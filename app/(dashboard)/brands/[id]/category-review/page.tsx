"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Role = "admin" | "rep" | "client" | null;

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

type DismissalRow = {
  retailer_name: string;
  universal_category: string;
  retailer_category_review_name: string;
};

type DateOverrideRow = {
  retailer_name: string;
  universal_category: string;
  retailer_category_review_name: string;
  review_date: string | null;
  reset_date: string | null;
};

// Stable key identifying a review row across all three tables
function rowKey(
  retailerName: string,
  universalCategory: string,
  reviewName: string | null
) {
  return `${retailerName}||${universalCategory}||${reviewName ?? ""}`;
}

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
  const brandId = (Array.isArray(idParam) ? idParam[0] : idParam) as string;

  const [role, setRole] = useState<Role>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [brand, setBrand] = useState<Brand | null>(null);
  const [rows, setRows] = useState<CategoryReviewRow[]>([]);
  const [dismissals, setDismissals] = useState<Set<string>>(new Set());
  const [dateOverrides, setDateOverrides] = useState<Record<string, DateOverrideRow>>({});
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [dateFilter, setDateFilter] = useState("all");
  // Inline edit state: key → { field: "review_date"|"reset_date", value: string }
  const [dismissedSectionOpen, setDismissedSectionOpen] = useState(false);

  // Inline edit state: key → { field: "review_date"|"reset_date", value: string }
  const [editingCell, setEditingCell] = useState<{
    key: string;
    field: "review_date" | "reset_date";
    value: string;
  } | null>(null);
  const [savingCell, setSavingCell] = useState(false);

  const isRepOrAdmin = role === "admin" || role === "rep";

  useEffect(() => {
    if (!brandId) return;
    load();
  }, [brandId]);

  async function load() {
    setError("");

    // Auth + role
    const { data: authData } = await supabase.auth.getUser();
    const uid = authData?.user?.id ?? null;
    setUserId(uid);

    if (uid) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", uid)
        .single();
      setRole((profile?.role as Role) ?? "client");
    }

    // Brand
    const { data: brandData, error: brandError } = await supabase
      .from("brands")
      .select("id,name")
      .eq("id", brandId)
      .maybeSingle();

    if (brandError) { setError(brandError.message); return; }
    if (!brandData) { setError("Brand not found."); return; }
    setBrand(brandData);

    // Category review rows
    const { data, error: reviewError } = await supabase
      .from("brand_category_review_view")
      .select(
        "brand_id,retailer_id,retailer_name,retailer_category_review_name,universal_department,universal_category,review_date,reset_date"
      )
      .eq("brand_id", brandId)
      .order("review_date", { ascending: true, nullsFirst: false });

    if (reviewError) { setError(reviewError.message); return; }
    setRows((data as CategoryReviewRow[]) ?? []);

    // Dismissals
    const { data: dismissalData } = await supabase
      .from("brand_category_review_dismissals")
      .select("retailer_name,universal_category,retailer_category_review_name")
      .eq("brand_id", brandId);

    const dismissedKeys = new Set<string>(
      ((dismissalData as DismissalRow[]) ?? []).map((d) =>
        rowKey(d.retailer_name, d.universal_category, d.retailer_category_review_name)
      )
    );
    setDismissals(dismissedKeys);

    // Date overrides
    const { data: overrideData } = await supabase
      .from("brand_category_review_date_overrides")
      .select(
        "retailer_name,universal_category,retailer_category_review_name,review_date,reset_date"
      )
      .eq("brand_id", brandId);

    const overrideMap: Record<string, DateOverrideRow> = {};
    ((overrideData as DateOverrideRow[]) ?? []).forEach((o) => {
      overrideMap[rowKey(o.retailer_name, o.universal_category, o.retailer_category_review_name)] = o;
    });
    setDateOverrides(overrideMap);
  }

  async function dismiss(row: CategoryReviewRow) {
    if (!userId) return;
    const key = rowKey(row.retailer_name, row.universal_category, row.retailer_category_review_name);

    const { error } = await supabase
      .from("brand_category_review_dismissals")
      .upsert(
        {
          brand_id: brandId,
          retailer_name: row.retailer_name,
          retailer_id: row.retailer_id ?? null,
          universal_category: row.universal_category,
          retailer_category_review_name: row.retailer_category_review_name ?? "",
          review_date: row.review_date ?? null,
          dismissed_by_user_id: userId,
        },
        { onConflict: "brand_id,retailer_name,universal_category,retailer_category_review_name" }
      );

    if (error) { setError(error.message); return; }
    setDismissals((prev) => new Set([...prev, key]));
  }

  async function undismiss(row: CategoryReviewRow) {
    const { error } = await supabase
      .from("brand_category_review_dismissals")
      .delete()
      .eq("brand_id", brandId)
      .eq("retailer_name", row.retailer_name)
      .eq("universal_category", row.universal_category)
      .eq("retailer_category_review_name", row.retailer_category_review_name ?? "");

    if (error) { setError(error.message); return; }
    const key = rowKey(row.retailer_name, row.universal_category, row.retailer_category_review_name);
    setDismissals((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }

  function startEdit(row: CategoryReviewRow, field: "review_date" | "reset_date") {
    if (!isRepOrAdmin) return;
    const key = rowKey(row.retailer_name, row.universal_category, row.retailer_category_review_name);
    const override = dateOverrides[key];
    const currentValue =
      field === "review_date"
        ? (override?.review_date ?? row.review_date ?? "")
        : (override?.reset_date ?? row.reset_date ?? "");
    setEditingCell({ key, field, value: currentValue });
  }

  async function commitEdit(row: CategoryReviewRow) {
    if (!editingCell || !userId) return;
    setSavingCell(true);

    const key = rowKey(row.retailer_name, row.universal_category, row.retailer_category_review_name);
    const existing = dateOverrides[key];

    const patch: Record<string, any> = {
      brand_id: brandId,
      retailer_name: row.retailer_name,
      retailer_id: row.retailer_id ?? null,
      universal_category: row.universal_category,
      retailer_category_review_name: row.retailer_category_review_name ?? "",
      updated_by_user_id: userId,
      updated_at: new Date().toISOString(),
      // preserve the other date from existing override or original row
      review_date: editingCell.field === "review_date"
        ? (editingCell.value || null)
        : (existing?.review_date ?? row.review_date ?? null),
      reset_date: editingCell.field === "reset_date"
        ? (editingCell.value || null)
        : (existing?.reset_date ?? row.reset_date ?? null),
    };

    const { error } = await supabase
      .from("brand_category_review_date_overrides")
      .upsert(patch, {
        onConflict: "brand_id,retailer_name,universal_category,retailer_category_review_name",
      });

    setSavingCell(false);

    if (error) { setError(error.message); setEditingCell(null); return; }

    setDateOverrides((prev) => ({
      ...prev,
      [key]: {
        retailer_name: row.retailer_name,
        universal_category: row.universal_category,
        retailer_category_review_name: row.retailer_category_review_name ?? "",
        review_date: patch.review_date,
        reset_date: patch.reset_date,
      },
    }));
    setEditingCell(null);
  }

  // Merge view data with overrides
  const mergedRows = useMemo<CategoryReviewRow[]>(() => {
    return rows.map((row) => {
      const key = rowKey(row.retailer_name, row.universal_category, row.retailer_category_review_name);
      const override = dateOverrides[key];
      if (!override) return row;
      return {
        ...row,
        review_date: override.review_date ?? row.review_date,
        reset_date: override.reset_date ?? row.reset_date,
      };
    });
  }, [rows, dateOverrides]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const today = todayISO();
    const next30 = addDaysISO(today, 30);
    const next90 = addDaysISO(today, 90);

    return mergedRows.filter((row) => {
      const key = rowKey(row.retailer_name, row.universal_category, row.retailer_category_review_name);
      if (dismissals.has(key)) return false;

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
      if (dateFilter === "next30") return row.review_date >= today && row.review_date <= next30;
      if (dateFilter === "next90") return row.review_date >= today && row.review_date <= next90;
      if (dateFilter === "past") return row.review_date < today;
      return true;
    });
  }, [mergedRows, dismissals, search, dateFilter]);

  const dismissedRows = useMemo(() => {
    if (!isRepOrAdmin) return [];
    return mergedRows.filter((row) =>
      dismissals.has(rowKey(row.retailer_name, row.universal_category, row.retailer_category_review_name))
    );
  }, [mergedRows, dismissals, isRepOrAdmin]);

  const stats = useMemo(() => {
    const today = todayISO();
    const next30 = addDaysISO(today, 30);
    const next90 = addDaysISO(today, 90);
    let next30Count = 0, next90Count = 0, pastDueCount = 0, missingCount = 0;

    const activeRows = mergedRows.filter(
      (r) => !dismissals.has(rowKey(r.retailer_name, r.universal_category, r.retailer_category_review_name))
    );

    activeRows.forEach((row) => {
      if (!row.review_date) { missingCount++; return; }
      if (row.review_date < today) pastDueCount++;
      if (row.review_date >= today && row.review_date <= next30) next30Count++;
      if (row.review_date >= today && row.review_date <= next90) next90Count++;
    });

    return { total: activeRows.length, next30: next30Count, next90: next90Count, pastDue: pastDueCount, missing: missingCount };
  }, [mergedRows, dismissals]);

  if (!brandId) return <div className="p-6">No brand ID in URL.</div>;

  return (
    <div className="p-6 space-y-6">
      <Link href={`/brands/${brandId}`} className="underline text-sm" style={{ color: "var(--muted-foreground)" }}>
        ← Back to Brand Dashboard
      </Link>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold mt-2" style={{ color: "var(--foreground)" }}>
            {brand?.name ?? "Brand"} — Category Review
          </h1>
          <p className="mt-1 text-sm" style={{ color: "var(--muted-foreground)" }}>
            Master category review and reset calendar for this brand's assigned categories.
          </p>
          {error ? <div className="text-red-600 text-sm mt-2">{error}</div> : null}
        </div>

        {/* Nav tabs */}
        <div className="flex gap-2 text-sm flex-wrap">
          <Link href={`/brands/${brandId}`} className="px-3 py-1.5 rounded border hover:bg-gray-50">
            Overview
          </Link>
          <Link href={`/brands/${brandId}/retailers`} className="px-3 py-1.5 rounded border hover:bg-gray-50">
            Retailers
          </Link>
          {isRepOrAdmin && (
            <Link href="/board" className="px-3 py-1.5 rounded border hover:bg-gray-50">
              Board
            </Link>
          )}
          <span
            className="px-3 py-1.5 rounded border text-white"
            style={{ background: "var(--foreground)" }}
          >
            Category Review
          </span>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <StatCard label="Total Rows" value={stats.total} />
        <StatCard label="Next 30 Days" value={stats.next30} />
        <StatCard label="Next 90 Days" value={stats.next90} />
        <StatCard label="Past Due" value={stats.pastDue} />
        <StatCard label="Missing Date" value={stats.missing} />
      </div>

      {/* Filters */}
      <div
        className="rounded-xl p-4 space-y-4"
        style={{ border: "1px solid var(--border)", background: "var(--card)" }}
      >
        <div className="flex flex-wrap items-center gap-3">
          <input
            className="flex-1 min-w-48 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2"
            style={{ border: "1px solid var(--border)", background: "var(--muted)", color: "var(--foreground)" }}
            placeholder="Search retailer, review name, department, or category…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          <select
            className="rounded-lg px-3 py-2 text-sm"
            style={{ border: "1px solid var(--border)", background: "var(--muted)", color: "var(--foreground)" }}
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
          <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
            No category review rows match your current filters.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)", color: "var(--muted-foreground)" }}>
                  <th className="text-left py-2 pr-4 font-medium">Retailer</th>
                  <th className="text-left py-2 pr-4 font-medium">Retailer Review Name</th>
                  <th className="text-left py-2 pr-4 font-medium">Department</th>
                  <th className="text-left py-2 pr-4 font-medium">Universal Category</th>
                  <th className="text-left py-2 pr-4 font-medium">
                    Review Date
                    {isRepOrAdmin && (
                      <span className="ml-1 text-xs font-normal opacity-60">(click to edit)</span>
                    )}
                  </th>
                  <th className="text-left py-2 pr-4 font-medium">
                    Reset Date
                    {isRepOrAdmin && (
                      <span className="ml-1 text-xs font-normal opacity-60">(click to edit)</span>
                    )}
                  </th>
                  {isRepOrAdmin && <th className="w-20" />}
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row, idx) => {
                  const key = rowKey(row.retailer_name, row.universal_category, row.retailer_category_review_name);
                  const hasOverride = !!dateOverrides[key];
                  const editingReview = editingCell?.key === key && editingCell.field === "review_date";
                  const editingReset = editingCell?.key === key && editingCell.field === "reset_date";

                  return (
                    <tr
                      key={`${key}-${idx}`}
                      style={{
                        borderBottom: "1px solid var(--border)",
                        background: idx % 2 === 0 ? "transparent" : "var(--muted)",
                      }}
                    >
                      {/* Retailer */}
                      <td className="py-3 pr-4" style={{ color: "var(--foreground)" }}>
                        {row.retailer_id ? (
                          <Link
                            href={`/brands/${brandId}/retailers/${row.retailer_id}`}
                            className="underline"
                            style={{ color: "var(--foreground)" }}
                          >
                            {row.retailer_name}
                          </Link>
                        ) : (
                          row.retailer_name
                        )}
                      </td>

                      {/* Retailer review name */}
                      <td className="py-3 pr-4" style={{ color: "var(--foreground)" }}>
                        {row.retailer_category_review_name || "—"}
                      </td>

                      {/* Department */}
                      <td className="py-3 pr-4" style={{ color: "var(--muted-foreground)" }}>
                        {row.universal_department || "—"}
                      </td>

                      {/* Universal category */}
                      <td className="py-3 pr-4" style={{ color: "var(--foreground)" }}>
                        {row.universal_category}
                      </td>

                      {/* Review date — inline editable */}
                      <td className="py-3 pr-4">
                        {editingReview ? (
                          <input
                            autoFocus
                            type="date"
                            className="rounded px-2 py-1 text-sm"
                            style={{ border: "1px solid var(--border)", background: "var(--card)", color: "var(--foreground)" }}
                            value={editingCell.value}
                            onChange={(e) =>
                              setEditingCell((c) => c ? { ...c, value: e.target.value } : c)
                            }
                            onBlur={() => commitEdit(row)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") commitEdit(row);
                              if (e.key === "Escape") setEditingCell(null);
                            }}
                            disabled={savingCell}
                          />
                        ) : (
                          <span
                            onClick={() => startEdit(row, "review_date")}
                            className={isRepOrAdmin ? "cursor-pointer hover:underline" : ""}
                            style={{
                              color: hasOverride && dateOverrides[key]?.review_date !== row.review_date
                                ? "var(--primary)"
                                : "var(--foreground)",
                            }}
                            title={isRepOrAdmin ? "Click to edit" : undefined}
                          >
                            {prettyDate(row.review_date)}
                          </span>
                        )}
                      </td>

                      {/* Reset date — inline editable */}
                      <td className="py-3 pr-4">
                        {editingReset ? (
                          <input
                            autoFocus
                            type="date"
                            className="rounded px-2 py-1 text-sm"
                            style={{ border: "1px solid var(--border)", background: "var(--card)", color: "var(--foreground)" }}
                            value={editingCell.value}
                            onChange={(e) =>
                              setEditingCell((c) => c ? { ...c, value: e.target.value } : c)
                            }
                            onBlur={() => commitEdit(row)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") commitEdit(row);
                              if (e.key === "Escape") setEditingCell(null);
                            }}
                            disabled={savingCell}
                          />
                        ) : (
                          <span
                            onClick={() => startEdit(row, "reset_date")}
                            className={isRepOrAdmin ? "cursor-pointer hover:underline" : ""}
                            style={{
                              color: hasOverride && dateOverrides[key]?.reset_date !== row.reset_date
                                ? "var(--primary)"
                                : "var(--foreground)",
                            }}
                            title={isRepOrAdmin ? "Click to edit" : undefined}
                          >
                            {prettyDate(row.reset_date)}
                          </span>
                        )}
                      </td>

                      {/* Dismiss */}
                      {isRepOrAdmin && (
                        <td className="py-3 text-right">
                          <button
                            className="text-xs"
                            style={{ color: "var(--muted-foreground)" }}
                            title="Dismiss from this brand's view"
                            onClick={() => dismiss(row)}
                          >
                            ✕
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Dismissed reviews — collapsible, reps/admins only */}
      {isRepOrAdmin && dismissedRows.length > 0 && (
        <div>
          <button
            className="text-sm"
            style={{ color: "var(--muted-foreground)" }}
            onClick={() => setDismissedSectionOpen((v) => !v)}
          >
            {dismissedSectionOpen ? "▾" : "▸"} Dismissed reviews ({dismissedRows.length})
          </button>

          {dismissedSectionOpen && (
            <div
              className="mt-3 rounded-xl overflow-x-auto"
              style={{ border: "1px solid var(--border)", background: "var(--card)" }}
            >
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border)", color: "var(--muted-foreground)" }}>
                    <th className="text-left py-2 px-4 font-medium">Retailer</th>
                    <th className="text-left py-2 px-4 font-medium">Review Name</th>
                    <th className="text-left py-2 px-4 font-medium">Universal Category</th>
                    <th className="text-left py-2 px-4 font-medium">Review Date</th>
                    <th className="text-left py-2 px-4 font-medium">Reset Date</th>
                    <th className="w-20" />
                  </tr>
                </thead>
                <tbody>
                  {dismissedRows.map((row, idx) => (
                    <tr
                      key={`dismissed-${idx}`}
                      style={{
                        borderBottom: idx < dismissedRows.length - 1 ? "1px solid var(--border)" : undefined,
                        opacity: 0.65,
                      }}
                    >
                      <td className="py-2.5 px-4" style={{ color: "var(--foreground)" }}>{row.retailer_name}</td>
                      <td className="py-2.5 px-4" style={{ color: "var(--foreground)" }}>{row.retailer_category_review_name || "—"}</td>
                      <td className="py-2.5 px-4" style={{ color: "var(--foreground)" }}>{row.universal_category}</td>
                      <td className="py-2.5 px-4" style={{ color: "var(--foreground)" }}>{prettyDate(row.review_date)}</td>
                      <td className="py-2.5 px-4" style={{ color: "var(--foreground)" }}>{prettyDate(row.reset_date)}</td>
                      <td className="py-2.5 px-4 text-right">
                        <button
                          className="text-xs underline"
                          style={{ color: "var(--muted-foreground)" }}
                          onClick={() => undismiss(row)}
                        >
                          Restore
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div
      className="rounded-xl p-4"
      style={{ border: "1px solid var(--border)", background: "var(--card)" }}
    >
      <div className="text-2xl font-bold" style={{ color: "var(--foreground)" }}>{value}</div>
      <div className="text-sm mt-1" style={{ color: "var(--muted-foreground)" }}>{label}</div>
    </div>
  );
}
