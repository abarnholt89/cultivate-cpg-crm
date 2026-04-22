"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import StatusBadge from "@/components/StatusBadge";

type Role = "admin" | "rep" | "client" | null;
type NoteMode = "client" | "internal";

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

const MY_TEAM = "__my_team__";

const MANAGER_MAP: Record<string, string[]> = {
  "623753df-291c-4aa5-85fd-5af37efd0297": [
    "623753df-291c-4aa5-85fd-5af37efd0297",
    "16078d4d-90f4-4a9e-b9c3-3c27a48f35ec",
    "ecd0e056-3f26-48f1-9556-026c7e909b8f",
    "e3fb436b-8ad0-4381-8f3f-e84db607bf10",
  ],
};

const STATUS_OPTIONS = [
  { value: "upcoming_review", label: "Upcoming Review" },
  { value: "waiting_for_retailer_to_publish_review", label: "Waiting for Retailer to Publish Next Category Review" },
  { value: "under_review", label: "Under Review" },
  { value: "active_account", label: "Active Account" },
  { value: "working_to_secure_anchor_account", label: "Distributor Required" },
  { value: "not_a_target_account", label: "Not a Target" },
  { value: "cultivate_does_not_rep", label: "Not Managed by Cultivate" },
  { value: "retailer_declined", label: "Retailer Declined" },
];

function statusLeftBorderColor(status: string | undefined): string {
  switch (status) {
    case "active_account":       return "#14b8a6"; // teal
    case "upcoming_review":
    case "open_review":          return "#f59e0b"; // amber
    case "under_review":
    case "waiting_for_retailer_to_publish_review":
    case "working_to_secure_anchor_account": return "#3b82f6"; // blue
    case "retailer_declined":    return "#f43f5e"; // rose
    case "not_a_target_account":
    case "cultivate_does_not_rep": return "#94a3b8"; // slate
    default:                     return "#e2e8f0"; // light gray
  }
}

