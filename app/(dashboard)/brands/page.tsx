"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";

type Brand = {
  id: string;
  name: string;
};

type Role = "admin" | "rep" | "client" | null;

export default function BrandsPage() {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [role, setRole] = useState<Role>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
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

      if (profileError) {
        setError(profileError.message);
        setLoading(false);
        return;
      }

      const userRole = (profile?.role as Role) ?? "client";
      setRole(userRole);

      if (userRole === "admin" || userRole === "rep") {
        const { data, error } = await supabase
          .from("brands")
          .select("id,name")
          .order("name", { ascending: true });

        if (error) {
          setError(error.message);
          setBrands([]);
          setLoading(false);
          return;
        }

        setBrands((data as Brand[]) ?? []);
        setLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from("brand_users")
        .select("brand_id, brands(id,name)")
        .eq("user_id", userId);

      if (error) {
        setError(error.message);
        setBrands([]);
        setLoading(false);
        return;
      }

      const formatted =
        data
          ?.map((row: any) => row.brands)
          .filter(Boolean)
          .sort((a: Brand, b: Brand) => a.name.localeCompare(b.name)) ?? [];

      setBrands(formatted);
      setLoading(false);
    }

    load();
  }, []);

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Brands</h1>
          <p className="mt-1 text-muted-foreground">
            {role === "client" ? "Your assigned brands" : "All brands"}
          </p>
        </div>

        {(role === "admin" || role === "rep") && (
          <Link
            href="/brands/new"
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
          >
            Add Brand
          </Link>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-primary/30 bg-primary/10 p-4">
          <div className="text-2xl font-bold text-foreground">{brands.length}</div>
          <div className="mt-1 text-sm text-muted-foreground">Total Brands</div>
        </div>

        <div className="rounded-xl border border-border bg-card p-4">
          <div className="text-2xl font-bold text-foreground">
            {role === "client" ? brands.length : "—"}
          </div>
          <div className="mt-1 text-sm text-muted-foreground">
            {role === "client" ? "Assigned to You" : "Visible in CRM"}
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-4">
          <div className="text-2xl font-bold text-foreground">
            {loading ? "…" : error ? "—" : brands.length > 0 ? "Active" : "—"}
          </div>
          <div className="mt-1 text-sm text-muted-foreground">Status</div>
        </div>
      </div>

      {loading && (
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">Loading brands...</p>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="text-sm text-red-600">Error: {error}</div>
        </div>
      )}

      {!loading && !error && brands.length === 0 && (
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">No brands available.</p>
        </div>
      )}

      {!loading && !error && brands.length > 0 && (
        <div className="space-y-3">
          {brands.map((b) => (
            <Link
              key={b.id}
              href={`/brands/${b.id}`}
              className="group flex items-center justify-between rounded-xl border border-border bg-card px-4 py-4 transition-colors hover:bg-accent"
            >
              <div className="min-w-0">
                <div className="truncate text-base font-semibold text-foreground">
                  {b.name}
                </div>
                <div className="mt-1 text-sm text-muted-foreground">
                  Open brand record
                </div>
              </div>

              <div className="ml-4 text-sm font-medium text-muted-foreground transition-colors group-hover:text-foreground">
                Open
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}