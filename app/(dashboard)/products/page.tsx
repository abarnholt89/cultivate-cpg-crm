"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Role = "admin" | "rep" | "client" | null;

type Product = {
  id: string;
  brand_id: string;
  description: string;
  retail_upc: string | null;
  size: string | null;
  uom: string | null;
  cost: number | null;
  kehe_cost: number | null;
  unfi_cost: number | null;
  case_cost: number | null;
  srp: number | null;
  status: string;
  created_at: string;
  kehe_item: string | null;
  unfi_east_item: string | null;
  unfi_west_item: string | null;
  unit_pack: string | null;
  inner_pack: string | null;
  master_case_pack: string | null;
  ti: number | null;
  hi: number | null;
  cert_non_gmo: boolean | null;
  cert_organic: boolean | null;
  cert_gluten_free: boolean | null;
  cert_kosher: boolean | null;
  cert_vegan: boolean | null;
};

type Brand = { id: string; name: string };
type Retailer = { id: string; name: string; banner: string | null };
type DcCode = { code: string; name: string };
type DcFlatRow = {
  id: string;
  brand_product_id: string;
  distributor: string;
  dc_code: string;
  dc_name: string | null;
  listed: boolean;
  description: string;
  retail_upc: string | null;
  brand_id: string;
};

type EditForm = {
  description: string;
  retail_upc: string;
  size: string;
  uom: string;
  kehe_item: string;
  unfi_east_item: string;
  unfi_west_item: string;
  cost: string;
  kehe_cost: string;
  unfi_cost: string;
  case_cost: string;
  srp: string;
  unit_pack: string;
  inner_pack: string;
  master_case_pack: string;
  ti: string;
  hi: string;
  cert_non_gmo: boolean;
  cert_organic: boolean;
  cert_gluten_free: boolean;
  cert_kosher: boolean;
  cert_vegan: boolean;
};

const EMPTY_EDIT_FORM: EditForm = {
  description: "", retail_upc: "", size: "", uom: "", kehe_item: "", unfi_east_item: "",
  unfi_west_item: "", cost: "", kehe_cost: "", unfi_cost: "", case_cost: "", srp: "",
  unit_pack: "", inner_pack: "", master_case_pack: "", ti: "", hi: "",
  cert_non_gmo: false, cert_organic: false, cert_gluten_free: false, cert_kosher: false,
  cert_vegan: false,
};

const PRODUCT_SELECT = [
  "id", "brand_id", "description", "retail_upc", "size", "uom",
  "cost", "kehe_cost", "unfi_cost", "case_cost", "srp", "status", "created_at",
  "kehe_item", "unfi_east_item", "unfi_west_item",
  "unit_pack", "inner_pack", "master_case_pack", "ti", "hi",
  "cert_non_gmo", "cert_organic", "cert_gluten_free", "cert_kosher", "cert_vegan",
].join(",");

function fmt$(n: number | null) { return n == null ? "—" : `$${n.toFixed(2)}`; }
function fmtN(n: number | null) { return n == null ? "—" : String(n); }

function Check({ v }: { v: boolean | null }) {
  if (!v) return <span className="text-muted-foreground text-xs">—</span>;
  return <span className="text-green-600 font-bold text-xs">✓</span>;
}

// Global grid: 3 frozen columns — Brand | Description | UPC
const FROZEN_BRAND_W = 140;
const FROZEN_DESC_W = 200;
const FROZEN_UPC_W = 120;
const FROZEN_DESC_LEFT = FROZEN_BRAND_W;
const FROZEN_UPC_LEFT = FROZEN_BRAND_W + FROZEN_DESC_W;

const mkHead = (left: number, w: number, borderRight = false) => ({
  position: "sticky" as const, left, top: 0, zIndex: 4,
  minWidth: w, maxWidth: w,
  background: "#1e3a4a",
  ...(borderRight ? { borderRight: "2px solid rgba(255,255,255,0.2)" } : {}),
});
const mkBody = (left: number, w: number, bg: string, borderRight = false) => ({
  position: "sticky" as const, left, zIndex: 2,
  minWidth: w, maxWidth: w,
  background: bg,
  whiteSpace: "normal" as const,
  ...(borderRight ? { borderRight: "2px solid var(--border)" } : {}),
});