function relativeTime(ts: string | null) {
  if (!ts) return "—";
  const mins = Math.floor((Date.now() - new Date(ts).getTime()) / 60000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  const days = Math.floor(mins / 1440);
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

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

  // Board-wide note mode — defaults to client-facing (safety default)
  const [mode, setMode] = useState<NoteMode>("client");

  const [brandSummaries, setBrandSummaries] = useState<BrandSummary[]>([]);
  const [timingByBrand, setTimingByBrand] = useState<Record<string, TimingRow[]>>({});

  const [brandRows, setBrandRows] = useState<Record<string, BoardRetailerRow[]>>({});
  const [loadingBrand, setLoadingBrand] = useState<Record<string, boolean>>({});

  const [search, setSearch] = useState("");
  const [expandedBrandIds, setExpandedBrandIds] = useState<Set<string>>(new Set());

  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<Record<string, string>>({});

  // Inline status editing — no intermediate edit-mode; select is always visible
  const [statusOverrides, setStatusOverrides] = useState<Record<string, string>>({});
  const [statusSaving, setStatusSaving] = useState<Record<string, boolean>>({});
  const [errorToast, setErrorToast] = useState<string | null>(null);
  const errorToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const prevSearchRef = useRef("");
  // Keep a ref of expanded brand IDs so mode-change effect can read without stale closure
  const expandedBrandIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => { expandedBrandIdsRef.current = expandedBrandIds; }, [expandedBrandIds]);

  useEffect(() => { loadSummaries(); }, []);

  useEffect(() => {
    if (!userId || !role || repFilterInitialized.current) return;
    repFilterInitialized.current = true;
    if (MANAGER_MAP[userId]) {
      setRepFilter(MY_TEAM);
    } else if (role === "rep") {
      setRepFilter(userId);
    }
  }, [userId, role]);

  // When mode changes: discard cached rows, close any open note editor,
  // and reload all currently expanded brands with the new visibility.
  useEffect(() => {
    if (loading) return; // skip during initial page load
    setBrandRows({});
    setLoadingBrand({});
    setExpandedKey(null);
    setNoteText("");
    expandedBrandIdsRef.current.forEach((id) => loadBrandRows(id, mode));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

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

      matchIds.forEach((id) => {
        if (!brandRows[id]) loadBrandRows(id, mode);
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

    const { data: brandsData, error: brandsError } = await supabase
      .from("brands").select("id, name").order("name", { ascending: true });

    if (brandsError) { setError(brandsError.message); setLoading(false); return; }
    const brands = (brandsData as Brand[]) ?? [];

    const { data: timing, error: timingErr } = await fetchAll<TimingRow>(() =>
      supabase
        .from("brand_retailer_timing")
        .select("id, brand_id, retailer_id, account_status, submitted_date")
    );

    if (timingErr) { setError(timingErr); setLoading(false); return; }

    const byBrand: Record<string, TimingRow[]> = {};
    timing.forEach((t) => {
      if (!byBrand[t.brand_id]) byBrand[t.brand_id] = [];
      byBrand[t.brand_id].push(t);
    });
    setTimingByBrand(byBrand);

    const allRetailerIds = [...new Set(timing.map((t) => t.retailer_id))];

    // Brand-level last activity always reflects client-visible messages
    const [repsRes, retailerRepRes, msgActivityRes] = await Promise.all([
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
      fetchAll<{ brand_id: string; created_at: string }>(() =>
        supabase
          .from("brand_retailer_messages")
          .select("brand_id, created_at")
          .eq("visibility", "client")
      ),
    ]);

    const msgLastActivity: Record<string, string> = {};
    (msgActivityRes.data ?? []).forEach((m) => {
      if (!msgLastActivity[m.brand_id] || m.created_at > msgLastActivity[m.brand_id]) {
        msgLastActivity[m.brand_id] = m.created_at;
      }
    });

    const summaries: BrandSummary[] = brands
      .map((brand) => {
        const rows = byBrand[brand.id] ?? [];
        return {
          id: brand.id,
          name: brand.name,
          retailerCount: rows.length,
          lastActivity: msgLastActivity[brand.id] ?? null,
        };
      })
      .filter((b) => b.retailerCount > 0);

    setBrandSummaries(summaries);

    if (!repsRes.error) setReps((repsRes.data ?? []) as RepProfile[]);

    if (!retailerRepRes.error) {
      const map: Record<string, string> = {};
      ((retailerRepRes.data ?? []) as { id: string; rep_owner_user_id: string | null }[]).forEach(
        (r) => { if (r.rep_owner_user_id) map[r.id] = r.rep_owner_user_id; }
      );
      setRetailerRepMap(map);
    }

    setLoading(false);
  }

  // ── On-demand brand detail load ───────────────────────────────────────────

  async function loadBrandRows(brandId: string, visibility: NoteMode) {
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
        .eq("visibility", visibility)
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
        if (!brandRows[brandId]) loadBrandRows(brandId, mode);
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

    const { data: profileData } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", userId)
      .single();
    const senderName = profileData?.full_name ?? null;

    console.log("[saveNote] inserting:", { brand_id: brandId, retailer_id: retailerId, visibility: mode, sender_id: userId, sender_name: senderName, body: text });

    const { error } = await supabase.from("brand_retailer_messages").insert({
      brand_id: brandId,
      retailer_id: retailerId,
      visibility: mode,
      sender_id: userId,
      sender_name: senderName,
      body: text,
    });

    setSaving(false);

    if (error) { setSaveStatus((s) => ({ ...s, [key]: error.message })); return; }

    setSaveStatus((s) => ({ ...s, [key]: "Saved." }));
    setExpandedKey(null);
    setNoteText("");
    setBrandRows((s) => { const next = { ...s }; delete next[brandId]; return next; });
    loadBrandRows(brandId, mode);
  }

  // ── Inline status update ──────────────────────────────────────────────────

  async function updateStatus(timingId: string, prevStatus: string, newStatus: string) {
    if (newStatus === prevStatus) return;

    setStatusOverrides((s) => ({ ...s, [timingId]: newStatus }));
    setStatusSaving((s) => ({ ...s, [timingId]: true }));

    const { error } = await supabase
      .from("brand_retailer_timing")
      .update({ account_status: newStatus })
      .eq("id", timingId);

    setStatusSaving((s) => ({ ...s, [timingId]: false }));

    if (error) {
      setStatusOverrides((s) => ({ ...s, [timingId]: prevStatus }));
      if (errorToastTimer.current) clearTimeout(errorToastTimer.current);
      setErrorToast("Failed to update status. You may not have permission.");
      errorToastTimer.current = setTimeout(() => setErrorToast(null), 4000);
    }
  }

  // ── Filter ────────────────────────────────────────────────────────────────

  const filteredSummaries = useMemo(() => {
    let result = brandSummaries;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter((b) => b.name.toLowerCase().includes(q));
    }
    if (repFilter === MY_TEAM) {
      const teamIds = new Set(MANAGER_MAP[userId ?? ""] ?? []);
      result = result.filter((b) => {
        const brandTiming = timingByBrand[b.id] ?? [];
        return brandTiming.some((t) => teamIds.has(retailerRepMap[t.retailer_id]));
      });
    } else if (repFilter) {
      result = result.filter((b) => {
        const brandTiming = timingByBrand[b.id] ?? [];
        return brandTiming.some((t) => retailerRepMap[t.retailer_id] === repFilter);
      });
    }
    return result;
  }, [brandSummaries, search, repFilter, retailerRepMap, timingByBrand, userId]);

  const isInternal = mode === "internal";

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      className="p-6 space-y-5 min-h-screen transition-colors"
      style={{ background: isInternal ? "#f1f5f9" : undefined }}
    >
      {/* Error toast */}
      {errorToast && (
        <div
          className="fixed bottom-5 right-5 z-50 rounded-lg px-4 py-3 text-sm font-medium shadow-lg"
          style={{ background: "#fee2e2", color: "#991b1b", border: "1px solid #fca5a5" }}
        >
          {errorToast}
        </div>
      )}

      {/* Internal mode banner */}
      {isInternal && (
        <div
          className="flex items-center justify-between rounded-lg px-4 py-2.5 text-sm"
          style={{ background: "#e2e8f0", color: "#334155", border: "1px solid #cbd5e1" }}
        >
          <span className="font-medium">
            Internal-only mode active · notes written here are team-only and NOT sent to clients
          </span>
          <button
            onClick={() => setMode("client")}
            className="ml-4 text-xs underline shrink-0"
            style={{ color: "#475569" }}
          >
            Switch to client-facing
          </button>
        </div>
      )}

      <div>
        <h1 className="text-3xl font-bold" style={{ color: "var(--foreground)" }}>
          All Brands Board
        </h1>
        <p className="mt-1 text-sm" style={{ color: isInternal ? "#64748b" : "var(--muted-foreground)" }}>
          {isInternal
            ? "Internal-only mode · notes written here are team-only and NOT sent to clients."
            : "Click a brand to expand — click a retailer row to add a client-facing note. Notes here appear on the client's dashboard."}
        </p>
      </div>

      {/* Filter row + mode toggle */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Mode toggle */}
        <div
          className="flex rounded-lg overflow-hidden text-sm"
          style={{ border: "1px solid var(--border)" }}
        >
          <button
            onClick={() => setMode("client")}
            className="px-3 py-2 font-medium transition-colors"
            style={{
              background: !isInternal ? "var(--foreground)" : "var(--card)",
              color: !isInternal ? "var(--background)" : "var(--muted-foreground)",
            }}
          >
            Client-facing
          </button>
          <button
            onClick={() => setMode("internal")}
            className="px-3 py-2 font-medium transition-colors"
            style={{
              background: isInternal ? "#334155" : "var(--card)",
              color: isInternal ? "#f8fafc" : "var(--muted-foreground)",
              borderLeft: "1px solid var(--border)",
            }}
          >
            Internal only
          </button>
        </div>

        <input
          type="text"
          placeholder="Filter by brand name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full max-w-sm rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2"
          style={{ border: "1px solid var(--border)", background: "var(--card)", color: "var(--foreground)" }}
        />

        {role === "admin" ? (
          reps.length > 0 && (
            <select
              value={repFilter}
              onChange={(e) => setRepFilter(e.target.value)}
              className="rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2"
              style={{ border: "1px solid var(--border)", background: "var(--card)", color: "var(--foreground)" }}
            >
              <option value="">All reps</option>
              {userId && MANAGER_MAP[userId] && (
                <option value={MY_TEAM}>My Team</option>
              )}
              {reps.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.full_name ?? r.id}
                </option>
              ))}
            </select>
          )
        ) : role === "rep" ? (
          <div
            className="rounded-lg px-3 py-2 text-sm"
            style={{ border: "1px solid var(--border)", background: "var(--muted)", color: "var(--muted-foreground)" }}
          >
            {reps.find((r) => r.id === repFilter)?.full_name ?? "My accounts"}
          </div>
        ) : null}
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
              : repFilter === MY_TEAM
                ? (() => {
                    const teamIds = new Set(MANAGER_MAP[userId ?? ""] ?? []);
                    return rawRows.filter((r) => teamIds.has(retailerRepMap[r.retailerId]));
                  })()
                : repFilter
                  ? rawRows.filter((r) => retailerRepMap[r.retailerId] === repFilter)
                  : rawRows;
            const isFetching = loadingBrand[brand.id] ?? false;

            return (
              <div
                key={brand.id}
                className="rounded-xl overflow-hidden"
                style={{ border: `1px solid ${isInternal ? "#cbd5e1" : "var(--border)"}` }}
              >
                {/* ── Collapsed summary row ── */}
                <button
                  type="button"
                  className="w-full flex items-center justify-between px-4 py-3 text-left"
                  style={{
                    background: isOpen
                      ? (isInternal ? "#e2e8f0" : "var(--accent)")
                      : (isInternal ? "#e8edf2" : "var(--muted)"),
                    cursor: "pointer",
                  }}
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
                      Last activity: {relativeTime(brand.lastActivity)}
                    </span>
                  </div>

                  <div className="flex items-center gap-3 shrink-0 ml-4">
                    <Link
                      href={`/brands/${brand.id}`}
                      className="text-xs underline"
                      style={{ color: "var(--muted-foreground)" }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      Open brand dashboard →
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
                      style={{ borderTop: `1px solid ${isInternal ? "#cbd5e1" : "var(--border)"}`, color: "var(--muted-foreground)" }}
                    >
                      Loading retailers…
                    </div>
                  ) : rows.length === 0 ? (
                    <div
                      className="px-4 py-3 text-sm italic"
                      style={{ borderTop: `1px solid ${isInternal ? "#cbd5e1" : "var(--border)"}`, color: "var(--muted-foreground)" }}
                    >
                      No retailers found.
                    </div>
                  ) : (
                    <table className="w-full text-sm" style={{ boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}>
                      <thead>
                        <tr style={{
                          background: isInternal ? "#e2e8f0" : "var(--secondary)",
                          color: "var(--muted-foreground)",
                          borderTop: `1px solid ${isInternal ? "#cbd5e1" : "var(--border)"}`,
                        }}>
                          <th className="text-left px-4 py-2 font-medium">Retailer</th>
                          <th className="text-left px-4 py-2 font-medium">Account Status</th>
                          <th className="text-left px-4 py-2 font-medium">Last Activity</th>
                          <th className="text-left px-4 py-2 font-medium">Latest Note</th>
                          <th className="w-8" />
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row, idx) => {
                          const key = `${brand.id}__${row.retailerId}`;
                          const isNoteOpen = expandedKey === key;
                          const isEven = idx % 2 === 0;
                          const currentStatus = statusOverrides[row.timingId] ?? row.accountStatus;
                          return (
                            <>
                              <tr
                                key={key}
                                style={{
                                  background: isNoteOpen
                                    ? (isInternal ? "#e2e8f0" : "var(--accent)")
                                    : isEven
                                      ? (isInternal ? "#f8fafc" : "var(--card)")
                                      : (isInternal ? "#f1f5f9" : "var(--secondary)"),
                                  borderTop: `1px solid ${isInternal ? "#cbd5e1" : "var(--border)"}`,
                                  cursor: "pointer",
                                }}
                                onClick={() => toggleNoteEditor(brand.id, row.retailerId)}
                              >
                                <td
                                  className="px-4 py-2.5 font-medium"
                                  style={{
                                    color: "var(--foreground)",
                                    borderLeft: `4px solid ${statusLeftBorderColor(currentStatus)}`,
                                  }}
                                >
                                  <Link
                                    href={`/brands/${brand.id}/retailers/${row.retailerId}`}
                                    className="underline"
                                    style={{ color: "var(--foreground)" }}
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    {row.banner}
                                  </Link>
                                </td>

                                {/* Inline status edit — always-visible select, no intermediate edit mode */}
                                <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                                  <select
                                    value={currentStatus}
                                    onChange={(e) => {
                                      e.stopPropagation();
                                      updateStatus(row.timingId, currentStatus, e.target.value);
                                    }}
                                    disabled={statusSaving[row.timingId]}
                                    className="text-xs rounded px-2 py-1 focus:outline-none focus:ring-1"
                                    style={{
                                      border: "1px solid var(--border)",
                                      background: "var(--card)",
                                      color: "var(--foreground)",
                                      maxWidth: "180px",
                                      opacity: statusSaving[row.timingId] ? 0.6 : 1,
                                    }}
                                  >
                                    {STATUS_OPTIONS.map((opt) => (
                                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                                    ))}
                                  </select>
                                </td>

                                <td className="px-4 py-2.5" style={{ color: "var(--muted-foreground)" }}>
                                  {relativeTime(row.latestNoteDate)}
                                </td>

                                <td className="px-4 py-2.5 max-w-xs" style={{ color: row.latestNote ? "var(--foreground)" : "var(--muted-foreground)" }}>
                                  {row.latestNote ? (
                                    <span className="line-clamp-1">
                                      {row.latestNote.length > 80 ? row.latestNote.slice(0, 80) + "…" : row.latestNote}
                                    </span>
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
                                  style={{
                                    background: isInternal ? "#e2e8f0" : "var(--accent)",
                                    borderTop: `1px solid ${isInternal ? "#cbd5e1" : "var(--border)"}`,
                                  }}
                                >
                                  <td colSpan={5} className="px-4 pb-4 pt-2">
                                    <div className="space-y-2">
                                      <p className="text-xs font-medium" style={{ color: isInternal ? "#475569" : "var(--muted-foreground)" }}>
                                        {isInternal
                                          ? `Add internal-only note for ${row.banner}`
                                          : `Add client-facing note for ${row.banner}`}
                                      </p>
                                      <textarea
                                        className="w-full rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2"
                                        style={{
                                          border: `1px solid ${isInternal ? "#94a3b8" : "var(--border)"}`,
                                          background: isInternal ? "#f8fafc" : "var(--card)",
                                          color: "var(--foreground)",
                                          minHeight: "72px",
                                        }}
                                        placeholder={isInternal ? "Write an internal-only note…" : "Write a client-facing note…"}
                                        value={noteText}
                                        onChange={(e) => setNoteText(e.target.value)}
                                        onClick={(e) => e.stopPropagation()}
                                        autoFocus
                                      />
                                      <div className="flex items-center gap-3">
                                        <button
                                          className="px-4 py-1.5 rounded-lg text-sm font-medium"
                                          style={{
                                            background: isInternal ? "#334155" : "var(--foreground)",
                                            color: isInternal ? "#f8fafc" : "var(--background)",
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
