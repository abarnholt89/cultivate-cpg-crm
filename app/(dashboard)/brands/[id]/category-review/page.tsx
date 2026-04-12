"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Brand = {
  id: string;
  name: string;
};

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

export default function BrandCategoryReviewPage() {
  const params = useParams();
  const idParam = params?.id;
  const brandId = Array.isArray(idParam) ? idParam[0] : idParam;

  const [brand, setBrand] = useState<Brand | null>(null);
  const [rows, setRows] = useState<CategoryReviewRow[]>([]);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [dateFilter, setDateFilter] = useState("all");

  useEffect(() => {
    if (!brandId) return;

    async function load() {
      setError("");
const {
  data: { user },
} = await supabase.auth.getUser();

const { data: profile } = await supabase
  .from("profiles")
  .select("role")
  .eq("id", user?.id)
  .single();

const role = profile?.role;
      const { data: brandData, error: brandError } = await supabase
        .from("brands")
        .select("id,name")
        .eq("id", brandId)
        .maybeSingle();

      if (brandError) {
        setError(brandError.message);
        return;
      }

      if (!brandData) {
        setError("Brand not found.");
        return;
      }

      setBrand(brandData);

let query = supabase
  .from("brand_category_review_view")
  .select(
    "brand_id,retailer_id,retailer_name,retailer_category_review_name,universal_department,universal_category,review_date,reset_date"
  )
  .order("review_date", { ascending: true, nullsFirst: false });

// only restrict clients
// only restrict clients
if (role === "client") {
  query = query.eq("brand_id", brandId);
}

const { data, error: reviewError } = await query;

      if (reviewError) {
        setError(reviewError.message);
        return;
      }

      setRows((data as CategoryReviewRow[]) ?? []);
    }

    load();
  }, [brandId]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const today = todayISO();
    const next30 = addDaysISO(today, 30);
    const next90 = addDaysISO(today, 90);

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
        return row.review_date < today;
      }

      return true;
    });
  }, [rows, search, dateFilter]);

  const stats = useMemo(() => {
    const today = todayISO();
    const next30 = addDaysISO(today, 30);
    const next90 = addDaysISO(today, 90);

    let next30Count = 0;
    let next90Count = 0;
    let pastDueCount = 0;
    let missingCount = 0;

    rows.forEach((row) => {
      if (!row.review_date) {
        missingCount++;
        return;
      }

      if (row.review_date < today) {
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

  if (!brandId) {
    return <div className="p-6">No brand ID in URL.</div>;
  }

  return (
    <div className="p-6 space-y-6">
      <Link href={`/brands/${brandId}`} className="underline text-sm">
        ← Back to Brand Dashboard
      </Link>

      <div>
        <h1 className="text-3xl font-bold mt-2">
          {brand?.name ?? "Brand"} — Category Review
        </h1>
        <p className="text-gray-600 mt-1">
          Master category review and reset calendar for this brand’s assigned categories.
        </p>
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

        {filteredRows.length === 0 ? (
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
                    key={`${row.retailer_name}-${row.universal_category}-${row.review_date ?? "none"}-${idx}`}
                    className="border-b last:border-b-0"
                  >
                    <td className="py-3 pr-4">
                      {row.retailer_id ? (
                        <Link
                          href={`/brands/${brandId}/retailers/${row.retailer_id}`}
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