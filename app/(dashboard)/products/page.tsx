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
  srp: number | null;
  cost: number | null;
  status: string;
  created_at: string;
};

type Brand = { id: string; name: string };

function formatCurrency(n: number | null) {
  if (n == null) return "—";
  return `$${n.toFixed(2)}`;
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
      supabase
        .from("brand_products")
        .select("id,brand_id,description,retail_upc,size,srp,cost,status,created_at")
        .eq("status", "active")
        .order("description"),
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

    setProducts((productsRes.data as Product[]) ?? []);

    // Count unique retailers per UPC
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
    return products.filter((p) => {
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
    });
  }, [products, brandFilter, query]);

  if (loading) return <div className="p-6 text-sm text-muted-foreground">Loading products…</div>;
  if (!authorized) return null;

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Products Library</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          All active SKUs across all brands — {products.length.toLocaleString()} total
        </p>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <select
          value={brandFilter}
          onChange={(e) => setBrandFilter(e.target.value)}
          className="rounded-lg px-3 py-2 text-sm focus:outline-none"
          style={{ border: "1px solid var(--border)", background: "var(--card)", color: "var(--foreground)" }}
        >
          <option value="">All Brands</option>
          {brands.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
        <input
          type="text"
          placeholder="Search description or UPC…"
          value={query}
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
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary text-left">
                <th className="px-4 py-3 font-medium text-muted-foreground">Brand</th>
                <th className="px-4 py-3 font-medium text-muted-foreground">Description</th>
                <th className="px-4 py-3 font-medium text-muted-foreground">UPC</th>
                <th className="px-4 py-3 font-medium text-muted-foreground">Size</th>
                <th className="px-4 py-3 font-medium text-muted-foreground">SRP</th>
                <th className="px-4 py-3 font-medium text-muted-foreground">Auth. Retailers</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((product, idx) => {
                const brand = brandsById[product.brand_id];
                const authCount = product.retail_upc ? (authorizedCounts[product.retail_upc] ?? 0) : 0;
                const isEven = idx % 2 === 0;
                return (
                  <tr
                    key={product.id}
                    className="border-b border-border last:border-0"
                    style={{ background: isEven ? "var(--card)" : "var(--secondary)" }}
                  >
                    <td className="px-4 py-3">
                      {brand ? (
                        <Link
                          href={`/brands/${product.brand_id}/products`}
                          className="text-sm font-medium text-foreground hover:underline"
                        >
                          {brand.name}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-foreground">{product.description}</td>
                    <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{product.retail_upc ?? "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">{product.size ?? "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">{formatCurrency(product.srp)}</td>
                    <td className="px-4 py-3">
                      {authCount > 0 ? (
                        <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                          {authCount}
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
