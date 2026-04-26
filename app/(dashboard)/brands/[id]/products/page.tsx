"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";

type Role = "admin" | "rep" | "client" | null;

type Product = {
  id: string;
  brand_id: string;
  description: string;
  retail_upc: string | null;
  size: string | null;
  srp: number | null;
  cost: number | null;
  status: string;
  created_at: string;
};

type Brand = { id: string; name: string };

const EMPTY_FORM = { description: "", retail_upc: "", size: "", srp: "", cost: "" };

function formatCurrency(n: number | null) {
  if (n == null) return "—";
  return `$${n.toFixed(2)}`;
}

export default function BrandProductsPage() {
  const params = useParams();
  const brandId = (Array.isArray(params?.id) ? params?.id[0] : params?.id) as string;

  const [brand, setBrand] = useState<Brand | null>(null);
  const [role, setRole] = useState<Role>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [authorizedCounts, setAuthorizedCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showArchived, setShowArchived] = useState(false);

  // Add product form
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  // CSV upload
  const csvRef = useRef<HTMLInputElement>(null);
  const [csvUploading, setCsvUploading] = useState(false);
  const [csvStatus, setCsvStatus] = useState("");

  // Search
  const [query, setQuery] = useState("");

  const isRepOrAdmin = role === "admin" || role === "rep";

  useEffect(() => {
    if (!brandId) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandId]);

  async function load() {
    setLoading(true);
    setError("");

    const { data: authData } = await supabase.auth.getUser();
    const userId = authData?.user?.id;
    if (!userId) { setError("Not authenticated"); setLoading(false); return; }

    const [profileRes, brandRes, productsRes] = await Promise.all([
      supabase.from("profiles").select("role").eq("id", userId).single(),
      supabase.from("brands").select("id,name").eq("id", brandId).single(),
      supabase
        .from("brand_products")
        .select("id,brand_id,description,retail_upc,size,srp,cost,status,created_at")
        .eq("brand_id", brandId)
        .order("description"),
    ]);

    if (profileRes.error) { setError(profileRes.error.message); setLoading(false); return; }
    if (brandRes.error) { setError(brandRes.error.message); setLoading(false); return; }
    if (productsRes.error) { setError(productsRes.error.message); setLoading(false); return; }

    setRole((profileRes.data?.role as Role) ?? null);
    setBrand(brandRes.data as Brand);
    setProducts((productsRes.data as Product[]) ?? []);

    // Count authorized retailers per UPC by querying authorized_products
    if (brandRes.data) {
      const { data: authRows } = await supabase
        .from("authorized_products")
        .select("upc,retailer_id")
        .ilike("client_name", `%${brandRes.data.name}%`);

      const counts: Record<string, Set<string>> = {};
      ((authRows ?? []) as { upc: string; retailer_id: string }[]).forEach((r) => {
        if (!r.upc || !r.retailer_id) return;
        if (!counts[r.upc]) counts[r.upc] = new Set();
        counts[r.upc].add(r.retailer_id);
      });

      const flat: Record<string, number> = {};
      Object.entries(counts).forEach(([upc, set]) => { flat[upc] = set.size; });
      setAuthorizedCounts(flat);
    }

    setLoading(false);
  }

  const displayProducts = useMemo(() => {
    return products
      .filter((p) => showArchived || p.status === "active")
      .filter((p) => {
        if (!query) return true;
        const q = query.toLowerCase();
        return (
          p.description.toLowerCase().includes(q) ||
          (p.retail_upc ?? "").toLowerCase().includes(q) ||
          (p.size ?? "").toLowerCase().includes(q)
        );
      });
  }, [products, showArchived, query]);

  async function addProduct() {
    if (!form.description.trim()) { setSaveError("Description is required"); return; }
    setSaving(true);
    setSaveError("");
    const { data, error } = await supabase
      .from("brand_products")
      .insert({
        brand_id: brandId,
        description: form.description.trim(),
        retail_upc: form.retail_upc.trim() || null,
        size: form.size.trim() || null,
        srp: form.srp ? parseFloat(form.srp) : null,
        cost: form.cost ? parseFloat(form.cost) : null,
        status: "active",
      })
      .select("id,brand_id,description,retail_upc,size,srp,cost,status,created_at")
      .single();

    if (error) { setSaveError(error.message); setSaving(false); return; }
    setProducts((prev) => [...prev, data as Product].sort((a, b) => a.description.localeCompare(b.description)));
    setForm(EMPTY_FORM);
    setAddOpen(false);
    setSaving(false);
  }

  async function archiveProduct(id: string) {
    await supabase.from("brand_products").update({ status: "archived" }).eq("id", id);
    setProducts((prev) => prev.map((p) => p.id === id ? { ...p, status: "archived" } : p));
  }

  async function restoreProduct(id: string) {
    await supabase.from("brand_products").update({ status: "active" }).eq("id", id);
    setProducts((prev) => prev.map((p) => p.id === id ? { ...p, status: "active" } : p));
  }

  async function handleCsvUpload(file: File) {
    setCsvUploading(true);
    setCsvStatus("Parsing…");
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) { setCsvStatus("CSV is empty or has no data rows."); setCsvUploading(false); return; }

    const headers = lines[0].split(",").map((h) => h.trim().toLowerCase().replace(/"/g, ""));
    const rows = lines.slice(1).map((line) => {
      const vals = line.split(",").map((v) => v.trim().replace(/"/g, ""));
      const obj: Record<string, string> = {};
      headers.forEach((h, i) => { obj[h] = vals[i] ?? ""; });
      return obj;
    });

    const insertRows = rows
      .filter((r) => r.description?.trim())
      .map((r) => ({
        brand_id: brandId,
        description: r.description.trim(),
        retail_upc: r.upc?.trim() || r.retail_upc?.trim() || null,
        size: r.size?.trim() || null,
        srp: r.srp ? parseFloat(r.srp) : null,
        cost: r.cost ? parseFloat(r.cost) : null,
        status: "active",
      }));

    if (insertRows.length === 0) { setCsvStatus("No valid rows found."); setCsvUploading(false); return; }

    const { error } = await supabase
      .from("brand_products")
      .upsert(insertRows, { onConflict: "brand_id,retail_upc", ignoreDuplicates: false });

    if (error) { setCsvStatus(`Error: ${error.message}`); } else {
      setCsvStatus(`Imported ${insertRows.length} products.`);
      load();
    }
    setCsvUploading(false);
  }

  if (loading) return <div className="p-6 text-sm text-muted-foreground">Loading products…</div>;

  const activeCount = products.filter((p) => p.status === "active").length;
  const archivedCount = products.filter((p) => p.status === "archived").length;

  return (
    <div className="space-y-6 p-6">
      {/* Header + Nav */}
      <div className="space-y-3">
        <div>
          <Link href="/brands" className="text-sm text-muted-foreground hover:text-foreground">
            ← Brands
          </Link>
          <h1 className="text-3xl font-bold mt-2 text-foreground">{brand?.name ?? "Brand"} — Products</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {activeCount} active SKU{activeCount !== 1 ? "s" : ""}
            {archivedCount > 0 ? ` · ${archivedCount} archived` : ""}
          </p>
        </div>

        {/* Nav tabs */}
        <div className="flex gap-2 text-sm flex-wrap">
          <Link href={`/brands/${brandId}`} className="px-3 py-1.5 rounded border hover:bg-gray-50">
            Overview
          </Link>
          <Link href={`/brands/${brandId}/retailers`} className="px-3 py-1.5 rounded border hover:bg-gray-50">
            Retailers
          </Link>
          <span className="px-3 py-1.5 rounded border text-white" style={{ background: "var(--foreground)" }}>
            Products
          </span>
          {isRepOrAdmin && (
            <Link href="/board" className="px-3 py-1.5 rounded border hover:bg-gray-50">
              Board
            </Link>
          )}
          <Link href={`/brands/${brandId}/category-review`} className="px-3 py-1.5 rounded border hover:bg-gray-50">
            Category Review
          </Link>
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder="Search description or UPC…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="rounded-lg px-3 py-2 text-sm flex-1 min-w-0 focus:outline-none focus:ring-2"
          style={{ border: "1px solid var(--border)", background: "var(--card)", color: "var(--foreground)" }}
        />
        <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
          />
          Show archived
        </label>
        {isRepOrAdmin && (
          <>
            <button
              onClick={() => setAddOpen((v) => !v)}
              className="px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap"
              style={{ background: "var(--foreground)", color: "var(--background)" }}
            >
              + Add Product
            </button>
            <button
              onClick={() => csvRef.current?.click()}
              disabled={csvUploading}
              className="px-4 py-2 rounded-lg text-sm font-medium border border-border text-muted-foreground hover:text-foreground transition-colors whitespace-nowrap disabled:opacity-50"
            >
              {csvUploading ? "Uploading…" : "CSV Upload"}
            </button>
            <input
              ref={csvRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleCsvUpload(f); e.target.value = ""; }}
            />
          </>
        )}
      </div>

      {csvStatus && <p className="text-sm text-muted-foreground">{csvStatus}</p>}

      {/* Add Product Form */}
      {addOpen && isRepOrAdmin && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <div className="text-sm font-semibold text-foreground">New Product</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="md:col-span-2">
              <label className="block text-xs text-muted-foreground mb-1">Description *</label>
              <input
                type="text"
                value={form.description}
                onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                placeholder="e.g. Original Flavor 2.2oz"
                className="border rounded-lg px-3 py-2 w-full text-sm"
                style={{ borderColor: "var(--border)", background: "var(--secondary)", color: "var(--foreground)" }}
              />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Retail UPC</label>
              <input
                type="text"
                value={form.retail_upc}
                onChange={(e) => setForm((prev) => ({ ...prev, retail_upc: e.target.value }))}
                placeholder="00000000000000"
                className="border rounded-lg px-3 py-2 w-full text-sm"
                style={{ borderColor: "var(--border)", background: "var(--secondary)", color: "var(--foreground)" }}
              />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Size</label>
              <input
                type="text"
                value={form.size}
                onChange={(e) => setForm((prev) => ({ ...prev, size: e.target.value }))}
                placeholder="e.g. 2.2 oz"
                className="border rounded-lg px-3 py-2 w-full text-sm"
                style={{ borderColor: "var(--border)", background: "var(--secondary)", color: "var(--foreground)" }}
              />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">SRP</label>
              <input
                type="number"
                step="0.01"
                value={form.srp}
                onChange={(e) => setForm((prev) => ({ ...prev, srp: e.target.value }))}
                placeholder="5.99"
                className="border rounded-lg px-3 py-2 w-full text-sm"
                style={{ borderColor: "var(--border)", background: "var(--secondary)", color: "var(--foreground)" }}
              />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Unit Cost</label>
              <input
                type="number"
                step="0.01"
                value={form.cost}
                onChange={(e) => setForm((prev) => ({ ...prev, cost: e.target.value }))}
                placeholder="3.20"
                className="border rounded-lg px-3 py-2 w-full text-sm"
                style={{ borderColor: "var(--border)", background: "var(--secondary)", color: "var(--foreground)" }}
              />
            </div>
          </div>
          {saveError && <p className="text-sm text-red-600">{saveError}</p>}
          <div className="flex gap-2">
            <button
              onClick={addProduct}
              disabled={!form.description.trim() || saving}
              className="px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
              style={{ background: "var(--foreground)", color: "var(--background)" }}
            >
              {saving ? "Saving…" : "Save Product"}
            </button>
            <button
              onClick={() => { setAddOpen(false); setForm(EMPTY_FORM); setSaveError(""); }}
              className="px-4 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Products table */}
      {displayProducts.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {query ? "No products match your search." : "No products yet. Add one above or upload a CSV."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary text-left">
                <th className="px-4 py-3 font-medium text-muted-foreground">Description</th>
                <th className="px-4 py-3 font-medium text-muted-foreground">UPC</th>
                <th className="px-4 py-3 font-medium text-muted-foreground">Size</th>
                <th className="px-4 py-3 font-medium text-muted-foreground">SRP</th>
                <th className="px-4 py-3 font-medium text-muted-foreground">Auth. Retailers</th>
                <th className="px-4 py-3 font-medium text-muted-foreground">Status</th>
                {isRepOrAdmin && <th className="px-4 py-3" />}
              </tr>
            </thead>
            <tbody>
              {displayProducts.map((product, idx) => {
                const isEven = idx % 2 === 0;
                const authCount = product.retail_upc ? (authorizedCounts[product.retail_upc] ?? 0) : 0;
                return (
                  <tr
                    key={product.id}
                    className="border-b border-border last:border-0"
                    style={{ background: isEven ? "var(--card)" : "var(--secondary)" }}
                  >
                    <td className="px-4 py-3 text-foreground font-medium">{product.description}</td>
                    <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{product.retail_upc ?? "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">{product.size ?? "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">{formatCurrency(product.srp)}</td>
                    <td className="px-4 py-3">
                      {authCount > 0 ? (
                        <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                          {authCount} retailer{authCount !== 1 ? "s" : ""}
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {product.status === "archived" ? (
                        <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">Archived</span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-teal-100 px-2 py-0.5 text-xs text-teal-700">Active</span>
                      )}
                    </td>
                    {isRepOrAdmin && (
                      <td className="px-4 py-3 text-right">
                        {product.status === "active" ? (
                          <button
                            onClick={() => archiveProduct(product.id)}
                            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                          >
                            Archive
                          </button>
                        ) : (
                          <button
                            onClick={() => restoreProduct(product.id)}
                            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                          >
                            Restore
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        CSV format: description, upc, size, srp, cost (header row required)
      </p>
    </div>
  );
}
