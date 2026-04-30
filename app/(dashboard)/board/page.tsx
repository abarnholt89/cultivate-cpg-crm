"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";

type Role = "admin" | "rep" | "client" | null;

type Brand = { id: string; name: string };

type TimingRow = {
  id: string;
  brand_id: string;
  retailer_id: string;
  account_status: string;
  submitted_date: string | null;
  universal_category: string | null;
};

type CategoryEntry = {
  timingId: string;
  accountStatus: string;
  universal_category: string | null;
  submittedDate: string | null;
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
  retailerId: string;
  banner: string;
  categories: CategoryEntry[];   // sorted: null/primary first, then alpha
  latestClientNote: string | null;
  latestClientNoteDate: string | null;
  latestInternalNote: string | null;
  latestInternalNoteDate: string | null;
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

type WorkedEntry = {
  brand_id: string;
  rep_id: string;
  retailer_id: string | null;
  worked_at: string;
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
  { value: "", label: "— No Status —" },
  { value: "awaiting_submission_opportunity", label: "Awaiting Submission Opportunity" },
  { value: "in_process", label: "In Process" },
  { value: "retailer_declined", label: "Retailer Declined" },
  { value: "not_a_target_account", label: "Not a Target Account" },
  { value: "working_to_secure_anchor_account", label: "Distributor Required" },
];

function statusLeftBorderColor(status: string | undefined): string {
  switch (status) {
    case "awaiting_submission_opportunity": return "#f59e0b"; // amber
    case "in_process":           return "#3b82f6"; // blue
    case "retailer_declined":    return "#f43f5e"; // rose
    case "not_a_target_account":
    case "working_to_secure_anchor_account": return "#94a3b8"; // slate
    default:                     return "#e2e8f0"; // light gray
  }
}

function daysAgo(iso: string): number {
  return Math.floor((Date.now() - new Date(iso + "T00:00:00").getTime()) / 86400000);
}

function workedBadge(workedAt: string | null, allTouched: boolean): { label: string; bg: string; fg: string } {
  if (allTouched) return { label: "All Done ✓", bg: "#15803d", fg: "#fff" };
  if (!workedAt) return { label: "No Activity", bg: "#ef4444", fg: "#fff" };
  const d = daysAgo(workedAt);
  const label = d === 0 ? "Today" : d === 1 ? "1d ago" : `${d}d ago`;
  if (d <= 14) return { label, bg: "#86efac", fg: "#14532d" };
  if (d <= 30) return { label, bg: "#fde047", fg: "#713f12" };
  if (d <= 45) return { label, bg: "#fb923c", fg: "#431407" };
  return { label, bg: "#ef4444", fg: "#fff" };
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

function statusShortLabel(status: string): string {
  switch (status) {
    case "awaiting_submission_opportunity": return "Awaiting";
    case "in_process":                     return "In Process";
    case "retailer_declined":              return "Declined";
    case "not_a_target_account":           return "Not Target";
    case "working_to_secure_anchor_account": return "Distributor";
    default:                               return "—";
  }
}

function statusPillBg(status: string): string {
  switch (status) {
    case "awaiting_submission_opportunity": return "#fef9c3";
    case "in_process":                     return "#dbeafe";
    case "retailer_declined":              return "#ffe4e6";
    case "not_a_target_account":
    case "working_to_secure_anchor_account": return "#f1f5f9";
    default:                               return "#f1f5f9";
  }
}

function statusPillFg(status: string): string {
  switch (status) {
    case "awaiting_submission_opportunity": return "#713f12";
    case "in_process":                     return "#1e3a8a";
    case "retailer_declined":              return "#881337";
    case "not_a_target_account":
    case "working_to_secure_anchor_account": return "#475569";
    default:                               return "#64748b";
  }
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

  const [brandSummaries, setBrandSummaries] = useState<BrandSummary[]>([]);
  // Per-sender last activity: brand_id → sender_id → latest created_at
  const [msgBySenderMap, setMsgBySenderMap] = useState<Record<string, Record<string, string>>>({});
  const [timingByBrand, setTimingByBrand] = useState<Record<string, TimingRow[]>>({});

  const [brandRows, setBrandRows] = useState<Record<string, BoardRetailerRow[]>>({});
  const [loadingBrand, setLoadingBrand] = useState<Record<string, boolean>>({});

  const [search, setSearch] = useState("");
  const [expandedBrandIds, setExpandedBrandIds] = useState<Set<string>>(new Set());

  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [clientNoteText, setClientNoteText] = useState("");
  const [internalNoteText, setInternalNoteText] = useState("");
  const [saving, setSaving] = useState<"client" | "internal" | null>(null);
  const [saveStatus, setSaveStatus] = useState<Record<string, string>>({});
  // Task form state — key is `${brandId}__${retailerId}`
  const [taskFormKey, setTaskFormKey] = useState<string | null>(null);
  const [taskForm, setTaskForm] = useState({ title: "", notes: "", due_date: "", assigned_to: "" });
  const [taskSaving, setTaskSaving] = useState(false);

  // Date Worked — raw entries kept for per-retailer "all touched" check
  const [workedEntries, setWorkedEntries] = useState<WorkedEntry[]>([]);
  // Derived map stored as state (not useMemo) so it updates reliably after async fetch
  const [latestWorkedMap, setLatestWorkedMap] = useState<Record<string, Record<string, string>>>({});
  const [dateWorkedSaving, setDateWorkedSaving] = useState<Record<string, boolean>>({});
  const [snoozeSaving, setSnoozeSaving] = useState<Record<string, boolean>>({});

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
        if (!brandRows[id]) loadBrandRows(id);
      });
    } else if (prev && !q) {
      setExpandedBrandIds(new Set());
      setExpandedKey(null);
      setClientNoteText("");
      setInternalNoteText("");
    }
  }, [search, brandSummaries]);

  // ── Initial summary load ──────────────────────────────────────────────────

  async function loadSummaries() {
    console.log("BOARD loadSummaries START");
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
        .select("id, brand_id, retailer_id, account_status, submitted_date, universal_category")
    );

    if (timingErr) { setError(timingErr); setLoading(false); return; }

    const byBrand: Record<string, TimingRow[]> = {};
    timing.forEach((t) => {
      if (!byBrand[t.brand_id]) byBrand[t.brand_id] = [];
      byBrand[t.brand_id].push(t);
    });
    setTimingByBrand(byBrand);

    const allRetailerIds = [...new Set(timing.map((t) => t.retailer_id))];

    // Start brand_date_worked fetch first so it runs in parallel with the Promise.all below.
    // Using fetchAll (paginated) instead of a plain .select() so we never hit the 1 000-row
    // default limit — a system with many reps × many brands can easily exceed that, causing
    // entries (e.g. JJ's 46) to be silently truncated.
    const workedPromise = fetchAll<WorkedEntry>(() =>
      supabase
        .from("brand_date_worked")
        .select("brand_id, rep_id, worked_at, retailer_id")
    );

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
      // Fetch client messages with sender_id for per-rep last-activity lookup.
      // We keep eq("visibility", "client") so RLS policies that gate internal
      // messages never silently drop the entire result set.
      fetchAll<{ brand_id: string; created_at: string; sender_id: string | null }>(() =>
        supabase
          .from("brand_retailer_messages")
          .select("brand_id, created_at, sender_id")
          .eq("visibility", "client")
      ),
    ]);

    // Await the already-running worked promise (runs concurrently with the above)
    const workedResult = await workedPromise;

    // msgActivityRes is already filtered to visibility="client"
    const msgLastActivity: Record<string, string> = {};
    const msgBySender: Record<string, Record<string, string>> = {};
    (msgActivityRes.data ?? []).forEach((m) => {
      // All-reps aggregate
      if (!msgLastActivity[m.brand_id] || m.created_at > msgLastActivity[m.brand_id]) {
        msgLastActivity[m.brand_id] = m.created_at;
      }
      // Per-sender (sender_id may be null for legacy rows — skip those)
      if (m.sender_id) {
        if (!msgBySender[m.brand_id]) msgBySender[m.brand_id] = {};
        const existing = msgBySender[m.brand_id][m.sender_id];
        if (!existing || m.created_at > existing) {
          msgBySender[m.brand_id][m.sender_id] = m.created_at;
        }
      }
    });

    const summaries: BrandSummary[] = brands
      .map((brand) => {
        const rows = byBrand[brand.id] ?? [];
        const uniqueRetailers = new Set(rows.map((r) => r.retailer_id)).size;
        return {
          id: brand.id,
          name: brand.name,
          retailerCount: uniqueRetailers,
          lastActivity: msgLastActivity[brand.id] ?? null,
        };
      })
      .filter((b) => b.retailerCount > 0);

    // Build latestWorkedMap here (not in useMemo) so it lands in state at the same
    // time as workedEntries — useMemo can fire before the async setState is processed.
    const nextWorkedMap: Record<string, Record<string, string>> = {};
    for (const e of workedResult.data) {
      if (!nextWorkedMap[e.brand_id]) nextWorkedMap[e.brand_id] = {};
      const existing = nextWorkedMap[e.brand_id][e.rep_id];
      if (!existing || e.worked_at > existing) nextWorkedMap[e.brand_id][e.rep_id] = e.worked_at;
    }

    // Set all state in one synchronous block so the first render has everything
    setBrandSummaries(summaries);
    setWorkedEntries(workedResult.data);
    setLatestWorkedMap(nextWorkedMap);
    setMsgBySenderMap(msgBySender);

    console.log("BOARD repsRes:", JSON.stringify(repsRes.data));
    console.log("BOARD repsRes.error:", repsRes.error);
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

    const [retailerRes, clientMsgsRes, internalMsgsRes] = await Promise.all([
      supabase.from("retailers").select("id, name, banner").in("id", retailerIds),
      supabase
        .from("brand_retailer_messages")
        .select("id, retailer_id, body, created_at")
        .eq("brand_id", brandId)
        .eq("visibility", "client")
        .order("created_at", { ascending: false }),
      supabase
        .from("brand_retailer_messages")
        .select("id, retailer_id, body, created_at")
        .eq("brand_id", brandId)
        .eq("visibility", "internal")
        .order("created_at", { ascending: false }),
    ]);

    if (retailerRes.error) {
      setLoadingBrand((s) => ({ ...s, [brandId]: false }));
      return;
    }

    const retailerMap: Record<string, Retailer> = {};
    ((retailerRes.data as Retailer[]) ?? []).forEach((r) => { retailerMap[r.id] = r; });

    const latestClientMap: Record<string, Message> = {};
    ((clientMsgsRes.data as Message[]) ?? []).forEach((m) => {
      if (!latestClientMap[m.retailer_id]) latestClientMap[m.retailer_id] = m;
    });

    const latestInternalMap: Record<string, Message> = {};
    ((internalMsgsRes.data as Message[]) ?? []).forEach((m) => {
      if (!latestInternalMap[m.retailer_id]) latestInternalMap[m.retailer_id] = m;
    });

    // Group timing rows by retailer_id — one BoardRetailerRow per retailer
    const byRetailer = new Map<string, TimingRow[]>();
    for (const t of timing) {
      if (!byRetailer.has(t.retailer_id)) byRetailer.set(t.retailer_id, []);
      byRetailer.get(t.retailer_id)!.push(t);
    }

    const rows: BoardRetailerRow[] = [...byRetailer.entries()]
      .map(([retailerId, timingRows]) => {
        const retailer = retailerMap[retailerId];
        const banner = retailer?.banner?.trim() || retailer?.name || "Unknown Retailer";
        const latestClient = latestClientMap[retailerId] ?? null;
        const latestInternal = latestInternalMap[retailerId] ?? null;

        // Sort categories: null/primary first, then alphabetical
        const sortedTiming = [...timingRows].sort((a, b) => {
          if (!a.universal_category && b.universal_category) return -1;
          if (a.universal_category && !b.universal_category) return 1;
          return (a.universal_category ?? "").localeCompare(b.universal_category ?? "");
        });

        return {
          retailerId,
          banner,
          categories: sortedTiming.map((t) => ({
            timingId: t.id,
            accountStatus: t.account_status,
            universal_category: t.universal_category ?? null,
            submittedDate: t.submitted_date,
          })),
          latestClientNote: latestClient?.body ?? null,
          latestClientNoteDate: latestClient?.created_at ?? null,
          latestInternalNote: latestInternal?.body ?? null,
          latestInternalNoteDate: latestInternal?.created_at ?? null,
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
          setClientNoteText("");
          setInternalNoteText("");
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
      setClientNoteText("");
      setInternalNoteText("");
    } else {
      setExpandedKey(key);
      setClientNoteText("");
      setInternalNoteText("");
    }
  }

  async function saveNote(brandId: string, retailerId: string, visibility: "client" | "internal") {
    const text = (visibility === "client" ? clientNoteText : internalNoteText).trim();
    if (!text || !userId) return;
    const key = `${brandId}__${retailerId}`;

    setSaving(visibility);
    setSaveStatus((s) => ({ ...s, [key]: "" }));

    const { data: profileData } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", userId)
      .single();
    const senderName = profileData?.full_name ?? null;

    const { error } = await supabase.from("brand_retailer_messages").insert({
      brand_id: brandId,
      retailer_id: retailerId,
      visibility,
      sender_id: userId,
      sender_name: senderName,
      body: text,
    });

    setSaving(null);

    if (error) { setSaveStatus((s) => ({ ...s, [key]: error.message })); return; }

    if (visibility === "client") setClientNoteText("");
    else setInternalNoteText("");

    // Auto-stamp date worked (silent — no extra UI feedback)
    const today = new Date().toISOString().split("T")[0];
    supabase.from("brand_date_worked").insert({
      brand_id: brandId,
      rep_id: userId,
      retailer_id: retailerId,
      worked_at: today,
    }).then(({ error: stampErr }) => {
      if (!stampErr) {
        setWorkedEntries((prev) => [...prev, { brand_id: brandId, rep_id: userId!, retailer_id: retailerId, worked_at: today }]);
        setLatestWorkedMap((prev) => ({
          ...prev,
          [brandId]: { ...(prev[brandId] ?? {}), [userId!]: today },
        }));
      }
    });

    setBrandRows((s) => { const next = { ...s }; delete next[brandId]; return next; });
    loadBrandRows(brandId);
  }

  async function saveBoardTask(brandId: string, retailerId: string) {
    if (!taskForm.title.trim() || !userId) return;
    setTaskSaving(true);
    try {
      await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: taskForm.title.trim(),
          notes: taskForm.notes || null,
          due_date: taskForm.due_date || null,
          assigned_to: taskForm.assigned_to || userId,
          created_by: userId,
          brand_id: brandId,
          retailer_id: retailerId,
        }),
      });
      setTaskFormKey(null);
      setTaskForm({ title: "", notes: "", due_date: "", assigned_to: "" });
    } finally {
      setTaskSaving(false);
    }
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

  // ── Date Worked ───────────────────────────────────────────────────────────

  async function markWorked(brandId: string) {
    if (!userId) return;
    setDateWorkedSaving((s) => ({ ...s, [brandId]: true }));
    const today = new Date().toISOString().split("T")[0];
    const { error } = await supabase.from("brand_date_worked").insert({
      brand_id: brandId,
      rep_id: userId,
      worked_at: today,
      // retailer_id intentionally null — brand-level touch counts for all retailers
    });
    if (!error) {
      setWorkedEntries((prev) => [...prev, { brand_id: brandId, rep_id: userId!, retailer_id: null, worked_at: today }]);
      setLatestWorkedMap((prev) => ({
        ...prev,
        [brandId]: { ...(prev[brandId] ?? {}), [userId!]: today },
      }));
    }
    setDateWorkedSaving((s) => ({ ...s, [brandId]: false }));
  }

  async function snoozeRetailer(brandId: string, retailerId: string) {
    if (!userId) return;
    const snoozeKey = `${brandId}__${retailerId}`;
    setSnoozeSaving((s) => ({ ...s, [snoozeKey]: true }));
    const today = new Date().toISOString().split("T")[0];
    const { error } = await supabase.from("brand_date_worked").insert({
      brand_id: brandId,
      rep_id: userId,
      retailer_id: retailerId,
      worked_at: today,
    });
    if (!error) {
      setWorkedEntries((prev) => [...prev, { brand_id: brandId, rep_id: userId!, retailer_id: retailerId, worked_at: today }]);
      setLatestWorkedMap((prev) => ({
        ...prev,
        [brandId]: { ...(prev[brandId] ?? {}), [userId!]: today },
      }));
    }
    setSnoozeSaving((s) => ({ ...s, [snoozeKey]: false }));
  }

  // latestWorkedMap is now a useState (set in loadSummaries) — not a useMemo.
  // useMemo fired with the initial empty workedEntries before the async fetch
  // resolved, and React's batching prevented a re-run after setWorkedEntries.
  // Storing it as state alongside workedEntries ensures they update together.

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
    // When filtering by a specific rep, sort oldest-to-newest by date worked (never first)
    if (repFilter && repFilter !== MY_TEAM) {
      result = [...result].sort((a, b) => {
        const aW = latestWorkedMap[a.id]?.[repFilter] ?? null;
        const bW = latestWorkedMap[b.id]?.[repFilter] ?? null;
        if (!aW && !bW) return a.name.localeCompare(b.name);
        if (!aW) return -1;
        if (!bW) return 1;
        return aW.localeCompare(bW); // lexicographic ascending = oldest date first
      });
    }
    return result;
  }, [brandSummaries, search, repFilter, retailerRepMap, timingByBrand, userId, latestWorkedMap]);

  // ── Render ────────────────────────────────────────────────────────────────

  console.log("BOARD RENDER — role:", role, "reps.length:", reps.length, "repFilter:", repFilter, "latestWorkedMap keys:", Object.keys(latestWorkedMap).length);

  return (
    <div className="p-6 space-y-5 min-h-screen">
      {/* Error toast */}
      {errorToast && (
        <div
          className="fixed bottom-5 right-5 z-50 rounded-lg px-4 py-3 text-sm font-medium shadow-lg"
          style={{ background: "#fee2e2", color: "#991b1b", border: "1px solid #fca5a5" }}
        >
          {errorToast}
        </div>
      )}

      <div>
        <h1 className="text-3xl font-bold" style={{ color: "var(--foreground)" }}>
          All Brands Board
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--muted-foreground)" }}>
          Click a brand to expand · click a retailer row to add notes.
        </p>
      </div>

      {/* Filter row */}
      <div className="flex flex-wrap items-center gap-3">
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
          {filteredSummaries.map((brand, brandIdx) => {
            const isOpen = expandedBrandIds.has(brand.id);
            // Which rep's date-worked to display: specific rep if filtering, else logged-in user
            const targetRepId = (repFilter && repFilter !== MY_TEAM) ? repFilter : (userId ?? "");
            const workedAt = latestWorkedMap[brand.id]?.[targetRepId] ?? null;

            // DEBUG — log for first brand row only
            if (brandIdx === 0) {
              const topKeys = Object.keys(latestWorkedMap).slice(0, 3);
              const innerKeys = latestWorkedMap[brand.id] ? Object.keys(latestWorkedMap[brand.id]) : [];
              console.log("BOARD DEBUG first brand:", brand.id, brand.name);
              console.log("BOARD DEBUG latestWorkedMap first 3 outer keys:", topKeys);
              console.log("BOARD DEBUG latestWorkedMap[brand.id] keys:", innerKeys);
              console.log("BOARD DEBUG targetRepId:", targetRepId);
              console.log("BOARD DEBUG workedAt lookup result:", workedAt);
            }

            // Dark green = rep has touched ALL assigned retailers in the current 60-day round
            const roundStart = new Date(Date.now() - 60 * 86400000).toISOString().split("T")[0];
            const brandTiming = timingByBrand[brand.id] ?? [];
            const assignedRetailerIds = [...new Set(
              brandTiming
                .filter((t) => retailerRepMap[t.retailer_id] === targetRepId)
                .map((t) => t.retailer_id)
            )];
            const allTouched = assignedRetailerIds.length > 0 && (() => {
              const entries = workedEntries.filter(
                (e) => e.brand_id === brand.id && e.rep_id === targetRepId && e.worked_at >= roundStart
              );
              if (entries.some((e) => e.retailer_id === null)) return true; // brand-level touch counts for all
              const touchedSet = new Set(entries.map((e) => e.retailer_id));
              return assignedRetailerIds.every((r) => touchedSet.has(r));
            })();

            const badge = workedBadge(workedAt, allTouched);

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
                style={{ border: "1px solid var(--border)" }}
              >
                {/* ── Collapsed summary row ── */}
                <button
                  type="button"
                  className="w-full flex items-center justify-between px-4 py-3 text-left"
                  style={{
                    background: isOpen ? "var(--accent)" : "var(--muted)",
                    cursor: "pointer",
                  }}
                  onClick={() => toggleBrand(brand.id)}
                >
                  <div className="flex items-center gap-4 min-w-0 flex-wrap">
                    <span className="font-semibold text-sm truncate" style={{ color: "var(--foreground)" }}>
                      {brand.name}
                    </span>
                    <span className="text-xs shrink-0" style={{ color: "var(--muted-foreground)" }}>
                      {brand.retailerCount} retailer{brand.retailerCount !== 1 ? "s" : ""}
                    </span>
                    <span className="text-xs shrink-0" style={{ color: "var(--muted-foreground)" }}>
                      Last activity: {relativeTime(
                        (repFilter && repFilter !== MY_TEAM)
                          ? (msgBySenderMap[brand.id]?.[repFilter] ?? null)
                          : brand.lastActivity
                      )}
                    </span>
                    {/* Date Worked badge — only meaningful for a specific rep */}
                    {repFilter && repFilter !== MY_TEAM && (
                      <span
                        className="text-xs font-medium rounded px-2 py-0.5 shrink-0"
                        style={{ background: badge.bg, color: badge.fg }}
                      >
                        {badge.label}
                      </span>
                    )}
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
                    <table className="w-full text-sm" style={{ boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}>
                      <thead>
                        <tr style={{
                          background: "var(--secondary)",
                          color: "var(--muted-foreground)",
                          borderTop: "1px solid var(--border)",
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
                          // Use primary (first) category's status for the left border color
                          const primaryStatus = statusOverrides[row.categories[0]?.timingId] ?? row.categories[0]?.accountStatus ?? "";
                          return (
                            <>
                              <tr
                                key={key}
                                style={{
                                  background: isNoteOpen
                                    ? "var(--accent)"
                                    : isEven
                                      ? "var(--card)"
                                      : "var(--secondary)",
                                  borderTop: "1px solid var(--border)",
                                  cursor: "pointer",
                                }}
                                onClick={() => toggleNoteEditor(brand.id, row.retailerId)}
                              >
                                {/* Retailer name */}
                                <td
                                  className="px-4 py-2.5 font-medium"
                                  style={{
                                    color: "var(--foreground)",
                                    borderLeft: `4px solid ${statusLeftBorderColor(primaryStatus)}`,
                                  }}
                                >
                                  <Link
                                    href={`/brands/${brand.id}/retailers#retailer-${row.retailerId}`}
                                    className="underline"
                                    style={{ color: "var(--foreground)" }}
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    {row.banner}
                                  </Link>
                                </td>

                                {/* Category + status pills */}
                                <td className="px-4 py-2.5">
                                  <div className="flex flex-wrap gap-1">
                                    {row.categories.map((cat) => {
                                      const status = statusOverrides[cat.timingId] ?? cat.accountStatus;
                                      const label = cat.universal_category
                                        ? `${cat.universal_category} · ${statusShortLabel(status)}`
                                        : statusShortLabel(status);
                                      return (
                                        <span
                                          key={cat.timingId}
                                          className="inline-block text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap"
                                          style={{
                                            background: statusPillBg(status),
                                            color: statusPillFg(status),
                                          }}
                                        >
                                          {label}
                                        </span>
                                      );
                                    })}
                                  </div>
                                </td>

                                <td className="px-4 py-2.5" style={{ color: "var(--muted-foreground)" }}>
                                  {relativeTime(row.latestClientNoteDate)}
                                </td>

                                <td className="px-4 py-2.5 max-w-xs" style={{ color: row.latestClientNote ? "var(--foreground)" : "var(--muted-foreground)" }}>
                                  {row.latestClientNote ? (
                                    <span className="line-clamp-1">
                                      {row.latestClientNote.length > 80 ? row.latestClientNote.slice(0, 80) + "…" : row.latestClientNote}
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
                                    background: "var(--accent)",
                                    borderTop: "1px solid var(--border)",
                                  }}
                                >
                                  <td colSpan={5} className="px-4 pb-4 pt-2">
                                    <div className="space-y-3">
                                      {/* Per-category status selects */}
                                      <div className="flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
                                        {row.categories.map((cat) => {
                                          const status = statusOverrides[cat.timingId] ?? cat.accountStatus;
                                          return (
                                            <div key={cat.timingId} className="flex flex-col gap-0.5">
                                              {cat.universal_category && (
                                                <span className="text-xs font-medium" style={{ color: "var(--muted-foreground)" }}>
                                                  {cat.universal_category}
                                                </span>
                                              )}
                                              <select
                                                value={status}
                                                onChange={(e) => { e.stopPropagation(); updateStatus(cat.timingId, status, e.target.value); }}
                                                disabled={statusSaving[cat.timingId]}
                                                className="text-xs rounded px-2 py-1 focus:outline-none focus:ring-1"
                                                style={{
                                                  border: "1px solid var(--border)",
                                                  background: "var(--card)",
                                                  color: "var(--foreground)",
                                                  opacity: statusSaving[cat.timingId] ? 0.6 : 1,
                                                }}
                                              >
                                                {STATUS_OPTIONS.map((opt) => (
                                                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                                                ))}
                                              </select>
                                            </div>
                                          );
                                        })}
                                      </div>

                                      {/* 2-column note editor */}
                                      <div className="grid grid-cols-2 gap-4">
                                        {/* Client-facing note */}
                                        <div className="space-y-2">
                                          <p className="text-xs font-semibold" style={{ color: "var(--foreground)" }}>
                                            Client-facing note
                                          </p>
                                          {row.latestClientNote && (
                                            <p className="text-xs rounded px-2 py-1.5 line-clamp-2" style={{ background: "var(--card)", color: "var(--muted-foreground)", border: "1px solid var(--border)" }}>
                                              {row.latestClientNote}
                                              <span className="ml-1 opacity-60">· {relativeTime(row.latestClientNoteDate)}</span>
                                            </p>
                                          )}
                                          <textarea
                                            className="w-full rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2"
                                            style={{
                                              border: "1px solid var(--border)",
                                              background: "var(--card)",
                                              color: "var(--foreground)",
                                              minHeight: "72px",
                                            }}
                                            placeholder="Write a client-facing note…"
                                            value={clientNoteText}
                                            onChange={(e) => setClientNoteText(e.target.value)}
                                            onClick={(e) => e.stopPropagation()}
                                          />
                                          <button
                                            className="px-3 py-1.5 rounded-lg text-sm font-medium"
                                            style={{
                                              background: "var(--foreground)",
                                              color: "var(--background)",
                                              opacity: saving === "client" || !clientNoteText.trim() ? 0.5 : 1,
                                              cursor: saving === "client" || !clientNoteText.trim() ? "not-allowed" : "pointer",
                                            }}
                                            disabled={saving === "client" || !clientNoteText.trim()}
                                            onClick={(e) => { e.stopPropagation(); saveNote(brand.id, row.retailerId, "client"); }}
                                          >
                                            {saving === "client" ? "Saving…" : "Save Client Note"}
                                          </button>
                                        </div>

                                        {/* Internal note */}
                                        <div className="space-y-2">
                                          <p className="text-xs font-semibold" style={{ color: "var(--foreground)" }}>
                                            Internal only
                                          </p>
                                          {row.latestInternalNote && (
                                            <p className="text-xs rounded px-2 py-1.5 line-clamp-2" style={{ background: "#f1f5f9", color: "#475569", border: "1px solid #cbd5e1" }}>
                                              {row.latestInternalNote}
                                              <span className="ml-1 opacity-60">· {relativeTime(row.latestInternalNoteDate)}</span>
                                            </p>
                                          )}
                                          <textarea
                                            className="w-full rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2"
                                            style={{
                                              border: "1px solid #94a3b8",
                                              background: "#f8fafc",
                                              color: "var(--foreground)",
                                              minHeight: "72px",
                                            }}
                                            placeholder="Write an internal-only note…"
                                            value={internalNoteText}
                                            onChange={(e) => setInternalNoteText(e.target.value)}
                                            onClick={(e) => e.stopPropagation()}
                                          />
                                          <button
                                            className="px-3 py-1.5 rounded-lg text-sm font-medium"
                                            style={{
                                              background: "#334155",
                                              color: "#f8fafc",
                                              opacity: saving === "internal" || !internalNoteText.trim() ? 0.5 : 1,
                                              cursor: saving === "internal" || !internalNoteText.trim() ? "not-allowed" : "pointer",
                                            }}
                                            disabled={saving === "internal" || !internalNoteText.trim()}
                                            onClick={(e) => { e.stopPropagation(); saveNote(brand.id, row.retailerId, "internal"); }}
                                          >
                                            {saving === "internal" ? "Saving…" : "Save Internal Note"}
                                          </button>
                                        </div>
                                      </div>

                                      <div className="flex items-center gap-3 flex-wrap pt-1">
                                        <button
                                          className="text-xs px-2 py-1 rounded font-medium transition-opacity"
                                          style={{
                                            background: "#1e293b",
                                            color: "#94a3b8",
                                            opacity: snoozeSaving[`${brand.id}__${row.retailerId}`] ? 0.6 : 1,
                                          }}
                                          disabled={!!snoozeSaving[`${brand.id}__${row.retailerId}`]}
                                          onClick={(e) => { e.stopPropagation(); snoozeRetailer(brand.id, row.retailerId); }}
                                        >
                                          {snoozeSaving[`${brand.id}__${row.retailerId}`] ? "…" : "💤 Snooze"}
                                        </button>
                                        <button
                                          className="text-sm underline"
                                          style={{ color: "var(--muted-foreground)" }}
                                          onClick={(e) => { e.stopPropagation(); toggleNoteEditor(brand.id, row.retailerId); }}
                                        >
                                          Cancel
                                        </button>
                                        <button
                                          className="text-sm"
                                          style={{ color: "var(--muted-foreground)" }}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            const tKey = `${brand.id}__${row.retailerId}`;
                                            setTaskFormKey((prev) => prev === tKey ? null : tKey);
                                            setTaskForm({ title: "", notes: "", due_date: "", assigned_to: userId ?? "" });
                                          }}
                                        >
                                          + Task
                                        </button>
                                        {saveStatus[key] && (
                                          <span className="text-sm" style={{ color: "var(--muted-foreground)" }}>
                                            {saveStatus[key]}
                                          </span>
                                        )}
                                      </div>
                                      {taskFormKey === key && (
                                        <div
                                          className="mt-3 space-y-2 rounded-lg p-3"
                                          style={{ border: "1px solid var(--border)", background: "var(--card)" }}
                                          onClick={(e) => e.stopPropagation()}
                                        >
                                          <p className="text-xs font-medium" style={{ color: "var(--muted-foreground)" }}>New Task</p>
                                          <input
                                            type="text"
                                            placeholder="Task title"
                                            value={taskForm.title}
                                            onChange={(e) => setTaskForm((prev) => ({ ...prev, title: e.target.value }))}
                                            className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1"
                                            style={{ border: "1px solid var(--border)", background: "var(--secondary)", color: "var(--foreground)" }}
                                          />
                                          <textarea
                                            placeholder="Notes (optional)"
                                            value={taskForm.notes}
                                            onChange={(e) => setTaskForm((prev) => ({ ...prev, notes: e.target.value }))}
                                            rows={2}
                                            className="w-full rounded-lg px-3 py-2 text-sm resize-none focus:outline-none"
                                            style={{ border: "1px solid var(--border)", background: "var(--secondary)", color: "var(--foreground)" }}
                                          />
                                          <div className="flex gap-2">
                                            <input
                                              type="date"
                                              value={taskForm.due_date}
                                              onChange={(e) => setTaskForm((prev) => ({ ...prev, due_date: e.target.value }))}
                                              className="flex-1 rounded-lg px-3 py-2 text-sm focus:outline-none"
                                              style={{ border: "1px solid var(--border)", background: "var(--secondary)", color: "var(--foreground)" }}
                                            />
                                            <select
                                              value={taskForm.assigned_to}
                                              onChange={(e) => setTaskForm((prev) => ({ ...prev, assigned_to: e.target.value }))}
                                              className="flex-1 rounded-lg px-3 py-2 text-sm focus:outline-none"
                                              style={{ border: "1px solid var(--border)", background: "var(--secondary)", color: "var(--foreground)" }}
                                            >
                                              <option value={userId ?? ""}>Me</option>
                                              {reps.filter((r) => r.id !== userId).map((r) => (
                                                <option key={r.id} value={r.id}>{r.full_name}</option>
                                              ))}
                                            </select>
                                          </div>
                                          <div className="flex gap-2">
                                            <button
                                              disabled={!taskForm.title.trim() || taskSaving}
                                              onClick={(e) => { e.stopPropagation(); saveBoardTask(brand.id, row.retailerId); }}
                                              className="px-3 py-1.5 rounded-lg text-sm font-medium disabled:opacity-50"
                                              style={{ background: "var(--foreground)", color: "var(--background)" }}
                                            >
                                              {taskSaving ? "Saving…" : "Save Task"}
                                            </button>
                                            <button
                                              onClick={(e) => { e.stopPropagation(); setTaskFormKey(null); }}
                                              className="text-sm"
                                              style={{ color: "var(--muted-foreground)" }}
                                            >
                                              Cancel
                                            </button>
                                          </div>
                                        </div>
                                      )}
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
