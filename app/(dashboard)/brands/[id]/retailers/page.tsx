"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import StatusBadge from "@/components/StatusBadge";

type Brand = { id: string; name: string };

type Retailer = {
  id: string;
  name: string;
  banner: string | null;
  channel: string | null;
  hq_region: string | null;
  store_count: number | null;
  team_owner: string | null;
  rep_owner_user_id: string | null;
};

type Role = "admin" | "rep" | "client" | null;

type AccountStatus =
  | "active_account"
  | "cultivate_does_not_rep"
  | "not_a_target_account"
  | "retailer_declined"
  | "waiting_for_retailer_to_publish_review"
  | "under_review"
  | "open_review"
  | "working_to_secure_anchor_account"
  | "upcoming_review";

type PipelineRow = {
  id?: string;
  brand_id: string;
  retailer_id: string;
  account_status: AccountStatus;
  schedule_mode: "scheduled" | "open";
  submitted_date: string | null;
  submitted_notes: string | null;
  notes: string | null;
};

type CategoryReviewRow = {
  brand_id: string;
  retailer_id: string | null;
  retailer_name: string;
  retailer_category_review_name: string | null;
  universal_department: string | null;
  universal_category: string;
  review_date: string | null;
  reset_date: string | null;
};

type AuthorizedRow = {
  authorized_item_count: number;
  authorized_upc_count: number;
};

type RecentMessage = {
  id: string;
  retailer_id: string;
  sender_name: string | null;
  body: string;
  created_at: string;
  visibility: "client" | "internal";
};

function rowKey(
  retailerName: string,
  universalCategory: string,
  reviewName: string | null
) {
  return `${retailerName}||${universalCategory}||${reviewName ?? ""}`;
}

function todayISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function addDaysISO(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function isBetweenInclusive(dateISO: string, startISO: string, endISO: string) {
  return dateISO >= startISO && dateISO <= endISO;
}

function prettyDate(value: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;

  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return prettyDate(iso);
}

function accountStatusLabel(status: AccountStatus | undefined) {
  switch (status) {
    case "active_account":
      return "Active Account";
    case "open_review":
      return "In Progress";
    case "under_review":
      return "Under Review";
    case "upcoming_review":
      return "Upcoming Review";
    case "waiting_for_retailer_to_publish_review":
      return "Awaiting Retailer Decision";
    case "working_to_secure_anchor_account":
      return "Distributor Required";
    case "not_a_target_account":
      return "Not a Target";
    case "cultivate_does_not_rep":
      return "Not Managed by Cultivate";
    case "retailer_declined":
      return "Retailer Declined";
    default:
      return "Upcoming Review";
  }
}

function reviewTypeLabel(mode: "scheduled" | "open") {
  return mode === "open" ? "Open Review" : "Scheduled Category Review";
}

function Badge({
  label,
  tone,
}: {
  label: string;
  tone: "neutral" | "good" | "warn" | "bad";
}) {
  const cls =
    tone === "good"
      ? "bg-green-100 text-green-800"
      : tone === "warn"
      ? "bg-yellow-100 text-yellow-800"
      : tone === "bad"
      ? "bg-red-100 text-red-800"
      : "bg-gray-100 text-gray-800";

  return <span className={`inline-block text-xs px-2 py-1 rounded ${cls}`}>{label}</span>;
}

const STATUS_FILTERS: Array<{ value: string; label: string }> = [
  { value: "all", label: "All Accounts" },
  { value: "in_motion", label: "In Motion" },
  { value: "active_account", label: "Active Accounts" },
  { value: "open_review", label: "In Progress" },
  { value: "under_review", label: "Under Review" },
  { value: "upcoming_review", label: "Upcoming Review" },
  { value: "waiting_for_retailer_to_publish_review", label: "Awaiting Retailer Decision" },
  { value: "working_to_secure_anchor_account", label: "Distributor Required" },
  { value: "not_a_target_account", label: "Not a Target" },
  { value: "cultivate_does_not_rep", label: "Not Managed by Cultivate" },
  { value: "retailer_declined", label: "Retailer Declined" },
  { value: "upcoming", label: "Upcoming Reviews (30d)" },
  { value: "submitted_recent", label: "Recently Submitted" },
  { value: "authorized", label: "Authorized" },
];

export default function BrandRetailersPage() {
  const params = useParams();
  const searchParams = useSearchParams();

  const brandId = (Array.isArray(params?.id) ? params?.id[0] : params?.id) as string;
  const filterFromUrl = (searchParams?.get("filter") ?? "all") as string;

  const [brand, setBrand] = useState<Brand | null>(null);
  const [retailers, setRetailers] = useState<Retailer[]>([]);
  const [pipelineMap, setPipelineMap] = useState<Record<string, PipelineRow>>({});
  const [calendarMap, setCalendarMap] = useState<Record<string, CategoryReviewRow[]>>({});
  const [authorizedMap, setAuthorizedMap] = useState<Record<string, AuthorizedRow>>({});
  const [messagesMap, setMessagesMap] = useState<Record<string, RecentMessage[]>>({});
  const [role, setRole] = useState<Role>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [dateOverrides, setDateOverrides] = useState<Record<string, { review_date: string | null; reset_date: string | null }>>({});
  const [pendingDateEdits, setPendingDateEdits] = useState<Record<string, { review_date?: string | null; reset_date?: string | null }>>({});
  const [status, setStatus] = useState("");
  const [query, setQuery] = useState("");
  const [selectedFilter, setSelectedFilter] = useState(filterFromUrl);
  const [selectedRep, setSelectedRep] = useState("all");

  const isRepOrAdmin = role === "admin" || role === "rep";

  useEffect(() => {
    setSelectedFilter(filterFromUrl);
  }, [filterFromUrl]);

  useEffect(() => {
    if (!brandId) return;

    async function load() {
      setStatus("");

      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError) {
        setStatus(authError.message);
        return;
      }

      const userId = authData?.user?.id;
      setUserId(userId ?? null);
      let resolvedRole: Role = "client";
      if (userId) {
        const { data: profileData, error: profileError } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", userId)
          .maybeSingle();

        if (profileError) {
          setStatus(profileError.message);
          return;
        }

        resolvedRole = (profileData?.role as Role) ?? "client";
        setRole(resolvedRole);
      }

      const { data: brandData, error: brandError } = await supabase
        .from("brands")
        .select("id,name")
        .eq("id", brandId)
        .single();

      if (brandError) {
        setStatus(brandError.message);
        return;
      }
      setBrand(brandData);

      const { data: retailerData, error: retailerError } = await supabase
        .from("retailers")
        .select("id,name,banner,channel,hq_region,store_count,team_owner,rep_owner_user_id")
        .order("banner", { ascending: true });

      if (retailerError) {
        setStatus(retailerError.message);
        return;
      }
      setRetailers((retailerData as Retailer[]) ?? []);

      const { data: pipelineData, error: pipelineError } = await supabase
        .from("brand_retailer_timing")
        .select("id,brand_id,retailer_id,account_status,schedule_mode,submitted_date,submitted_notes,notes")
        .eq("brand_id", brandId);

      if (pipelineError) {
        setStatus(pipelineError.message);
        return;
      }

      const nextPipelineMap: Record<string, PipelineRow> = {};
      (pipelineData ?? []).forEach((row: any) => {
        nextPipelineMap[row.retailer_id] = {
          id: row.id,
          brand_id: row.brand_id,
          retailer_id: row.retailer_id,
          account_status: (row.account_status ?? "upcoming_review") as AccountStatus,
          schedule_mode: (row.schedule_mode ?? "open") as "scheduled" | "open",
          submitted_date: row.submitted_date ?? null,
          submitted_notes: row.submitted_notes ?? null,
          notes: row.notes ?? null,
        };
      });
      setPipelineMap(nextPipelineMap);

      const { data: calendarData, error: calendarError } = await supabase
        .from("brand_category_review_view")
        .select(
          "brand_id,retailer_id,retailer_name,retailer_category_review_name,universal_department,universal_category,review_date,reset_date"
        )
        .eq("brand_id", brandId);

      if (calendarError) {
        setStatus(calendarError.message);
        return;
      }

      const nextCalendarMap: Record<string, CategoryReviewRow[]> = {};
      ((calendarData as CategoryReviewRow[]) ?? []).forEach((row) => {
        if (!row.retailer_id) return;
        if (!nextCalendarMap[row.retailer_id]) nextCalendarMap[row.retailer_id] = [];
        nextCalendarMap[row.retailer_id].push(row);
      });

      Object.keys(nextCalendarMap).forEach((retailerId) => {
        nextCalendarMap[retailerId].sort((a, b) => {
          const aDate = a.review_date || a.reset_date || "";
          const bDate = b.review_date || b.reset_date || "";
          return aDate.localeCompare(bDate);
        });
      });

      setCalendarMap(nextCalendarMap);

      const { data: overrideData } = await supabase
        .from("brand_category_review_date_overrides")
        .select(
          "retailer_name,universal_category,retailer_category_review_name,review_date,reset_date"
        )
        .eq("brand_id", brandId);

      const overrideMap: Record<string, { review_date: string | null; reset_date: string | null }> = {};
      ((overrideData ?? []) as any[]).forEach((o) => {
        overrideMap[rowKey(o.retailer_name, o.universal_category, o.retailer_category_review_name)] = {
          review_date: o.review_date ?? null,
          reset_date: o.reset_date ?? null,
        };
      });
      setDateOverrides(overrideMap);
      setPendingDateEdits({});

      const { data: authorizedData, error: authorizedError } = await supabase
        .from("authorized_accounts_with_brand_id")
        .select("retailer_id,authorized_item_count,authorized_upc_count")
        .eq("brand_id", brandId);

      if (authorizedError) {
        setStatus(authorizedError.message);
        return;
      }

      const nextAuthorizedMap: Record<string, AuthorizedRow> = {};
      (authorizedData ?? []).forEach((row: any) => {
        nextAuthorizedMap[row.retailer_id] = {
          authorized_item_count: row.authorized_item_count ?? 0,
          authorized_upc_count: row.authorized_upc_count ?? 0,
        };
      });

      setAuthorizedMap(nextAuthorizedMap);

      // Load recent messages per retailer — admin/rep see both visibility types
      const isAdminOrRep = resolvedRole === "admin" || resolvedRole === "rep";
      let msgsQuery = supabase
        .from("brand_retailer_messages")
        .select("id,retailer_id,sender_name,body,created_at,visibility")
        .eq("brand_id", brandId)
        .order("created_at", { ascending: false });

      if (!isAdminOrRep) {
        msgsQuery = msgsQuery.eq("visibility", "client");
      } else {
        msgsQuery = msgsQuery.in("visibility", ["client", "internal"]);
      }

      const { data: messagesData } = await msgsQuery;

      const nextMessagesMap: Record<string, RecentMessage[]> = {};
      ((messagesData ?? []) as RecentMessage[]).forEach((m) => {
        if (!nextMessagesMap[m.retailer_id]) nextMessagesMap[m.retailer_id] = [];
        if (nextMessagesMap[m.retailer_id].length < 4) {
          nextMessagesMap[m.retailer_id].push(m);
        }
      });
      setMessagesMap(nextMessagesMap);
    }

    load();
  }, [brandId]);

  const repOptions = useMemo(() => {
    return Array.from(
      new Set(retailers.map((r) => r.team_owner).filter((v): v is string => !!v && v.trim() !== ""))
    ).sort((a, b) => a.localeCompare(b));
  }, [retailers]);

  function defaultPipelineRow(retailerId: string): PipelineRow {
    return {
      brand_id: brandId,
      retailer_id: retailerId,
      account_status: "upcoming_review",
      schedule_mode: "open",
      submitted_date: null,
      submitted_notes: null,
      notes: null,
    };
  }

  function updateLocal(retailerId: string, patch: Partial<PipelineRow>) {
    setPipelineMap((prev) => {
      const current = prev[retailerId] ?? defaultPipelineRow(retailerId);
      return { ...prev, [retailerId]: { ...current, ...patch } };
    });
  }

  function updateDateEdit(key: string, field: "review_date" | "reset_date", value: string | null) {
    setPendingDateEdits((prev) => ({
      ...prev,
      [key]: { ...prev[key], [field]: value },
    }));
  }

  async function save(retailerId: string) {
    const row = pipelineMap[retailerId] ?? defaultPipelineRow(retailerId);
    setStatus("Saving…");

    const payload = {
      brand_id: brandId,
      retailer_id: retailerId,
      account_status: row.account_status,
      schedule_mode: row.schedule_mode,
      submitted_date: row.submitted_date,
      submitted_notes: row.submitted_notes,
      notes: row.notes,
    };

    const { error } = await supabase
      .from("brand_retailer_timing")
      .upsert(payload, { onConflict: "brand_id,retailer_id" });

    if (error) {
      setStatus(error.message);
      return;
    }

    // Save any pending date overrides for this retailer's category review rows
    const reviewRows = calendarMap[retailerId] ?? [];
    const savedKeys: string[] = [];

    for (const review of reviewRows) {
      const key = rowKey(review.retailer_name, review.universal_category, review.retailer_category_review_name);
      const pending = pendingDateEdits[key];
      if (!pending) continue;

      const existing = dateOverrides[key];
      const patch = {
        brand_id: brandId,
        retailer_name: review.retailer_name,
        retailer_id: review.retailer_id ?? null,
        universal_category: review.universal_category,
        retailer_category_review_name: review.retailer_category_review_name ?? "",
        updated_by_user_id: userId,
        updated_at: new Date().toISOString(),
        review_date: "review_date" in pending
          ? pending.review_date ?? null
          : (existing?.review_date ?? review.review_date ?? null),
        reset_date: "reset_date" in pending
          ? pending.reset_date ?? null
          : (existing?.reset_date ?? review.reset_date ?? null),
      };

      const { error: overrideError } = await supabase
        .from("brand_category_review_date_overrides")
        .upsert(patch, {
          onConflict: "brand_id,retailer_name,universal_category,retailer_category_review_name",
        });

      if (overrideError) {
        setStatus(overrideError.message);
        return;
      }

      savedKeys.push(key);
      setDateOverrides((prev) => ({
        ...prev,
        [key]: { review_date: patch.review_date, reset_date: patch.reset_date },
      }));
    }

    if (savedKeys.length > 0) {
      setPendingDateEdits((prev) => {
        const next = { ...prev };
        savedKeys.forEach((k) => delete next[k]);
        return next;
      });
    }

    setStatus("Saved ✅");
  }

  function authorizedSummary(authorized?: AuthorizedRow) {
    if (!authorized) return "No authorized items";
    return `${authorized.authorized_item_count} items • ${authorized.authorized_upc_count} UPCs`;
  }

  const brandName = useMemo(() => brand?.name ?? "Brand", [brand]);

  const filteredRetailers = useMemo(() => {
    const t = todayISO();
    const next30 = addDaysISO(t, 30);
    const prev30 = addDaysISO(t, -30);
    const q = query.trim().toLowerCase();

    function matchesFilter(r: Retailer): boolean {
      const row = pipelineMap[r.id] ?? defaultPipelineRow(r.id);
      const calendarRows = calendarMap[r.id] ?? [];
      const nextReview = calendarRows.find((entry) => !!entry.review_date);
      const authorized = authorizedMap[r.id];

      if (selectedFilter === "all") return true;
      if (selectedFilter === "in_motion") {
  return (
    row.account_status === "open_review" ||
    row.account_status === "under_review" ||
    row.account_status === "waiting_for_retailer_to_publish_review"
  );
}

      if (selectedFilter === "upcoming") {
        return (
          row.schedule_mode === "scheduled" &&
          !row.submitted_date &&
          !!nextReview?.review_date &&
          isBetweenInclusive(nextReview.review_date, t, next30)
        );
      }

      if (selectedFilter === "submitted_recent") {
        return !!row.submitted_date && isBetweenInclusive(row.submitted_date, prev30, t);
      }

      if (selectedFilter === "authorized") {
        return !!authorized;
      }

      if (
        selectedFilter === "active_account" ||
        selectedFilter === "cultivate_does_not_rep" ||
        selectedFilter === "not_a_target_account" ||
        selectedFilter === "retailer_declined" ||
        selectedFilter === "waiting_for_retailer_to_publish_review" ||
        selectedFilter === "under_review" ||
        selectedFilter === "open_review" ||
        selectedFilter === "working_to_secure_anchor_account" ||
        selectedFilter === "upcoming_review"
      ) {
        return row.account_status === selectedFilter;
      }

      return true;
    }

    function matchesSearch(r: Retailer): boolean {
      if (!q) return true;

      const banner = (r.banner ?? "").toLowerCase();
      const parent = (r.name ?? "").toLowerCase();
      const channel = (r.channel ?? "").toLowerCase();
      const region = (r.hq_region ?? "").toLowerCase();
      const repOwner = (r.team_owner ?? "").toLowerCase();

      return (
        banner.includes(q) ||
        parent.includes(q) ||
        channel.includes(q) ||
        region.includes(q) ||
        repOwner.includes(q)
      );
    }

    function matchesRep(r: Retailer): boolean {
      if (selectedRep === "all") return true;
      return (r.team_owner ?? "") === selectedRep;
    }

    return retailers.filter((r) => matchesFilter(r) && matchesSearch(r) && matchesRep(r));
  }, [retailers, pipelineMap, calendarMap, authorizedMap, selectedFilter, query, selectedRep]);

  return (
    <div className="p-6 space-y-6">
      <div>
        <Link className="underline text-sm" href={`/brands/${brandId}`} style={{ color: "var(--muted-foreground)" }}>
          ← Back to Brand
        </Link>
        <h1 className="text-3xl font-bold mt-2" style={{ color: "var(--foreground)" }}>{brandName} — Retailers</h1>
        <div className="text-sm mt-1" style={{ color: "var(--muted-foreground)" }}>
          Showing <span className="font-semibold">{filteredRetailers.length}</span> of{" "}
          <span className="font-semibold">{retailers.length}</span> retailers
        </div>
        {status && <p className="mt-2 text-sm text-red-600">{status}</p>}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <input
          className="rounded-lg px-3 py-2 w-full text-sm focus:outline-none focus:ring-2"
          style={{ border: "1px solid var(--border)", background: "var(--card)", color: "var(--foreground)" }}
          placeholder="Search banner, parent company, channel, region, rep…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        <select
          className="rounded-lg px-3 py-2 w-full text-sm"
          style={{ border: "1px solid var(--border)", background: "var(--card)", color: "var(--foreground)" }}
          value={selectedFilter}
          onChange={(e) => setSelectedFilter(e.target.value)}
        >
          {STATUS_FILTERS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        <select
          className="rounded-lg px-3 py-2 w-full text-sm"
          style={{ border: "1px solid var(--border)", background: "var(--card)", color: "var(--foreground)" }}
          value={selectedRep}
          onChange={(e) => setSelectedRep(e.target.value)}
        >
          <option value="all">All Reps</option>
          {repOptions.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </div>

      {filteredRetailers.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>No retailers match your search or filter.</p>
      ) : (
        <div className="space-y-4">
          {filteredRetailers.map((r) => {
            const row = pipelineMap[r.id] ?? defaultPipelineRow(r.id);
            const headline = r.banner?.trim() ? r.banner : r.name;
            const reviewRows = calendarMap[r.id] ?? [];
            const authorized = authorizedMap[r.id];
            const hasLegacyNotes = !!row.notes?.trim();
            const recentMsgs = messagesMap[r.id] ?? [];
            const hasMoreMessages = recentMsgs.length === 4;
            const displayMsgs = recentMsgs.slice(0, 3).reverse();

            return (
              <div
                key={r.id}
                className="rounded-xl p-5 space-y-4"
                style={{ border: "1px solid var(--border)", background: "var(--card)" }}
              >
                {/* Header */}
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="font-bold text-xl" style={{ color: "var(--foreground)" }}>
                        {headline}
                      </span>
                      <StatusBadge status={row.account_status} />
                    </div>
                    {r.banner ? (
                      <div className="text-sm" style={{ color: "var(--muted-foreground)" }}>{r.name}</div>
                    ) : null}
                    <div className="text-sm flex flex-wrap gap-x-3 gap-y-1" style={{ color: "var(--muted-foreground)" }}>
                      {r.channel ? <span>{r.channel}</span> : null}
                      {r.hq_region ? <span>{r.hq_region}</span> : null}
                      {typeof r.store_count === "number" ? <span>{r.store_count} stores</span> : null}
                      <span>{reviewTypeLabel(row.schedule_mode)}</span>
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-2 shrink-0">
                    {authorized ? (
                      <Badge
                        label={`Authorized • ${authorized.authorized_item_count} items`}
                        tone="good"
                      />
                    ) : null}
                    <Link
                      className="text-xs underline"
                      style={{ color: "var(--muted-foreground)" }}
                      href={`/brands/${brandId}/retailers/${r.id}`}
                    >
                      Open →
                    </Link>
                  </div>
                </div>

                {/* Meta grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                  <div className="rounded-lg p-3" style={{ border: "1px solid var(--border)", background: "var(--muted)" }}>
                    <div className="text-xs mb-1" style={{ color: "var(--muted-foreground)" }}>Rep Owner</div>
                    <div className="font-medium" style={{ color: "var(--foreground)" }}>{r.team_owner || "Unassigned"}</div>
                  </div>

                  <div className="rounded-lg p-3" style={{ border: "1px solid var(--border)", background: "var(--muted)" }}>
                    <div className="text-xs mb-1" style={{ color: "var(--muted-foreground)" }}>Authorized Items</div>
                    <div className="font-medium" style={{ color: "var(--foreground)" }}>{authorizedSummary(authorized)}</div>
                  </div>
                </div>

                {/* Recent messages — omit entirely if none */}
                {displayMsgs.length > 0 && (
                  <div className="space-y-1">
                    {displayMsgs.map((m) => (
                      <div
                        key={m.id}
                        className="flex items-baseline gap-2 rounded-md px-2 py-1.5 text-sm"
                        style={{ background: "var(--muted)" }}
                      >
                        <span
                          className="shrink-0 text-xs font-medium"
                          style={{ color: "var(--muted-foreground)" }}
                        >
                          {m.sender_name ?? "Cultivate"}
                        </span>
                        {m.visibility === "internal" && (
                          <span
                            className="shrink-0 text-xs rounded px-1"
                            style={{
                              background: "var(--accent)",
                              color: "var(--muted-foreground)",
                              fontSize: "0.65rem",
                            }}
                          >
                            internal
                          </span>
                        )}
                        <span
                          className="min-w-0 flex-1 truncate"
                          style={{ color: "var(--foreground)" }}
                        >
                          {m.body}
                        </span>
                        <span
                          className="shrink-0 text-xs"
                          style={{ color: "var(--muted-foreground)" }}
                        >
                          {timeAgo(m.created_at)}
                        </span>
                      </div>
                    ))}
                    {hasMoreMessages && (
                      <Link
                        href={`/brands/${brandId}/retailers/${r.id}`}
                        className="block text-xs pt-0.5 pl-2"
                        style={{ color: "var(--muted-foreground)" }}
                      >
                        View all →
                      </Link>
                    )}
                  </div>
                )}

                {/* Account status dropdown (rep/admin only) */}
                {isRepOrAdmin && (
                  <div>
                    <div className="text-xs mb-1" style={{ color: "var(--muted-foreground)" }}>Change Account Status</div>
                    <select
                      className="border rounded-lg px-3 py-2 w-full text-sm"
                      style={{ borderColor: "var(--border)", background: "var(--card)", color: "var(--foreground)" }}
                      value={row.account_status}
                      onChange={(e) =>
                        updateLocal(r.id, {
                          account_status: e.target.value as AccountStatus,
                        })
                      }
                    >
                      <option value="active_account">Active Account</option>
                      <option value="open_review">In Progress</option>
                      <option value="under_review">Under Review</option>
                      <option value="working_to_secure_anchor_account">Distributor Required</option>
                      <option value="waiting_for_retailer_to_publish_review">Awaiting Retailer Decision</option>
                      <option value="upcoming_review">Upcoming Review</option>
                      <option value="cultivate_does_not_rep">Not Managed by Cultivate</option>
                      <option value="not_a_target_account">Not a Target</option>
                      <option value="retailer_declined">Retailer Declined</option>
                    </select>
                  </div>
                )}

                {/* Category Review Timing */}
                <div
                  className="rounded-lg p-3 space-y-3"
                  style={{ border: "1px solid var(--border)" }}
                >
                  <div className="text-sm font-medium" style={{ color: "var(--foreground)" }}>
                    Category Review Timing
                  </div>

                  {reviewRows.length === 0 ? (
                    <div className="text-sm" style={{ color: "var(--muted-foreground)" }}>
                      No scheduled category reviews.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {reviewRows.map((review, idx) => {
                        const rk = rowKey(review.retailer_name, review.universal_category, review.retailer_category_review_name);
                        const pending = pendingDateEdits[rk];
                        const effectiveReviewDate =
                          pending && "review_date" in pending
                            ? (pending.review_date ?? "")
                            : (dateOverrides[rk]?.review_date ?? review.review_date ?? "");
                        const effectiveResetDate =
                          pending && "reset_date" in pending
                            ? (pending.reset_date ?? "")
                            : (dateOverrides[rk]?.reset_date ?? review.reset_date ?? "");
                        return (
                        <div
                          key={`${review.retailer_name}-${review.universal_category}-${review.retailer_category_review_name ?? "none"}-${idx}`}
                          className="rounded-lg p-3"
                          style={{ border: "1px solid var(--border)", background: "var(--muted)" }}
                        >
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                            <div>
                              <div className="text-xs mb-1" style={{ color: "var(--muted-foreground)" }}>
                                Retailer Review Name
                              </div>
                              <div className="font-medium" style={{ color: "var(--foreground)" }}>
                                {review.retailer_category_review_name || "—"}
                              </div>
                            </div>
                            <div>
                              <div className="text-xs mb-1" style={{ color: "var(--muted-foreground)" }}>
                                Universal Category
                              </div>
                              <div className="font-medium" style={{ color: "var(--foreground)" }}>
                                {review.universal_category}
                              </div>
                            </div>
                            <div>
                              <div className="text-xs mb-1" style={{ color: "var(--muted-foreground)" }}>
                                Review Date
                              </div>
                              {isRepOrAdmin ? (
                                <input
                                  type="date"
                                  className="border rounded-lg px-3 py-2 w-full text-sm"
                                  style={{ borderColor: "var(--border)", background: "var(--card)", color: "var(--foreground)" }}
                                  value={effectiveReviewDate}
                                  onChange={(e) => updateDateEdit(rk, "review_date", e.target.value || null)}
                                />
                              ) : (
                                <div className="font-medium" style={{ color: "var(--foreground)" }}>
                                  {prettyDate(effectiveReviewDate || null)}
                                </div>
                              )}
                            </div>
                            <div>
                              <div className="text-xs mb-1" style={{ color: "var(--muted-foreground)" }}>
                                Reset Date
                              </div>
                              {isRepOrAdmin ? (
                                <input
                                  type="date"
                                  className="border rounded-lg px-3 py-2 w-full text-sm"
                                  style={{ borderColor: "var(--border)", background: "var(--card)", color: "var(--foreground)" }}
                                  value={effectiveResetDate}
                                  onChange={(e) => updateDateEdit(rk, "reset_date", e.target.value || null)}
                                />
                              ) : (
                                <div className="font-medium" style={{ color: "var(--foreground)" }}>
                                  {prettyDate(effectiveResetDate || null)}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Submission tracking (rep/admin only) */}
                {isRepOrAdmin && (
                  <div
                    className="rounded-lg p-3"
                    style={{ border: "1px solid var(--border)" }}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <label className="text-sm font-medium flex items-center gap-2" style={{ color: "var(--foreground)" }}>
                        <input
                          type="checkbox"
                          checked={!!row.submitted_date}
                          onChange={(e) =>
                            updateLocal(r.id, {
                              submitted_date: e.target.checked ? todayISO() : null,
                            })
                          }
                        />
                        Submitted to retailer
                      </label>
                      <div className="text-sm" style={{ color: "var(--muted-foreground)" }}>
                        {row.submitted_date ? `Date: ${prettyDate(row.submitted_date)}` : "Not submitted"}
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <div className="text-xs mb-1" style={{ color: "var(--muted-foreground)" }}>Submitted Date</div>
                        <input
                          type="date"
                          className="border rounded-lg px-3 py-2 w-full text-sm"
                          style={{ borderColor: "var(--border)", background: "var(--card)", color: "var(--foreground)" }}
                          value={row.submitted_date ?? ""}
                          onChange={(e) =>
                            updateLocal(r.id, { submitted_date: e.target.value || null })
                          }
                        />
                      </div>
                      <div>
                        <div className="text-xs mb-1" style={{ color: "var(--muted-foreground)" }}>Submitted Notes</div>
                        <input
                          className="border rounded-lg px-3 py-2 w-full text-sm"
                          style={{ borderColor: "var(--border)", background: "var(--card)", color: "var(--foreground)" }}
                          value={row.submitted_notes ?? ""}
                          onChange={(e) =>
                            updateLocal(r.id, { submitted_notes: e.target.value || null })
                          }
                          placeholder="Optional"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {hasLegacyNotes ? (
                  <div>
                    <div className="text-xs mb-1" style={{ color: "var(--muted-foreground)" }}>Legacy Notes</div>
                    <textarea
                      className="border rounded-lg px-3 py-2 w-full text-sm"
                      style={{ borderColor: "var(--border)", background: "var(--card)", color: "var(--foreground)" }}
                      rows={3}
                      value={row.notes ?? ""}
                      onChange={(e) => updateLocal(r.id, { notes: e.target.value || null })}
                    />
                  </div>
                ) : null}

                {isRepOrAdmin ? (
                  <button
                    className="px-4 py-2 rounded-lg text-sm font-medium"
                    style={{ background: "var(--foreground)", color: "var(--background)" }}
                    onClick={() => save(r.id)}
                  >
                    Save Changes
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}