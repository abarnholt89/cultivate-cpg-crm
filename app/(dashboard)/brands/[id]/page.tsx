"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";

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
  const [role, setRole] = useState<Role>(null);
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

        setRole((profileData?.role as Role) ?? "client");
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

    setStatus("Saved ✅");
  }

  function recentMessageLabel(authorized?: AuthorizedRow) {
    if (authorized) {
      return `${authorized.authorized_item_count} items • ${authorized.authorized_upc_count} UPCs`;
    }
    return "No authorized items";
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
        <Link className="underline text-sm" href={`/brands/${brandId}`}>
          ← Back to Brand
        </Link>
        <h1 className="text-3xl font-bold mt-2">{brandName} — Retailers</h1>
        <div className="text-sm text-gray-600 mt-1">
          Showing <span className="font-semibold">{filteredRetailers.length}</span> of{" "}
          <span className="font-semibold">{retailers.length}</span> retailers
        </div>
        {status && <p className="mt-2 text-sm text-red-600">{status}</p>}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <input
          className="border rounded px-3 py-2 w-full"
          placeholder="Search banner, parent company, channel, region, rep…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        <select
          className="border rounded px-3 py-2 w-full"
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
          className="border rounded px-3 py-2 w-full"
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
        <p className="text-sm text-gray-600">No retailers match your search or filter.</p>
      ) : (
        <div className="space-y-3">
          {filteredRetailers.map((r) => {
            const row = pipelineMap[r.id] ?? defaultPipelineRow(r.id);
            const headline = r.banner?.trim() ? r.banner : r.name;
            const reviewRows = calendarMap[r.id] ?? [];
            const authorized = authorizedMap[r.id];
            const hasLegacyNotes = !!row.notes?.trim();

            return (
              <div key={r.id} className="border rounded-lg p-4 space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-3 flex-wrap">
                      <div className="font-semibold text-lg">{headline}</div>
                      <Link
                        className="inline-block bg-black text-white text-sm px-3 py-1.5 rounded"
                        href={`/brands/${brandId}/retailers/${r.id}`}
                      >
                        Open Messages
                      </Link>
                    </div>

                    {r.banner ? <div className="text-sm text-gray-500">{r.name}</div> : null}

                    <div className="text-sm text-gray-500">
                      {r.channel ? <span>{r.channel}</span> : null}
                      {r.hq_region ? <span>{r.channel ? " • " : ""}{r.hq_region}</span> : null}
                      {typeof r.store_count === "number" ? (
                        <span>{(r.channel || r.hq_region) ? " • " : ""}{r.store_count} stores</span>
                      ) : null}
                      <span>{(r.channel || r.hq_region || typeof r.store_count === "number") ? " • " : ""}Review Type: {reviewTypeLabel(row.schedule_mode)}</span>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 justify-end">
                    {authorized ? (
                      <Badge
                        label={`Authorized • ${authorized.authorized_item_count} items`}
                        tone="good"
                      />
                    ) : null}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                  <div className="border rounded p-3 bg-gray-50">
                    <div className="text-xs text-gray-500 mb-1">Rep Owner</div>
                    <div className="font-medium">{r.team_owner || "Unassigned"}</div>
                  </div>

                  <div className="border rounded p-3 bg-gray-50">
                    <div className="text-xs text-gray-500 mb-1">Account Status</div>
                    <div className="font-medium">{accountStatusLabel(row.account_status)}</div>
                  </div>

                  <div className="border rounded p-3 bg-gray-50">
                    <div className="text-xs text-gray-500 mb-1">Authorized</div>
                    <div className="font-medium">{recentMessageLabel(authorized)}</div>
                  </div>
                </div>

                <div>
                  <div className="text-xs text-gray-500 mb-1">Account Status</div>
                  <select
                    className="border rounded px-3 py-2 w-full"
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

                <div className="border rounded p-3 space-y-3">
                  <div className="text-sm font-medium">Category Review Timing</div>

                  {reviewRows.length === 0 ? (
                    <div className="text-sm text-gray-600">No scheduled category reviews</div>
                  ) : (
                    <div className="space-y-3">
                      {reviewRows.map((review, idx) => (
                        <div
                          key={`${review.retailer_name}-${review.universal_category}-${review.retailer_category_review_name ?? "none"}-${idx}`}
                          className="border rounded p-3 bg-gray-50"
                        >
                          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-sm">
                            <div>
                              <div className="text-xs text-gray-500 mb-1">Retailer Review Name</div>
                              <div className="font-medium">
                                {review.retailer_category_review_name || "—"}
                              </div>
                            </div>

                            <div>
                              <div className="text-xs text-gray-500 mb-1">Universal Category</div>
                              <div className="font-medium">{review.universal_category}</div>
                            </div>

                            <div>
                              <div className="text-xs text-gray-500 mb-1">Review Date</div>
                              <div className="font-medium">{prettyDate(review.review_date)}</div>
                            </div>

                            <div>
                              <div className="text-xs text-gray-500 mb-1">Reset Date</div>
                              <div className="font-medium">{prettyDate(review.reset_date)}</div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="border rounded p-3">
                  <div className="flex items-center justify-between gap-3">
                    <label className="text-sm font-medium">
                      <input
                        type="checkbox"
                        className="mr-2"
                        checked={!!row.submitted_date}
                        onChange={(e) =>
                          updateLocal(r.id, {
                            submitted_date: e.target.checked ? todayISO() : null,
                          })
                        }
                      />
                      Submitted to retailer
                    </label>

                    <div className="text-sm text-gray-600">
                      {row.submitted_date ? `Date: ${prettyDate(row.submitted_date)}` : "Not submitted"}
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <div className="text-xs text-gray-500 mb-1">Submitted Date</div>
                      <input
                        type="date"
                        className="border rounded px-3 py-2 w-full"
                        value={row.submitted_date ?? ""}
                        onChange={(e) =>
                          updateLocal(r.id, { submitted_date: e.target.value || null })
                        }
                      />
                    </div>

                    <div>
                      <div className="text-xs text-gray-500 mb-1">Submitted Notes</div>
                      <input
                        className="border rounded px-3 py-2 w-full"
                        value={row.submitted_notes ?? ""}
                        onChange={(e) =>
                          updateLocal(r.id, { submitted_notes: e.target.value || null })
                        }
                        placeholder="Optional"
                      />
                    </div>
                  </div>
                </div>

                {hasLegacyNotes ? (
                  <div>
                    <div className="text-xs text-gray-500 mb-1">Legacy Notes</div>

                    {isRepOrAdmin ? (
                      <textarea
                        className="border rounded px-3 py-2 w-full"
                        rows={3}
                        value={row.notes ?? ""}
                        onChange={(e) => updateLocal(r.id, { notes: e.target.value || null })}
                      />
                    ) : (
                      <div className="border rounded px-3 py-2 bg-gray-50 text-sm whitespace-pre-wrap min-h-[88px]">
                        {row.notes}
                      </div>
                    )}
                  </div>
                ) : null}

                {isRepOrAdmin ? (
                  <button
                    className="bg-black text-white px-4 py-2 rounded"
                    onClick={() => save(r.id)}
                  >
                    Save
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