export default function ProductsLibraryPage() {
  const router = useRouter();

  const [role, setRole] = useState<Role>(null);
  const [authorized, setAuthorized] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [brandsById, setBrandsById] = useState<Record<string, Brand>>({});
  const [authorizedCounts, setAuthorizedCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [brandFilter, setBrandFilter] = useState("");
  const [query, setQuery] = useState("");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditForm>(EMPTY_EDIT_FORM);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");

  // Tab state
  const [activeTab, setActiveTab] = useState<"products" | "apl" | "dc">("products");
  const [copyMode, setCopyMode] = useState(false);
  const [selectedCells, setSelectedCells] = useState<Set<string>>(new Set());
  const [copyConfirm, setCopyConfirm] = useState(false);
  const [includeHeaders, setIncludeHeaders] = useState(true);
  const [tableModalHtml, setTableModalHtml] = useState<string | null>(null);
  const tableModalRef = useRef<HTMLDivElement>(null);

  // APL state (global — all brands)
  const [aplLoaded, setAplLoaded] = useState(false);
  const [aplLoading, setAplLoading] = useState(false);
  const [aplRetailers, setAplRetailers] = useState<Retailer[]>([]);
  const [aplAuthorized, setAplAuthorized] = useState<Set<string>>(new Set());
  const [aplSearch, setAplSearch] = useState("");
  const [aplShowAll, setAplShowAll] = useState(true);

  // DC state (global — all brands)
  const [dcLoaded, setDcLoaded] = useState(false);
  const [dcLoading, setDcLoading] = useState(false);
  const [dcRows, setDcRows] = useState<DcFlatRow[]>([]);

  // APL add-authorization form
  const [aplAddOpen, setAplAddOpen] = useState(false);
  const [aplAddRetailerId, setAplAddRetailerId] = useState("");
  const [aplAddProductId, setAplAddProductId] = useState("");
  const [aplAddSkuSearch, setAplAddSkuSearch] = useState("");
  const [aplAddSaving, setAplAddSaving] = useState(false);
  const [aplAddError, setAplAddError] = useState("");

  // DC edit mode
  const [dcEditMode, setDcEditMode] = useState(false);
  const [dcPending, setDcPending] = useState<Set<string>>(new Set());
  const [dcError, setDcError] = useState("");

  const isRepOrAdmin = role === "admin" || role === "rep";

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load() {
    setLoading(true);
    setError("");

    const { data: authData } = await supabase.auth.getUser();
    const userId = authData?.user?.id;
    if (!userId) { router.replace("/login"); return; }

    const { data: profile } = await supabase.from("profiles").select("role").eq("id", userId).single();
    const nextRole = (profile?.role as Role) ?? null;
    setRole(nextRole);

    if (nextRole === "client") { router.replace("/brands"); return; }
    setAuthorized(true);

    const [brandsRes, authRowsRes] = await Promise.all([
      supabase.from("brands").select("id,name").order("name"),
      supabase.from("authorized_products").select("upc,retailer_id"),
    ]);

    if (brandsRes.error) { setError(brandsRes.error.message); setLoading(false); return; }

    const brandsData = (brandsRes.data as Brand[]) ?? [];
    setBrands(brandsData);
    const byId: Record<string, Brand> = {};
    brandsData.forEach((b) => { byId[b.id] = b; });
    setBrandsById(byId);

    // Paginate brand_products to load all SKUs (Supabase default cap is 1000)
    const PCHUNK = 1000;
    const allProducts: Product[] = [];
    let pfrom = 0;
    while (true) {
      const { data: pdata, error: perr } = await supabase
        .from("brand_products").select(PRODUCT_SELECT).eq("status", "active").order("description")
        .range(pfrom, pfrom + PCHUNK - 1);
      if (perr) { setError(perr.message); setLoading(false); return; }
      if (!pdata || pdata.length === 0) break;
      allProducts.push(...(pdata as unknown as Product[]));
      if (pdata.length < PCHUNK) break;
      pfrom += PCHUNK;
    }
    setProducts(allProducts);

    const counts: Record<string, Set<string>> = {};
    ((authRowsRes.data ?? []) as { upc: string; retailer_id: string }[]).forEach((r) => {
      if (!r.upc || !r.retailer_id) return;
      if (!counts[r.upc]) counts[r.upc] = new Set();
      counts[r.upc].add(r.retailer_id);
    });
    const flat: Record<string, number> = {};
    Object.entries(counts).forEach(([upc, set]) => { flat[upc] = set.size; });
    setAuthorizedCounts(flat);

    setLoading(false);
  }

  async function loadApl() {
    console.log("[loadApl] called — aplLoaded:", aplLoaded, "aplLoading:", aplLoading);
    if (aplLoaded || aplLoading) return;
    setAplLoading(true);
    // Fetch retailers + ALL authorized_products (paginated)
    const CHUNK = 1000;
    const [retailersRes] = await Promise.all([
      supabase.from("retailers").select("id,name,banner").order("name"),
    ]);
    // Deduplicate retailers by banner (falling back to name)
    const rawRetailers = (retailersRes.data as Retailer[]) ?? [];
    const seenBanners = new Set<string>();
    const dedupedRetailers: Retailer[] = [];
    for (const r of rawRetailers) {
      const key = r.banner ?? r.name;
      if (!seenBanners.has(key)) { seenBanners.add(key); dedupedRetailers.push(r); }
    }
    console.log("[loadApl] rawRetailers:", rawRetailers.length, "→ deduped:", dedupedRetailers.length);
    console.log("[loadApl] first 3 deduped retailers:", dedupedRetailers.slice(0, 3).map(r => ({ id: r.id, banner: r.banner, name: r.name })));
    setAplRetailers(dedupedRetailers);

    const authSet = new Set<string>();
    let from = 0;
    let totalAuthRows = 0;
    let sampleAuthRows: any[] = [];
    while (true) {
      const { data, error } = await supabase
        .from("authorized_products")
        .select("upc,retailer_id")
        .range(from, from + CHUNK - 1);
      console.log(`[loadApl] auth fetch page ${from}: rows=${data?.length ?? 0} error=${error?.message ?? "none"}`);
      if (!data || data.length === 0) break;
      if (from === 0) sampleAuthRows = data.slice(0, 5);
      totalAuthRows += data.length;
      (data as { upc: string; retailer_id: string }[]).forEach((r) => {
        if (r.upc && r.retailer_id) authSet.add(`${r.upc}|${r.retailer_id}`);
      });
      if (data.length < CHUNK) break;
      from += CHUNK;
    }
    console.log("[loadApl] total auth rows:", totalAuthRows, "| auth set size:", authSet.size);
    console.log("[loadApl] first 5 auth rows from DB:", sampleAuthRows);
    console.log("[loadApl] first 5 auth SET keys:", [...authSet].slice(0, 5));

    // Cross-check: do any auth retailer_ids match deduped retailer ids?
    const dedupedIds = new Set(dedupedRetailers.map(r => r.id));
    const authRetailerIds = new Set(sampleAuthRows.map((r: any) => r.retailer_id));
    console.log("[loadApl] sample auth retailer_ids:", [...authRetailerIds]);
    console.log("[loadApl] any sample auth retailer_id in deduped list?",
      [...authRetailerIds].some(id => dedupedIds.has(id)));

    setAplAuthorized(authSet);
    setAplLoaded(true);
    setAplLoading(false);
  }

  async function loadDc() {
    if (dcLoaded || dcLoading) return;
    console.log("[loadDc/global] starting — dcLoaded:", dcLoaded, "dcLoading:", dcLoading);
    setDcLoading(true);

    // Step 1: confirm the API can see the table (no join)
    const { count: tableCount, error: countErr } = await supabase
      .from("distributor_dc_listings")
      .select("*", { count: "exact", head: true });
    console.log("[loadDc/global] table count:", tableCount, "countErr:", countErr);

    // Step 2: try a simple 5-row sample with no join to isolate join issues
    const { data: sample, error: sampleErr } = await supabase
      .from("distributor_dc_listings")
      .select("id,brand_product_id,distributor,dc_code,listed")
      .limit(5);
    console.log("[loadDc/global] 5-row sample:", sample, "sampleErr:", sampleErr);

    type RawRow = {
      id: string;
      brand_product_id: string;
      distributor: string;
      dc_code: string;
      dc_name: string | null;
      listed: boolean;
      brand_products: { description: string; retail_upc: string | null; brand_id: string } | null;
    };

    const all: DcFlatRow[] = [];
    const PAGE = 1000;
    let from = 0;
    while (true) {
      const { data, error } = await supabase
        .from("distributor_dc_listings")
        .select("id,brand_product_id,distributor,dc_code,dc_name,listed,brand_products(description,retail_upc,brand_id)")
        .range(from, from + PAGE - 1)
        .order("distributor")
        .order("dc_code");
      console.log(`[loadDc/global] range(${from},${from + PAGE - 1}): rows=${data?.length ?? "null"} error=${error?.message ?? "none"}`);
      if (error) {
        console.error("[loadDc/global] fetch error:", error);
        setError(`DC load error: ${error.message}`);
        setDcLoading(false);
        return;
      }
      const rows = (data ?? []) as unknown as RawRow[];
      if (from === 0 && rows.length > 0) {
        console.log("[loadDc/global] first row sample:", JSON.stringify(rows[0]));
      }
      rows.forEach((r) => {
        all.push({
          id: r.id,
          brand_product_id: r.brand_product_id,
          distributor: r.distributor,
          dc_code: r.dc_code,
          dc_name: r.dc_name,
          listed: r.listed,
          description: r.brand_products?.description ?? "",
          retail_upc: r.brand_products?.retail_upc ?? null,
          brand_id: r.brand_products?.brand_id ?? "",
        });
      });
      if (rows.length < PAGE) break;
      from += PAGE;
    }
    console.log("[loadDc/global] done — total rows:", all.length, "sample distributors:", [...new Set(all.slice(0, 20).map(r => r.distributor))]);
    setDcRows(all);
    setDcLoaded(true);
    setDcLoading(false);
  }

  function switchTab(tab: "products" | "apl" | "dc") {
    setActiveTab(tab);
    if (tab === "apl" && !aplLoaded) loadApl();
    if (tab === "dc" && !dcLoaded) loadDc();
  }


  async function toggleApl(upc: string, retailerId: string) {
    const product = products.find((p) => p.retail_upc === upc);
    const brandId = product?.brand_id;
    const brandName = brandId ? (brandsById[brandId]?.name ?? "") : "";
    const key = `${upc}|${retailerId}`;
    const isAuth = aplAuthorized.has(key);
    if (isAuth) {
      const q = supabase.from("authorized_products").delete().eq("upc", upc).eq("retailer_id", retailerId);
      if (brandId) await q.eq("brand_id", brandId); else await q;
      setAplAuthorized((prev) => { const n = new Set(prev); n.delete(key); return n; });
    } else {
      await supabase.from("authorized_products")
        .insert({ brand_id: brandId ?? null, retailer_id: retailerId, upc, client_name: brandName });
      setAplAuthorized((prev) => { const n = new Set(prev); n.add(key); return n; });
    }
  }

  async function toggleDc(bpId: string, distributor: string, dcCode: string) {
    if (!isRepOrAdmin || !dcEditMode) return;
    const normDist = (distributor ?? "").toUpperCase();
    const key = `${bpId}|${normDist}|${dcCode}`;
    if (dcPending.has(key)) return;

    const currentListed = dcLookup.get(key) ?? false;
    const newListed = !currentListed;
    const isNewRow = !dcRows.some(
      (r) => r.brand_product_id === bpId && (r.distributor ?? "").toUpperCase() === normDist && r.dc_code === dcCode
    );

    // Optimistic update
    setDcPending((prev) => new Set(prev).add(key));
    if (isNewRow) {
      const product = products.find((p) => p.id === bpId);
      setDcRows((prev) => [...prev, {
        id: "", brand_product_id: bpId, distributor, dc_code: dcCode, dc_name: null,
        listed: true, description: product?.description ?? "", retail_upc: product?.retail_upc ?? null,
        brand_id: product?.brand_id ?? "",
      }]);
    } else {
      setDcRows((prev) => prev.map((r) =>
        r.brand_product_id === bpId && (r.distributor ?? "").toUpperCase() === normDist && r.dc_code === dcCode
          ? { ...r, listed: newListed } : r
      ));
    }

    const { error } = await supabase.from("distributor_dc_listings").upsert(
      { brand_product_id: bpId, distributor, dc_code: dcCode, listed: newListed },
      { onConflict: "brand_product_id,distributor,dc_code" }
    );

    setDcPending((prev) => { const n = new Set(prev); n.delete(key); return n; });
    if (error) {
      // Revert optimistic update
      if (isNewRow) {
        setDcRows((prev) => prev.filter(
          (r) => !(r.brand_product_id === bpId && (r.distributor ?? "").toUpperCase() === normDist && r.dc_code === dcCode)
        ));
      } else {
        setDcRows((prev) => prev.map((r) =>
          r.brand_product_id === bpId && (r.distributor ?? "").toUpperCase() === normDist && r.dc_code === dcCode
            ? { ...r, listed: currentListed } : r
        ));
      }
      setDcError(`Failed to update [${distributor}] ${dcCode}: ${error.message}`);
      setTimeout(() => setDcError(""), 5000);
    }
  }

  async function addAplAuthorization() {
    if (!aplAddRetailerId || !aplAddProductId) { setAplAddError("Select both a retailer and a SKU"); return; }
    const product = products.find((p) => p.id === aplAddProductId);
    if (!product?.retail_upc) { setAplAddError("Selected SKU has no UPC"); return; }
    const key = `${product.retail_upc}|${aplAddRetailerId}`;
    if (aplAuthorized.has(key)) { setAplAddError("Already authorized"); return; }
    setAplAddSaving(true);
    setAplAddError("");
    const brandName = brandsById[product.brand_id]?.name ?? "";
    const { error } = await supabase.from("authorized_products")
      .insert({ brand_id: product.brand_id, retailer_id: aplAddRetailerId, upc: product.retail_upc, client_name: brandName });
    if (error) { setAplAddError(error.message); setAplAddSaving(false); return; }
    setAplAuthorized((prev) => { const n = new Set(prev); n.add(key); return n; });
    setAplAddOpen(false);
    setAplAddRetailerId(""); setAplAddProductId(""); setAplAddSkuSearch("");
    setAplAddSaving(false);
  }


  const filtered = useMemo(() => {
    return products
      .filter((p) => {
        if (brandFilter && p.brand_id !== brandFilter) return false;
        if (query) {
          const q = query.toLowerCase();
          return (
            p.description.toLowerCase().includes(q) ||
            (p.retail_upc ?? "").toLowerCase().includes(q) ||
            (p.size ?? "").toLowerCase().includes(q)
          );
        }
        return true;
      })
      .sort((a, b) => {
        const aBrand = brandsById[a.brand_id]?.name ?? "";
        const bBrand = brandsById[b.brand_id]?.name ?? "";
        const brandCmp = aBrand.localeCompare(bBrand);
        if (brandCmp !== 0) return brandCmp;
        return a.description.localeCompare(b.description);
      });
  }, [products, brandFilter, query, brandsById]);

  // APL — all active products, optional brand filter + search
  const aplProducts = useMemo(() => {
    return products
      .filter((p) => p.status === "active")
      .filter((p) => !brandFilter || p.brand_id === brandFilter)
      .filter((p) => {
        if (!aplSearch) return true;
        const q = aplSearch.toLowerCase();
        return p.description.toLowerCase().includes(q) || (p.retail_upc ?? "").includes(q) ||
          (brandsById[p.brand_id]?.name ?? "").toLowerCase().includes(q);
      })
      .sort((a, b) => {
        const bn = (brandsById[a.brand_id]?.name ?? "").localeCompare(brandsById[b.brand_id]?.name ?? "");
        return bn !== 0 ? bn : a.description.localeCompare(b.description);
      });
  }, [products, brandFilter, aplSearch, brandsById]);

  const aplVisibleRetailers = useMemo(() => {
    if (aplShowAll) return aplRetailers;
    return aplRetailers.filter((r) =>
      aplProducts.some((p) => p.retail_upc && aplAuthorized.has(`${p.retail_upc}|${r.id}`))
    );
  }, [aplRetailers, aplShowAll, aplProducts, aplAuthorized]);

  // DC — all active products (for Add DC Listing SKU selector)
  const dcProducts = useMemo(() => {
    return products
      .filter((p) => p.status === "active")
      .sort((a, b) => {
        const bn = (brandsById[a.brand_id]?.name ?? "").localeCompare(brandsById[b.brand_id]?.name ?? "");
        return bn !== 0 ? bn : a.description.localeCompare(b.description);
      });
  }, [products, brandsById]);

  // Derived DC code lists for the Add DC Listing dropdown
  const unfiCodes = useMemo<DcCode[]>(() => {
    const m = new Map<string, string>();
    dcRows.forEach((r) => { if ((r.distributor ?? "").toUpperCase() === "UNFI") m.set(r.dc_code, r.dc_name ?? r.dc_code); });
    return [...m.entries()].map(([code, name]) => ({ code, name })).sort((a, b) => a.code.localeCompare(b.code));
  }, [dcRows]);
  const keheCodes = useMemo<DcCode[]>(() => {
    const m = new Map<string, string>();
    dcRows.forEach((r) => { if ((r.distributor ?? "").toUpperCase() === "KEHE") m.set(r.dc_code, r.dc_name ?? r.dc_code); });
    return [...m.entries()].map(([code, name]) => ({ code, name })).sort((a, b) => a.code.localeCompare(b.code));
  }, [dcRows]);

  // Fast O(1) lookup for pivot table cells — normalize distributor to uppercase so
  // "kehe"/"KeHE"/"KEHE" all match the same bucket as the column headers
  const dcLookup = useMemo<Map<string, boolean>>(() => {
    const m = new Map<string, boolean>();
    dcRows.forEach((r) => m.set(`${r.brand_product_id}|${(r.distributor ?? "").toUpperCase()}|${r.dc_code}`, r.listed));
    return m;
  }, [dcRows]);

  function startEdit(product: Product) {
    setEditingId(product.id);
    setEditForm({
      description: product.description,
      retail_upc: product.retail_upc ?? "",
      size: product.size ?? "",
      uom: product.uom ?? "",
      kehe_item: product.kehe_item ?? "",
      unfi_east_item: product.unfi_east_item ?? "",
      unfi_west_item: product.unfi_west_item ?? "",
      cost: product.cost != null ? String(product.cost) : "",
      kehe_cost: product.kehe_cost != null ? String(product.kehe_cost) : "",
      unfi_cost: product.unfi_cost != null ? String(product.unfi_cost) : "",
      case_cost: product.case_cost != null ? String(product.case_cost) : "",
      srp: product.srp != null ? String(product.srp) : "",
      unit_pack: product.unit_pack ?? "",
      inner_pack: product.inner_pack ?? "",
      master_case_pack: product.master_case_pack ?? "",
      ti: product.ti != null ? String(product.ti) : "",
      hi: product.hi != null ? String(product.hi) : "",
      cert_non_gmo: product.cert_non_gmo ?? false,
      cert_organic: product.cert_organic ?? false,
      cert_gluten_free: product.cert_gluten_free ?? false,
      cert_kosher: product.cert_kosher ?? false,
      cert_vegan: product.cert_vegan ?? false,
    });
    setEditError("");
  }

  function cancelEdit() { setEditingId(null); setEditError(""); }

  async function saveEdit() {
    if (!editingId) return;
    if (!editForm.description.trim()) { setEditError("Description is required"); return; }
    setEditSaving(true);
    setEditError("");
    const updates = {
      description: editForm.description.trim(),
      retail_upc: editForm.retail_upc.trim() || null,
      size: editForm.size.trim() || null,
      uom: editForm.uom.trim() || null,
      kehe_item: editForm.kehe_item.trim() || null,
      unfi_east_item: editForm.unfi_east_item.trim() || null,
      unfi_west_item: editForm.unfi_west_item.trim() || null,
      cost: editForm.cost ? parseFloat(editForm.cost) : null,
      kehe_cost: editForm.kehe_cost ? parseFloat(editForm.kehe_cost) : null,
      unfi_cost: editForm.unfi_cost ? parseFloat(editForm.unfi_cost) : null,
      case_cost: editForm.case_cost ? parseFloat(editForm.case_cost) : null,
      srp: editForm.srp ? parseFloat(editForm.srp) : null,
      unit_pack: editForm.unit_pack.trim() || null,
      inner_pack: editForm.inner_pack.trim() || null,
      master_case_pack: editForm.master_case_pack.trim() || null,
      ti: editForm.ti ? parseFloat(editForm.ti) : null,
      hi: editForm.hi ? parseFloat(editForm.hi) : null,
      cert_non_gmo: editForm.cert_non_gmo || null,
      cert_organic: editForm.cert_organic || null,
      cert_gluten_free: editForm.cert_gluten_free || null,
      cert_kosher: editForm.cert_kosher || null,
      cert_vegan: editForm.cert_vegan || null,
    };
    const { error } = await supabase.from("brand_products").update(updates).eq("id", editingId);
    if (error) { setEditError(error.message); setEditSaving(false); return; }
    setProducts((prev) => prev.map((p) => p.id === editingId ? { ...p, ...updates } : p));
    setEditingId(null);
    setEditSaving(false);
  }

  const isRepOrAdminLocal = role === "admin" || role === "rep";
  const totalCols = 24 + (isRepOrAdminLocal ? 1 : 0);

  if (loading) return <div className="p-6 text-sm text-muted-foreground">Loading products…</div>;
  if (!authorized) return null;

  const thStyle = "px-3 py-2 font-medium text-muted-foreground whitespace-nowrap text-left text-xs";
  const tdStyle = "px-3 py-2 text-xs whitespace-nowrap";
  const groupTh = "px-3 py-1 text-xs font-semibold text-white/80 text-center";

  function tabCls(tab: string) {
    return `px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
      activeTab === tab
        ? "border-foreground text-foreground"
        : "border-transparent text-muted-foreground hover:text-foreground"
    }`;
  }

  // Copy Mode helpers
  const COPY_COLS = ["brand", "description", "retail_upc", "size", "uom", "kehe_item", "unfi_east_item", "unfi_west_item", "cost", "case_cost", "srp"];
  const COL_LABELS: Record<string, string> = {
    brand: "Brand", description: "Description", retail_upc: "UPC", size: "Size", uom: "UOM",
    kehe_item: "KeHE", unfi_east_item: "UNFI East", unfi_west_item: "UNFI West",
    cost: "Unit Cost", case_cost: "Case Cost", srp: "SRP",
  };

  function toggleCell(rowIdx: number, col: string) {
    const key = `${rowIdx}-${col}`;
    setSelectedCells((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function getProductCellValue(product: Product, col: string): string {
    const brand = brandsById[product.brand_id];
    switch (col) {
      case "brand": return brand?.name ?? "";
      case "description": return product.description ?? "";
      case "retail_upc": return product.retail_upc ?? "";
      case "size": return product.size ?? "";
      case "uom": return product.uom ?? "";
      case "kehe_item": return product.kehe_item ?? "";
      case "unfi_east_item": return product.unfi_east_item ?? "";
      case "unfi_west_item": return product.unfi_west_item ?? "";
      case "cost": return product.cost != null ? `$${product.cost.toFixed(2)}` : "";
      case "case_cost": return product.case_cost != null ? `$${product.case_cost.toFixed(2)}` : "";
      case "srp": return product.srp != null ? `$${product.srp.toFixed(2)}` : "";
      default: return "";
    }
  }

  function buildRowMap() {
    const rowMap = new Map<number, Map<string, string>>();
    for (const key of selectedCells) {
      const dashIdx = key.indexOf("-");
      const rowIdx = parseInt(key.slice(0, dashIdx));
      const col = key.slice(dashIdx + 1);
      if (!rowMap.has(rowIdx)) rowMap.set(rowIdx, new Map());
      const product = filtered[rowIdx];
      if (!product) continue;
      rowMap.get(rowIdx)!.set(col, getProductCellValue(product, col));
    }
    return rowMap;
  }

  async function copyForExcel() {
    const rowMap = buildRowMap();
    const activeCols = COPY_COLS.filter((c) => [...rowMap.values()].some((m) => m.has(c)));
    const dataLines = [...rowMap.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, cols]) => activeCols.map((c) => cols.get(c) ?? "").join("\t"));
    const lines = includeHeaders
      ? [activeCols.map((c) => COL_LABELS[c] ?? c).join("\t"), ...dataLines]
      : dataLines;
    await navigator.clipboard.writeText(lines.join("\n"));
    setCopyConfirm(true);
    setTimeout(() => setCopyConfirm(false), 1500);
  }

  function openTableModal() {
    const rowMap = buildRowMap();
    const activeCols = COPY_COLS.filter((c) => [...rowMap.values()].some((m) => m.has(c)));
    const stripDollar = (v: string) => v.replace(/^\$/, "");
    const sortedRows = [...rowMap.entries()].sort((a, b) => a[0] - b[0]);
    const thStyle = `border:1px solid #d1d5db;background:#f3f4f6;padding:8px 14px;font-weight:bold;text-align:left;`;
    const tdStyle = `border:1px solid #d1d5db;padding:8px 14px;`;
    const headerRow = includeHeaders
      ? `<tr>${activeCols.map((c) => `<th style="${thStyle}">${COL_LABELS[c] ?? c}</th>`).join("")}</tr>`
      : "";
    const dataRows = sortedRows
      .map(([, cols]) => `<tr>${activeCols.map((c) => `<td style="${tdStyle}">${stripDollar(cols.get(c) ?? "")}</td>`).join("")}</tr>`)
      .join("");
    const html = `<table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:13px;">${headerRow}${dataRows}</table>`;
    setTableModalHtml(html);
    // Auto-select table contents after render
    setTimeout(() => {
      const el = tableModalRef.current;
      if (!el) return;
      const sel = window.getSelection();
      if (!sel) return;
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);
    }, 50);
  }

  function mkSelStyle(rowIdx: number, col: string, base?: CSSProperties): CSSProperties {
    if (!copyMode) return base ?? {};
    const isSel = selectedCells.has(`${rowIdx}-${col}`);
    return { ...(base ?? {}), cursor: "pointer", ...(isSel ? { background: "#ccfbf1", outline: "2px solid #2dd4bf", outlineOffset: "-2px" } : {}) };
  }

  function mkSelClick(rowIdx: number, col: string): (() => void) | undefined {
    return copyMode ? () => toggleCell(rowIdx, col) : undefined;
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Products Library</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          All active SKUs across all brands — {products.length.toLocaleString()} total
        </p>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      </div>

      {/* Brand filter + search (always visible) */}
      <div className="flex flex-wrap gap-3">
        <select
          value={brandFilter} onChange={(e) => setBrandFilter(e.target.value)}
          className="rounded-lg px-3 py-2 text-sm focus:outline-none"
          style={{ border: "1px solid var(--border)", background: "var(--card)", color: "var(--foreground)" }}
        >
          <option value="">All Brands</option>
          {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        {activeTab === "products" && (
          <input
            type="text" placeholder="Search description or UPC…" value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="rounded-lg px-3 py-2 text-sm flex-1 min-w-[200px] focus:outline-none focus:ring-2"
            style={{ border: "1px solid var(--border)", background: "var(--card)", color: "var(--foreground)" }}
          />
        )}
        {activeTab === "products" && (
          <span className="self-center text-sm text-muted-foreground">
            {filtered.length.toLocaleString()} SKU{filtered.length !== 1 ? "s" : ""}
          </span>
        )}
        {activeTab === "products" && (
          <button
            onClick={() => { setCopyMode((v) => { if (v) setSelectedCells(new Set()); return !v; }); }}
            className="px-3 py-2 rounded-lg text-sm font-medium border transition-colors whitespace-nowrap"
            style={copyMode
              ? { background: "#0d9488", color: "#fff", borderColor: "#0d9488" }
              : { border: "1px solid var(--border)", background: "var(--card)", color: "var(--muted-foreground)" }}
          >
            {copyMode ? "Exit Copy Mode" : "Copy Mode"}
          </button>
        )}
        {activeTab === "products" && copyMode && selectedCells.size > 0 && (
          <>
            <button
              onClick={copyForExcel}
              className="px-3 py-2 rounded-lg text-sm font-medium border transition-colors whitespace-nowrap"
              style={{ background: copyConfirm ? "#0d9488" : "var(--card)", color: copyConfirm ? "#fff" : "var(--foreground)", borderColor: copyConfirm ? "#0d9488" : "var(--border)" }}
            >
              {copyConfirm ? "Copied!" : "Copy for Excel"}
            </button>
            <button
              onClick={openTableModal}
              className="px-3 py-2 rounded-lg text-sm font-medium border transition-colors whitespace-nowrap"
              style={{ border: "1px solid var(--border)", background: "var(--card)", color: "var(--foreground)" }}
            >
              Open as Table
            </button>
            <button
              onClick={() => setSelectedCells(new Set())}
              className="px-3 py-2 rounded-lg text-sm font-medium border transition-colors whitespace-nowrap"
              style={{ border: "1px solid var(--border)", background: "var(--card)", color: "var(--muted-foreground)" }}
            >
              Clear
            </button>
          </>
        )}
      </div>

      {activeTab === "products" && copyMode && (
        <div className="flex items-center gap-4 rounded-lg px-3 py-2 text-xs text-teal-700" style={{ background: "#f0fdfa", border: "1px solid #99f6e4" }}>
          <span>{selectedCells.size === 0 ? "Click cells to select them, then click Copy Selected." : `${selectedCells.size} cell${selectedCells.size !== 1 ? "s" : ""} selected`}</span>
          <label className="flex items-center gap-1.5 cursor-pointer ml-auto whitespace-nowrap">
            <input type="checkbox" checked={includeHeaders} onChange={(e) => setIncludeHeaders(e.target.checked)} />
            Include headers
          </label>
        </div>
      )}

      {/* Tab bar */}
      <div className="flex border-b border-border -mb-2">
        <button onClick={() => switchTab("products")} className={tabCls("products")}>Products</button>
        <button onClick={() => switchTab("apl")} className={tabCls("apl")}>APL</button>
        <button onClick={() => switchTab("dc")} className={tabCls("dc")}>DC Assortment</button>
      </div>

      {/* ─────────────── PRODUCTS TAB ─────────────── */}
      {activeTab === "products" && (
        <>
          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground">No products match your filters.</p>
          ) : (
            <>
            {copyMode && (
              <style>{`.copy-mode-table td[data-sel] { pointer-events: auto !important; cursor: pointer !important; } .copy-mode-table td[data-sel] span.cell-hit { display: block; width: 100%; pointer-events: auto; } .copy-mode-table td[data-sel]:not([data-selected="true"]) span.cell-hit:hover { background: rgba(20,184,166,0.06); }`}</style>
            )}
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className={copyMode ? "text-sm copy-mode-table" : "text-sm"} style={{ minWidth: "max-content", width: "100%", userSelect: copyMode ? "none" : undefined }}>
                <thead>
                  <tr style={{ background: "#1e3a4a" }}>
                    <th className={groupTh} colSpan={1} style={{ borderRight: "1px solid rgba(255,255,255,0.15)" }}>Brand</th>
                    <th className={groupTh} colSpan={4} style={{ borderRight: "1px solid rgba(255,255,255,0.15)" }}>Identity</th>
                    <th className={groupTh} colSpan={3} style={{ borderRight: "1px solid rgba(255,255,255,0.15)" }}>Distributor Items</th>
                    <th className={groupTh} colSpan={5} style={{ borderRight: "1px solid rgba(255,255,255,0.15)" }}>Pricing</th>
                    <th className={groupTh} colSpan={5} style={{ borderRight: "1px solid rgba(255,255,255,0.15)" }}>Pack Info</th>
                    <th className={groupTh} colSpan={5} style={{ borderRight: "1px solid rgba(255,255,255,0.15)" }}>Certifications</th>
                    <th className={groupTh} colSpan={1}>Auth.</th>
                    {isRepOrAdminLocal && <th className={groupTh} colSpan={1} />}
                  </tr>
                  <tr className="border-b border-border bg-secondary text-left">
                    <th className={thStyle} style={{ borderRight: "1px solid var(--border)" }}>Brand</th>
                    <th className={thStyle}>Description</th>
                    <th className={thStyle}>UPC</th>
                    <th className={thStyle}>Size</th>
                    <th className={thStyle} style={{ borderRight: "1px solid var(--border)" }}>UOM</th>
                    <th className={thStyle}>KeHE</th>
                    <th className={thStyle}>UNFI East</th>
                    <th className={thStyle} style={{ borderRight: "1px solid var(--border)" }}>UNFI West</th>
                    <th className={thStyle}>Unit Cost</th>
                    <th className={thStyle}>KeHE Cost</th>
                    <th className={thStyle}>UNFI Cost</th>
                    <th className={thStyle}>Case Cost</th>
                    <th className={thStyle} style={{ borderRight: "1px solid var(--border)" }}>SRP</th>
                    <th className={thStyle}>Unit Pack</th>
                    <th className={thStyle}>Inner Pack</th>
                    <th className={thStyle}>Master Case</th>
                    <th className={thStyle}>TI</th>
                    <th className={thStyle} style={{ borderRight: "1px solid var(--border)" }}>HI</th>
                    <th className={thStyle}>Non-GMO</th>
                    <th className={thStyle}>Organic</th>
                    <th className={thStyle}>GF</th>
                    <th className={thStyle}>Kosher</th>
                    <th className={thStyle} style={{ borderRight: "1px solid var(--border)" }}>Vegan</th>
                    <th className={thStyle}>Auth.</th>
                    {isRepOrAdminLocal && <th className={thStyle} />}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((product, idx) => {
                    const brand = brandsById[product.brand_id];
                    const authCount = product.retail_upc ? (authorizedCounts[product.retail_upc] ?? 0) : 0;
                    const isEven = idx % 2 === 0;
                    const isEditing = editingId === product.id;
                    const rowBg = isEven ? "var(--card)" : "var(--secondary)";

                    return [
                      <tr key={product.id} className="border-b border-border last:border-0" style={{ background: rowBg }}>
                        <td className={tdStyle} data-sel={copyMode ? "1" : undefined} data-selected={selectedCells.has(`${idx}-brand`) ? "true" : undefined} style={mkSelStyle(idx, "brand", { borderRight: "1px solid var(--border)" })}>
                          <span className="cell-hit" onClick={mkSelClick(idx, "brand")}>
                            {brand
                              ? <Link href={`/brands/${product.brand_id}/products`} className="text-xs font-medium text-foreground hover:underline whitespace-nowrap" onClick={copyMode ? (e) => { e.preventDefault(); e.stopPropagation(); toggleCell(idx, "brand"); } : undefined}>{brand.name}</Link>
                              : <span className="text-muted-foreground">—</span>}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-xs text-foreground font-medium" data-sel={copyMode ? "1" : undefined} data-selected={selectedCells.has(`${idx}-description`) ? "true" : undefined} style={mkSelStyle(idx, "description", { whiteSpace: "normal" })}>
                          <span className="cell-hit" onClick={mkSelClick(idx, "description")}>{product.description}</span>
                        </td>
                        <td className={`${tdStyle} font-mono text-muted-foreground`} data-sel={copyMode ? "1" : undefined} data-selected={selectedCells.has(`${idx}-retail_upc`) ? "true" : undefined} style={mkSelStyle(idx, "retail_upc")}>
                          <span className="cell-hit" onClick={mkSelClick(idx, "retail_upc")}>{product.retail_upc ?? "—"}</span>
                        </td>
                        <td className={`${tdStyle} text-muted-foreground`} data-sel={copyMode ? "1" : undefined} data-selected={selectedCells.has(`${idx}-size`) ? "true" : undefined} style={mkSelStyle(idx, "size")}>
                          <span className="cell-hit" onClick={mkSelClick(idx, "size")}>{product.size ?? "—"}</span>
                        </td>
                        <td className={`${tdStyle} text-muted-foreground`} data-sel={copyMode ? "1" : undefined} data-selected={selectedCells.has(`${idx}-uom`) ? "true" : undefined} style={mkSelStyle(idx, "uom", { borderRight: "1px solid var(--border)" })}>
                          <span className="cell-hit" onClick={mkSelClick(idx, "uom")}>{product.uom ?? "—"}</span>
                        </td>
                        <td className={`${tdStyle} text-muted-foreground`} data-sel={copyMode ? "1" : undefined} data-selected={selectedCells.has(`${idx}-kehe_item`) ? "true" : undefined} style={mkSelStyle(idx, "kehe_item")}>
                          <span className="cell-hit" onClick={mkSelClick(idx, "kehe_item")}>{product.kehe_item ?? "—"}</span>
                        </td>
                        <td className={`${tdStyle} text-muted-foreground`} data-sel={copyMode ? "1" : undefined} data-selected={selectedCells.has(`${idx}-unfi_east_item`) ? "true" : undefined} style={mkSelStyle(idx, "unfi_east_item")}>
                          <span className="cell-hit" onClick={mkSelClick(idx, "unfi_east_item")}>{product.unfi_east_item ?? "—"}</span>
                        </td>
                        <td className={`${tdStyle} text-muted-foreground`} data-sel={copyMode ? "1" : undefined} data-selected={selectedCells.has(`${idx}-unfi_west_item`) ? "true" : undefined} style={mkSelStyle(idx, "unfi_west_item", { borderRight: "1px solid var(--border)" })}>
                          <span className="cell-hit" onClick={mkSelClick(idx, "unfi_west_item")}>{product.unfi_west_item ?? "—"}</span>
                        </td>
                        <td className={`${tdStyle} text-muted-foreground`} data-sel={copyMode ? "1" : undefined} data-selected={selectedCells.has(`${idx}-cost`) ? "true" : undefined} style={mkSelStyle(idx, "cost")}>
                          <span className="cell-hit" onClick={mkSelClick(idx, "cost")}>{fmt$(product.cost)}</span>
                        </td>
                        <td className={`${tdStyle} text-muted-foreground`}>{fmt$(product.kehe_cost)}</td>
                        <td className={`${tdStyle} text-muted-foreground`}>{fmt$(product.unfi_cost)}</td>
                        <td className={`${tdStyle} text-muted-foreground`} data-sel={copyMode ? "1" : undefined} data-selected={selectedCells.has(`${idx}-case_cost`) ? "true" : undefined} style={mkSelStyle(idx, "case_cost")}>
                          <span className="cell-hit" onClick={mkSelClick(idx, "case_cost")}>{fmt$(product.case_cost)}</span>
                        </td>
                        <td className={`${tdStyle} text-muted-foreground`} data-sel={copyMode ? "1" : undefined} data-selected={selectedCells.has(`${idx}-srp`) ? "true" : undefined} style={mkSelStyle(idx, "srp", { borderRight: "1px solid var(--border)" })}>
                          <span className="cell-hit" onClick={mkSelClick(idx, "srp")}>{fmt$(product.srp)}</span>
                        </td>
                        <td className={`${tdStyle} text-muted-foreground`}>{product.unit_pack ?? "—"}</td>
                        <td className={`${tdStyle} text-muted-foreground`}>{product.inner_pack ?? "—"}</td>
                        <td className={`${tdStyle} text-muted-foreground`}>{product.master_case_pack ?? "—"}</td>
                        <td className={`${tdStyle} text-muted-foreground`}>{fmtN(product.ti)}</td>
                        <td className={`${tdStyle} text-muted-foreground`} style={{ borderRight: "1px solid var(--border)" }}>{fmtN(product.hi)}</td>
                        <td className={`${tdStyle} text-center`}><Check v={product.cert_non_gmo} /></td>
                        <td className={`${tdStyle} text-center`}><Check v={product.cert_organic} /></td>
                        <td className={`${tdStyle} text-center`}><Check v={product.cert_gluten_free} /></td>
                        <td className={`${tdStyle} text-center`}><Check v={product.cert_kosher} /></td>
                        <td className={`${tdStyle} text-center`} style={{ borderRight: "1px solid var(--border)" }}><Check v={product.cert_vegan} /></td>
                        <td className={tdStyle}>
                          {authCount > 0
                            ? <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">{authCount}</span>
                            : <span className="text-muted-foreground">—</span>}
                        </td>
                        {isRepOrAdminLocal && (
                          <td className={`${tdStyle} text-right`}>
                            <button onClick={copyMode ? undefined : () => startEdit(product)} className="text-xs text-muted-foreground hover:text-foreground transition-colors">Edit</button>
                          </td>
                        )}
                      </tr>,
                      isEditing && (
                        <tr key={`${product.id}-edit`} className="border-b border-border" style={{ background: "var(--card)" }}>
                          <td colSpan={totalCols} className="px-4 py-3">
                            <div className="space-y-3">
                              <div className="grid grid-cols-4 gap-3">
                                <div className="col-span-2">
                                  <label className="block text-xs text-muted-foreground mb-1">Description *</label>
                                  <input type="text" value={editForm.description} onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))} className="border rounded px-2 py-1 text-sm w-full" style={{ borderColor: "var(--border)", background: "var(--secondary)", color: "var(--foreground)" }} />
                                </div>
                                <div>
                                  <label className="block text-xs text-muted-foreground mb-1">UPC</label>
                                  <input type="text" value={editForm.retail_upc} onChange={(e) => setEditForm((f) => ({ ...f, retail_upc: e.target.value }))} className="border rounded px-2 py-1 text-sm w-full font-mono" style={{ borderColor: "var(--border)", background: "var(--secondary)", color: "var(--foreground)" }} />
                                </div>
                                <div>
                                  <label className="block text-xs text-muted-foreground mb-1">Size</label>
                                  <input type="text" value={editForm.size} onChange={(e) => setEditForm((f) => ({ ...f, size: e.target.value }))} className="border rounded px-2 py-1 text-sm w-full" style={{ borderColor: "var(--border)", background: "var(--secondary)", color: "var(--foreground)" }} />
                                </div>
                              </div>
                              <div className="grid grid-cols-4 gap-3">
                                <div>
                                  <label className="block text-xs text-muted-foreground mb-1">UOM</label>
                                  <input type="text" value={editForm.uom} onChange={(e) => setEditForm((f) => ({ ...f, uom: e.target.value }))} className="border rounded px-2 py-1 text-sm w-full" style={{ borderColor: "var(--border)", background: "var(--secondary)", color: "var(--foreground)" }} />
                                </div>
                                <div>
                                  <label className="block text-xs text-muted-foreground mb-1">KeHE Item #</label>
                                  <input type="text" value={editForm.kehe_item} onChange={(e) => setEditForm((f) => ({ ...f, kehe_item: e.target.value }))} className="border rounded px-2 py-1 text-sm w-full font-mono" style={{ borderColor: "var(--border)", background: "var(--secondary)", color: "var(--foreground)" }} />
                                </div>
                                <div>
                                  <label className="block text-xs text-muted-foreground mb-1">UNFI East #</label>
                                  <input type="text" value={editForm.unfi_east_item} onChange={(e) => setEditForm((f) => ({ ...f, unfi_east_item: e.target.value }))} className="border rounded px-2 py-1 text-sm w-full font-mono" style={{ borderColor: "var(--border)", background: "var(--secondary)", color: "var(--foreground)" }} />
                                </div>
                                <div>
                                  <label className="block text-xs text-muted-foreground mb-1">UNFI West #</label>
                                  <input type="text" value={editForm.unfi_west_item} onChange={(e) => setEditForm((f) => ({ ...f, unfi_west_item: e.target.value }))} className="border rounded px-2 py-1 text-sm w-full font-mono" style={{ borderColor: "var(--border)", background: "var(--secondary)", color: "var(--foreground)" }} />
                                </div>
                              </div>
                              <div className="grid grid-cols-5 gap-3">
                                <div>
                                  <label className="block text-xs text-muted-foreground mb-1">Unit Cost ($)</label>
                                  <input type="number" step="0.01" value={editForm.cost} onChange={(e) => setEditForm((f) => ({ ...f, cost: e.target.value }))} className="border rounded px-2 py-1 text-sm w-full" style={{ borderColor: "var(--border)", background: "var(--secondary)", color: "var(--foreground)" }} />
                                </div>
                                <div>
                                  <label className="block text-xs text-muted-foreground mb-1">KeHE Cost ($)</label>
                                  <input type="number" step="0.01" value={editForm.kehe_cost} onChange={(e) => setEditForm((f) => ({ ...f, kehe_cost: e.target.value }))} className="border rounded px-2 py-1 text-sm w-full" style={{ borderColor: "var(--border)", background: "var(--secondary)", color: "var(--foreground)" }} />
                                </div>
                                <div>
                                  <label className="block text-xs text-muted-foreground mb-1">UNFI Cost ($)</label>
                                  <input type="number" step="0.01" value={editForm.unfi_cost} onChange={(e) => setEditForm((f) => ({ ...f, unfi_cost: e.target.value }))} className="border rounded px-2 py-1 text-sm w-full" style={{ borderColor: "var(--border)", background: "var(--secondary)", color: "var(--foreground)" }} />
                                </div>
                                <div>
                                  <label className="block text-xs text-muted-foreground mb-1">Case Cost ($)</label>
                                  <input type="number" step="0.01" value={editForm.case_cost} onChange={(e) => setEditForm((f) => ({ ...f, case_cost: e.target.value }))} className="border rounded px-2 py-1 text-sm w-full" style={{ borderColor: "var(--border)", background: "var(--secondary)", color: "var(--foreground)" }} />
                                </div>
                                <div>
                                  <label className="block text-xs text-muted-foreground mb-1">SRP ($)</label>
                                  <input type="number" step="0.01" value={editForm.srp} onChange={(e) => setEditForm((f) => ({ ...f, srp: e.target.value }))} className="border rounded px-2 py-1 text-sm w-full" style={{ borderColor: "var(--border)", background: "var(--secondary)", color: "var(--foreground)" }} />
                                </div>
                              </div>
                              <div className="grid grid-cols-5 gap-3">
                                <div>
                                  <label className="block text-xs text-muted-foreground mb-1">Unit Pack</label>
                                  <input type="text" value={editForm.unit_pack} onChange={(e) => setEditForm((f) => ({ ...f, unit_pack: e.target.value }))} className="border rounded px-2 py-1 text-sm w-full" style={{ borderColor: "var(--border)", background: "var(--secondary)", color: "var(--foreground)" }} />
                                </div>
                                <div>
                                  <label className="block text-xs text-muted-foreground mb-1">Inner Pack</label>
                                  <input type="text" value={editForm.inner_pack} onChange={(e) => setEditForm((f) => ({ ...f, inner_pack: e.target.value }))} className="border rounded px-2 py-1 text-sm w-full" style={{ borderColor: "var(--border)", background: "var(--secondary)", color: "var(--foreground)" }} />
                                </div>
                                <div>
                                  <label className="block text-xs text-muted-foreground mb-1">Master Case</label>
                                  <input type="text" value={editForm.master_case_pack} onChange={(e) => setEditForm((f) => ({ ...f, master_case_pack: e.target.value }))} className="border rounded px-2 py-1 text-sm w-full" style={{ borderColor: "var(--border)", background: "var(--secondary)", color: "var(--foreground)" }} />
                                </div>
                                <div>
                                  <label className="block text-xs text-muted-foreground mb-1">TI</label>
                                  <input type="number" step="1" value={editForm.ti} onChange={(e) => setEditForm((f) => ({ ...f, ti: e.target.value }))} className="border rounded px-2 py-1 text-sm w-full" style={{ borderColor: "var(--border)", background: "var(--secondary)", color: "var(--foreground)" }} />
                                </div>
                                <div>
                                  <label className="block text-xs text-muted-foreground mb-1">HI</label>
                                  <input type="number" step="1" value={editForm.hi} onChange={(e) => setEditForm((f) => ({ ...f, hi: e.target.value }))} className="border rounded px-2 py-1 text-sm w-full" style={{ borderColor: "var(--border)", background: "var(--secondary)", color: "var(--foreground)" }} />
                                </div>
                              </div>
                              <div className="flex flex-wrap items-center gap-4">
                                <span className="text-xs text-muted-foreground font-medium">Certifications:</span>
                                {(["cert_non_gmo", "cert_organic", "cert_gluten_free", "cert_kosher", "cert_vegan"] as const).map((field) => (
                                  <label key={field} className="flex items-center gap-1.5 text-xs text-foreground cursor-pointer">
                                    <input type="checkbox" checked={editForm[field]} onChange={(e) => setEditForm((f) => ({ ...f, [field]: e.target.checked }))} className="rounded" />
                                    {field === "cert_non_gmo" ? "Non-GMO" : field === "cert_organic" ? "Organic" : field === "cert_gluten_free" ? "GF" : field === "cert_kosher" ? "Kosher" : "Vegan"}
                                  </label>
                                ))}
                                <div className="flex items-center gap-2 ml-auto">
                                  {editError && <span className="text-xs text-red-600">{editError}</span>}
                                  <button onClick={saveEdit} disabled={editSaving} className="px-3 py-1.5 rounded text-xs font-medium disabled:opacity-50" style={{ background: "var(--foreground)", color: "var(--background)" }}>
                                    {editSaving ? "Saving…" : "Save"}
                                  </button>
                                  <button onClick={cancelEdit} className="text-xs text-muted-foreground hover:text-foreground">Cancel</button>
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      ),
                    ].filter(Boolean);
                  })}
                </tbody>
              </table>
            </div>
            </>
          )}
        </>
      )}

      {/* ─────────────── APL TAB ─────────────── */}
      {activeTab === "apl" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="text" placeholder="Search SKUs…" value={aplSearch}
              onChange={(e) => setAplSearch(e.target.value)}
              className="rounded-lg px-3 py-2 text-sm w-64 focus:outline-none focus:ring-2"
              style={{ border: "1px solid var(--border)", background: "var(--card)", color: "var(--foreground)" }}
            />
            <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
              <input type="checkbox" checked={!aplShowAll} onChange={(e) => setAplShowAll(!e.target.checked)} />
              Authorized retailers only
            </label>
            {!aplLoading && aplLoaded && (
              <span className="text-sm text-muted-foreground">
                {aplProducts.length} SKU{aplProducts.length !== 1 ? "s" : ""} · {aplVisibleRetailers.length} retailer{aplVisibleRetailers.length !== 1 ? "s" : ""}
              </span>
            )}
            {isRepOrAdmin && !aplLoading && aplLoaded && (
              <button
                onClick={() => { setAplAddOpen((v) => !v); setAplAddError(""); }}
                className="ml-auto px-3 py-1.5 rounded-lg text-xs font-medium border border-border text-muted-foreground hover:text-foreground transition-colors"
              >
                + Add Authorization
              </button>
            )}
          </div>

          {/* Add Authorization form */}
          {aplAddOpen && isRepOrAdmin && (
            <div className="rounded-xl border border-border bg-card p-4 space-y-3">
              <div className="text-sm font-semibold text-foreground">Add Authorization</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">Retailer</label>
                  <select
                    value={aplAddRetailerId} onChange={(e) => setAplAddRetailerId(e.target.value)}
                    className="rounded-lg px-3 py-2 text-sm w-full"
                    style={{ border: "1px solid var(--border)", background: "var(--secondary)", color: "var(--foreground)" }}
                  >
                    <option value="">— Select retailer —</option>
                    {aplRetailers.map((r) => <option key={r.id} value={r.id}>{r.banner ?? r.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">SKU</label>
                  <input
                    type="text" placeholder="Filter SKUs…" value={aplAddSkuSearch}
                    onChange={(e) => setAplAddSkuSearch(e.target.value)}
                    className="rounded-lg px-3 py-2 text-sm w-full mb-1.5"
                    style={{ border: "1px solid var(--border)", background: "var(--secondary)", color: "var(--foreground)" }}
                  />
                  <select
                    value={aplAddProductId} onChange={(e) => setAplAddProductId(e.target.value)}
                    className="rounded-lg px-3 py-2 text-sm w-full"
                    style={{ border: "1px solid var(--border)", background: "var(--secondary)", color: "var(--foreground)" }}
                  >
                    <option value="">— Select SKU —</option>
                    {aplProducts
                      .filter((p) => !aplAddSkuSearch ||
                        p.description.toLowerCase().includes(aplAddSkuSearch.toLowerCase()) ||
                        (p.retail_upc ?? "").includes(aplAddSkuSearch))
                      .map((p) => (
                        <option key={p.id} value={p.id}>{(brandsById[p.brand_id]?.name ? `[${brandsById[p.brand_id].name}] ` : "")}{p.description}{p.retail_upc ? ` (${p.retail_upc})` : ""}</option>
                      ))}
                  </select>
                </div>
              </div>
              {aplAddError && <p className="text-xs text-red-600">{aplAddError}</p>}
              <div className="flex gap-2">
                <button onClick={addAplAuthorization} disabled={aplAddSaving}
                  className="px-3 py-1.5 rounded text-xs font-medium disabled:opacity-50"
                  style={{ background: "var(--foreground)", color: "var(--background)" }}>
                  {aplAddSaving ? "Saving…" : "Save"}
                </button>
                <button onClick={() => { setAplAddOpen(false); setAplAddError(""); }} className="text-xs text-muted-foreground hover:text-foreground">Cancel</button>
              </div>
            </div>
          )}

          {aplLoading && <p className="text-sm text-muted-foreground">Loading APL data…</p>}

          {!aplLoading && aplLoaded && aplProducts.length === 0 && (
            <p className="text-sm text-muted-foreground">No active SKUs found.</p>
          )}

          {!aplLoading && aplLoaded && aplProducts.length > 0 && aplVisibleRetailers.length > 0 && (
            <div style={{ overflowX: "auto", overflowY: "auto", maxHeight: "72vh", borderRadius: "0.75rem", border: "1px solid var(--border)" }}>
              <table style={{ borderCollapse: "separate", borderSpacing: 0, fontSize: "0.75rem" }}>
                <thead>
                  <tr style={{ background: "#1e3a4a" }}>
                    <th style={{ ...mkHead(0, FROZEN_BRAND_W), padding: "8px 12px", fontWeight: 500, color: "rgba(255,255,255,0.8)", textAlign: "left" }}>Brand</th>
                    <th style={{ ...mkHead(FROZEN_DESC_LEFT, FROZEN_DESC_W), padding: "8px 12px", fontWeight: 500, color: "rgba(255,255,255,0.8)", textAlign: "left" }}>Description</th>
                    <th style={{ ...mkHead(FROZEN_UPC_LEFT, FROZEN_UPC_W, true), padding: "8px 12px", fontWeight: 500, color: "rgba(255,255,255,0.8)", textAlign: "left" }}>UPC</th>
                    {aplVisibleRetailers.map((r) => (
                      <th key={r.id} style={{
                        position: "sticky", top: 0, zIndex: 1, background: "#1e3a4a",
                        writingMode: "vertical-rl", textOrientation: "mixed", transform: "rotate(180deg)",
                        height: 110, width: 30, whiteSpace: "nowrap", textAlign: "left", verticalAlign: "bottom",
                        padding: "8px 4px", fontWeight: 400, color: "rgba(255,255,255,0.75)", fontSize: "0.7rem",
                        borderLeft: "1px solid rgba(255,255,255,0.08)",
                      }}>{r.banner ?? r.name}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {aplProducts.map((p, idx) => {
                    const rowBg = idx % 2 === 0 ? "var(--card)" : "var(--secondary)";
                    const brandName = brandsById[p.brand_id]?.name ?? "";
                    if (idx === 0 && aplVisibleRetailers.length > 0) {
                      const sampleKey = `${p.retail_upc}|${aplVisibleRetailers[0].id}`;
                      console.log("[APL grid] first cell key:", sampleKey, "| in authSet?", aplAuthorized.has(sampleKey));
                      console.log("[APL grid] product retail_upc:", p.retail_upc, "| retailer id:", aplVisibleRetailers[0].id, "banner:", aplVisibleRetailers[0].banner);
                      console.log("[APL grid] auth set size:", aplAuthorized.size);
                    }
                    return (
                      <tr key={p.id} style={{ borderBottom: "1px solid var(--border)" }}>
                        <td style={{ ...mkBody(0, FROZEN_BRAND_W, rowBg), padding: "6px 12px", color: "var(--muted-foreground)" }}>
                          <div style={{ maxWidth: FROZEN_BRAND_W - 16, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={brandName}>{brandName}</div>
                        </td>
                        <td style={{ ...mkBody(FROZEN_DESC_LEFT, FROZEN_DESC_W, rowBg), padding: "6px 12px", fontWeight: 500, color: "var(--foreground)" }}>
                          <div style={{ maxWidth: FROZEN_DESC_W - 24, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={p.description}>{p.description}</div>
                        </td>
                        <td style={{ ...mkBody(FROZEN_UPC_LEFT, FROZEN_UPC_W, rowBg, true), padding: "6px 12px", fontFamily: "monospace", color: "var(--muted-foreground)" }}>{p.retail_upc ?? "—"}</td>
                        {aplVisibleRetailers.map((r) => {
                          const key = `${p.retail_upc}|${r.id}`;
                          const isAuth = !!p.retail_upc && aplAuthorized.has(key);
                          const canToggle = !!p.retail_upc && isRepOrAdmin;
                          return (
                            <td key={r.id} onClick={() => canToggle && toggleApl(p.retail_upc!, r.id)}
                              style={{ textAlign: "center", padding: "6px 4px", cursor: canToggle ? "pointer" : "default", background: isAuth ? "rgba(22,163,74,0.12)" : rowBg, borderLeft: "1px solid var(--border)", minWidth: 30, transition: "background 0.1s" }}
                              title={`${r.banner ?? r.name} — ${isAuth ? "Authorized" : "Not authorized"}`}>
                              {isAuth
                                ? <span style={{ color: "#16a34a", fontWeight: 700, fontSize: "0.85rem" }}>✓</span>
                                : <span style={{ color: "var(--muted-foreground)", fontSize: "0.7rem" }}>·</span>}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {!aplLoading && aplLoaded && aplProducts.length > 0 && aplVisibleRetailers.length === 0 && !aplShowAll && (
            <p className="text-sm text-muted-foreground">No authorized retailers. Toggle off the filter to see all retailers.</p>
          )}

          {!aplLoading && aplLoaded && isRepOrAdmin && aplProducts.length > 0 && (
            <p className="text-xs text-muted-foreground">Click any cell to toggle authorization for that SKU × retailer.</p>
          )}
        </div>
      )}

      {/* ─────────────── DC ASSORTMENT TAB ─────────────── */}
      {activeTab === "dc" && (
        <div className="space-y-4">
          {/* Edit Mode toggle */}
          {isRepOrAdmin && !dcLoading && dcLoaded && (
            <div className="flex items-center justify-end gap-3">
              {dcEditMode && (
                <span className="text-xs text-muted-foreground">Click any cell to toggle listed status</span>
              )}
              <button
                onClick={() => setDcEditMode((v) => !v)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors"
                style={dcEditMode
                  ? { background: "#1e3a4a", color: "#fff", borderColor: "#1e3a4a" }
                  : { background: "transparent", borderColor: "var(--border)", color: "var(--muted-foreground)" }}
              >
                {dcEditMode ? "✓ Edit Mode ON" : "Edit Mode"}
              </button>
            </div>
          )}

          {dcLoading && <p className="text-sm text-muted-foreground">Loading DC data…</p>}

          {!dcLoading && dcLoaded && (() => {
            const allDcCodes = [
              ...keheCodes.map((dc) => ({ ...dc, distributor: "KeHE" as const })),
              ...unfiCodes.map((dc) => ({ ...dc, distributor: "UNFI" as const })),
            ];
            console.log("[DC render] dcRows:", dcRows.length, "keheCodes:", keheCodes.length, "unfiCodes:", unfiCodes.length, "allDcCodes:", allDcCodes.length, "dcProducts:", dcProducts.length);
            if (dcRows.length === 0) {
              return (
                <div className="rounded-xl border border-border bg-card p-6 space-y-2">
                  <p className="text-sm font-medium text-foreground">No DC listings found</p>
                  <p className="text-xs text-muted-foreground">
                    The <code className="font-mono bg-secondary px-1 rounded">distributor_dc_listings</code> table is empty.
                    Use &quot;+ Add DC Listing&quot; to add listings.
                  </p>
                  {isRepOrAdmin && (
                    <button onClick={() => setDcEditMode(true)}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium border border-border text-muted-foreground hover:text-foreground transition-colors mt-1">
                      Enable Edit Mode
                    </button>
                  )}
                </div>
              );
            }
            return (
              <>
                <div className="text-sm text-muted-foreground">
                  {dcProducts.length} SKU{dcProducts.length !== 1 ? "s" : ""} · {keheCodes.length} KeHE DC{keheCodes.length !== 1 ? "s" : ""} · {unfiCodes.length} UNFI DC{unfiCodes.length !== 1 ? "s" : ""}
                </div>
                <div style={{ overflowX: "auto", overflowY: "auto", maxHeight: "72vh", borderRadius: "0.75rem", border: "1px solid var(--border)" }}>
                  <table style={{ borderCollapse: "separate", borderSpacing: 0, fontSize: "0.75rem" }}>
                    <thead>
                      <tr style={{ background: "#1e3a4a" }}>
                        <th style={{ ...mkHead(0, FROZEN_BRAND_W), padding: "8px 12px", fontWeight: 500, color: "rgba(255,255,255,0.8)", textAlign: "left" }}>Brand</th>
                        <th style={{ ...mkHead(FROZEN_DESC_LEFT, FROZEN_DESC_W), padding: "8px 12px", fontWeight: 500, color: "rgba(255,255,255,0.8)", textAlign: "left" }}>Description</th>
                        <th style={{ ...mkHead(FROZEN_UPC_LEFT, FROZEN_UPC_W, true), padding: "8px 12px", fontWeight: 500, color: "rgba(255,255,255,0.8)", textAlign: "left" }}>UPC</th>
                        {allDcCodes.map((dc, i) => {
                          const isFirstUnfi = dc.distributor === "UNFI" && (i === 0 || allDcCodes[i - 1].distributor === "KeHE");
                          return (
                            <th key={`${dc.distributor}-${dc.code}`} style={{
                              position: "sticky", top: 0, zIndex: 1, background: "#1e3a4a",
                              writingMode: "vertical-rl", textOrientation: "mixed", transform: "rotate(180deg)",
                              height: 110, width: 30, whiteSpace: "nowrap", textAlign: "left", verticalAlign: "bottom",
                              padding: "8px 4px", fontWeight: 400, fontSize: "0.7rem",
                              color: dc.distributor === "KeHE" ? "rgba(134,239,172,0.85)" : "rgba(147,197,253,0.85)",
                              borderLeft: isFirstUnfi ? "2px solid rgba(59,130,246,0.4)" : "1px solid rgba(255,255,255,0.08)",
                            }}>
                              {dc.code} — {dc.name}
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {dcProducts.map((p, idx) => {
                        const rowBg = idx % 2 === 0 ? "var(--card)" : "var(--secondary)";
                        const brandName = brandsById[p.brand_id]?.name ?? "";
                        return (
                          <tr key={p.id} style={{ borderBottom: "1px solid var(--border)" }}>
                            <td style={{ ...mkBody(0, FROZEN_BRAND_W, rowBg), padding: "6px 12px", color: "var(--muted-foreground)" }}>
                              <div style={{ maxWidth: FROZEN_BRAND_W - 16, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={brandName}>{brandName}</div>
                            </td>
                            <td style={{ ...mkBody(FROZEN_DESC_LEFT, FROZEN_DESC_W, rowBg), padding: "6px 12px", fontWeight: 500, color: "var(--foreground)" }}>
                              <div style={{ maxWidth: FROZEN_DESC_W - 24, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={p.description}>{p.description}</div>
                            </td>
                            <td style={{ ...mkBody(FROZEN_UPC_LEFT, FROZEN_UPC_W, rowBg, true), padding: "6px 12px", fontFamily: "monospace", color: "var(--muted-foreground)" }}>{p.retail_upc ?? "—"}</td>
                            {allDcCodes.map((dc, i) => {
                              const cellKey = `${p.id}|${dc.distributor.toUpperCase()}|${dc.code}`;
                              const isListed = dcLookup.get(cellKey) ?? false;
                              const isPending = dcPending.has(cellKey);
                              const isFirstUnfi = dc.distributor === "UNFI" && (i === 0 || allDcCodes[i - 1].distributor === "KeHE");
                              const canClick = isRepOrAdmin && dcEditMode;
                              return (
                                <td key={`${dc.distributor}-${dc.code}`}
                                  onClick={canClick ? () => toggleDc(p.id, dc.distributor, dc.code) : undefined}
                                  style={{
                                    textAlign: "center", padding: "6px 4px",
                                    cursor: canClick ? "pointer" : "default",
                                    background: isPending ? "rgba(0,0,0,0.04)" : isListed ? "rgba(22,163,74,0.12)" : rowBg,
                                    borderLeft: isFirstUnfi ? "2px solid rgba(59,130,246,0.2)" : "1px solid var(--border)",
                                    minWidth: 30, transition: "background 0.1s",
                                    opacity: isPending ? 0.5 : 1,
                                  }}
                                  title={canClick
                                    ? `[${dc.distributor}] ${dc.code} — click to ${isListed ? "remove" : "add"}`
                                    : `[${dc.distributor}] ${dc.code} — ${isListed ? "Listed" : "Not listed"}`}>
                                  {isPending
                                    ? <span style={{ color: "var(--muted-foreground)", fontSize: "0.65rem" }}>…</span>
                                    : isListed
                                      ? <span style={{ color: "#16a34a", fontWeight: 700, fontSize: "0.85rem" }}>✓</span>
                                      : <span style={{ color: "var(--muted-foreground)", fontSize: "0.7rem" }}>—</span>}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            );
          })()}
        </div>
      )}

      {/* DC error toast */}
      {dcError && (
        <div className="fixed bottom-6 right-6 z-50 rounded-lg px-4 py-3 text-sm shadow-lg"
          style={{ background: "#fee2e2", color: "#991b1b", border: "1px solid #fca5a5", maxWidth: 360 }}>
          {dcError}
        </div>
      )}

      {tableModalHtml && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.55)" }}
          onClick={() => { setTableModalHtml(null); window.getSelection()?.removeAllRanges(); }}
        >
          <div
            className="bg-white rounded-xl shadow-2xl flex flex-col max-h-[85vh] w-auto max-w-[90vw]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 pt-5 pb-3 border-b border-gray-200">
              <h2 className="text-base font-semibold text-gray-900">Copy this table into your email</h2>
              <p className="text-xs text-gray-500 mt-1">Select all (Ctrl+A / Cmd+A), copy (Ctrl+C / Cmd+C), then paste into your email.</p>
            </div>
            <div className="overflow-auto px-6 py-4 flex-1">
              <div ref={tableModalRef} dangerouslySetInnerHTML={{ __html: tableModalHtml }} />
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end">
              <button
                onClick={() => { setTableModalHtml(null); window.getSelection()?.removeAllRanges(); }}
                className="px-4 py-2 rounded-lg text-sm font-medium"
                style={{ background: "#1e3a4a", color: "#fff" }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
