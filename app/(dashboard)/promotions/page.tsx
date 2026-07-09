"use client";

import React, { useEffect, useMemo, useState, Suspense } from "react";
import { supabase } from "@/lib/supabaseClient";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

type Role = "admin" | "rep" | "client" | null;

type PromotionRow = {
  id: string;
  brand_id: string | null;
  retailer_id: string | null;
  brand_name: string;
  retailer_name: string;
  retailer_banner: string | null;
  distributor: string | null;
  cultivate_rep: string | null;
  sku_description: string;
  unit_upc: string | null;
  promo_year: number;
  promo_month: number;
  promo_name: string | null;
  promo_type: string;
  promo_status: string;
  promo_scope: "retailer" | "distributor" | null;
  start_date: string | null;
  end_date: string | null;
  discount_percent: number | null;
  discount_amount: number | null;
  promo_text_raw: string | null;
  notes: string | null;
};

type DistributorGroup = {
  key: string;
  distributor: string;
  brand_name: string;
  promo_year: number;
  promo_month: number;
  promo_name: string | null;
  promo_type: string;
  promo_status: string;
  start_date: string | null;
  end_date: string | null;
  promo_text_raw: string | null;
  rows: PromotionRow[];
};

type RetailerPromoGroup = {
  key: string;
  promo_year: number;
  promo_month: number;
  promo_name: string | null;
  promo_type: string;
  promo_status: string;
  start_date: string | null;
  end_date: string | null;
  promo_text_raw: string | null;
  rows: PromotionRow[];
};

type RetailerBrandGroup = {
  key: string;
  brand_id: string | null;
  brand_name: string;
  rows: PromotionRow[];
  promoGroups: RetailerPromoGroup[];
};

type RetailerGroup = {
  key: string;
  retailer_name: string;
  retailer_banner: string | null;
  distributors: string[];
  rows: PromotionRow[];
  brandGroups: RetailerBrandGroup[];
};

type BrandOption = { id: string; name: string };
type RetailerOption = { id: string; name: string; banner: string | null; distributor: string | null };
type SkuOption = { upc: string; sku_description: string };

type BulkForm = {
  promo_type: string;
  promo_status: string;
  promo_scope: "retailer" | "distributor";
  start_date: string;
  end_date: string;
  discount_percent: string;
  discount_amount: string;
  promo_name: string;
  notes: string;
};

// Bulk edit at the promotion-group level. Fields here are the union of the
// group's shared key columns (promo_name, promo_type, start/end date) plus
// the non-key fields users want to write to every SKU at once (discount,
// status, notes, promo_text). Strings throughout — coerced on save.
type GroupEditForm = {
  promo_name: string;
  promo_type: string;
  promo_status: string;
  start_date: string;
  end_date: string;
  discount_percent: string;
  discount_amount: string;
  promo_text_raw: string;
  notes: string;
};

type EditForm = {
  brand_name: string;
  retailer_name: string;
  distributor: string;
  cultivate_rep: string;
  sku_description: string;
  unit_upc: string;
  promo_year: string;
  promo_month: string;
  promo_name: string;
  promo_type: string;
  promo_status: string;
  start_date: string;
  end_date: string;
  discount_percent: string;
  discount_amount: string;
  promo_text_raw: string;
  notes: string;
};

const EMPTY_BULK_FORM: BulkForm = {
  promo_type: "TPR",
  promo_status: "confirmed",
  promo_scope: "retailer",
  start_date: "",
  end_date: "",
  discount_percent: "",
  discount_amount: "",
  promo_name: "",
  notes: "",
};

// ── helpers ───────────────────────────────────────────────────────────────────

function monthLabel(month: number) {
  return new Date(2026, month - 1, 1).toLocaleString(undefined, { month: "short" });
}

function monthLabelLong(month: number) {
  return new Date(2026, month - 1, 1).toLocaleString(undefined, { month: "long" });
}

