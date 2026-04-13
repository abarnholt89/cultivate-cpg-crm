"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
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
  const [rows, setRows] = useState<CategoryReviewRow[]>([]);
  const [error, setError] = useState("");
  const [role, setRole] = useState<Role>(null);
  const [search, setSearch] = useState("");
  const [dateFilter, setDateFilter] = useState("all");
  const [loading, setLoading] = useState(true);

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

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const today = todayISO();
    const next30 = addDaysISO(today, 30);
    const next90 = addDaysISO(today, 90);
    const last180 = addDaysISO(today, -180);

    return rows.filter((row) => {
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

      if (dateFilter === "next30") {
        return row.review_date >= today && row.review_date <= next30;
      }

      if (dateFilter === "next90") {
        return row.review_date >= today && row.review_date <= next90;
      }

      if (dateFilter === "past") {
        return row.review_date >= last180 && row.review_date < today;
      }

      return true;
    });
  }, [rows, search, dateFilter]);

  const stats = useMemo(() => {
    const today = todayISO();
    const next30 = addDaysISO(today, 30);
    const next90 = addDaysISO(today, 90);
    const last180 = addDaysISO(today, -180);

    let next30Count = 0;
    let next90Count = 0;
    let pastDueCount = 0;
    let missingCount = 0;

    rows.forEach((row) => {
      if (!row.review_date) {
        missingCount++;
        return;
      }

      if (row.review_date >= last180 && row.review_date < today) {
        pastDueCount++;
      }

      if (row.review_date >= today && row.review_date <= next30) {
        next30Count++;
      }

      if (row.review_date >= today && row.review_date <= next90) {
        next90Count++;
      }
    });

    return {
      total: rows.length,
      next30: next30Count,
      next90: next90Count,
      pastDue: pastDueCount,
      missing: missingCount,
    };
  }, [rows]);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Category Review</h1>
        <p className="text-gray-600 mt-1">
          Master category review and reset calendar across brands.
        </p>
        {role ? (
          <p className="text-sm text-gray-500 mt-1">
            Viewing as: <span className="font-medium">{role}</span>
          </p>
        ) : null}
        {error ? <div className="text-red-600 text-sm mt-2">{error}</div> : null}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <StatCard label="Total Rows" value={stats.total} />
        <StatCard label="Next 30 Days" value={stats.next30} />
        <StatCard label="Next 90 Days" value={stats.next90} />
        <StatCard label="Past Due" value={stats.pastDue} />
        <StatCard label="Missing Review Date" value={stats.missing} />
      </div>

      <div className="border rounded-xl p-4 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <input
            className="border rounded px-3 py-2 w-full"
            placeholder="Search retailer, review name, department, or category..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          <select
            className="border rounded px-3 py-2 w-full bg-white"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
          >
            <option value="all">All Dates</option>
            <option value="next30">Next 30 Days</option>
            <option value="next90">Next 90 Days</option>
            <option value="past">Past Due</option>
            <option value="missing">Missing Review Date</option>
          </select>
        </div>

        {loading ? (
          <p className="text-sm text-gray-600">Loading category review rows…</p>
        ) : filteredRows.length === 0 ? (
          <p className="text-sm text-gray-600">
            No category review rows match your current filters.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b">
                  <th className="py-2 pr-4">Retailer</th>
                  <th className="py-2 pr-4">Retailer Review Name</th>
                  <th className="py-2 pr-4">Department</th>
                  <th className="py-2 pr-4">Universal Category</th>
                  <th className="py-2 pr-4">Review Date</th>
                  <th className="py-2 pr-4">Reset Date</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row, idx) => (
                  <tr
                    key={`${row.brand_id}-${row.retailer_name}-${row.universal_category}-${row.review_date ?? "none"}-${idx}`}
                    className="border-b last:border-b-0"
                  >
                    <td className="py-3 pr-4">
                      {row.retailer_id ? (
                        <Link
                          href={`/brands/${row.brand_id}/retailers/${row.retailer_id}`}
                          className="underline hover:text-black"
                        >
                          {row.retailer_name}
                        </Link>
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
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <div className="border rounded-lg p-4">
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-sm text-gray-600 mt-1">{label}</div>
    </div>
  );
}