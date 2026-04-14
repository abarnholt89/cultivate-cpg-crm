"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Role = "admin" | "rep" | "client" | null;

type CategoryReviewRow = {
  brand_id: string;
  retailer_id: string | null;
  retailer_name: string;
  retailer_category_review_name: string | null;
  universal_department: string | null;
  universal_category: string;
  review_date: string | null;
  reset_date: string | null;
};

type BrandChoice = {
  brand_id: string;
  brand_name: string;
};

function prettyDate(value: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function todayISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function addDaysISO(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

async function fetchAllRows<T>(query: any): Promise<T[]> {
  const pageSize = 1000;
  let from = 0;
  let allRows: T[] = [];

  while (true) {
    const { data, error } = await query.range(from, from + pageSize - 1);
    if (error) throw error;

    const rows = (data ?? []) as T[];
    allRows = allRows.concat(rows);

    if (rows.length < pageSize) break;
    from += pageSize;
  }

  return allRows;
}

export default function GlobalCategoryReviewPage() {
  const router = useRouter();
  const [rows, setRows] = useState<CategoryReviewRow[]>([]);
  const [error, setError] = useState("");
  const [role, setRole] = useState<Role>(null);
  const [search, setSearch] = useState("");
  const [dateFilter, setDateFilter] = useState("all");
  const [sortBy, setSortBy] = useState("none");
  const [loading, setLoading] = useState(true);

  const [showModal, setShowModal] = useState(false);
  const [selectedBrands, setSelectedBrands] = useState<BrandChoice[]>([]);
  const [selectedRow, setSelectedRow] = useState<CategoryReviewRow | null>(null);
  const [modalLoading, setModalLoading] = useState(false);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError("");

      try {
        const {
          data: { user },
          error: authError,
        } = await supabase.auth.getUser();

        if (authError) {
          setError(authError.message);
          setLoading(false);
          return;
        }

        if (!user) {
          setError("You must be signed in.");
          setLoading(false);
          return;
        }

        const { data: profile, error: profileError } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", user.id)
          .single();

        if (profileError) {
          setError(profileError.message);
          setLoading(false);
          return;
        }

        const nextRole = (profile?.role as Role) ?? null;
        setRole(nextRole);

        if (nextRole === "client") {
          router.replace("/brands");
          return;
        }

        let query = supabase
          .from("brand_category_review_view")
          .select(
            "brand_id,retailer_id,retailer_name,retailer_category_review_name,universal_department,universal_category,review_date,reset_date"
          )
          .order("review_date", { ascending: true, nullsFirst: false });

        if (nextRole === "client") {
          const { data: brandUsers, error: brandUsersError } = await supabase
            .from("brand_users")
            .select("brand_id")
            .eq("user_id", user.id);

          if (brandUsersError) {
            setError(brandUsersError.message);
            setLoading(false);
            return;
          }

          const brandIds = (brandUsers ?? []).map((row) => row.brand_id);

          if (brandIds.length === 0) {
            setRows([]);
            setLoading(false);
            return;
          }

          query = query.in("brand_id", brandIds);
        }

        if (nextRole === "rep") {
          const { data: ownedRetailers, error: ownedRetailersError } = await supabase
            .from("retailers")
            .select("id")
            .eq("rep_owner_user_id", user.id);

          if (ownedRetailersError) {
            setError(ownedRetailersError.message);
            setLoading(false);
            return;
          }

          const retailerIds = (ownedRetailers ?? []).map((row) => row.id);

          if (retailerIds.length === 0) {
            setRows([]);
            setLoading(false);
            return;
          }

          query = query.in("retailer_id", retailerIds);
        }

        const data = await fetchAllRows<CategoryReviewRow>(query);
        setRows(data ?? []);
      } catch (err: any) {
        setError(err?.message || "Failed to load category reviews.");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, []);

  useEffect(() => {
    if (role === "rep") {
      setDateFilter("next90");
    }
  }, [role]);

  async function handleRowClick(row: CategoryReviewRow) {
    if (!row.retailer_id) return;

    setSelectedRow(row);
    setSelectedBrands([]);
    setShowModal(true);
    setModalLoading(true);

    try {
      const { data: reviewRows, error: reviewError } = await supabase
        .from("brand_category_review_view")
        .select("brand_id")
        .eq("retailer_id", row.retailer_id)
        .eq("retailer_category_review_name", row.retailer_category_review_name);

      if (reviewError) {
        setError(reviewError.message);
        setModalLoading(false);
        return;
      }

      const brandIds = Array.from(
        new Set((reviewRows ?? []).map((r: any) => r.brand_id).filter(Boolean))
      );

      if (brandIds.length === 0) {
        setModalLoading(false);
        return;
      }

      const { data: brandRows, error: brandError } = await supabase
        .from("brands")
        .select("id,name")
        .in("id", brandIds)
        .order("name", { ascending: true });

      if (brandError) {
        setError(brandError.message);
        setModalLoading(false);
        return;
      }

      setSelectedBrands(
        (brandRows ?? []).map((b: any) => ({
          brand_id: b.id,
          brand_name: b.name,
        }))
      );
    } finally {
      setModalLoading(false);
    }
  }

  const finalRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const today = todayISO();
    const next90 = addDaysISO(today, 90);
    const last180 = addDaysISO(today, -180);

    let filtered = rows.filter((row) => {
      const matchesSearch =
        !q ||
        row.retailer_name.toLowerCase().includes(q) ||
        (row.retailer_category_review_name ?? "").toLowerCase().includes(q) ||
        row.universal_category.toLowerCase().includes(q) ||
        (row.universal_department ?? "").toLowerCase().includes(q);

      if (!matchesSearch) return false;

      if (dateFilter === "all") return true;
      if (dateFilter === "missing") return !row.review_date;
      if (!row.review_date) return false;

      if (dateFilter === "next90") {
        return row.review_date >= today && row.review_date <= next90;
      }

      if (dateFilter === "past") {
        return row.review_date >= last180 && row.review_date < today;
      }

      return true;
    });

    if (sortBy === "category") {
      filtered = [...filtered].sort((a, b) =>
        a.universal_category.localeCompare(b.universal_category)
      );
    }

    if (sortBy === "retailer") {
      filtered = [...filtered].sort((a, b) =>
        a.retailer_name.localeCompare(b.retailer_name)
      );
    }

    if (sortBy === "review_date") {
      filtered = [...filtered].sort((a, b) =>
        (a.review_date || "9999-12-31").localeCompare(b.review_date || "9999-12-31")
      );
    }

    return filtered;
  }, [rows, search, dateFilter, sortBy]);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Category Review</h1>
        {error ? <div className="text-red-600 text-sm mt-2">{error}</div> : null}
      </div>

      <div className="flex flex-col md:flex-row gap-3">
        <input
          className="border rounded px-3 py-2 w-full"
          placeholder="Search retailer, review, category..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <select
          className="border rounded px-3 py-2 bg-white"
          value={dateFilter}
          onChange={(e) => setDateFilter(e.target.value)}
        >
          <option value="all">All Dates</option>
          <option value="next90">Next 90 Days</option>
          <option value="past">Past Due</option>
          <option value="missing">Missing Review Date</option>
        </select>

        <select
          className="border rounded px-3 py-2 bg-white"
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
        >
          <option value="none">Sort</option>
          <option value="retailer">Retailer</option>
          <option value="category">Category</option>
          <option value="review_date">Review Date</option>
        </select>
      </div>

      {loading ? (
        <div>Loading…</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b">
                <th className="py-2 pr-4">Retailer</th>
                <th className="py-2 pr-4">Review</th>
                <th className="py-2 pr-4">Department</th>
                <th className="py-2 pr-4">Category</th>
                <th className="py-2 pr-4">Review Date</th>
                <th className="py-2 pr-4">Reset Date</th>
              </tr>
            </thead>
            <tbody>
              {finalRows.map((row, idx) => (
                <tr
                  key={`${row.brand_id}-${row.retailer_name}-${row.universal_category}-${row.review_date ?? "none"}-${idx}`}
                  className="border-b last:border-b-0"
                >
                  <td className="py-3 pr-4">
                    {row.retailer_id ? (
                      <span
                        onClick={() => handleRowClick(row)}
                        className="underline hover:text-black cursor-pointer"
                      >
                        {row.retailer_name}
                      </span>
                    ) : (
                      row.retailer_name
                    )}
                  </td>
                  <td className="py-3 pr-4">
                    {row.retailer_category_review_name || "—"}
                  </td>
                  <td className="py-3 pr-4">
                    {row.universal_department || "—"}
                  </td>
                  <td className="py-3 pr-4">{row.universal_category}</td>
                  <td className="py-3 pr-4">{prettyDate(row.review_date)}</td>
                  <td className="py-3 pr-4">{prettyDate(row.reset_date)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && selectedRow ? (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl p-6 w-[520px] max-h-[70vh] overflow-y-auto">
            <h3 className="font-semibold mb-4">
              Select Brand ({selectedBrands.length})
            </h3>

            {modalLoading ? (
              <div className="text-sm text-gray-600">Loading brands…</div>
            ) : (
              <div className="space-y-2">
                {selectedBrands.map((b) => (
                  <Link
                    key={b.brand_id}
                    href={`/brands/${b.brand_id}/retailers/${selectedRow.retailer_id}`}
                    className="block border rounded-lg p-3 hover:bg-gray-50"
                  >
                    <div className="font-medium">{b.brand_name}</div>
                  </Link>
                ))}
              </div>
            )}

            <button
              onClick={() => setShowModal(false)}
              className="mt-4 text-sm"
            >
              Close
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}