function prettyDate(value: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function getPromoStart(rows: PromotionRow[]) {
  return rows.map((r) => r.start_date).filter(Boolean).sort()[0] ?? null;
}

function getPromoEnd(rows: PromotionRow[]) {
  const dates = rows.map((r) => r.end_date).filter(Boolean).sort();
  return dates.length ? dates[dates.length - 1] : null;
}

function discountLabel(row: PromotionRow) {
  const parts: string[] = [];
  if (row.discount_percent != null) parts.push(`${row.discount_percent}%`);
  if (row.discount_amount != null) parts.push(`$${row.discount_amount}`);
  return parts.join(" • ");
}

function normalizeText(value: string | null | undefined) {
  return (value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function skuKey(row: PromotionRow) {
  const upc = normalizeText(row.unit_upc);
  if (upc) return `upc:${upc}`;
  const desc = normalizeText(row.sku_description);
  if (desc) return `desc:${desc}`;
  return `row:${row.id}`;
}

function uniqueSkuCount(rows: PromotionRow[]) {
  return new Set(rows.map(skuKey)).size;
}

function isEdlpEdlc(row: PromotionRow) {
  const t = (row.promo_type || "").toUpperCase();
  const n = (row.promo_name || "").toUpperCase();
  return t.includes("EDLP") || t.includes("EDLC") || n.includes("EDLP") || n.includes("EDLC");
}

function isEdlpEdlcGroup(pg: { promo_type: string; promo_name: string | null }) {
  const t = (pg.promo_type || "").toUpperCase();
  const n = (pg.promo_name || "").toUpperCase();
  return t.includes("EDLP") || t.includes("EDLC") || n.includes("EDLP") || n.includes("EDLC");
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function remapStatus(s: string): string {
  if (s === "approved") return "submitted";
  if (s === "cancelled") return "completed";
  return s;
}

function applyDisplayStatus(row: PromotionRow): PromotionRow {
  const today = todayISO();
  const status = remapStatus(row.promo_status);
  let display = status;
  if (row.end_date && row.end_date < today) {
    display = "completed";
  } else if (row.start_date && row.end_date && row.start_date <= today && row.end_date >= today) {
    if (status !== "submitted") display = "live";
  }
  return display === row.promo_status ? row : { ...row, promo_status: display };
}

function normalizeStageRow(r: any): PromotionRow {
  return {
    id: String(r.id),
    brand_id: r.brand_id ?? null,
    retailer_id: r.retailer_id ?? null,
    brand_name: r.brand_name ?? "",
    retailer_name: r.retailer_name ?? "",
    retailer_banner: r.retailer_banner ?? null,
    distributor: r.distributor ?? null,
    cultivate_rep: r.cultivate_rep ?? null,
    sku_description: r.sku_description ?? "",
    unit_upc: r.unit_upc ?? null,
    promo_year: Number(r.promo_year) || 0,
    promo_month: Number(r.promo_month) || 0,
    promo_name: r.promo_name ?? null,
    promo_type: r.promo_type ?? "",
    promo_status: remapStatus(r.promo_status ?? ""),
    promo_scope: r.promo_scope ?? null,
    start_date: r.start_date ?? null,
    end_date: r.end_date ?? null,
    discount_percent: r.discount_percent != null ? Number(r.discount_percent) : null,
    discount_amount: r.discount_amount != null ? Number(r.discount_amount) : null,
    promo_text_raw: r.promo_text_raw ?? null,
    notes: r.notes ?? null,
  };
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

function isDistributorRow(row: PromotionRow) {
  const scope = (row.promo_scope || "").toLowerCase();
  const promoName = (row.promo_name || "").toLowerCase();
  const promoType = (row.promo_type || "").toLowerCase();
  const hasRetailerName = Boolean(row.retailer_name && row.retailer_name.trim() !== "");
  const retailerName = (row.retailer_name || "").toLowerCase();
  return (
    scope === "distributor" ||
    promoName === "distributor oi" ||
    promoType === "distributor oi" ||
    (!hasRetailerName && Boolean(row.distributor)) ||
    retailerName === "distributor" ||
    retailerName === "distributor oi"
  );
}

function splitPromotions(rows: PromotionRow[]) {
  const distributorSupport = rows.filter(isDistributorRow);
  const retailerActivations = rows.filter((r) => !isDistributorRow(r));
  return { distributorSupport, retailerActivations };
}

function groupDistributorSupport(rows: PromotionRow[]): DistributorGroup[] {
  const grouped = new Map<string, DistributorGroup>();
  for (const row of rows) {
    const key = [row.distributor || "Distributor Program", row.promo_year, row.promo_month, row.brand_name].join("||");
    if (!grouped.has(key)) {
      grouped.set(key, { key, distributor: row.distributor || "Distributor Program", brand_name: row.brand_name, promo_year: row.promo_year, promo_month: row.promo_month, promo_name: row.promo_name, promo_type: row.promo_type, promo_status: row.promo_status, start_date: row.start_date, end_date: row.end_date, promo_text_raw: row.promo_text_raw, rows: [] });
    }
    grouped.get(key)!.rows.push(row);
  }
  return Array.from(grouped.values()).sort((a, b) => {
    if (a.promo_year !== b.promo_year) return b.promo_year - a.promo_year;
    if (a.promo_month !== b.promo_month) return b.promo_month - a.promo_month;
    if (a.distributor !== b.distributor) return a.distributor.localeCompare(b.distributor);
    return a.brand_name.localeCompare(b.brand_name);
  });
}

// Distributor values that should not be shown as sub-detail labels
const JUNK_DISTRIBUTORS = new Set([
  "TBD", "WHSE", "GMI", "Renaissance", "Winebow", "Chex", "Chex Finer Foods",
  "Carmela Foods", "Fortune", "Rain Forest", "Rainforest", "Threshold",
]);

function isRealDistributor(d: string): boolean {
  if (!d || JUNK_DISTRIBUTORS.has(d)) return false;
  if (/^\d+$/.test(d.trim())) return false; // purely numeric = account number
  return true;
}

function groupRetailerActivations(rows: PromotionRow[]): RetailerGroup[] {
  const retailerMap = new Map<string, RetailerGroup>();
  for (const row of rows) {
    // Key on retailer_id when present so all raw name variants (e.g. "Whole Foods Market",
    // "Whole Foods (SoCal, NorCal, NE)") that share the same DB retailer merge into one card.
    // Fall back to retailer_name for rows where retailer_id is null.
    const retailerKey = row.retailer_id ?? row.retailer_name ?? "Unknown Retailer";
    if (!retailerMap.has(retailerKey)) {
      // Use banner as the display name (clean DB name); fall back to retailer_name
      const displayName = row.retailer_banner || row.retailer_name || "Unknown Retailer";
      retailerMap.set(retailerKey, { key: retailerKey, retailer_name: displayName, retailer_banner: row.retailer_banner ?? null, distributors: [], rows: [], brandGroups: [] });
    }
    const rg = retailerMap.get(retailerKey)!;
    rg.rows.push(row);
    // Pick up the first non-null banner
    if (!rg.retailer_banner && row.retailer_banner) {
      rg.retailer_banner = row.retailer_banner;
      rg.retailer_name = row.retailer_banner;
    }
    // Collect real distributor names only
    if (row.distributor && isRealDistributor(row.distributor) && !rg.distributors.includes(row.distributor)) {
      rg.distributors.push(row.distributor);
    }
  }
  const retailerGroups = Array.from(retailerMap.values());
  for (const retailerGroup of retailerGroups) {
    const brandMap = new Map<string, RetailerBrandGroup>();
    for (const row of retailerGroup.rows) {
      const brandKey = `${retailerGroup.key}||${row.brand_name || row.brand_id || "unknown"}`;
      if (!brandMap.has(brandKey)) {
        brandMap.set(brandKey, { key: brandKey, brand_id: row.brand_id, brand_name: row.brand_name, rows: [], promoGroups: [] });
      }
      brandMap.get(brandKey)!.rows.push(row);
    }
    const brandGroups = Array.from(brandMap.values());
    for (const brandGroup of brandGroups) {
      const promoMap = new Map<string, RetailerPromoGroup>();
      for (const row of brandGroup.rows) {
        const promoKey = [brandGroup.key, row.promo_year, row.promo_month, row.promo_name || "", row.promo_type, row.start_date || "", row.end_date || ""].join("||");
        if (!promoMap.has(promoKey)) {
          promoMap.set(promoKey, { key: promoKey, promo_year: row.promo_year, promo_month: row.promo_month, promo_name: row.promo_name, promo_type: row.promo_type, promo_status: row.promo_status, start_date: row.start_date, end_date: row.end_date, promo_text_raw: row.promo_text_raw, rows: [] });
        }
        promoMap.get(promoKey)!.rows.push(row);
      }
      brandGroup.promoGroups = Array.from(promoMap.values()).sort((a, b) => {
        if (a.promo_year !== b.promo_year) return b.promo_year - a.promo_year;
        if (a.promo_month !== b.promo_month) return b.promo_month - a.promo_month;
        return (a.promo_name || a.promo_type).localeCompare(b.promo_name || b.promo_type);
      });
    }
    retailerGroup.brandGroups = brandGroups.sort((a, b) => a.brand_name.localeCompare(b.brand_name));
  }
  return retailerGroups.sort((a, b) => (a.retailer_banner || a.retailer_name).localeCompare(b.retailer_banner || b.retailer_name));
}

// ── component ─────────────────────────────────────────────────────────────────

function PromotionsInner() {
  const searchParams = useSearchParams();
  const brandIdParam = searchParams.get("brand");

  const [role, setRole] = useState<Role>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [promotions, setPromotions] = useState<PromotionRow[]>([]);
  const [filtered, setFiltered] = useState<PromotionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");

  // Expand/collapse
  const [expandedRetailers, setExpandedRetailers] = useState<Record<string, boolean>>({});
  const [expandedDistributorGroups, setExpandedDistributorGroups] = useState<Record<string, boolean>>({});
  const [expandedBrands, setExpandedBrands] = useState<Record<string, boolean>>({});
  const [expandedPromoGroups, setExpandedPromoGroups] = useState<Record<string, boolean>>({});

  // Filters
  const [yearFilter, setYearFilter] = useState("all");
  const [brandFilter, setBrandFilter] = useState("all");
  const [retailerFilter, setRetailerFilter] = useState("all");
  const [monthFilter, setMonthFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [repFilter, setRepFilter] = useState("all");
  const [scopeFilter, setScopeFilter] = useState("all");
  const [hideEdlp, setHideEdlp] = useState(true); // Feature 1

  // Inline edit + delete
  const [editingRow, setEditingRow] = useState<PromotionRow | null>(null);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");
  const [deletingItem, setDeletingItem] = useState<PromotionRow | null>(null);
  const [deletingPromoGroupKey, setDeletingPromoGroupKey] = useState<string | null>(null);

  // Bulk group edit modal. We stash brandName + retailerName alongside the
  // group because the UPDATE WHERE clause needs them and they're not on the
  // RetailerPromoGroup struct itself. groupEditInitial captures the form's
  // starting values so the dirty check below is just value !== initial.
  const [groupEditing, setGroupEditing] = useState<
    | { pg: RetailerPromoGroup; brandName: string; retailerName: string }
    | null
  >(null);
  const [groupEditForm, setGroupEditForm] = useState<GroupEditForm | null>(null);
  const [groupEditInitial, setGroupEditInitial] = useState<GroupEditForm | null>(null);
  const [groupEditVaries, setGroupEditVaries] = useState<Partial<Record<keyof GroupEditForm, boolean>>>({});
  const [groupEditSaving, setGroupEditSaving] = useState(false);
  const [groupEditError, setGroupEditError] = useState("");
  const [syncingStatuses, setSyncingStatuses] = useState(false);

  // View mode (Feature 3)
  const [viewMode, setViewMode] = useState<"list" | "calendar">("list");
  const [calYear, setCalYear] = useState<number>(new Date().getFullYear());
  const [calDrillKey, setCalDrillKey] = useState<string | null>(null); // "brandName||month"

  // Bulk builder (Feature 2)
  const [allBrands, setAllBrands] = useState<BrandOption[]>([]);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkStep, setBulkStep] = useState<1 | 2 | 3 | 4>(1);
  const [bulkBrandId, setBulkBrandId] = useState("");
  const [bulkBrandName, setBulkBrandName] = useState("");
  const [bulkBrandUpcs, setBulkBrandUpcs] = useState<string[]>([]);
  const [bulkRetailerId, setBulkRetailerId] = useState("");
  const [bulkRetailerName, setBulkRetailerName] = useState("");
  const [bulkRetailerBanner, setBulkRetailerBanner] = useState<string | null>(null);
  const [bulkRetailerDistributor, setBulkRetailerDistributor] = useState<string | null>(null);
  const [bulkAvailableRetailers, setBulkAvailableRetailers] = useState<RetailerOption[]>([]);
  const [bulkSkus, setBulkSkus] = useState<SkuOption[]>([]);
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set());
  const [bulkForm, setBulkForm] = useState<BulkForm>(EMPTY_BULK_FORM);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkError, setBulkError] = useState("");
  const [bulkLoadingStep, setBulkLoadingStep] = useState(false);

  // ── Load ────────────────────────────────────────────────────────────────────

  useEffect(() => {
    async function load() {
      setLoading(true);
      setStatus("");
      try {
        const { data: authData } = await supabase.auth.getUser();
        const uid = authData?.user?.id;
        if (!uid) { setStatus("You must be signed in."); setLoading(false); return; }
        setUserId(uid);

        const { data: profile, error: profileError } = await supabase.from("profiles").select("role").eq("id", uid).single();
        if (profileError) { setStatus(profileError.message); setLoading(false); return; }
        const nextRole = (profile?.role as Role) ?? null;
        setRole(nextRole);

        // Fetch brands for bulk builder
        const { data: brandsData } = await supabase.from("brands").select("id,name").eq("archived", false).order("name");
        const brandsList = (brandsData as BrandOption[]) ?? [];
        setAllBrands(brandsList);

        // Auto-apply brand filter when navigating from a brand dashboard
        if (brandIdParam) {
          const matched = brandsList.find((b) => b.id === brandIdParam);
          if (matched) setBrandFilter(matched.name);
        }

        let rows: PromotionRow[];
        if (nextRole === "client") {
          const { data: brandUsers } = await supabase.from("brand_users").select("brand_id").eq("user_id", uid);
          const brandIds = (brandUsers ?? []).map((r: any) => r.brand_id);
          if (brandIds.length === 0) { setPromotions([]); setLoading(false); return; }

          const clientRaw = await fetchAllRows<any>(
            supabase.from("promotions_stage").select("*")
              .in("brand_id", brandIds)
              .order("promo_year", { ascending: false })
              .order("promo_month", { ascending: true })
          );
          rows = clientRaw.map(normalizeStageRow).map(applyDisplayStatus);
        } else {
          const rawRows = await fetchAllRows<any>(
            supabase.from("promotions_stage").select("*")
              .order("promo_year", { ascending: false })
              .order("promo_month", { ascending: true })
          );
          rows = rawRows.map(normalizeStageRow).map(applyDisplayStatus);
        }

        setPromotions(rows);
        // Do NOT call setFiltered here — the filter useEffect owns that
        // to ensure other filters are always applied consistently.

        // Default calYear to most recent year in data
        const mostRecentYear = rows.reduce((max, r) => Math.max(max, r.promo_year), new Date().getFullYear());
        setCalYear(mostRecentYear);
      } catch (err: any) {
        setStatus(err?.message || "Failed to load promotions.");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // ── Filter effect ──────────────────────────────────────────────────────────

  useEffect(() => {
    let rows = [...promotions];
    if (brandFilter !== "all") rows = rows.filter((r) => r.brand_name === brandFilter);
    if (retailerFilter !== "all") rows = rows.filter((r) => r.retailer_name === retailerFilter);
    if (monthFilter !== "all") rows = rows.filter((r) => String(r.promo_month) === monthFilter);
    if (yearFilter !== "all") rows = rows.filter((r) => String(r.promo_year) === yearFilter);
    if (statusFilter !== "all") rows = rows.filter((r) => r.promo_status === statusFilter);
    if (repFilter !== "all") rows = rows.filter((r) => (r.cultivate_rep || "") === repFilter);
    if (scopeFilter === "distributor") rows = rows.filter(isDistributorRow);
    else if (scopeFilter === "retailer") rows = rows.filter((r) => !isDistributorRow(r));
    setFiltered(rows);
  }, [promotions, brandFilter, retailerFilter, monthFilter, yearFilter, statusFilter, repFilter, scopeFilter]);

  // ── Filter options ─────────────────────────────────────────────────────────

  const brands = useMemo(() => [...new Set(promotions.map((r) => r.brand_name).filter(Boolean))].sort(), [promotions]);
  const retailers = useMemo(() => [...new Set(promotions.map((r) => r.retailer_name).filter(Boolean))].sort(), [promotions]);
  const statuses = useMemo(() => [...new Set(promotions.map((r) => r.promo_status).filter(Boolean))].sort(), [promotions]);
  const reps = useMemo(() => [...new Set(promotions.map((r) => r.cultivate_rep || "").filter((r) => r !== ""))].sort(), [promotions]);
  const years = useMemo(() => [...new Set(promotions.map((r) => r.promo_year))].sort((a, b) => b - a), [promotions]);

  const { distributorSupport, retailerActivations } = useMemo(() => splitPromotions(filtered), [filtered]);
  const distributorGroups = useMemo(() => groupDistributorSupport(distributorSupport), [distributorSupport]);
  const retailerGroups = useMemo(() => groupRetailerActivations(retailerActivations), [retailerActivations]);

  const distributorOiKeys = useMemo(() => {
    const rows = promotions.filter(isDistributorRow);
    return new Set(rows.map((r) => [
      (r.brand_name || "").toLowerCase(),
      r.promo_year,
      r.promo_month,
    ].join("||")));
  }, [promotions]);

  // ── Calendar data (Feature 3) ──────────────────────────────────────────────

  const calendarData = useMemo(() => {
    const rows = promotions.filter((r) =>
      r.promo_year === calYear && !isDistributorRow(r) && !isEdlpEdlc(r)
    );
    const brandsApplied = brandFilter !== "all" ? rows.filter((r) => r.brand_name === brandFilter) : rows;
    const brandMap = new Map<string, { brand_id: string | null; months: Map<number, Set<string>> }>();
    for (const row of brandsApplied) {
      if (!brandMap.has(row.brand_name)) brandMap.set(row.brand_name, { brand_id: row.brand_id, months: new Map() });
      const entry = brandMap.get(row.brand_name)!;
      if (!entry.months.has(row.promo_month)) entry.months.set(row.promo_month, new Set());
      const display = row.retailer_banner || row.retailer_name;
      if (display) entry.months.get(row.promo_month)!.add(display);
    }
    return Array.from(brandMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([brand_name, { brand_id, months }]) => ({ brand_name, brand_id, months }));
  }, [promotions, calYear, brandFilter]);

  // ── Bulk builder handlers (Feature 2) ──────────────────────────────────────

  async function handleBulkBrandSelect(brandId: string) {
    const brand = allBrands.find((b) => b.id === brandId);
    if (!brand) return;
    setBulkBrandId(brandId);
    setBulkBrandName(brand.name);
    setBulkLoadingStep(true);

    // All retailers — rep picks freely
    const { data: retailerRows } = await supabase
      .from("retailers")
      .select("id,name,banner,distributor")
      .order("name");
    setBulkAvailableRetailers((retailerRows as RetailerOption[]) ?? []);

    setBulkLoadingStep(false);
    setBulkStep(2);
  }

  async function handleBulkRetailerSelect(retailer: RetailerOption) {
    setBulkRetailerId(retailer.id);
    setBulkRetailerName(retailer.name);
    setBulkRetailerBanner(retailer.banner);
    setBulkRetailerDistributor(retailer.distributor);
    setBulkLoadingStep(true);

    // All SKUs for this brand — no authorization or status restriction
    const { data: bpData } = await supabase
      .from("brand_products")
      .select("retail_upc,description")
      .eq("brand_id", bulkBrandId)
      .neq("status", "archived")
      .order("description");

    const skus: SkuOption[] = ((bpData ?? []) as { retail_upc: string | null; description: string }[])
      .filter((p) => p.retail_upc)
      .map((p) => ({ upc: p.retail_upc!, sku_description: p.description }));

    setBulkSkus(skus);
    setBulkSelected(new Set(skus.map((s) => s.upc)));

    setBulkLoadingStep(false);
    setBulkStep(3);
  }

  async function saveBulkPromos() {
    if (bulkSelected.size === 0) { setBulkError("Select at least one SKU."); return; }
    if (!bulkForm.promo_type) { setBulkError("Promo type is required."); return; }
    if (!bulkForm.start_date) { setBulkError("Start date is required."); return; }
    setBulkSaving(true);
    setBulkError("");

    const start = new Date(bulkForm.start_date);
    const promoYear = start.getFullYear();
    const promoMonth = start.getMonth() + 1;

    const selectedSkus = bulkSkus.filter((s) => bulkSelected.has(s.upc));
    const insertRows = selectedSkus.map((sku) => ({
      brand_id: bulkBrandId,
      brand_name: bulkBrandName,
      retailer_name: bulkRetailerName,
      distributor: bulkRetailerDistributor,
      cultivate_rep: (role === "rep" || role === "admin") ? userId : null,
      sku_description: sku.sku_description,
      unit_upc: sku.upc,
      promo_year: promoYear,
      promo_month: promoMonth,
      promo_name: bulkForm.promo_name.trim() || null,
      promo_type: bulkForm.promo_type.trim(),
      promo_status: bulkForm.promo_status,
      start_date: bulkForm.start_date,
      end_date: bulkForm.end_date || null,
      discount_percent: bulkForm.discount_percent ? parseFloat(bulkForm.discount_percent) : null,
      discount_amount: bulkForm.discount_amount ? parseFloat(bulkForm.discount_amount) : null,
      notes: bulkForm.notes.trim() || null,
    }));

    const { error } = await supabase.from("promotions_stage").insert(insertRows);
    if (error) { setBulkError(error.message); setBulkSaving(false); return; }

    // Reload promotions and close builder
    const reloadRaw = await fetchAllRows<any>(supabase.from("promotions_stage").select("*").order("promo_year", { ascending: false }).order("promo_month", { ascending: true }));
    setPromotions(reloadRaw.map(normalizeStageRow).map(applyDisplayStatus));
    setBulkOpen(false);
    setBulkStep(1);
    setBulkBrandId(""); setBulkBrandName(""); setBulkBrandUpcs([]);
    setBulkRetailerId(""); setBulkRetailerName(""); setBulkRetailerBanner(null); setBulkRetailerDistributor(null);
    setBulkAvailableRetailers([]); setBulkSkus([]); setBulkSelected(new Set());
    setBulkForm(EMPTY_BULK_FORM);
    setBulkSaving(false);
  }

  // ── Inline edit / delete ────────────────────────────────────────────────────

  function openEdit(item: PromotionRow) {
    setEditingRow(item);
    setEditForm({
      brand_name: item.brand_name,
      retailer_name: item.retailer_name,
      distributor: item.distributor ?? "",
      cultivate_rep: item.cultivate_rep ?? "",
      sku_description: item.sku_description,
      unit_upc: item.unit_upc ?? "",
      promo_year: String(item.promo_year),
      promo_month: String(item.promo_month),
      promo_name: item.promo_name ?? "",
      promo_type: item.promo_type,
      promo_status: item.promo_status,
      start_date: item.start_date?.slice(0, 10) ?? "",
      end_date: item.end_date?.slice(0, 10) ?? "",
      discount_percent: item.discount_percent != null ? String(item.discount_percent) : "",
      discount_amount: item.discount_amount != null ? String(item.discount_amount) : "",
      promo_text_raw: item.promo_text_raw ?? "",
      notes: item.notes ?? "",
    });
    setEditError("");
  }

  function rowMatchFilter(r: PromotionRow, orig: PromotionRow) {
    return (
      r.brand_name === orig.brand_name &&
      r.retailer_name === orig.retailer_name &&
      r.sku_description === orig.sku_description &&
      r.promo_year === orig.promo_year &&
      r.promo_month === orig.promo_month &&
      r.promo_type === orig.promo_type &&
      r.start_date === orig.start_date &&
      r.unit_upc === orig.unit_upc &&
      r.promo_name === orig.promo_name
    );
  }

  function buildKeyQuery(q: any, item: PromotionRow) {
    q = q
      .eq("brand_name", item.brand_name)
      .eq("retailer_name", item.retailer_name)
      .eq("sku_description", item.sku_description)
      .eq("promo_year", item.promo_year)
      .eq("promo_month", item.promo_month)
      .eq("promo_type", item.promo_type);
    if (item.unit_upc != null) q = q.eq("unit_upc", item.unit_upc);
    else q = q.is("unit_upc", null);
    if (item.promo_name != null) q = q.eq("promo_name", item.promo_name);
    else q = q.is("promo_name", null);
    if (item.start_date != null) q = q.eq("start_date", item.start_date);
    else q = q.is("start_date", null);
    return q;
  }

  async function handleSaveEdit() {
    if (!editingRow || !editForm) return;
    setEditSaving(true);
    setEditError("");

    const payload = {
      brand_name: editForm.brand_name.trim(),
      retailer_name: editForm.retailer_name.trim(),
      distributor: editForm.distributor.trim() || null,
      cultivate_rep: editForm.cultivate_rep.trim() || null,
      sku_description: editForm.sku_description.trim(),
      unit_upc: editForm.unit_upc.trim() || null,
      promo_year: Number(editForm.promo_year) || editingRow.promo_year,
      promo_month: Number(editForm.promo_month) || editingRow.promo_month,
      promo_name: editForm.promo_name.trim() || null,
      promo_type: editForm.promo_type.trim(),
      promo_status: editForm.promo_status.trim(),
      start_date: editForm.start_date || null,
      end_date: editForm.end_date || null,
      discount_percent: editForm.discount_percent ? Number(editForm.discount_percent) : null,
      discount_amount: editForm.discount_amount ? Number(editForm.discount_amount) : null,
      promo_text_raw: editForm.promo_text_raw.trim() || null,
      notes: editForm.notes.trim() || null,
    };

    const { error } = await buildKeyQuery(
      supabase.from("promotions_stage").update(payload),
      editingRow
    );

    if (error) {
      setEditError(error.message);
      setEditSaving(false);
      return;
    }

    setPromotions((prev) =>
      prev.map((r) =>
        rowMatchFilter(r, editingRow)
          ? { ...r, ...payload, promo_scope: r.promo_scope }
          : r
      )
    );
    setEditingRow(null);
    setEditForm(null);
    setEditSaving(false);
  }

  async function handleDeleteRow(item: PromotionRow) {
    const { error } = await buildKeyQuery(
      supabase.from("promotions_stage").delete(),
      item
    );

    if (error) {
      setDeletingItem(null);
      alert(error.message);
      return;
    }

    setPromotions((prev) => prev.filter((r) => !rowMatchFilter(r, item)));
    setDeletingItem(null);
  }

  // Open the bulk-edit modal for a promo group. For every field, if all SKUs
  // in the group agree on a value we pre-fill it; if they disagree we leave
  // the input blank and mark the field as "varies" so the placeholder reads
  // "(varies — leave blank to keep per-SKU)". On save we only push fields
  // the user actually changed, so untouched divergent values are preserved.
  function openGroupEdit(pg: RetailerPromoGroup, brandName: string, retailerName: string) {
    function sharedString<K extends keyof PromotionRow>(key: K): string | undefined {
      let v: PromotionRow[K] | null = null;
      let initialised = false;
      for (const r of pg.rows) {
        const cur = r[key];
        if (!initialised) { v = cur; initialised = true; continue; }
        if (cur !== v) return undefined;
      }
      if (v === null || v === undefined) return "";
      return typeof v === "string" ? v : String(v);
    }

    function sharedDate<K extends "start_date" | "end_date">(key: K): string | undefined {
      let v: string | null | undefined;
      let initialised = false;
      for (const r of pg.rows) {
        const cur = r[key];
        if (!initialised) { v = cur; initialised = true; continue; }
        if (cur !== v) return undefined;
      }
      return (v ?? "")?.slice(0, 10) ?? "";
    }

    const fields: Array<keyof GroupEditForm> = [
      "promo_name", "promo_type", "promo_status",
      "start_date", "end_date",
      "discount_percent", "discount_amount",
      "promo_text_raw", "notes",
    ];
    const varies: Partial<Record<keyof GroupEditForm, boolean>> = {};
    const form: GroupEditForm = {
      promo_name: "", promo_type: "", promo_status: "",
      start_date: "", end_date: "",
      discount_percent: "", discount_amount: "",
      promo_text_raw: "", notes: "",
    };
    for (const f of fields) {
      const v = f === "start_date" || f === "end_date"
        ? sharedDate(f)
        : sharedString(f as keyof PromotionRow);
      if (v === undefined) {
        varies[f] = true;
        form[f] = "";
      } else {
        form[f] = v;
      }
    }

    setGroupEditing({ pg, brandName, retailerName });
    setGroupEditForm(form);
    setGroupEditInitial({ ...form });
    setGroupEditVaries(varies);
    setGroupEditError("");
  }

  async function handleSaveGroupEdit() {
    if (!groupEditing || !groupEditForm || !groupEditInitial) return;
    const { pg, brandName, retailerName } = groupEditing;

    // Build payload from fields the user actually changed. Anything unchanged
    // (including divergent fields the user didn't touch) is left alone.
    const dirty = (Object.keys(groupEditForm) as Array<keyof GroupEditForm>)
      .filter((k) => groupEditForm[k] !== groupEditInitial[k]);
    if (dirty.length === 0) {
      setGroupEditing(null); setGroupEditForm(null); setGroupEditInitial(null);
      return;
    }

    const payload: Record<string, unknown> = {};
    for (const k of dirty) {
      const raw = groupEditForm[k].trim();
      if (k === "discount_percent" || k === "discount_amount") {
        payload[k] = raw === "" ? null : Number(raw);
      } else if (k === "start_date" || k === "end_date") {
        payload[k] = raw === "" ? null : raw;
      } else if (k === "promo_type" || k === "promo_status") {
        // Required-ish fields — refuse to blank them
        if (raw === "") continue;
        payload[k] = raw;
      } else {
        payload[k] = raw === "" ? null : raw;
      }
    }

    setGroupEditSaving(true);
    setGroupEditError("");

    // Match the full group key so two groups that differ only by promo_type or
    // dates can't collide. Looser than handleDeletePromoGroup deliberately —
    // UPDATE is more destructive than DELETE was here.
    let q: any = supabase.from("promotions_stage").update(payload)
      .eq("brand_name", brandName)
      .eq("retailer_name", retailerName)
      .eq("promo_year", pg.promo_year)
      .eq("promo_month", pg.promo_month)
      .eq("promo_type", pg.promo_type);
    q = pg.promo_name != null ? q.eq("promo_name", pg.promo_name) : q.is("promo_name", null);
    q = pg.start_date != null ? q.eq("start_date", pg.start_date) : q.is("start_date", null);
    q = pg.end_date != null ? q.eq("end_date", pg.end_date) : q.is("end_date", null);

    const { error } = await q;
    if (error) {
      setGroupEditError(error.message);
      setGroupEditSaving(false);
      return;
    }

    // Local-state mirror: apply the same payload to every matching row so the
    // UI reflects the change without a refetch. Coerce nulls/numbers to match
    // PromotionRow's shape.
    setPromotions((prev) => prev.map((r) => {
      const matches =
        r.brand_name === brandName &&
        r.retailer_name === retailerName &&
        r.promo_year === pg.promo_year &&
        r.promo_month === pg.promo_month &&
        r.promo_type === pg.promo_type &&
        (r.promo_name ?? null) === (pg.promo_name ?? null) &&
        (r.start_date ?? null) === (pg.start_date ?? null) &&
        (r.end_date ?? null) === (pg.end_date ?? null);
      if (!matches) return r;
      const merged: PromotionRow = { ...r };
      for (const k of dirty) {
        const v = payload[k];
        if (k === "discount_percent" || k === "discount_amount") merged[k] = v as number | null;
        else if (k === "promo_type" || k === "promo_status") merged[k] = (v as string | null) ?? "";
        else (merged as Record<string, unknown>)[k] = v;
      }
      return merged;
    }));

    setGroupEditSaving(false);
    setGroupEditing(null);
    setGroupEditForm(null);
    setGroupEditInitial(null);
    setGroupEditVaries({});
  }

  async function handleDeletePromoGroup(pg: RetailerPromoGroup, brandName: string, retailerName: string) {
    let q = supabase
      .from("promotions_stage")
      .delete()
      .eq("brand_name", brandName)
      .eq("retailer_name", retailerName)
      .eq("promo_year", pg.promo_year)
      .eq("promo_month", pg.promo_month);
    if (pg.promo_name != null) q = q.eq("promo_name", pg.promo_name);
    else q = q.is("promo_name", null);

    const { error } = await q;
    if (error) {
      setDeletingPromoGroupKey(null);
      alert(error.message);
      return;
    }

    setPromotions((prev) =>
      prev.filter(
        (r) =>
          !(
            r.brand_name === brandName &&
            r.retailer_name === retailerName &&
            r.promo_year === pg.promo_year &&
            r.promo_month === pg.promo_month &&
            r.promo_name === pg.promo_name
          )
      )
    );
    setDeletingPromoGroupKey(null);
  }

  async function handleSyncStatuses() {
    setSyncingStatuses(true);
    try {
      const today = todayISO();
      await supabase
        .from("promotions_stage")
        .update({ promo_status: "completed" })
        .lt("end_date", today)
        .neq("promo_status", "completed");
      await supabase
        .from("promotions_stage")
        .update({ promo_status: "live" })
        .lte("start_date", today)
        .gte("end_date", today)
        .not("promo_status", "in", '("completed","submitted")');
      // Reload
      const rawRows = await fetchAllRows<any>(
        supabase.from("promotions_stage").select("*")
          .order("promo_year", { ascending: false })
          .order("promo_month", { ascending: true })
      );
      setPromotions(rawRows.map(normalizeStageRow).map(applyDisplayStatus));
    } catch (err: any) {
      alert(err?.message || "Sync failed.");
    } finally {
      setSyncingStatuses(false);
    }
  }

  // ── Render: existing list sections ─────────────────────────────────────────

  function renderDistributorGroups(groups: DistributorGroup[]) {
    return groups.map((group) => {
      const skuCount = uniqueSkuCount(group.rows);
      const startDate = getPromoStart(group.rows);
      const endDate = getPromoEnd(group.rows);
      return (
        <React.Fragment key={group.key}>
          <tr className="border-b cursor-pointer hover:bg-gray-50" onClick={() => setExpandedDistributorGroups((prev) => ({ ...prev, [group.key]: !prev[group.key] }))}>
            <td className="px-4 py-3"><div className="font-medium">{group.distributor}</div><div className="text-xs text-gray-500">Distributor support</div></td>
            <td className="px-4 py-3"><div className="font-medium">{group.brand_name}</div><div className="text-xs text-gray-500">{group.promo_name || "Distributor OI"}</div></td>
            <td className="px-4 py-3"><div>{skuCount} SKU{skuCount === 1 ? "" : "s"}</div><div className="text-xs text-gray-500 mt-1">Click to view assortment</div></td>
            <td className="px-4 py-3">{monthLabel(group.promo_month)} {group.promo_year}</td>
            <td className="px-4 py-3">{group.promo_name || "Distributor OI"}</td>
            <td className="px-4 py-3">{group.promo_status}</td>
            <td className="px-4 py-3"><div>{prettyDate(startDate)}</div><div className="text-xs text-gray-500">{prettyDate(endDate)}</div></td>
            <td className="px-4 py-3"><div>{group.promo_name || "Distributor OI"}</div>{group.promo_text_raw ? <div className="text-xs text-gray-500 mt-1">{group.promo_text_raw}</div> : null}</td>
          </tr>
          {expandedDistributorGroups[group.key] ? (
            <tr className="bg-gray-50 border-b">
              <td colSpan={8} className="px-4 py-4">
                <div className="space-y-2 text-sm">
                  {group.rows.map((item) => (
                    <div key={item.id} className="border rounded p-3 bg-white mb-2">
                      <div className="font-medium">{item.sku_description}</div>
                      {item.unit_upc ? <div className="text-xs text-gray-500">UPC: {item.unit_upc}</div> : null}
                      <div className="text-xs text-gray-500 mt-1">Runs: {prettyDate(item.start_date)} → {prettyDate(item.end_date)}</div>
                      {item.promo_type ? <div className="text-xs text-gray-500">TPR Type: {item.promo_type}</div> : null}
                      {discountLabel(item) ? <div className="text-xs text-gray-500">Discount: {discountLabel(item)}</div> : null}
                      {(role === "admin" || role === "rep") && (
                        <div className="mt-2 flex items-center gap-3">
                          <button type="button" onClick={() => openEdit(item)} className="text-xs underline text-blue-600 hover:text-blue-800">Edit</button>
                          {deletingItem === item ? (
                            <span className="flex items-center gap-1 text-xs">
                              <span className="text-gray-600">Delete?</span>
                              <button type="button" onClick={() => handleDeleteRow(item)} className="text-red-600 font-medium hover:underline">Yes</button>
                              <button type="button" onClick={() => setDeletingItem(null)} className="text-gray-500 hover:underline">No</button>
                            </span>
                          ) : (
                            <button type="button" onClick={() => setDeletingItem(item)} className="text-xs text-gray-400 hover:text-red-500" title="Delete promotion">🗑</button>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </td>
            </tr>
          ) : null}
        </React.Fragment>
      );
    });
  }

  function renderRetailerGroups(groups: RetailerGroup[]) {
    return groups.map((group) => {
      // Apply EDLP/EDLC filter at the promo-group level
      const visibleBrandGroups = group.brandGroups.map((bg) => ({
        ...bg,
        promoGroups: hideEdlp ? bg.promoGroups.filter((pg) => !isEdlpEdlcGroup(pg)) : bg.promoGroups,
      })).filter((bg) => bg.promoGroups.length > 0);

      // If all promo groups are EDLP/EDLC, skip this retailer entirely
      if (hideEdlp && visibleBrandGroups.length === 0) return null;

      const promoCount = visibleBrandGroups.reduce((sum, bg) => sum + bg.promoGroups.length, 0);
      const visibleRows = visibleBrandGroups.flatMap((bg) => bg.promoGroups.flatMap((pg) => pg.rows));
      const skuCount = uniqueSkuCount(visibleRows);
      const brandCount = visibleBrandGroups.length;
      return (
        <React.Fragment key={group.key}>
          <tr className="border-b cursor-pointer hover:bg-gray-50" onClick={() => setExpandedRetailers((prev) => ({ ...prev, [group.key]: !prev[group.key] }))}>
            <td className="px-4 py-3"><div className="font-medium">{group.retailer_banner || group.retailer_name}</div>{group.distributors.length > 0 ? <div className="text-xs text-gray-500">{group.distributors.join(" · ")}</div> : null}</td>
            <td className="px-4 py-3"><div className="font-medium">{promoCount} Promotion{promoCount === 1 ? "" : "s"}</div><div className="text-xs text-gray-500">{skuCount} SKU{skuCount === 1 ? "" : "s"} total</div></td>
            <td className="px-4 py-3"><div className="font-medium">{brandCount} Brand{brandCount === 1 ? "" : "s"}</div><div className="text-xs text-gray-500">Click to view brands on deal</div></td>
            <td className="px-4 py-3">—</td><td className="px-4 py-3">—</td><td className="px-4 py-3">—</td><td className="px-4 py-3">—</td><td className="px-4 py-3">—</td>
          </tr>
          {expandedRetailers[group.key] ? (
            <tr className="bg-gray-50 border-b">
              <td colSpan={8} className="px-4 py-4">
                <div className="space-y-3">
                  {visibleBrandGroups.map((brandGroup) => {
                    const brandPromoCount = brandGroup.promoGroups.length;
                    const brandSkuCount = uniqueSkuCount(brandGroup.promoGroups.flatMap((pg) => pg.rows));
                    const hasAnyOiLoaded = brandGroup.promoGroups.some((pg) => pg.rows.some((item) => distributorOiKeys.has([(item.brand_name || "").toLowerCase(), item.promo_year, item.promo_month].join("||"))));
                    return (
                      <div key={brandGroup.key} className="border rounded bg-white">
                        <button type="button" className="w-full text-left p-3 hover:bg-gray-50" onClick={(e) => { e.stopPropagation(); setExpandedBrands((prev) => ({ ...prev, [brandGroup.key]: !prev[brandGroup.key] })); }}>
                          <div className="flex items-start justify-between gap-4">
                            <div>
                              <div className="font-medium">{brandGroup.brand_name}</div>
                              <div className="text-xs text-gray-500 mt-1">{brandPromoCount} Promotion{brandPromoCount === 1 ? "" : "s"} • {brandSkuCount} SKU{brandSkuCount === 1 ? "" : "s"}</div>
                            </div>
                            {hasAnyOiLoaded ? <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] text-green-700 border-green-300 bg-green-50">✓ OI loaded</span> : null}
                          </div>
                        </button>
                        {expandedBrands[brandGroup.key] ? (
                          <div className="px-3 pb-3 space-y-2">
                            {brandGroup.promoGroups.map((promoGroup) => {
                              const promoSkuCount = uniqueSkuCount(promoGroup.rows);
                              const hasOiLoaded = promoGroup.rows.some((item) => distributorOiKeys.has([(item.brand_name || "").toLowerCase(), item.promo_year, item.promo_month].join("||")));
                              return (
                                <div key={promoGroup.key} className="border rounded bg-gray-50">
                                  <div className="flex items-start">
                                    <button type="button" className="flex-1 text-left p-3 hover:bg-gray-100" onClick={(e) => { e.stopPropagation(); setExpandedPromoGroups((prev) => ({ ...prev, [promoGroup.key]: !prev[promoGroup.key] })); }}>
                                      <div className="font-medium">{monthLabel(promoGroup.promo_month)} {promoGroup.promo_year} — {promoGroup.promo_name || promoGroup.promo_type}</div>
                                      <div className="text-xs text-gray-500 mt-1 flex items-center gap-2">
                                        <span>{promoSkuCount} SKU{promoSkuCount === 1 ? "" : "s"} • {promoGroup.promo_status}</span>
                                        {hasOiLoaded ? <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] text-green-700 border-green-300 bg-green-50">✓ OI loaded</span> : null}
                                      </div>
                                      <div className="text-xs text-gray-500">Runs: {prettyDate(promoGroup.start_date)} → {prettyDate(promoGroup.end_date)}</div>
                                      <div className="text-xs text-gray-500 mt-1">TPR Type: {promoGroup.promo_type}</div>
                                      {promoGroup.promo_text_raw ? <div className="text-xs text-gray-500 mt-1">{promoGroup.promo_text_raw}</div> : null}
                                    </button>
                                    {(role === "admin" || role === "rep") && (
                                      <div className="flex items-center gap-3 pr-3 pt-3" onClick={(e) => e.stopPropagation()}>
                                        {deletingPromoGroupKey === promoGroup.key ? (
                                          <span className="flex items-center gap-1 text-xs whitespace-nowrap">
                                            <span className="text-gray-600">Delete all {promoSkuCount} SKU{promoSkuCount === 1 ? "" : "s"}?</span>
                                            <button type="button" onClick={() => handleDeletePromoGroup(promoGroup, brandGroup.brand_name, group.retailer_name)} className="text-red-600 font-medium hover:underline">Yes</button>
                                            <button type="button" onClick={() => setDeletingPromoGroupKey(null)} className="text-gray-500 hover:underline">No</button>
                                          </span>
                                        ) : (
                                          <>
                                            <button type="button" onClick={() => openGroupEdit(promoGroup, brandGroup.brand_name, group.retailer_name)} className="text-xs underline text-blue-600 hover:text-blue-800" title={`Edit shared fields for all ${promoSkuCount} SKUs in this promotion`}>Edit</button>
                                            <button type="button" onClick={() => setDeletingPromoGroupKey(promoGroup.key)} className="text-gray-400 hover:text-red-500" title="Delete all SKUs in this promotion">🗑</button>
                                          </>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                  {expandedPromoGroups[promoGroup.key] ? (
                                    <div className="px-3 pb-3 space-y-2">
                                      {promoGroup.rows.map((item) => (
                                        <div key={item.id} className="border rounded p-3 bg-white">
                                          <div className="font-medium">{item.sku_description}</div>
                                          {item.unit_upc ? <div className="text-xs text-gray-500">UPC: {item.unit_upc}</div> : null}
                                          {item.cultivate_rep ? <div className="text-xs text-gray-500">Rep: {item.cultivate_rep}</div> : null}
                                          {item.promo_type ? <div className="text-xs text-gray-500">TPR Type: {item.promo_type}</div> : null}
                                          {discountLabel(item) ? <div className="text-xs text-gray-500">Discount: {discountLabel(item)}</div> : null}
                                          <div className="text-xs text-gray-500">Runs: {prettyDate(item.start_date)} → {prettyDate(item.end_date)}</div>
                                          {item.notes ? <div className="text-xs text-gray-500 mt-1">Notes: {item.notes}</div> : null}
                                          {(role === "admin" || role === "rep") && (
                                            <div className="mt-2 flex items-center gap-3">
                                              <button type="button" onClick={() => openEdit(item)} className="text-xs underline text-blue-600 hover:text-blue-800">Edit</button>
                                              {deletingItem === item ? (
                                                <span className="flex items-center gap-1 text-xs">
                                                  <span className="text-gray-600">Delete?</span>
                                                  <button type="button" onClick={() => handleDeleteRow(item)} className="text-red-600 font-medium hover:underline">Yes</button>
                                                  <button type="button" onClick={() => setDeletingItem(null)} className="text-gray-500 hover:underline">No</button>
                                                </span>
                                              ) : (
                                                <button type="button" onClick={() => setDeletingItem(item)} className="text-xs text-gray-400 hover:text-red-500" title="Delete promotion">🗑</button>
                                              )}
                                            </div>
                                          )}
                                        </div>
                                      ))}
                                    </div>
                                  ) : null}
                                </div>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </td>
            </tr>
          ) : null}
        </React.Fragment>
      );
    });
  }

  // ── Render: bulk builder (Feature 2) ───────────────────────────────────────

  const inputCls = "border rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:ring-2";
  const inputStyle = { borderColor: "var(--border)", background: "var(--secondary)", color: "var(--foreground)" };

  function renderBulkBuilder() {
    if (!bulkOpen) return null;
    return (
      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-foreground">Bulk Promo Builder</h2>
          <button onClick={() => { setBulkOpen(false); setBulkStep(1); setBulkBrandId(""); setBulkRetailerId(""); }} className="text-sm text-muted-foreground hover:text-foreground">✕ Cancel</button>
        </div>

        {/* Step indicator */}
        <div className="flex gap-2 text-xs">
          {(["1. Brand", "2. Retailer", "3. SKUs", "4. Details"] as const).map((label, i) => (
            <span key={label} className={`px-2 py-1 rounded ${bulkStep === i + 1 ? "font-semibold text-white" : "text-muted-foreground"}`} style={bulkStep === i + 1 ? { background: "var(--foreground)" } : {}}>
              {label}
            </span>
          ))}
        </div>

        {bulkLoadingStep && <p className="text-sm text-muted-foreground">Loading…</p>}

        {/* Step 1: Select brand */}
        {bulkStep === 1 && !bulkLoadingStep && (
          <div className="space-y-2">
            <label className="block text-xs text-muted-foreground mb-1">Select a brand</label>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 max-h-64 overflow-y-auto">
              {allBrands.map((b) => (
                <button key={b.id} onClick={() => handleBulkBrandSelect(b.id)} className="text-left px-3 py-2 rounded-lg border text-sm hover:bg-secondary transition-colors truncate" style={{ borderColor: "var(--border)", color: "var(--foreground)" }}>
                  {b.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 2: Select retailer */}
        {bulkStep === 2 && !bulkLoadingStep && (
          <div className="space-y-2">
            <div className="text-sm font-medium text-foreground">{bulkBrandName}</div>
            <label className="block text-xs text-muted-foreground mb-1">Select a retailer</label>
            {bulkAvailableRetailers.length === 0 ? (
              <p className="text-sm text-muted-foreground">No authorized retailers found for this brand.</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 max-h-64 overflow-y-auto">
                {bulkAvailableRetailers.map((r) => (
                  <button key={r.id} onClick={() => handleBulkRetailerSelect(r)} className="text-left px-3 py-2 rounded-lg border text-sm hover:bg-secondary transition-colors" style={{ borderColor: "var(--border)", color: "var(--foreground)" }}>
                    <div className="font-medium truncate">{r.banner || r.name}</div>
                    {r.banner && <div className="text-xs text-muted-foreground truncate">{r.name}</div>}
                  </button>
                ))}
              </div>
            )}
            <button onClick={() => setBulkStep(1)} className="text-xs text-muted-foreground hover:text-foreground mt-2">← Back</button>
          </div>
        )}

        {/* Step 3: SKU checklist */}
        {bulkStep === 3 && !bulkLoadingStep && (
          <div className="space-y-3">
            <div className="text-sm font-medium text-foreground">{bulkBrandName} → {bulkRetailerBanner || bulkRetailerName}</div>
            <div className="flex items-center gap-3">
              <label className="text-xs text-muted-foreground">Authorized SKUs ({bulkSelected.size} of {bulkSkus.length} selected)</label>
              <button onClick={() => setBulkSelected(new Set(bulkSkus.map((s) => s.upc)))} className="text-xs underline text-muted-foreground hover:text-foreground">All</button>
              <button onClick={() => setBulkSelected(new Set())} className="text-xs underline text-muted-foreground hover:text-foreground">None</button>
            </div>
            {bulkSkus.length === 0 ? (
              <p className="text-sm text-muted-foreground">No SKUs found for this brand.</p>
            ) : (
              <div className="max-h-64 overflow-y-auto border border-border rounded-lg divide-y divide-border">
                {bulkSkus.map((sku) => (
                  <label key={sku.upc} className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-secondary text-sm">
                    <input type="checkbox" checked={bulkSelected.has(sku.upc)} onChange={(e) => {
                      const next = new Set(bulkSelected);
                      e.target.checked ? next.add(sku.upc) : next.delete(sku.upc);
                      setBulkSelected(next);
                    }} />
                    <div>
                      <div className="text-foreground">{sku.sku_description}</div>
                      <div className="text-xs text-muted-foreground font-mono">{sku.upc}</div>
                    </div>
                  </label>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <button onClick={() => setBulkStep(2)} className="text-xs text-muted-foreground hover:text-foreground">← Back</button>
              <button onClick={() => setBulkStep(4)} disabled={bulkSelected.size === 0} className="px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50" style={{ background: "var(--foreground)", color: "var(--background)" }}>
                Next: Set Details →
              </button>
            </div>
          </div>
        )}

        {/* Step 4: Promo details */}
        {bulkStep === 4 && !bulkLoadingStep && (
          <div className="space-y-4">
            <div className="text-sm font-medium text-foreground">{bulkBrandName} → {bulkRetailerBanner || bulkRetailerName} · {bulkSelected.size} SKU{bulkSelected.size !== 1 ? "s" : ""}</div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Promo Type *</label>
                <select value={bulkForm.promo_type} onChange={(e) => setBulkForm((f) => ({ ...f, promo_type: e.target.value }))} className={inputCls} style={inputStyle}>
                  <option value="TPR">TPR</option>
                  <option value="EDLP">EDLP</option>
                  <option value="EDLC">EDLC</option>
                  <option value="Ad">Ad</option>
                  <option value="Display">Display</option>
                  <option value="Demo">Demo</option>
                  <option value="Digital">Digital</option>
                  <option value="Other">Other</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Status</label>
                <select value={bulkForm.promo_status} onChange={(e) => setBulkForm((f) => ({ ...f, promo_status: e.target.value }))} className={inputCls} style={inputStyle}>
                  <option value="planned">Planned</option>
                  <option value="submitted">Submitted</option>
                  <option value="live">Live</option>
                  <option value="completed">Completed</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Scope</label>
                <select value={bulkForm.promo_scope} onChange={(e) => setBulkForm((f) => ({ ...f, promo_scope: e.target.value as "retailer" | "distributor" }))} className={inputCls} style={inputStyle}>
                  <option value="retailer">Retailer</option>
                  <option value="distributor">Distributor</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Start Date *</label>
                <input type="date" value={bulkForm.start_date} onChange={(e) => setBulkForm((f) => ({ ...f, start_date: e.target.value }))} className={inputCls} style={inputStyle} />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">End Date</label>
                <input type="date" value={bulkForm.end_date} onChange={(e) => setBulkForm((f) => ({ ...f, end_date: e.target.value }))} className={inputCls} style={inputStyle} />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Promo Name</label>
                <input type="text" value={bulkForm.promo_name} onChange={(e) => setBulkForm((f) => ({ ...f, promo_name: e.target.value }))} placeholder="e.g. Spring Sale" className={inputCls} style={inputStyle} />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Discount %</label>
                <input type="number" step="0.1" value={bulkForm.discount_percent} onChange={(e) => setBulkForm((f) => ({ ...f, discount_percent: e.target.value }))} placeholder="15" className={inputCls} style={inputStyle} />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Discount $</label>
                <input type="number" step="0.01" value={bulkForm.discount_amount} onChange={(e) => setBulkForm((f) => ({ ...f, discount_amount: e.target.value }))} placeholder="1.50" className={inputCls} style={inputStyle} />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Notes</label>
                <input type="text" value={bulkForm.notes} onChange={(e) => setBulkForm((f) => ({ ...f, notes: e.target.value }))} className={inputCls} style={inputStyle} />
              </div>
            </div>
            {bulkError && <p className="text-sm text-red-600">{bulkError}</p>}
            <div className="flex gap-3 items-center">
              <button onClick={saveBulkPromos} disabled={bulkSaving} className="px-5 py-2 rounded-lg text-sm font-medium disabled:opacity-50" style={{ background: "var(--foreground)", color: "var(--background)" }}>
                {bulkSaving ? "Saving…" : `Save ${bulkSelected.size} Promo${bulkSelected.size !== 1 ? "s" : ""}`}
              </button>
              <button onClick={() => setBulkStep(3)} className="text-xs text-muted-foreground hover:text-foreground">← Back to SKUs</button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Render: calendar view (Feature 3) ──────────────────────────────────────

  function renderCalendar() {
    const months = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

    // Drill-in rows
    const drillRows = calDrillKey
      ? promotions.filter((r) => {
          const [dn, dm] = calDrillKey.split("||");
          return r.brand_name === dn && r.promo_month === parseInt(dm) && r.promo_year === calYear && !isDistributorRow(r) && !isEdlpEdlc(r);
        })
      : [];

    return (
      <div className="space-y-4">
        {/* Year selector */}
        <div className="flex items-center gap-3">
          <label className="text-sm text-muted-foreground">Year:</label>
          <div className="flex gap-1">
            {years.map((y) => (
              <button key={y} onClick={() => { setCalYear(y); setCalDrillKey(null); }} className={`px-3 py-1 rounded text-sm ${calYear === y ? "font-semibold text-white" : "text-muted-foreground border border-border hover:bg-secondary"}`} style={calYear === y ? { background: "var(--foreground)" } : {}}>
                {y}
              </button>
            ))}
          </div>
          {calendarData.length > 0 && (
            <span className="text-xs text-muted-foreground ml-2">{calendarData.length} brand{calendarData.length !== 1 ? "s" : ""} with TPRs</span>
          )}
        </div>

        {calendarData.length === 0 ? (
          <p className="text-sm text-muted-foreground">No TPR promotions found for {calYear}.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="text-xs" style={{ minWidth: "max-content", width: "100%" }}>
              <thead>
                <tr style={{ background: "#1e3a4a" }}>
                  <th className="px-4 py-2 text-left text-white/80 font-semibold whitespace-nowrap sticky left-0" style={{ background: "#1e3a4a", minWidth: 180 }}>Brand</th>
                  {months.map((m) => (
                    <th key={m} className="px-3 py-2 text-center text-white/80 font-semibold whitespace-nowrap" style={{ minWidth: 90 }}>{monthLabel(m)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {calendarData.map((row, idx) => (
                  <tr key={row.brand_name} className="border-b border-border last:border-0" style={{ background: idx % 2 === 0 ? "var(--card)" : "var(--secondary)" }}>
                    <td className="px-4 py-2 font-medium text-foreground whitespace-nowrap sticky left-0" style={{ background: idx % 2 === 0 ? "var(--card)" : "var(--secondary)" }}>
                      {row.brand_id
                        ? <Link href={`/brands/${row.brand_id}/promotions`} className="hover:underline">{row.brand_name}</Link>
                        : <span>{row.brand_name}</span>}
                    </td>
                    {months.map((m) => {
                      const retailers = row.months.get(m);
                      const drillKey = `${row.brand_name}||${m}`;
                      const isDrilling = calDrillKey === drillKey;
                      if (!retailers || retailers.size === 0) {
                        return <td key={m} className="px-3 py-2 text-center text-muted-foreground">—</td>;
                      }
                      return (
                        <td key={m} className="px-3 py-2 text-center">
                          <button
                            onClick={() => setCalDrillKey(isDrilling ? null : drillKey)}
                            className={`inline-flex flex-col items-center gap-0.5 rounded px-2 py-1 transition-colors ${isDrilling ? "ring-2 ring-primary" : "hover:bg-secondary"}`}
                          >
                            <span className="text-xs font-semibold text-foreground">{retailers.size}</span>
                            <span className="text-[10px] text-muted-foreground leading-tight">{retailers.size === 1 ? [...retailers][0].slice(0, 10) : "retailers"}</span>
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Drill-in panel */}
        {calDrillKey && drillRows.length > 0 && (
          <div className="rounded-xl border border-border bg-card p-4 space-y-3">
            {(() => {
              const [dn, dm] = calDrillKey.split("||");
              return <div className="flex items-center justify-between"><h3 className="text-sm font-semibold text-foreground">{dn} — {monthLabelLong(parseInt(dm))} {calYear}</h3><button onClick={() => setCalDrillKey(null)} className="text-xs text-muted-foreground hover:text-foreground">✕</button></div>;
            })()}
            <div className="space-y-2">
              {groupRetailerActivations(drillRows).map((rg) => (
                <div key={rg.key} className="border border-border rounded-lg p-3 text-sm">
                  <div className="font-medium text-foreground">{rg.retailer_banner || rg.retailer_name}</div>
                  {rg.distributors.length > 0 && <div className="text-xs text-muted-foreground">{rg.distributors.join(" · ")}</div>}
                  <div className="text-xs text-muted-foreground mt-1">{uniqueSkuCount(rg.rows)} SKU{uniqueSkuCount(rg.rows) !== 1 ? "s" : ""} on deal</div>
                  {rg.brandGroups.flatMap((bg) => bg.promoGroups).map((pg) => (
                    <div key={pg.key} className="mt-2 text-xs text-muted-foreground border-t border-border pt-2">
                      <div>{pg.promo_type}{pg.promo_name ? ` — ${pg.promo_name}` : ""}</div>
                      <div>Runs: {prettyDate(pg.start_date)} → {prettyDate(pg.end_date)}</div>
                      <div>{uniqueSkuCount(pg.rows)} SKU{uniqueSkuCount(pg.rows) !== 1 ? "s" : ""} · {pg.promo_status}</div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── JSX ────────────────────────────────────────────────────────────────────

  const selectCls = "rounded-lg px-3 py-2 text-sm focus:outline-none";
  const selectStyle = { border: "1px solid var(--border)", background: "var(--card)", color: "var(--foreground)" };

  const subNavBrand = brandIdParam ? allBrands.find((b) => b.id === brandIdParam) ?? null : null;

  return (
    <div className="p-6 space-y-6">
      {/* Brand sub-nav */}
      {subNavBrand && (
        <div className="flex gap-2 text-sm flex-wrap">
          <Link href={`/brands/${subNavBrand.id}`} className="px-3 py-1.5 rounded border hover:bg-gray-50">
            Overview
          </Link>
          <Link href={`/brands/${subNavBrand.id}/retailers`} className="px-3 py-1.5 rounded border hover:bg-gray-50">
            Retailers
          </Link>
          <Link href={`/brands/${subNavBrand.id}/products`} className="px-3 py-1.5 rounded border hover:bg-gray-50">
            Products
          </Link>
          <Link href={`/brands/${subNavBrand.id}/category-review`} className="px-3 py-1.5 rounded border hover:bg-gray-50">
            Category Review
          </Link>
          <span className="px-3 py-1.5 rounded border text-white" style={{ background: "var(--foreground)" }}>
            Promotions
          </span>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-bold text-foreground mr-auto">Promotions</h1>

        {/* View toggle */}
        <div className="flex rounded-lg overflow-hidden border border-border text-sm">
          <button onClick={() => setViewMode("list")} className={`px-4 py-2 ${viewMode === "list" ? "font-semibold text-white" : "text-muted-foreground hover:bg-secondary"}`} style={viewMode === "list" ? { background: "var(--foreground)" } : {}}>List</button>
          <button onClick={() => setViewMode("calendar")} className={`px-4 py-2 ${viewMode === "calendar" ? "font-semibold text-white" : "text-muted-foreground hover:bg-secondary"}`} style={viewMode === "calendar" ? { background: "var(--foreground)" } : {}}>Calendar</button>
        </div>

        {(role === "admin" || role === "rep") && (
          <>
            <button onClick={() => { setBulkOpen((v) => !v); setBulkStep(1); }} className="px-4 py-2 rounded-lg text-sm font-medium" style={{ background: "var(--foreground)", color: "var(--background)" }}>
              + Add Promotion
            </button>
            <Link href="/promotions/new" className="px-4 py-2 rounded-lg text-sm border border-border text-muted-foreground hover:text-foreground transition-colors">
              Single SKU
            </Link>
            {role === "admin" && (
              <button
                onClick={handleSyncStatuses}
                disabled={syncingStatuses}
                className="px-4 py-2 rounded-lg text-sm border border-border text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
              >
                {syncingStatuses ? "Syncing…" : "Sync Statuses"}
              </button>
            )}
          </>
        )}
      </div>

      {status ? <div className="text-sm text-red-600">{status}</div> : null}

      {/* ── Inline edit modal ────────────────────────────────────────────── */}
      {editingRow && editForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => { setEditingRow(null); setEditForm(null); }}>
          <div className="relative w-full max-w-2xl mx-4 rounded-xl border border-border bg-card shadow-xl p-6 space-y-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Edit Promotion</h2>
              <button type="button" onClick={() => { setEditingRow(null); setEditForm(null); }} className="text-muted-foreground hover:text-foreground">✕</button>
            </div>
            {editError && <div className="text-sm text-red-600">{editError}</div>}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              {(["brand_name", "retailer_name", "distributor", "cultivate_rep", "sku_description", "unit_upc"] as const).map((field) => (
                <div key={field} className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground capitalize">{field.replace(/_/g, " ")}</label>
                  <input className="w-full border rounded px-2 py-1.5 text-sm" style={{ borderColor: "var(--border)", background: "var(--secondary)", color: "var(--foreground)" }} value={editForm[field]} onChange={(e) => setEditForm((f) => f ? { ...f, [field]: e.target.value } : f)} />
                </div>
              ))}
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Promo Name</label>
                <select className="w-full border rounded px-2 py-1.5 text-sm" style={{ borderColor: "var(--border)", background: "var(--secondary)", color: "var(--foreground)" }} value={editForm.promo_name} onChange={(e) => setEditForm((f) => f ? { ...f, promo_name: e.target.value } : f)}>
                  <option value="">—</option>
                  {["TPR","Feature","Display","Digital","Distributor OI","Other"].map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Promo Type</label>
                <select className="w-full border rounded px-2 py-1.5 text-sm" style={{ borderColor: "var(--border)", background: "var(--secondary)", color: "var(--foreground)" }} value={editForm.promo_type} onChange={(e) => setEditForm((f) => f ? { ...f, promo_type: e.target.value } : f)}>
                  <option value="">—</option>
                  {["TPR","Feature","Display","Digital","Distributor OI","Other"].map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Promo Status</label>
                <select className="w-full border rounded px-2 py-1.5 text-sm" style={{ borderColor: "var(--border)", background: "var(--secondary)", color: "var(--foreground)" }} value={editForm.promo_status} onChange={(e) => setEditForm((f) => f ? { ...f, promo_status: e.target.value } : f)}>
                  {["planned","submitted","live","completed"].map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Start Date</label>
                <input type="date" className="w-full border rounded px-2 py-1.5 text-sm" style={{ borderColor: "var(--border)", background: "var(--secondary)", color: "var(--foreground)" }} value={editForm.start_date} onChange={(e) => setEditForm((f) => f ? { ...f, start_date: e.target.value } : f)} />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">End Date</label>
                <input type="date" className="w-full border rounded px-2 py-1.5 text-sm" style={{ borderColor: "var(--border)", background: "var(--secondary)", color: "var(--foreground)" }} value={editForm.end_date} onChange={(e) => setEditForm((f) => f ? { ...f, end_date: e.target.value } : f)} />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Discount %</label>
                <input type="number" step="0.01" className="w-full border rounded px-2 py-1.5 text-sm" style={{ borderColor: "var(--border)", background: "var(--secondary)", color: "var(--foreground)" }} value={editForm.discount_percent} onChange={(e) => setEditForm((f) => f ? { ...f, discount_percent: e.target.value } : f)} placeholder="Optional" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Discount $</label>
                <input type="number" step="0.01" className="w-full border rounded px-2 py-1.5 text-sm" style={{ borderColor: "var(--border)", background: "var(--secondary)", color: "var(--foreground)" }} value={editForm.discount_amount} onChange={(e) => setEditForm((f) => f ? { ...f, discount_amount: e.target.value } : f)} placeholder="Optional" />
              </div>
              <div className="space-y-1 md:col-span-2">
                <label className="text-xs font-medium text-muted-foreground">Promo Text</label>
                <textarea rows={2} className="w-full border rounded px-2 py-1.5 text-sm" style={{ borderColor: "var(--border)", background: "var(--secondary)", color: "var(--foreground)" }} value={editForm.promo_text_raw} onChange={(e) => setEditForm((f) => f ? { ...f, promo_text_raw: e.target.value } : f)} />
              </div>
              <div className="space-y-1 md:col-span-2">
                <label className="text-xs font-medium text-muted-foreground">Notes</label>
                <textarea rows={2} className="w-full border rounded px-2 py-1.5 text-sm" style={{ borderColor: "var(--border)", background: "var(--secondary)", color: "var(--foreground)" }} value={editForm.notes} onChange={(e) => setEditForm((f) => f ? { ...f, notes: e.target.value } : f)} />
              </div>
            </div>
            <div className="flex items-center gap-3 pt-2">
              <button type="button" onClick={handleSaveEdit} disabled={editSaving} className="px-4 py-2 rounded text-sm font-medium text-white disabled:opacity-50" style={{ background: "var(--foreground)" }}>
                {editSaving ? "Saving…" : "Save Changes"}
              </button>
              <button type="button" onClick={() => { setEditingRow(null); setEditForm(null); }} className="px-4 py-2 rounded text-sm border border-border text-muted-foreground hover:text-foreground">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk group edit modal — edits shared fields for every SKU in a promo group */}
      {groupEditing && groupEditForm && groupEditInitial && (() => {
        const close = () => { setGroupEditing(null); setGroupEditForm(null); setGroupEditInitial(null); setGroupEditVaries({}); setGroupEditError(""); };
        const { pg, brandName, retailerName } = groupEditing;
        const skuCount = uniqueSkuCount(pg.rows);
        const placeholderFor = (k: keyof GroupEditForm) =>
          groupEditVaries[k] ? "(varies — leave blank to keep per-SKU)" : "";
        const set = (k: keyof GroupEditForm, v: string) =>
          setGroupEditForm((f) => f ? { ...f, [k]: v } : f);
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={close}>
            <div className="relative w-full max-w-2xl mx-4 rounded-xl border border-border bg-card shadow-xl p-6 space-y-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              <div>
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold">Edit Promotion Group</h2>
                  <button type="button" onClick={close} className="text-muted-foreground hover:text-foreground">✕</button>
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {brandName} · {retailerName} · {monthLabel(pg.promo_month)} {pg.promo_year} · {skuCount} SKU{skuCount === 1 ? "" : "s"}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  Only fields you change will be written. Untouched fields keep their per-SKU values.
                </div>
              </div>

              {groupEditError && <div className="text-sm text-red-600">{groupEditError}</div>}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Promo Name</label>
                  <input className="w-full border rounded px-2 py-1.5 text-sm" style={{ borderColor: "var(--border)", background: "var(--secondary)", color: "var(--foreground)" }} value={groupEditForm.promo_name} placeholder={placeholderFor("promo_name")} onChange={(e) => set("promo_name", e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Promo Type (TPR type)</label>
                  <select className="w-full border rounded px-2 py-1.5 text-sm" style={{ borderColor: "var(--border)", background: "var(--secondary)", color: "var(--foreground)" }} value={groupEditForm.promo_type} onChange={(e) => set("promo_type", e.target.value)}>
                    {groupEditVaries.promo_type && <option value="">{placeholderFor("promo_type")}</option>}
                    {["TPR","Feature","Display","Digital","Distributor OI","Other"].map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Promo Status</label>
                  <select className="w-full border rounded px-2 py-1.5 text-sm" style={{ borderColor: "var(--border)", background: "var(--secondary)", color: "var(--foreground)" }} value={groupEditForm.promo_status} onChange={(e) => set("promo_status", e.target.value)}>
                    {groupEditVaries.promo_status && <option value="">{placeholderFor("promo_status")}</option>}
                    {["planned","submitted","live","completed"].map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                </div>
                <div /> {/* spacer to keep the grid aligned */}
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Start Date</label>
                  <input type="date" className="w-full border rounded px-2 py-1.5 text-sm" style={{ borderColor: "var(--border)", background: "var(--secondary)", color: "var(--foreground)" }} value={groupEditForm.start_date} placeholder={placeholderFor("start_date")} onChange={(e) => set("start_date", e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">End Date</label>
                  <input type="date" className="w-full border rounded px-2 py-1.5 text-sm" style={{ borderColor: "var(--border)", background: "var(--secondary)", color: "var(--foreground)" }} value={groupEditForm.end_date} placeholder={placeholderFor("end_date")} onChange={(e) => set("end_date", e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">
                    Discount %{pg.promo_type === "Distributor OI" ? " (OI %)" : ""}
                  </label>
                  <input type="number" step="0.01" className="w-full border rounded px-2 py-1.5 text-sm" style={{ borderColor: "var(--border)", background: "var(--secondary)", color: "var(--foreground)" }} value={groupEditForm.discount_percent} placeholder={placeholderFor("discount_percent") || "Optional"} onChange={(e) => set("discount_percent", e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Discount $</label>
                  <input type="number" step="0.01" className="w-full border rounded px-2 py-1.5 text-sm" style={{ borderColor: "var(--border)", background: "var(--secondary)", color: "var(--foreground)" }} value={groupEditForm.discount_amount} placeholder={placeholderFor("discount_amount") || "Optional"} onChange={(e) => set("discount_amount", e.target.value)} />
                </div>
                <div className="space-y-1 md:col-span-2">
                  <label className="text-xs font-medium text-muted-foreground">Promo Text</label>
                  <textarea rows={2} className="w-full border rounded px-2 py-1.5 text-sm" style={{ borderColor: "var(--border)", background: "var(--secondary)", color: "var(--foreground)" }} value={groupEditForm.promo_text_raw} placeholder={placeholderFor("promo_text_raw")} onChange={(e) => set("promo_text_raw", e.target.value)} />
                </div>
                <div className="space-y-1 md:col-span-2">
                  <label className="text-xs font-medium text-muted-foreground">Notes</label>
                  <textarea rows={2} className="w-full border rounded px-2 py-1.5 text-sm" style={{ borderColor: "var(--border)", background: "var(--secondary)", color: "var(--foreground)" }} value={groupEditForm.notes} placeholder={placeholderFor("notes")} onChange={(e) => set("notes", e.target.value)} />
                </div>
              </div>

              <div className="flex items-center gap-3 pt-2">
                <button type="button" onClick={handleSaveGroupEdit} disabled={groupEditSaving} className="px-4 py-2 rounded text-sm font-medium text-white disabled:opacity-50" style={{ background: "var(--foreground)" }}>
                  {groupEditSaving ? "Saving…" : `Save Changes to ${skuCount} SKU${skuCount === 1 ? "" : "s"}`}
                </button>
                <button type="button" onClick={close} className="px-4 py-2 rounded text-sm border border-border text-muted-foreground hover:text-foreground">Cancel</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Bulk builder */}
      {renderBulkBuilder()}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <select value={brandFilter} onChange={(e) => setBrandFilter(e.target.value)} className={selectCls} style={selectStyle}>
          <option value="all">All Brands</option>
          {brands.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
        <select value={retailerFilter} onChange={(e) => setRetailerFilter(e.target.value)} className={selectCls} style={selectStyle}>
          <option value="all">All Retailers</option>
          {retailers.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <select value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)} className={selectCls} style={selectStyle}>
          <option value="all">All Months</option>
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <option key={m} value={String(m)}>{monthLabel(m)}</option>)}
        </select>
        <select value={yearFilter} onChange={(e) => setYearFilter(e.target.value)} className={selectCls} style={selectStyle}>
          <option value="all">All Years</option>
          {years.map((y) => <option key={y} value={String(y)}>{y}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={selectCls} style={selectStyle}>
          <option value="all">All Statuses</option>
          {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={scopeFilter} onChange={(e) => setScopeFilter(e.target.value)} className={selectCls} style={selectStyle}>
          <option value="all">All Scopes</option>
          <option value="retailer">Retailer</option>
          <option value="distributor">Distributor</option>
        </select>
        {(role === "admin" || role === "rep") && (
          <select value={repFilter} onChange={(e) => setRepFilter(e.target.value)} className={selectCls} style={selectStyle}>
            <option value="all">All Reps</option>
            {reps.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        )}
        {/* Feature 1: EDLP/EDLC toggle */}
        <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer select-none">
          <input type="checkbox" checked={hideEdlp} onChange={(e) => setHideEdlp(e.target.checked)} />
          Hide EDLP/EDLC
        </label>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading promotions…</div>
      ) : viewMode === "calendar" ? (
        renderCalendar()
      ) : (
        <>
          {role === "client" && (
            <section>
              <p className="text-sm text-gray-500 mb-4">Distributor base support by brand and month.</p>
              <table className="w-full text-sm border rounded-xl">
                <tbody>{renderDistributorGroups(distributorGroups)}</tbody>
              </table>
            </section>
          )}
          <section>
            <h2 className="text-xl font-semibold mb-2">Retailer Activations</h2>
            <p className="text-sm text-gray-500 mb-4">Retailer-specific promotions by account, brand, month, and assortment.</p>
            <table className="w-full text-sm border rounded-xl">
              <tbody>{renderRetailerGroups(retailerGroups)}</tbody>
            </table>
          </section>
        </>
      )}
    </div>
  );
}

export default function PromotionsPage() {
  return (
    <Suspense>
      <PromotionsInner />
    </Suspense>
  );
}
