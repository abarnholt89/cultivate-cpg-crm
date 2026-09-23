"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Role = "admin" | "rep" | "client" | null;

type BrandRow = {
  id: string;
  name: string;
  cultivate_lead: string | null;
  tier: string | null;
  brand_status: string | null;
  status_note: string | null;
  archived: boolean;
};

// Draft state per brand — tracks unsaved field values.
type Draft = {
  cultivate_lead: string;
  tier: string;
  brand_status: string;
  status_note: string;
};

function rowDraft(b: BrandRow): Draft {
  return {
    cultivate_lead: b.cultivate_lead ?? "",
    tier: b.tier ?? "",
    brand_status: b.brand_status ?? "Active",
    status_note: b.status_note ?? "",
  };
}

const inputCls =
  "w-full border-0 bg-transparent text-sm focus:outline-none focus:ring-1 focus:ring-blue-300 rounded px-1 py-0.5";

export default function BrandRosterPage() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);
  const [authorized, setAuthorized] = useState(false);
  const [brands, setBrands] = useState<BrandRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [error, setError] = useState("");

  useEffect(() => {
    async function init() {
      const { data: authData } = await supabase.auth.getUser();
      const uid = authData?.user?.id;
      if (!uid) { router.replace("/login"); return; }

      const { data: profile } = await supabase
        .from("profiles").select("role").eq("id", uid).maybeSingle();
      const role = (profile as { role: Role } | null)?.role;
      if (role !== "admin" && role !== "rep") { router.replace("/brands"); return; }

      setAuthorized(true);
      setAuthChecked(true);
      await loadBrands();
    }
    init();
  }, [router]);

  async function loadBrands() {
    const { data, error: err } = await supabase
      .from("brands")
      .select("id,name,cultivate_lead,tier,brand_status,status_note,archived")
      .order("name");
    if (err) { setError(err.message); return; }
    const rows = (data ?? []) as BrandRow[];
    setBrands(rows);
    const initialDrafts: Record<string, Draft> = {};
    rows.forEach((b) => { initialDrafts[b.id] = rowDraft(b); });
    setDrafts(initialDrafts);
  }

  function setField(brandId: string, field: keyof Draft, value: string) {
    setDrafts((prev) => ({
      ...prev,
      [brandId]: { ...prev[brandId], [field]: value },
    }));
  }

  async function saveRow(brandId: string) {
    const draft = drafts[brandId];
    if (!draft) return;
    setSaving((prev) => ({ ...prev, [brandId]: true }));

    const patch: Record<string, unknown> = {
      cultivate_lead: draft.cultivate_lead.trim() || null,
      tier: draft.tier.trim() || null,
      brand_status: draft.brand_status || null,
      status_note: draft.status_note.trim() || null,
    };
    // Keep archived in sync: Inactive → archived=true, Active → archived=false.
    if (draft.brand_status === "Inactive") patch.archived = true;
    else if (draft.brand_status === "Active") patch.archived = false;

    const { error: err } = await supabase.from("brands").update(patch).eq("id", brandId);
    if (err) setError(err.message);
    else {
      setBrands((prev) =>
        prev.map((b) =>
          b.id === brandId
            ? {
                ...b,
                cultivate_lead: (patch.cultivate_lead as string | null),
                tier: (patch.tier as string | null),
                brand_status: (patch.brand_status as string | null),
                status_note: (patch.status_note as string | null),
                archived: (patch.archived as boolean) ?? b.archived,
              }
            : b
        )
      );
    }

    setSaving((prev) => ({ ...prev, [brandId]: false }));
  }

  if (!authChecked) return <div className="p-6 text-sm text-muted-foreground">Checking access…</div>;
  if (!authorized) return null;

  const activeCount = brands.filter((b) => b.brand_status !== "Inactive").length;
  const inactiveCount = brands.filter((b) => b.brand_status === "Inactive").length;

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold">Brand Roster</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Cultivate internal — never shown to clients.{" "}
          <span className="font-medium">{activeCount} active</span>
          {inactiveCount > 0 && (
            <> · <span className="font-medium text-red-600">{inactiveCount} inactive</span></>
          )}
        </p>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b" style={{ background: "var(--muted)" }}>
              <th className="px-4 py-2.5 text-left font-medium text-xs uppercase tracking-wide text-muted-foreground">Brand</th>
              <th className="px-4 py-2.5 text-left font-medium text-xs uppercase tracking-wide text-muted-foreground">Cultivate Lead</th>
              <th className="px-4 py-2.5 text-left font-medium text-xs uppercase tracking-wide text-muted-foreground w-24">Tier</th>
              <th className="px-4 py-2.5 text-left font-medium text-xs uppercase tracking-wide text-muted-foreground w-36">Status</th>
              <th className="px-4 py-2.5 text-left font-medium text-xs uppercase tracking-wide text-muted-foreground">Note</th>
              <th className="px-3 py-2.5 w-16"></th>
            </tr>
          </thead>
          <tbody>
            {brands.map((brand) => {
              const draft = drafts[brand.id];
              if (!draft) return null;
              const isInactive = draft.brand_status === "Inactive";
              const isSaving = saving[brand.id] ?? false;

              return (
                <tr
                  key={brand.id}
                  className="border-b last:border-0 transition-colors"
                  style={
                    isInactive
                      ? { background: "#fff1f2", borderLeft: "3px solid #f87171" }
                      : { borderLeft: "3px solid transparent" }
                  }
                >
                  <td className="px-4 py-2">
                    <span className={`font-medium ${isInactive ? "text-red-700" : ""}`}>
                      {brand.name}
                    </span>
                    {isInactive && (
                      <span className="ml-2 text-[10px] font-bold uppercase px-1.5 py-0.5 rounded"
                        style={{ background: "#fecaca", color: "#991b1b" }}>
                        Inactive
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-1.5">
                    <input
                      type="text"
                      className={inputCls}
                      value={draft.cultivate_lead}
                      onChange={(e) => setField(brand.id, "cultivate_lead", e.target.value)}
                      onBlur={() => saveRow(brand.id)}
                      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                      placeholder="—"
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    <input
                      type="text"
                      className={inputCls}
                      value={draft.tier}
                      onChange={(e) => setField(brand.id, "tier", e.target.value)}
                      onBlur={() => saveRow(brand.id)}
                      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                      placeholder="—"
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    <select
                      className={`${inputCls} cursor-pointer`}
                      value={draft.brand_status}
                      onChange={(e) => {
                        setField(brand.id, "brand_status", e.target.value);
                      }}
                      onBlur={() => saveRow(brand.id)}
                      style={isInactive ? { color: "#dc2626", fontWeight: 600 } : undefined}
                    >
                      <option value="Active">Active</option>
                      <option value="Inactive">Inactive</option>
                    </select>
                  </td>
                  <td className="px-3 py-1.5">
                    <input
                      type="text"
                      className={inputCls}
                      value={draft.status_note}
                      onChange={(e) => setField(brand.id, "status_note", e.target.value)}
                      onBlur={() => saveRow(brand.id)}
                      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                      placeholder="—"
                    />
                  </td>
                  <td className="px-3 py-1.5 text-center">
                    {isSaving && (
                      <span className="text-xs text-muted-foreground">…</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
