"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import StatusBadge from "@/components/StatusBadge";

type Role = "admin" | "rep" | "client" | null;

type Brand = { id: string; name: string };

type TimingRow = {
  id: string;
  brand_id: string;
  retailer_id: string;
  account_status: string;
  submitted_date: string | null;
};

type Retailer = {
  id: string;
  name: string;
  banner: string | null;
};

type Message = {
  id: string;
  retailer_id: string;
  body: string;
  created_at: string;
};

type BoardRetailerRow = {
  timingId: string;
  retailerId: string;
  banner: string;
  accountStatus: string;
  submittedDate: string | null;
  latestNote: string | null;
  latestNoteDate: string | null;
};

type BrandSummary = {
  id: string;
  name: string;
  retailerCount: number;
  lastActivity: string | null;
};

type RepProfile = {
  id: string;
  full_name: string | null;
};

function prettyDate(value: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/** Fetches all rows from a query using range pagination to bypass the 1000-row default cap. */
async function fetchAll<T>(buildQuery: () => any): Promise<{ data: T[]; error: string | null }> {
  const PAGE = 1000;
  let from = 0;
  const all: T[] = [];
  while (true) {
    const { data, error } = await buildQuery().range(from, from + PAGE - 1);
    if (error) return { data: [], error: error.message };
    all.push(...(data ?? []));
    if ((data ?? []).length < PAGE) break;
    from += PAGE;
  }
  return { data: all, error: null };
}

export default function AllBrandsBoardPage() {
  const router = useRouter();

  const [role, setRole] = useState<Role>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reps, setReps] = useState<RepProfile[]>([]);
  const [repFilter, setRepFilter] = useState<string>("");
  const [retailerRepMap, setRetailerRepMap] = useState<Record<string, string>>({});
  const repFilterInitialized = useRef(false);

  // Summary data — loaded once upfront
  const [brandSummaries, setBrandSummaries] = useState<BrandSummary[]>([]);
  // Full timing rows by brand_id — used when expanding to fetch detail data
  const [timingByBrand, setTimingByBrand] = useState<Record<string, TimingRow[]>>({});

  // On-demand retailer rows per brand (null = not yet loaded)
  const [brandRows, setBrandRows] = useState<Record<string, BoardRetailerRow[]>>({});
  const [loadingBrand, setLoadingBrand] = useState<Record<string, boolean>>({});

  const [search, setSearch] = useState("");
  const [expandedBrandIds, setExpandedBrandIds] = useState<Set<string>>(new Set());

  // Retailer-level note editor: key = `${brandId}__${retailerId}`
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<Record<string, string>>({});

  const prevSearchRef = useRef("");

  useEffect(() => { loadSummaries(); }, []);

  // Auto-expand matching brands when search has text; collapse all when cleared
  useEffect(() => {
    const q = search.trim().toLowerCase();
    const prev = prevSearchRef.current.trim().toLowerCase();
    prevSearchRef.current = search;

    if (q) {
      const matchIds = brandSummaries
        .filter((b) => b.name.toLowerCase().includes(q))
        .map((b) => b.id);

      setExpandedBrandIds((cur) => {
        const next = new Set(cur);
        matchIds.forEach((id) => next.add(id));
        return next;
      });

      // Trigger on-demand load for newly matched brands not yet loaded
      matchIds.forEach((id) => {
        if (!brandRows[id]) loadBrandRows(id);
      });
    } else if (prev && !q) {
      setExpandedBrandIds(new Set());
      setExpandedKey(null);
      setNoteText("");
    }
  }, [search, brandSummaries]);

  // ── Initial summary load ──────────────────────────────────────────────────

  async function loadSummaries() {
    setLoading(true);
    setError("");

    const { data: authData } = await supabase.auth.getUser();
    const uid = authData?.user?.id ?? null;
    setUserId(uid);

    if (!uid) { router.replace("/login"); return; }

    const { data: profileData } = await supabase
      .from("profiles").select("role").eq("id", uid).maybeSingle();

    const resolvedRole = (profileData?.role as Role) ?? "client";
    setRole(resolvedRole);
    if (resolvedRole === "client") { router.replace("/brands"); return; }

    // Load brands
    const { data: brandsData, error: brandsError } = await supabase
      .from("brands").select("id, name").order("name", { ascending: true });

    if (brandsError) { setError(brandsError.message); setLoading(false); return; }
    const brands = (brandsData as Brand[]) ?? [];

    // Load ALL timing rows (paginated to bypass 1000-row cap)
    const { data: timing, error: timingErr } = await fetchAll<TimingRow>(() =>
      supabase
        .from("brand_retailer_timing")
        .select("id, brand_id, retailer_id, account_status, submitted_date")
    );

    if (timingErr) { setError(timingErr); setLoading(false); return; }

    // Group timing by brand
    const byBrand: Record<string, TimingRow[]> = {};
    timing.forEach((t) => {
      if (!byBrand[t.brand_id]) byBrand[t.brand_id] = [];
      byBrand[t.brand_id].push(t);
    });
    setTimingByBrand(byBrand);

    // Build summaries
    const summaries: BrandSummary[] = brands
      .map((brand) => {
        const rows = byBrand[brand.id] ?? [];
        const lastActivity = rows.reduce<string | null>((best, r) => {
          if (!r.submitted_date) return best;
          if (!best) return r.submitted_date;
          return r.submitted_date > best ? r.submitted_date : best;
        }, null);
        return { id: brand.id, name: brand.name, retailerCount: rows.length, lastActivity };
      })
      .filter((b) => b.retailerCount > 0);

    setBrandSummaries(summaries);

    // Collect all retailer IDs from timing — use these to scope the retailers query
    // so RLS doesn't block it (a bare unfiltered select on retailers returns 0 rows)
    const allRetailerIds = [...new Set(timing.map((t) => t.retailer_id))];
    console.log("[board] allRetailerIds count:", allRetailerIds.length);

    // Load reps list and retailer→rep map in parallel
    const [repsRes, retailerRepRes] = await Promise.all([
      supabase
        .from("profiles")
        .select("id, full_name")
        .in("role", ["rep", "admin"])
        .order("full_name"),
      allRetailerIds.length > 0
        ? supabase
            .from("retailers")
            .select("id, rep_owner_user_id")
            .in("id", allRetailerIds)
        : Promise.resolve({ data: [] as { id: string; rep_owner_user_id: string | null }[], error: null }),
    ]);

    console.log("[board] repsRes:", repsRes.data?.length, repsRes.error?.message);
    console.log("[board] retailerRepRes:", retailerRepRes.data?.length, (retailerRepRes as any).error?.message);

    if (!repsRes.error) {
      setReps((repsRes.data ?? []) as RepProfile[]);
    }

    if (!retailerRepRes.error) {
      const map: Record<string, string> = {};
      ((retailerRepRes.data ?? []) as { id: string; rep_owner_user_id: string | null }[]).forEach(
        (r) => { if (r.rep_owner_user_id) map[r.id] = r.rep_owner_user_id; }
      );
      console.log("[board] retailerRepMap size:", Object.keys(map).length);
      setRetailerRepMap(map);
    }

    if (!repFilterInitialized.current) {
      repFilterInitialized.current = true;
      if (resolvedRole === "rep" && uid) {
        setRepFilter(uid);
      }
    }

    setLoading(false);
  }

  // ── On-demand brand detail load ───────────────────────────────────────────

  async function loadBrandRows(brandId: string) {
    if (loadingBrand[brandId]) return;
    setLoadingBrand((s) => ({ ...s, [brandId]: true }));

    const timing = timingByBrand[brandId] ?? [];
    const retailerIds = timing.map((t) => t.retailer_id);

    if (retailerIds.length === 0) {
      setBrandRows((s) => ({ ...s, [brandId]: [] }));
      setLoadingBrand((s) => ({ ...s, [brandId]: false }));
      return;
    }

    const [retailerRes, messagesRes] = await Promise.all([
      supabase.from("retailers").select("id, name, banner").in("id", retailerIds),
      supabase
        .from("brand_retailer_messages")
        .select("id, retailer_id, body, created_at")
        .eq("brand_id", brandId)
        .eq("visibility", "internal")
        .order("created_at", { ascending: false }),
    ]);

    if (retailerRes.error || messagesRes.error) {
      setLoadingBrand((s) => ({ ...s, [brandId]: false }));
      return;
    }

    const retailerMap: Record<string, Retailer> = {};
    ((retailerRes.data as Retailer[]) ?? []).forEach((r) => { retailerMap[r.id] = r; });

    const latestNoteMap: Record<string, Message> = {};
    ((messagesRes.data as Message[]) ?? []).forEach((m) => {
      if (!latestNoteMap[m.retailer_id]) latestNoteMap[m.retailer_id] = m;
    });

    const rows: BoardRetailerRow[] = timing
      .map((t) => {
        const retailer = retailerMap[t.retailer_id];
        const banner = retailer?.banner?.trim() || retailer?.name || "Unknown Retailer";
        const latest = latestNoteMap[t.retailer_id] ?? null;
        return {
          timingId: t.id,
          retailerId: t.retailer_id,
          banner,
          accountStatus: t.account_status,
          submittedDate: t.submitted_date,
          latestNote: latest?.body ?? null,
          latestNoteDate: latest?.created_at ?? null,
        };
      })
      .sort((a, b) => a.banner.localeCompare(b.banner));

    setBrandRows((s) => ({ ...s, [brandId]: rows }));
    setLoadingBrand((s) => ({ ...s, [brandId]: false }));
  }

  // ── Expand / collapse brand ───────────────────────────────────────────────

  function toggleBrand(brandId: string) {
    setExpandedBrandIds((prev) => {
      const next = new Set(prev);
      if (next.has(brandId)) {
        next.delete(brandId);
        if (expandedKey?.startsWith(`${brandId}__`)) {
          setExpandedKey(null);
          setNoteText("");
        }
      } else {
        next.add(brandId);
        if (!brandRows[brandId]) loadBrandRows(brandId);
      }
      return next;
    });
  }

  // ── Note editor ───────────────────────────────────────────────────────────

  function toggleNoteEditor(brandId: string, retailerId: string) {
    const key = `${brandId}__${retailerId}`;
    if (expandedKey === key) {
      setExpandedKey(null);
      setNoteText("");
    } else {
      setExpandedKey(key);
      setNoteText("");
    }
  }

  async function saveNote(brandId: string, retailerId: string) {
    const text = noteText.trim();
    if (!text || !userId) return;
    const key = `${brandId}__${retailerId}`;

    setSaving(true);
    setSaveStatus((s) => ({ ...s, [key]: "" }));

    const { error } = await supabase.from("brand_retailer_messages").insert({
      brand_id: brandId,
      retailer_id: retailerId,
      visibility: "internal",
      sender_id: userId,
      body: text,
    });

    setSaving(false);

    if (error) { setSaveStatus((s) => ({ ...s, [key]: error.message })); return; }

    setSaveStatus((s) => ({ ...s, [key]: "Saved." }));
    setExpandedKey(null);
    setNoteText("");
    // Invalidate and reload just this brand's rows
    setBrandRows((s) => { const next = { ...s }; delete next[brandId]; return next; });
    loadBrandRows(brandId);
  }

  // ── Filter ────────────────────────────────────────────────────────────────

  const filteredSummaries = useMemo(() => {
    let result = brandSummaries;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter((b) => b.name.toLowerCase().includes(q));
    }
    if (repFilter) {
      console.log("[board] filtering by repFilter:", repFilter, "retailerRepMap size:", Object.keys(retailerRepMap).length);
      result = result.filter((b) => {
        const brandTiming = timingByBrand[b.id] ?? [];
        return brandTiming.some((t) => retailerRepMap[t.retailer_id] === repFilter);
      });
      console.log("[board] brands after rep filter:", result.length);
    }
    return result;
  }, [brandSummaries, search, repFilter, retailerRepMap, timingByBrand]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-3xl font-bold" style={{ color: "var(--foreground)" }}>
          All Brands Board
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--muted-foreground)" }}>
          Click a brand to expand — click a retailer row to add an internal note
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder="Filter by brand name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full max-w-sm rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2"
          style={{ border: "1px solid var(--border)", background: "var(--card)", color: "var(--foreground)" }}
        />
        {reps.length > 0 && (
          <select
            value={repFilter}
            onChange={(e) => setRepFilter(e.target.value)}
            className="rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2"
            style={{ border: "1px solid var(--border)", background: "var(--card)", color: "var(--foreground)" }}
          >
            <option value="">All reps</option>
            {reps.map((r) => (
              <option key={r.id} value={r.id}>
                {r.full_name ?? r.id}
              </option>
            ))}
          </select>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {loading ? (
        <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>Loading…</p>
      ) : filteredSummaries.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
          {search ? "No brands match your search." : "No retailer data found."}
        </p>
      ) : (
        <div className="space-y-2">
          {filteredSummaries.map((brand) => {
            const isOpen = expandedBrandIds.has(brand.id);
            const rawRows = brandRows[brand.id] ?? null;
            const rows = rawRows === null
              ? null
              : repFilter
                ? rawRows.filter((r) => retailerRepMap[r.retailerId] === repFilter)
                : rawRows;
            const isFetching = loadingBrand[brand.id] ?? false;

            return (
              <div
                key={brand.id}
                className="rounded-xl overflow-hidden"
                style={{ border: "1px solid var(--border)" }}
              >
                {/* ── Collapsed summary row ── */}
                <button
                  type="button"
                  className="w-full flex items-center justify-between px-4 py-3 text-left"
                  style={{ background: isOpen ? "var(--accent)" : "var(--muted)", cursor: "pointer" }}
                  onClick={() => toggleBrand(brand.id)}
                >
                  <div className="flex items-center gap-4 min-w-0">
                    <span className="font-semibold text-sm truncate" style={{ color: "var(--foreground)" }}>
                      {brand.name}
                    </span>
                    <span className="text-xs shrink-0" style={{ color: "var(--muted-foreground)" }}>
                      {brand.retailerCount} retailer{brand.retailerCount !== 1 ? "s" : ""}
                    </span>
                    <span className="text-xs shrink-0" style={{ color: "var(--muted-foreground)" }}>
                      Last activity: {prettyDate(brand.lastActivity)}
                    </span>
                  </div>

                  <div className="flex items-center gap-3 shrink-0 ml-4">
                    <Link
                      href={`/brands/${brand.id}/board`}
                      className="text-xs underline"
                      style={{ color: "var(--muted-foreground)" }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      Open brand board
                    </Link>
                    <span style={{ color: "var(--muted-foreground)", fontSize: "0.65rem" }}>
                      {isOpen ? "▲" : "▼"}
                    </span>
                  </div>
                </button>

                {/* ── Expanded retailer table ── */}
                {isOpen && (
                  isFetching || rows === null ? (
                    <div
                      className="px-4 py-3 text-sm"
                      style={{ borderTop: "1px solid var(--border)", color: "var(--muted-foreground)" }}
                    >
                      Loading retailers…
                    </div>
                  ) : rows.length === 0 ? (
                    <div
                      className="px-4 py-3 text-sm italic"
                      style={{ borderTop: "1px solid var(--border)", color: "var(--muted-foreground)" }}
                    >
                      No retailers found.
                    </div>
                  ) : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr style={{ background: "var(--secondary)", color: "var(--muted-foreground)", borderTop: "1px solid var(--border)" }}>
                          <th className="text-left px-4 py-2 font-medium">Retailer</th>
                          <th className="text-left px-4 py-2 font-medium">Account Status</th>
                          <th className="text-left px-4 py-2 font-medium">Last Activity</th>
                          <th className="text-left px-4 py-2 font-medium">Latest Internal Note</th>
                          <th className="w-8" />
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row, idx) => {
                          const key = `${brand.id}__${row.retailerId}`;
                          const isNoteOpen = expandedKey === key;
                          const isEven = idx % 2 === 0;
                          return (
                            <>
                              <tr
                                key={key}
                                style={{
                                  background: isNoteOpen ? "var(--accent)" : isEven ? "var(--card)" : "var(--secondary)",
                                  borderTop: "1px solid var(--border)",
                                  cursor: "pointer",
                                }}
                                onClick={() => toggleNoteEditor(brand.id, row.retailerId)}
                              >
                                <td className="px-4 py-2.5 font-medium" style={{ color: "var(--foreground)" }}>
                                  <Link
                                    href={`/brands/${brand.id}/retailers/${row.retailerId}`}
                                    className="underline"
                                    style={{ color: "var(--foreground)" }}
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    {row.banner}
                                  </Link>
                                </td>
                                <td className="px-4 py-2.5">
                                  <StatusBadge status={row.accountStatus} />
                                </td>
                                <td className="px-4 py-2.5" style={{ color: "var(--muted-foreground)" }}>
                                  {prettyDate(row.submittedDate)}
                                </td>
                                <td className="px-4 py-2.5 max-w-xs" style={{ color: row.latestNote ? "var(--foreground)" : "var(--muted-foreground)" }}>
                                  {row.latestNote ? (
                                    <>
                                      <span className="line-clamp-1">
                                        {row.latestNote.length > 80 ? row.latestNote.slice(0, 80) + "…" : row.latestNote}
                                      </span>
                                      {row.latestNoteDate && (
                                        <span className="text-xs block" style={{ color: "var(--muted-foreground)" }}>
                                          {prettyDate(row.latestNoteDate)}
                                        </span>
                                      )}
                                    </>
                                  ) : (
                                    <span className="italic text-xs">No notes yet</span>
                                  )}
                                </td>
                                <td className="px-2 py-2.5 text-right" style={{ color: "var(--muted-foreground)", fontSize: "0.7rem" }}>
                                  {isNoteOpen ? "▲" : "▼"}
                                </td>
                              </tr>

                              {isNoteOpen && (
                                <tr
                                  key={`${key}-editor`}
                                  style={{ background: "var(--accent)", borderTop: "1px solid var(--border)" }}
                                >
                                  <td colSpan={5} className="px-4 pb-4 pt-2">
                                    <div className="space-y-2">
                                      <p className="text-xs font-medium" style={{ color: "var(--muted-foreground)" }}>
                                        Add internal note for {row.banner}
                                      </p>
                                      <textarea
                                        className="w-full rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2"
                                        style={{
                                          border: "1px solid var(--border)",
                                          background: "var(--card)",
                                          color: "var(--foreground)",
                                          minHeight: "72px",
                                        }}
                                        placeholder="Write an internal note…"
                                        value={noteText}
                                        onChange={(e) => setNoteText(e.target.value)}
                                        onClick={(e) => e.stopPropagation()}
                                        autoFocus
                                      />
                                      <div className="flex items-center gap-3">
                                        <button
                                          className="px-4 py-1.5 rounded-lg text-sm font-medium"
                                          style={{
                                            background: "var(--foreground)",
                                            color: "var(--background)",
                                            opacity: saving || !noteText.trim() ? 0.5 : 1,
                                            cursor: saving || !noteText.trim() ? "not-allowed" : "pointer",
                                          }}
                                          disabled={saving || !noteText.trim()}
                                          onClick={(e) => { e.stopPropagation(); saveNote(brand.id, row.retailerId); }}
                                        >
                                          {saving ? "Saving…" : "Save Note"}
                                        </button>
                                        <button
                                          className="text-sm underline"
                                          style={{ color: "var(--muted-foreground)" }}
                                          onClick={(e) => { e.stopPropagation(); toggleNoteEditor(brand.id, row.retailerId); }}
                                        >
                                          Cancel
                                        </button>
                                        {saveStatus[key] && (
                                          <span className="text-sm" style={{ color: "var(--muted-foreground)" }}>
                                            {saveStatus[key]}
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </>
                          );
                        })}
                      </tbody>
                    </table>
                  )
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
