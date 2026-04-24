"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Brand = { id: string; name: string };

type PipelineStatus =
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
  id: string;
  retailer_id: string;
  account_status: PipelineStatus;
  schedule_mode: "scheduled" | "open";
  submitted_date: string | null;
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

type Retailer = { id: string; name: string; banner: string | null };

type AuthorizedRow = {
  retailer_id: string;
  retailer_name: string | null;
  authorized_item_count: number;
  authorized_upc_count: number;
};

type ManualTimingRow = {
  id: string;
  retailer_id: string;
  category: string | null;
  category_review_date: string | null;
  reset_date: string | null;
};

type MsgSummary = {
  count: number;
  latest_at: string | null;
  latest_sender: string | null;
};

// ─── helpers ───────────────────────────────────────────────────────────────

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDaysISO(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function isBetweenInclusive(dateISO: string, startISO: string, endISO: string) {
  return dateISO >= startISO && dateISO <= endISO;
}

function prettyDate(value: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function relativeTime(ts: string) {
  const mins = Math.floor((Date.now() - new Date(ts).getTime()) / 60000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  const days = Math.floor(mins / 1440);
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function statusLabel(status: PipelineStatus) {
  switch (status) {
    case "active_account": return "Active Account";
    case "open_review": return "In Progress";
    case "under_review": return "Under Review";
    case "working_to_secure_anchor_account": return "Distributor Required";
    case "waiting_for_retailer_to_publish_review": return "Awaiting Retailer Decision";
    case "upcoming_review": return "Upcoming Review";
    case "not_a_target_account": return "Not a Target";
    case "cultivate_does_not_rep": return "Not Managed by Cultivate";
    case "retailer_declined": return "Retailer Declined";
    default: return status;
  }
}

function isInMotion(status: PipelineStatus) {
  return (
    status === "open_review" ||
    status === "under_review" ||
    status === "waiting_for_retailer_to_publish_review"
  );
}

function nDaysAgoISO(n: number) {
  return new Date(Date.now() - n * 86400000).toISOString();
}

// ─── page ──────────────────────────────────────────────────────────────────

export default function BrandDashboardPage() {
  const params = useParams();
  const idParam = params?.id;
  const brandId = Array.isArray(idParam) ? idParam[0] : idParam;

  const happeningRef = useRef<HTMLDivElement>(null);

  const [brand, setBrand] = useState<Brand | null>(null);
  const [pipelineRows, setPipelineRows] = useState<PipelineRow[]>([]);
  const [calendarRows, setCalendarRows] = useState<CategoryReviewRow[]>([]);
  const [manualTimingRows, setManualTimingRows] = useState<ManualTimingRow[]>([]);
  const [authorizedRows, setAuthorizedRows] = useState<AuthorizedRow[]>([]);
  const [retailersById, setRetailersById] = useState<Record<string, Retailer>>({});
  const [error, setError] = useState("");

  // new state
  const [repName, setRepName] = useState<string | null>(null);
  const [activityBannerCount, setActivityBannerCount] = useState(0);
  const [bannerSubtext, setBannerSubtext] = useState("");
  const [messagesByRetailer, setMessagesByRetailer] = useState<Record<string, MsgSummary>>({});
  const [recentOnlyFilter, setRecentOnlyFilter] = useState(false);

  useEffect(() => {
    if (!brandId) return;

    async function load() {
      setError("");

      const { data: brandData, error: brandError } = await supabase
        .from("brands")
        .select("id,name")
        .eq("id", brandId)
        .maybeSingle();

      if (brandError) { setError(brandError.message); return; }
      if (!brandData) { setError("Brand not found."); return; }
      setBrand(brandData);

      const [pipelineResponse, calendarResponse, authorizedResponse, msgsResponse, manualTimingResponse] =
        await Promise.all([
          supabase
            .from("brand_retailer_timing")
            .select("id,retailer_id,account_status,schedule_mode,submitted_date,notes")
            .eq("brand_id", brandId),
          supabase
            .from("brand_category_review_view")
            .select(
              "brand_id,retailer_id,retailer_name,retailer_category_review_name,universal_department,universal_category,review_date,reset_date"
            )
            .eq("brand_id", brandId),
          supabase
            .from("authorized_accounts_with_brand_id")
            .select("retailer_id,retailer_name,authorized_item_count,authorized_upc_count")
            .eq("brand_id", brandId),
          supabase
            .from("brand_retailer_messages")
            .select("id,retailer_id,created_at,sender_name,visibility")
            .eq("brand_id", brandId)
            .eq("visibility", "client")
            .order("created_at", { ascending: false }),
          supabase
            .from("brand_retailer_category_timing")
            .select("id,retailer_id,category,category_review_date,reset_date")
            .eq("brand_id", brandId),
        ]);

      if (pipelineResponse.error) { setError(pipelineResponse.error.message); return; }
      if (calendarResponse.error) { setError(calendarResponse.error.message); return; }
      if (authorizedResponse.error) { setError(authorizedResponse.error.message); return; }

      const nextPipelineRows = (pipelineResponse.data as PipelineRow[]) ?? [];
      const nextCalendarRows = (calendarResponse.data as CategoryReviewRow[]) ?? [];
      const nextAuthorizedRows = (authorizedResponse.data as AuthorizedRow[]) ?? [];
      const nextManualTimingRows = (manualTimingResponse.data as ManualTimingRow[]) ?? [];
      const allMsgs = (msgsResponse.data ?? []) as {
        id: string;
        retailer_id: string;
        created_at: string;
        sender_name: string | null;
        visibility: string;
      }[];

      setPipelineRows(nextPipelineRows);
      setCalendarRows(nextCalendarRows);
      setManualTimingRows(nextManualTimingRows);
      setAuthorizedRows(nextAuthorizedRows);

      // ── activity banner ──────────────────────────────────────────────────
      const sevenDaysAgo = nDaysAgoISO(7);
      const recentMsgs = allMsgs.filter((m) => m.created_at >= sevenDaysAgo);
      setActivityBannerCount(recentMsgs.length);

      if (recentMsgs.length > 0) {
        const uniqueSenders = [
          ...new Set(recentMsgs.map((m) => m.sender_name).filter(Boolean)),
        ] as string[];
        const retailersUpdated = new Set(recentMsgs.map((m) => m.retailer_id)).size;
        const senderStr =
          uniqueSenders.length === 0 ? "Your team" :
          uniqueSenders.length === 1 ? uniqueSenders[0] :
          uniqueSenders.length === 2 ? `${uniqueSenders[0]} and ${uniqueSenders[1]}` :
          `${uniqueSenders[0]}, ${uniqueSenders[1]} and ${uniqueSenders.length - 2} more`;
        setBannerSubtext(
          `${senderStr} updated ${retailersUpdated} retailer${retailersUpdated !== 1 ? "s" : ""}`
        );
      }

      // ── per-retailer message summary ─────────────────────────────────────
      const byRetailer: Record<string, MsgSummary> = {};
      allMsgs.forEach((m) => {
        if (!byRetailer[m.retailer_id]) {
          byRetailer[m.retailer_id] = { count: 0, latest_at: null, latest_sender: null };
        }
        byRetailer[m.retailer_id].count += 1;
        // messages are already ordered newest-first, so first one encountered is latest
        if (!byRetailer[m.retailer_id].latest_at) {
          byRetailer[m.retailer_id].latest_at = m.created_at;
          byRetailer[m.retailer_id].latest_sender = m.sender_name;
        }
      });
      setMessagesByRetailer(byRetailer);

      // ── retailer name map ─────────────────────────────────────────────────
      const retailerIds = [
        ...new Set([
          ...nextPipelineRows.map((r) => r.retailer_id).filter(Boolean),
          ...((nextCalendarRows.map((r) => r.retailer_id).filter(Boolean) as string[]) ?? []),
          ...nextAuthorizedRows.map((r) => r.retailer_id).filter(Boolean),
          ...nextManualTimingRows.map((r) => r.retailer_id).filter(Boolean),
        ]),
      ];

      if (retailerIds.length > 0) {
        const { data: retailerData, error: retailerError } = await supabase
          .from("retailers")
          .select("id,name,banner")
          .in("id", retailerIds);
        if (!retailerError) {
          const map: Record<string, Retailer> = {};
          (retailerData as Retailer[]).forEach((r) => { map[r.id] = r; });
          setRetailersById(map);
        }
      }

      // ── account lead (best-effort; falls back gracefully if column absent) ─
      const repRow = (nextPipelineRows as (PipelineRow & { assigned_rep?: string })[])
        .filter((r) => (r as any).assigned_rep)
        .sort((a, b) => (b.submitted_date || "").localeCompare(a.submitted_date || ""))[0];
      if (repRow?.assigned_rep) {
        const { data: repProfile } = await supabase
          .from("profiles")
          .select("full_name")
          .eq("id", repRow.assigned_rep)
          .single();
        setRepName(repProfile?.full_name ?? null);
      }
    }

    load();
  }, [brandId]);

  // ── derived data ──────────────────────────────────────────────────────────

  const summary = useMemo(() => {
    const today = todayISO();
    const prev30 = addDaysISO(today, -30);
    const next30 = addDaysISO(today, 30);
    let upcomingReviews = 0;
    let inMotion = 0;
    let activeAccounts = 0;
    calendarRows.forEach((r) => {
      if (r.review_date && isBetweenInclusive(r.review_date, prev30, next30)) upcomingReviews++;
    });
    manualTimingRows.forEach((r) => {
      if (r.category_review_date && isBetweenInclusive(r.category_review_date, prev30, next30)) upcomingReviews++;
    });
    pipelineRows.forEach((r) => {
      if (isInMotion(r.account_status)) inMotion++;
      if (r.account_status === "active_account") activeAccounts++;
    });
    return { upcomingReviews, inMotion, activeAccounts };
  }, [pipelineRows, calendarRows, manualTimingRows]);

  // Distinct retailers with at least one client-visible message in the last 7 days
  const recentRetailerCount = useMemo(() => {
    const sevenDaysAgo = nDaysAgoISO(7);
    return Object.values(messagesByRetailer).filter(
      (v) => v.latest_at && v.latest_at >= sevenDaysAgo
    ).length;
  }, [messagesByRetailer]);

  type ReviewActivityItem = {
    key: string;
    retailer_name: string;
    category_label: string;
    date: string;
    retailer_id: string | null;
  };

  const upcomingList = useMemo(() => {
    const today = todayISO();
    const prev30 = addDaysISO(today, -30);
    const next30 = addDaysISO(today, 30);

    const calendarItems: ReviewActivityItem[] = calendarRows
      .filter((r) => !!r.review_date && isBetweenInclusive(r.review_date, prev30, next30))
      .map((r) => ({
        key: `cal-${r.retailer_name}-${r.universal_category}-${r.review_date}`,
        retailer_name: r.retailer_name,
        category_label: r.retailer_category_review_name || r.universal_category,
        date: r.review_date!,
        retailer_id: r.retailer_id,
      }));

    const manualItems: ReviewActivityItem[] = manualTimingRows
      .filter((r) => !!r.category_review_date && isBetweenInclusive(r.category_review_date, prev30, next30))
      .map((r) => ({
        key: `manual-${r.id}`,
        retailer_name: retailersById[r.retailer_id]?.name ?? "Retailer",
        category_label: r.category || "Category Review",
        date: r.category_review_date!,
        retailer_id: r.retailer_id,
      }));

    return [...calendarItems, ...manualItems]
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 8);
  }, [calendarRows, manualTimingRows, retailersById]);

  const recentWorkflow = useMemo(() => {
    const sevenDaysAgo = nDaysAgoISO(7);
    const twentyOneDaysAgo = nDaysAgoISO(21);

    function getLatest(row: PipelineRow) {
      return messagesByRetailer[row.retailer_id]?.latest_at || row.submitted_date || "";
    }

    function sortPriority(row: PipelineRow) {
      const latest = getLatest(row);
      if (!latest || latest < twentyOneDaysAgo) return 3; // stale
      if (latest >= sevenDaysAgo) return 1;               // recent
      return 2;                                            // moderate
    }

    return [...pipelineRows]
      .filter((r) => r.submitted_date || r.notes || messagesByRetailer[r.retailer_id])
      .sort((a, b) => {
        const pa = sortPriority(a);
        const pb = sortPriority(b);
        if (pa !== pb) return pa - pb;
        return getLatest(b).localeCompare(getLatest(a));
      })
      .slice(0, 8);
  }, [pipelineRows, messagesByRetailer]);

  const displayWorkflow = useMemo(() => {
    if (!recentOnlyFilter) return recentWorkflow;
    const sevenDaysAgo = nDaysAgoISO(7);
    // Filter by message date only — must match what recentRetailerCount counts
    return recentWorkflow.filter((row) => {
      const msgLatest = messagesByRetailer[row.retailer_id]?.latest_at ?? "";
      return msgLatest >= sevenDaysAgo;
    });
  }, [recentWorkflow, recentOnlyFilter, messagesByRetailer]);

  const topAuthorized = useMemo(() => {
    return [...authorizedRows]
      .sort((a, b) => (b.authorized_item_count || 0) - (a.authorized_item_count || 0))
      .slice(0, 8);
  }, [authorizedRows]);

  if (!brandId) return <div className="p-6">No brand ID in URL.</div>;

  return (
    <div className="p-6 space-y-6">
      <Link href="/brands" className="underline text-sm">← Back to Brands</Link>

      {/* ── header ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold mt-2">{brand?.name ?? "Brand"}</h1>
          <p className="text-gray-500 mt-1 text-sm">
            Brand dashboard
            {repName ? (
              <>
                {" · "}
                <span className="font-medium text-gray-700">{repName}</span>
                {" is your account lead"}
              </>
            ) : null}
          </p>
          {error ? <div className="text-red-600 text-sm mt-2">{error}</div> : null}
        </div>

        <div className="flex gap-2 text-sm flex-wrap">
          <Link
            href={`/brands/${brandId}/retailers`}
            className="inline-block px-4 py-2 rounded border hover:bg-gray-50"
          >
            Retailers
          </Link>
          <Link
            href={`/brands/${brandId}/category-review`}
            className="inline-block px-4 py-2 rounded border hover:bg-gray-50"
          >
            Category Review
          </Link>
        </div>
      </div>

      {/* ── activity banner ─────────────────────────────────────────────── */}
      {activityBannerCount > 0 && (
        <div
          className="flex items-center justify-between gap-4 rounded-r-xl"
          style={{
            background: "#E1F5EE",
            borderLeft: "3px solid #0F6E56",
            padding: "14px 18px",
          }}
        >
          <div>
            <div className="text-sm font-semibold" style={{ color: "#085041" }}>
              {activityBannerCount} update{activityBannerCount !== 1 ? "s" : ""} since you last visited
            </div>
            {bannerSubtext && (
              <div className="text-xs mt-0.5" style={{ color: "#0F6E56" }}>
                {bannerSubtext}
              </div>
            )}
          </div>
          <button
            onClick={() => {
              setRecentOnlyFilter(true);
              happeningRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
            className="text-xs font-medium whitespace-nowrap hover:underline"
            style={{ color: "#0F6E56" }}
          >
            Review updates →
          </button>
        </div>
      )}

      {/* ── KPI tiles ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SummaryCard
          label="Upcoming Reviews"
          value={summary.upcomingReviews}
          href={`/brands/${brandId}/category-review`}
        />
        <SummaryCard
          label="In Motion"
          value={summary.inMotion}
          href={`/brands/${brandId}/retailers?filter=in_motion`}
        />
        <SummaryCard
          label="Active Accounts"
          value={summary.activeAccounts}
          href={`/brands/${brandId}/retailers?filter=active_account`}
        />
        <SummaryCard
          label="Recent Updates"
          value={recentRetailerCount}
          href={`/brands/${brandId}/retailers`}
          highlight={recentRetailerCount > 0}
          onHighlightClick={() => {
            setRecentOnlyFilter(true);
            happeningRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
          }}
        />
      </div>

      {/* ── What's Happening Now ─────────────────────────────────────────── */}
      <div className="border rounded-xl p-4" ref={happeningRef}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold">What's Happening Now</h2>
            {recentOnlyFilter && (
              <span className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-medium" style={{ background: "#E1F5EE", color: "#085041" }}>
                Showing recent updates only
                <button
                  onClick={() => setRecentOnlyFilter(false)}
                  className="ml-1.5 underline hover:opacity-70 font-normal"
                  aria-label="Show all"
                >
                  Show all
                </button>
              </span>
            )}
          </div>
          <Link href={`/brands/${brandId}/retailers`} className="text-sm underline">
            Open retailer list
          </Link>
        </div>

        {displayWorkflow.length === 0 ? (
          <div className="mt-4">
            {recentOnlyFilter ? (
              <div className="rounded-lg p-4 text-sm" style={{ background: "#F8FFFE", border: "1px solid #C6EDE0" }}>
                <div className="font-medium" style={{ color: "#085041" }}>No retailer activity in the last 7 days.</div>
                <div className="text-gray-500 mt-0.5">Check back soon or view all retailers below.</div>
                <button
                  onClick={() => setRecentOnlyFilter(false)}
                  className="mt-3 text-xs font-medium underline"
                  style={{ color: "#0F6E56" }}
                >
                  Show all retailers →
                </button>
              </div>
            ) : (
              <p className="text-sm text-gray-600">No recent workflow notes yet.</p>
            )}
          </div>
        ) : (
          <div className="space-y-3 mt-4">
            {displayWorkflow.map((row, index) => {
              const retailer = retailersById[row.retailer_id];
              const headline = retailer?.banner?.trim() ? retailer.banner : retailer?.name ?? "Retailer";
              const msgInfo = messagesByRetailer[row.retailer_id];
              const latestAt = msgInfo?.latest_at || row.submitted_date;
              const latestSender = msgInfo?.latest_sender;
              const msgCount = msgInfo?.count ?? 0;

              const sevenDaysAgo = nDaysAgoISO(7);
              const twentyOneDaysAgo = nDaysAgoISO(21);
              const isRecent = !!latestAt && latestAt >= sevenDaysAgo;
              const isStale = !latestAt || latestAt < twentyOneDaysAgo;

              return (
                <Link
                  key={row.id ?? `${row.retailer_id ?? "no-retailer"}-${index}`}
                  href={`/brands/${brandId}/retailers#retailer-${row.retailer_id}`}
                  className="block rounded-lg p-3 transition hover:bg-gray-50"
                  style={{
                    border: "1px solid #e5e7eb",
                    borderLeft: isRecent ? "3px solid #0F6E56" : "1px solid #e5e7eb",
                    opacity: isStale ? 0.65 : 1,
                  }}
                >
                  <div className="font-medium text-sm">{headline}</div>

                  <div className="text-xs text-gray-500 mt-0.5">{statusLabel(row.account_status)}</div>

                  {/* attribution */}
                  <div className="text-xs mt-1" style={{ color: isRecent ? "#0F6E56" : "#9ca3af" }}>
                    {latestSender && latestAt
                      ? `Updated by ${latestSender} · ${relativeTime(latestAt)}`
                      : row.submitted_date
                      ? `Updated ${prettyDate(row.submitted_date)}`
                      : "No recent activity"}
                  </div>

                  {row.notes ? (
                    <div className="text-sm text-gray-700 mt-2 line-clamp-2">{row.notes}</div>
                  ) : null}

                  {/* message footer */}
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-xs text-gray-400">
                      {msgCount > 0
                        ? `${msgCount} message${msgCount !== 1 ? "s" : ""} · last ${msgInfo?.latest_at ? relativeTime(msgInfo.latest_at) : "—"}`
                        : "No messages yet"}
                    </span>
                    <span className="text-xs underline text-gray-500">Open retailer →</span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {/* ── bottom two-column section ────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="border rounded-xl p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Review Activity</h2>
            <Link href={`/brands/${brandId}/category-review`} className="text-sm underline">View all</Link>
          </div>

          {upcomingList.length === 0 ? (
            <p className="text-sm text-gray-600 mt-4">No review activity in the past or next 30 days.</p>
          ) : (
            <div className="space-y-3 mt-4">
              {upcomingList.map((item) => (
                <div
                  key={item.key}
                  className="block border rounded-lg p-3"
                >
                  <div className="font-medium">{item.retailer_name}</div>
                  <div className="text-sm text-gray-500">{item.category_label}</div>
                  <div className="text-sm text-gray-600 mt-1">{prettyDate(item.date)}</div>
                  {item.retailer_id ? (
                    <div className="mt-2">
                      <Link href={`/brands/${brandId}/retailers#retailer-${item.retailer_id}`} className="text-sm underline">
                        Open retailer →
                      </Link>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="border rounded-xl p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Authorized Accounts</h2>
            <Link href={`/brands/${brandId}/retailers?filter=authorized`} className="text-sm underline">View all</Link>
          </div>

          {topAuthorized.length === 0 ? (
            <p className="text-sm text-gray-600 mt-4">No authorized accounts loaded yet.</p>
          ) : (
            <div className="space-y-3 mt-4">
              {topAuthorized.map((row, index) => {
                const retailer = retailersById[row.retailer_id];
                const headline = retailer?.banner?.trim()
                  ? retailer.banner
                  : row.retailer_name || retailer?.name || "Retailer";
                return (
                  <Link
                    key={`${row.retailer_id ?? "no-retailer"}-${index}`}
                    href={`/brands/${brandId}/retailers?filter=authorized`}
                    className="block border rounded-lg p-3 hover:bg-gray-50"
                  >
                    <div className="font-medium">{headline}</div>
                    <div className="text-sm text-gray-600 mt-1">
                      {row.authorized_item_count} items · {row.authorized_upc_count} UPCs
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── SummaryCard ───────────────────────────────────────────────────────────

function SummaryCard({
  label,
  value,
  href,
  highlight,
  onHighlightClick,
}: {
  label: string;
  value: number;
  href: string;
  highlight?: boolean;
  onHighlightClick?: () => void;
}) {
  if (highlight && value > 0) {
    return (
      <button
        onClick={onHighlightClick}
        className="rounded-lg p-4 w-full text-left transition"
        style={{ background: "#E1F5EE", border: "1px solid #5DCAA5" }}
      >
        <div className="flex items-center gap-2">
          <span className="text-2xl font-bold" style={{ color: "#085041" }}>{value}</span>
          <span
            className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
            style={{ background: "#9FE1CB", color: "#085041" }}
          >
            NEW
          </span>
        </div>
        <div className="text-sm mt-1" style={{ color: "#0F6E56" }}>{label}</div>
      </button>
    );
  }

  return (
    <Link href={href} className="border rounded-lg p-4 hover:bg-gray-50 transition block">
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-sm text-gray-600 mt-1">{label}</div>
    </Link>
  );
}
