"use client";

import { useEffect, useMemo, useState } from "react";
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

type Draft = {
  cultivate_lead: string;
  tier: string;
  brand_status: string;
  status_note: string;
};

type SortCol = "name" | "lead" | "tier" | "status";
type SortDir = "asc" | "desc";
type FilterTab = "all" | "active" | "inactive";

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

function SortIcon({ col, sortCol, sortDir }: { col: SortCol; sortCol: SortCol; sortDir: SortDir }) {
  if (col !== sortCol) return <span className="ml-1 opacity-25">↕</span>;
  return <span className="ml-1">{sortDir === "asc" ? "↑" : "↓"}</span>;
}

export default function BrandRosterPage() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);
  const [authorized, setAuthorized] = useState(false);
  const [brands, setBrands] = useState<BrandRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [archiveConfirm, setArchiveConfirm] = useState<string | null>(null); // brand id pending confirm

  // Filter / search / sort
  const [filterTab, setFilterTab] = useState<FilterTab>("all");
  const [search, setSearch] = useState("");
  const [sortCol, setSortCol] = useState<SortCol>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

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
    if (err) { setRowErrors({ _global: err.message }); return; }
    const rows = (data ?? []) as BrandRow[];
    setBrands(rows);
    const d: Record<string, Draft> = {};
    rows.forEach((b) => { d[b.id] = rowDraft(b); });
    setDrafts(d);
  }

  function setField(brandId: string, field: keyof Draft, value: string) {
    setDrafts((prev) => ({ ...prev, [brandId]: { ...prev[brandId], [field]: value } }));
    setRowErrors((prev) => { const next = { ...prev }; delete next[brandId]; return next; });
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
    if (draft.brand_status === "Inactive") patch.archived = true;
    else if (draft.brand_status === "Active") patch.archived = false;

    const { error: err } = await supabase.from("brands").update(patch).eq("id", brandId);

    if (err) {
      const msg = err.message ?? "";
      // check_brand_active trigger fires on paused/archived brands — surface a clear action.
      if (msg.toLowerCase().includes("paused") || msg.toLowerCase().includes("cannot be edited")) {
        setRowErrors((prev) => ({
          ...prev,
          [brandId]: "This brand is paused by a DB trigger. Use Reactivate to restore it first.",
        }));
      } else {
        setRowErrors((prev) => ({ ...prev, [brandId]: msg }));
      }
    } else {
      setBrands((prev) =>
        prev.map((b) =>
          b.id === brandId
            ? {
                ...b,
                cultivate_lead: (patch.cultivate_lead as string | null),
                tier: (patch.tier as string | null),
                brand_status: (patch.brand_status as string | null),
                status_note: (patch.status_note as string | null),
                archived: patch.archived !== undefined ? (patch.archived as boolean) : b.archived,
              }
            : b
        )
      );
      setRowErrors((prev) => { const next = { ...prev }; delete next[brandId]; return next; });
    }
    setSaving((prev) => ({ ...prev, [brandId]: false }));
  }

  async function archiveBrand(brandId: string) {
    setArchiveConfirm(null);
    const patch = { brand_status: "Inactive", archived: true };
    const { error: err } = await supabase.from("brands").update(patch).eq("id", brandId);
    if (err) {
      setRowErrors((prev) => ({ ...prev, [brandId]: err.message }));
    } else {
      setBrands((prev) => prev.map((b) => b.id === brandId ? { ...b, brand_status: "Inactive", archived: true } : b));
      setDrafts((prev) => ({ ...prev, [brandId]: { ...prev[brandId], brand_status: "Inactive" } }));
    }
  }

  async function reactivateBrand(brandId: string) {
    // Explicit reactivate — if check_brand_active trigger allows it when setting Active,
    // this succeeds. If the trigger blocks ALL updates on paused brands, you'll need to
    // modify the trigger to add: IF NEW.brand_status = 'Active' THEN RETURN NEW; END IF;
    const patch = { brand_status: "Active", archived: false };
    const { error: err } = await supabase.from("brands").update(patch).eq("id", brandId);
    if (err) {
      setRowErrors((prev) => ({
        ...prev,
        [brandId]: `Reactivate blocked: ${err.message}. The check_brand_active trigger may need to allow Active transitions — share the trigger SQL to fix.`,
      }));
    } else {
      setBrands((prev) => prev.map((b) => b.id === brandId ? { ...b, brand_status: "Active", archived: false } : b));
      setDrafts((prev) => ({ ...prev, [brandId]: { ...prev[brandId], brand_status: "Active" } }));
      setRowErrors((prev) => { const next = { ...prev }; delete next[brandId]; return next; });
    }
  }

  function toggleSort(col: SortCol) {
    if (sortCol === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortCol(col); setSortDir("asc"); }
  }

  // Unified inactive definition: brand_status='Inactive' OR archived=true.
  // Trigger-paused brands (archived=true, status may differ) count as inactive.
  const isInactiveBrand = (b: BrandRow) => b.brand_status === "Inactive" || b.archived;

  const activeCount = brands.filter((b) => !isInactiveBrand(b)).length;
  const inactiveCount = brands.filter((b) => isInactiveBrand(b)).length;

  const visible = useMemo(() => {
    let rows = [...brands];

    // Filter — uses unified inactive definition so archived=true rows go to "Inactive" tab
    if (filterTab === "active") rows = rows.filter((b) => !isInactiveBrand(b));
    else if (filterTab === "inactive") rows = rows.filter((b) => isInactiveBrand(b));

    // Search
    const q = search.trim().toLowerCase();
    if (q) rows = rows.filter((b) => b.name.toLowerCase().includes(q));

    // Sort — status column normalizes to "Active"/"Inactive" so archived=true rows
    // cluster with brand_status='Inactive' rows regardless of their raw status value.
    rows.sort((a, b) => {
      let va = "";
      let vb = "";
      if (sortCol === "name") { va = a.name; vb = b.name; }
      else if (sortCol === "lead") { va = a.cultivate_lead ?? ""; vb = b.cultivate_lead ?? ""; }
      else if (sortCol === "tier") { va = a.tier ?? ""; vb = b.tier ?? ""; }
      else if (sortCol === "status") {
        va = isInactiveBrand(a) ? "Inactive" : "Active";
        vb = isInactiveBrand(b) ? "Inactive" : "Active";
      }
      const cmp = va.localeCompare(vb);
      return sortDir === "asc" ? cmp : -cmp;
    });

    return rows;
  }, [brands, filterTab, search, sortCol, sortDir]);

  if (!authChecked) return <div className="p-6 text-sm text-muted-foreground">Checking access…</div>;
  if (!authorized) return null;

  const thCls = "px-4 py-2.5 text-left font-medium text-xs uppercase tracking-wide text-muted-foreground cursor-pointer select-none hover:text-foreground transition-colors";

  return (
    <div className="p-6 space-y-5 max-w-6xl mx-auto">
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

      {rowErrors._global && <p className="text-sm text-red-600">{rowErrors._global}</p>}

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Filter tabs */}
        <div className="flex rounded-lg border overflow-hidden text-sm">
          {(["all", "active", "inactive"] as FilterTab[]).map((tab) => {
            const count = tab === "all" ? brands.length : tab === "active" ? activeCount : inactiveCount;
            return (
              <button
                key={tab}
                onClick={() => setFilterTab(tab)}
                className="px-3 py-1.5 transition-colors capitalize"
                style={
                  filterTab === tab
                    ? { background: "var(--foreground)", color: "var(--background)" }
                    : { color: "var(--muted-foreground)" }
                }
              >
                {tab} <span className="opacity-60">{count}</span>
              </button>
            );
          })}
        </div>

        {/* Search */}
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search brand name…"
          className="border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400 w-56"
        />

        <span className="text-xs text-muted-foreground ml-auto">{visible.length} shown</span>
      </div>

      {/* Table */}
      <div className="border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b" style={{ background: "var(--muted)" }}>
                <th className={thCls} onClick={() => toggleSort("name")}>
                  Brand <SortIcon col="name" sortCol={sortCol} sortDir={sortDir} />
                </th>
                <th className={thCls} onClick={() => toggleSort("lead")}>
                  Cultivate Lead <SortIcon col="lead" sortCol={sortCol} sortDir={sortDir} />
                </th>
                <th className={`${thCls} w-24`} onClick={() => toggleSort("tier")}>
                  Tier <SortIcon col="tier" sortCol={sortCol} sortDir={sortDir} />
                </th>
                <th className={`${thCls} w-36`} onClick={() => toggleSort("status")}>
                  Status <SortIcon col="status" sortCol={sortCol} sortDir={sortDir} />
                </th>
                <th className="px-4 py-2.5 text-left font-medium text-xs uppercase tracking-wide text-muted-foreground">Note</th>
                <th className="px-3 py-2.5 w-28"></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((brand) => {
                const draft = drafts[brand.id];
                if (!draft) return null;
                const isInactive = isInactiveBrand(brand);
                const isSaving = saving[brand.id] ?? false;
                const rowErr = rowErrors[brand.id];
                const pendingArchive = archiveConfirm === brand.id;

                return (
                  <>
                    <tr
                      key={brand.id}
                      className="border-b transition-colors"
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
                        <input type="text" className={inputCls}
                          value={draft.cultivate_lead}
                          onChange={(e) => setField(brand.id, "cultivate_lead", e.target.value)}
                          onBlur={() => saveRow(brand.id)}
                          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                          placeholder="—" />
                      </td>
                      <td className="px-3 py-1.5">
                        <input type="text" className={inputCls}
                          value={draft.tier}
                          onChange={(e) => setField(brand.id, "tier", e.target.value)}
                          onBlur={() => saveRow(brand.id)}
                          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                          placeholder="—" />
                      </td>
                      <td className="px-3 py-1.5">
                        <select
                          className={`${inputCls} cursor-pointer`}
                          value={draft.brand_status}
                          onChange={(e) => setField(brand.id, "brand_status", e.target.value)}
                          onBlur={() => saveRow(brand.id)}
                          style={isInactive ? { color: "#dc2626", fontWeight: 600 } : undefined}
                        >
                          <option value="Active">Active</option>
                          <option value="Inactive">Inactive</option>
                        </select>
                      </td>
                      <td className="px-3 py-1.5">
                        <input type="text" className={inputCls}
                          value={draft.status_note}
                          onChange={(e) => setField(brand.id, "status_note", e.target.value)}
                          onBlur={() => saveRow(brand.id)}
                          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                          placeholder="—" />
                      </td>
                      <td className="px-3 py-1.5 text-right whitespace-nowrap">
                        {isSaving ? (
                          <span className="text-xs text-muted-foreground">saving…</span>
                        ) : isInactive ? (
                          <button
                            onClick={() => reactivateBrand(brand.id)}
                            className="text-xs font-medium text-green-700 hover:underline"
                          >
                            Reactivate →
                          </button>
                        ) : pendingArchive ? (
                          <span className="flex items-center gap-1.5 justify-end">
                            <button
                              onClick={() => archiveBrand(brand.id)}
                              className="text-xs font-medium text-red-600 hover:underline"
                            >
                              Confirm
                            </button>
                            <button
                              onClick={() => setArchiveConfirm(null)}
                              className="text-xs text-muted-foreground hover:text-foreground"
                            >
                              Cancel
                            </button>
                          </span>
                        ) : (
                          <button
                            onClick={() => setArchiveConfirm(brand.id)}
                            className="text-xs text-muted-foreground hover:text-red-600 transition-colors"
                          >
                            Archive →
                          </button>
                        )}
                      </td>
                    </tr>
                    {rowErr && (
                      <tr key={`${brand.id}-err`} style={isInactive ? { background: "#fff1f2" } : undefined}>
                        <td colSpan={6} className="px-4 pb-2 text-xs text-red-600">{rowErr}</td>
                      </tr>
                    )}
                  </>
                );
              })}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-muted-foreground">
                    No brands match.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Archive confirm note */}
      {archiveConfirm && (() => {
        const b = brands.find((x) => x.id === archiveConfirm);
        return b ? (
          <p className="text-xs text-muted-foreground">
            Archive <strong>{b.name}</strong>? It will be hidden from rep surfaces but not deleted — reversible via Reactivate. Click Confirm in the row above.
          </p>
        ) : null;
      })()}
    </div>
  );
}
