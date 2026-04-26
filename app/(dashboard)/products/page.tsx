"use client";

import { useEffect, useMemo, useState } from "react";
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

type EditForm = {
  description: string;
  retail_upc: string;
  size: string;
  srp: string;
};

const PRODUCT_SELECT = [
  "id", "brand_id", "description", "retail_upc", "size", "uom",
  "cost", "case_cost", "srp", "status", "created_at",
  "kehe_item", "unfi_east_item", "unfi_west_item",
  "unit_pack", "inner_pack", "master_case_pack", "ti", "hi",
  "cert_non_gmo", "cert_organic", "cert_gluten_free", "cert_kosher", "cert_vegan",
].join(",");

function fmt$(n: number | null) {
  return n == null ? "—" : `$${n.toFixed(2)}`;
}

function fmtN(n: number | null) {
  return n == null ? "—" : String(n);
}

function Check({ v }: { v: boolean | null }) {
  if (!v) return <span className="text-muted-foreground text-xs">—</span>;
  return <span className="text-green-600 font-bold text-xs">✓</span>;
}

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
  const [editForm, setEditForm] = useState<EditForm>({ description: "", retail_upc: "", size: "", srp: "" });
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");

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

    const [productsRes, brandsRes, authRowsRes] = await Promise.all([
      supabase.from("brand_products").select(PRODUCT_SELECT).eq("status", "active").order("description"),
      supabase.from("brands").select("id,name").order("name"),
      supabase.from("authorized_products").select("upc,retailer_id"),
    ]);

    if (productsRes.error) { setError(productsRes.error.message); setLoading(false); return; }
    if (brandsRes.error) { setError(brandsRes.error.message); setLoading(false); return; }

    const brandsData = (brandsRes.data as Brand[]) ?? [];
    setBrands(brandsData);
    const byId: Record<string, Brand> = {};
    brandsData.forEach((b) => { byId[b.id] = b; });
    setBrandsById(byId);
    setProducts((productsRes.data as unknown as Product[]) ?? []);

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

  function startEdit(product: Product) {
    setEditingId(product.id);
    setEditForm({
      description: product.description,
      retail_upc: product.retail_upc ?? "",
      size: product.size ?? "",
      srp: product.srp != null ? String(product.srp) : "",
    });
    setEditError("");
  }

  function cancelEdit() { setEditingId(null); setEditError(""); }

  async function saveEdit() {
    if (!editingId) return;
    if (!editForm.description.trim()) { setEditError("Description is required"); return; }
    setEditSaving(true);
    setEditError("");
    const { error } = await supabase
      .from("brand_products")
      .update({
        description: editForm.description.trim(),
        retail_upc: editForm.retail_upc.trim() || null,
        size: editForm.size.trim() || null,
        srp: editForm.srp ? parseFloat(editForm.srp) : null,
      })
      .eq("id", editingId);
    if (error) { setEditError(error.message); setEditSaving(false); return; }
    setProducts((prev) =>
      prev.map((p) => p.id === editingId
        ? { ...p, description: editForm.description.trim(), retail_upc: editForm.retail_upc.trim() || null, size: editForm.size.trim() || null, srp: editForm.srp ? parseFloat(editForm.srp) : null }
        : p)
    );
    setEditingId(null);
    setEditSaving(false);
  }

  const isRepOrAdmin = role === "admin" || role === "rep";
  const totalCols = 22 + (isRepOrAdmin ? 1 : 0);

  if (loading) return <div className="p-6 text-sm text-muted-foreground">Loading products…</div>;
  if (!authorized) return null;

  const thStyle = "px-3 py-2 font-medium text-muted-foreground whitespace-nowrap text-left text-xs";
  const tdStyle = "px-3 py-2 text-xs whitespace-nowrap";
  const groupTh = "px-3 py-1 text-xs font-semibold text-white/80 text-center";

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Products Library</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          All active SKUs across all brands — {products.length.toLocaleString()} total
        </p>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      </div>

      <div className="flex flex-wrap gap-3">
        <select
          value={brandFilter} onChange={(e) => setBrandFilter(e.target.value)}
          className="rounded-lg px-3 py-2 text-sm focus:outline-none"
          style={{ border: "1px solid var(--border)", background: "var(--card)", color: "var(--foreground)" }}
        >
          <option value="">All Brands</option>
          {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <input
          type="text" placeholder="Search description or UPC…" value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="rounded-lg px-3 py-2 text-sm flex-1 min-w-[200px] focus:outline-none focus:ring-2"
          style={{ border: "1px solid var(--border)", background: "var(--card)", color: "var(--foreground)" }}
        />
        <span className="self-center text-sm text-muted-foreground">
          {filtered.length.toLocaleString()} SKU{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">No products match your filters.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="text-sm" style={{ minWidth: "max-content", width: "100%" }}>
            <thead>
              {/* Group header row */}
              <tr style={{ background: "#1e3a4a" }}>
                <th className={groupTh} colSpan={1} style={{ borderRight: "1px solid rgba(255,255,255,0.15)" }}>Brand</th>
                <th className={groupTh} colSpan={4} style={{ borderRight: "1px solid rgba(255,255,255,0.15)" }}>Identity</th>
                <th className={groupTh} colSpan={3} style={{ borderRight: "1px solid rgba(255,255,255,0.15)" }}>Distributor Items</th>
                <th className={groupTh} colSpan={3} style={{ borderRight: "1px solid rgba(255,255,255,0.15)" }}>Pricing</th>
                <th className={groupTh} colSpan={5} style={{ borderRight: "1px solid rgba(255,255,255,0.15)" }}>Pack Info</th>
                <th className={groupTh} colSpan={5} style={{ borderRight: "1px solid rgba(255,255,255,0.15)" }}>Certifications</th>
                <th className={groupTh} colSpan={1}>Auth.</th>
                {isRepOrAdmin && <th className={groupTh} colSpan={1} />}
              </tr>
              {/* Column header row */}
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
                {isRepOrAdmin && <th className={thStyle} />}
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
                    <td className={tdStyle} style={{ borderRight: "1px solid var(--border)" }}>
                      {brand
                        ? <Link href={`/brands/${product.brand_id}/products`} className="text-xs font-medium text-foreground hover:underline whitespace-nowrap">{brand.name}</Link>
                        : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className={`${tdStyle} text-foreground font-medium max-w-[240px] whitespace-normal`}>{product.description}</td>
                    <td className={`${tdStyle} font-mono text-muted-foreground`}>{product.retail_upc ?? "—"}</td>
                    <td className={`${tdStyle} text-muted-foreground`}>{product.size ?? "—"}</td>
                    <td className={`${tdStyle} text-muted-foreground`} style={{ borderRight: "1px solid var(--border)" }}>{product.uom ?? "—"}</td>
                    <td className={`${tdStyle} text-muted-foreground`}>{product.kehe_item ?? "—"}</td>
                    <td className={`${tdStyle} text-muted-foreground`}>{product.unfi_east_item ?? "—"}</td>
                    <td className={`${tdStyle} text-muted-foreground`} style={{ borderRight: "1px solid var(--border)" }}>{product.unfi_west_item ?? "—"}</td>
                    <td className={`${tdStyle} text-muted-foreground`}>{fmt$(product.cost)}</td>
                    <td className={`${tdStyle} text-muted-foreground`}>{fmt$(product.case_cost)}</td>
                    <td className={`${tdStyle} text-muted-foreground`} style={{ borderRight: "1px solid var(--border)" }}>{fmt$(product.srp)}</td>
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
                    {isRepOrAdmin && (
                      <td className={`${tdStyle} text-right`}>
                        <button onClick={() => startEdit(product)} className="text-xs text-muted-foreground hover:text-foreground transition-colors">Edit</button>
                      </td>
                    )}
                  </tr>,
                  // Inline edit expander
                  isEditing && (
                    <tr key={`${product.id}-edit`} className="border-b border-border" style={{ background: "var(--card)" }}>
                      <td colSpan={totalCols} className="px-4 py-3">
                        <div className="flex flex-wrap gap-3 items-end">
                          <div>
                            <label className="block text-xs text-muted-foreground mb-1">Description</label>
                            <input type="text" value={editForm.description} onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))} className="border rounded px-2 py-1 text-sm w-64" style={{ borderColor: "var(--border)", background: "var(--secondary)", color: "var(--foreground)" }} />
                          </div>
                          <div>
                            <label className="block text-xs text-muted-foreground mb-1">UPC</label>
                            <input type="text" value={editForm.retail_upc} onChange={(e) => setEditForm((f) => ({ ...f, retail_upc: e.target.value }))} className="border rounded px-2 py-1 text-sm w-40 font-mono" style={{ borderColor: "var(--border)", background: "var(--secondary)", color: "var(--foreground)" }} />
                          </div>
                          <div>
                            <label className="block text-xs text-muted-foreground mb-1">Size</label>
                            <input type="text" value={editForm.size} onChange={(e) => setEditForm((f) => ({ ...f, size: e.target.value }))} className="border rounded px-2 py-1 text-sm w-24" style={{ borderColor: "var(--border)", background: "var(--secondary)", color: "var(--foreground)" }} />
                          </div>
                          <div>
                            <label className="block text-xs text-muted-foreground mb-1">SRP</label>
                            <input type="number" step="0.01" value={editForm.srp} onChange={(e) => setEditForm((f) => ({ ...f, srp: e.target.value }))} className="border rounded px-2 py-1 text-sm w-20" style={{ borderColor: "var(--border)", background: "var(--secondary)", color: "var(--foreground)" }} />
                          </div>
                          <div className="flex items-center gap-2">
                            {editError && <span className="text-xs text-red-600">{editError}</span>}
                            <button onClick={saveEdit} disabled={editSaving} className="px-3 py-1.5 rounded text-xs font-medium disabled:opacity-50" style={{ background: "var(--foreground)", color: "var(--background)" }}>
                              {editSaving ? "Saving…" : "Save"}
                            </button>
                            <button onClick={cancelEdit} className="text-xs text-muted-foreground hover:text-foreground">Cancel</button>
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
      )}
    </div>
  );
}
