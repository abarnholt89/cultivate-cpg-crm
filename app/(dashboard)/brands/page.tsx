"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
type Brand = { id: string; name: string };
type Role = "admin" | "rep" | "client" | null;

type TimingSummary = {
  lastActivity: string | null;
};

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
}


function prettyDate(value: string | null) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export default function BrandsPage() {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [role, setRole] = useState<Role>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [timingByBrand, setTimingByBrand] = useState<Record<string, TimingSummary>>({});

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    setError("");

    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData?.user) {
      setError(authError?.message || "No authenticated user found.");
      setLoading(false);
      return;
    }

    const userId = authData.user.id;

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .single();

    if (profileError) { setError(profileError.message); setLoading(false); return; }

    const userRole = (profile?.role as Role) ?? "client";
    setRole(userRole);

    let loadedBrands: Brand[] = [];

    if (userRole === "admin" || userRole === "rep") {
      const { data, error } = await supabase
        .from("brands")
        .select("id,name")
        .order("name", { ascending: true });
      if (error) { setError(error.message); setLoading(false); return; }
      loadedBrands = (data as Brand[]) ?? [];
    } else {
      const { data, error } = await supabase
        .from("brand_users")
        .select("brand_id, brands(id,name)")
        .eq("user_id", userId);
      if (error) { setError(error.message); setLoading(false); return; }
      loadedBrands = (data ?? [])
        .map((row: any) => row.brands)
        .filter(Boolean)
        .sort((a: Brand, b: Brand) => a.name.localeCompare(b.name));
    }

    setBrands(loadedBrands);

    // Load timing summaries for all brands
    if (loadedBrands.length > 0) {
      const brandIds = loadedBrands.map((b) => b.id);
      const { data: timingData } = await supabase
        .from("brand_retailer_timing")
        .select("brand_id, submitted_date")
        .in("brand_id", brandIds);

      const summaries: Record<string, TimingSummary> = {};
      (timingData ?? []).forEach((row: any) => {
        if (!summaries[row.brand_id]) {
          summaries[row.brand_id] = { lastActivity: null };
        }
        const s = summaries[row.brand_id];
        if (row.submitted_date) {
          if (!s.lastActivity || row.submitted_date > s.lastActivity) {
            s.lastActivity = row.submitted_date;
          }
        }
      });

      setTimingByBrand(summaries);
    }

    setLoading(false);
  }

  const filtered = useMemo(() => {
    if (!search.trim()) return brands;
    const q = search.trim().toLowerCase();
    return brands.filter((b) => b.name.toLowerCase().includes(q));
  }, [brands, search]);

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Brands</h1>
          <p className="mt-1 text-muted-foreground">
            {role === "client" ? "Your assigned brands" : "All brands"}
          </p>
        </div>

        {(role === "admin" || role === "rep") && (
          <Link
            href="/brands/new"
            className="rounded-lg px-4 py-2 text-sm font-medium transition hover:opacity-90"
            style={{ background: "#123b52", color: "#78f5cd" }}
          >
            Add Brand
          </Link>
        )}
      </div>

      {/* Stats + search row */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="rounded-xl border border-primary/30 bg-primary/10 px-5 py-3">
          <div className="text-2xl font-bold text-foreground">{brands.length}</div>
          <div className="mt-0.5 text-sm text-muted-foreground">Total Brands</div>
        </div>

        <input
          type="text"
          placeholder="Search brands…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full max-w-sm rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2"
          style={{ border: "1px solid var(--border)", background: "var(--card)", color: "var(--foreground)" }}
        />
      </div>

      {loading && <p className="text-sm text-muted-foreground">Loading brands...</p>}
      {error && <p className="text-sm text-red-600">Error: {error}</p>}
      {!loading && !error && filtered.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {search ? "No brands match your search." : "No brands available."}
        </p>
      )}

      {!loading && !error && filtered.length > 0 && (
        <div className="space-y-2">
          {filtered.map((b) => {
            const summary = timingByBrand[b.id];
            const ini = initials(b.name);
            const lastActivityStr = prettyDate(summary?.lastActivity ?? null);

            return (
              <Link
                key={b.id}
                href={`/brands/${b.id}`}
                className="group flex items-center gap-4 rounded-xl border border-border bg-card px-4 py-4 transition-colors hover:bg-accent"
              >
                {/* Initials avatar */}
                <div
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold"
                  style={{ background: "#123b52", color: "#78f5cd" }}
                >
                  {ini}
                </div>

                {/* Brand info */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="truncate text-base font-semibold text-foreground">
                      {b.name}
                    </span>
                  </div>
                  {lastActivityStr && (
                    <div className="mt-1 text-sm text-muted-foreground">
                      Last activity: {lastActivityStr}
                    </div>
                  )}
                </div>

                <div className="ml-2 text-sm font-medium text-muted-foreground transition-colors group-hover:text-foreground shrink-0">
                  Open →
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
