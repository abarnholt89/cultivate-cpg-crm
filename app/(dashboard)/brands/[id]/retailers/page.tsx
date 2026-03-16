"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";

type Brand = { id: string; name: string };

type Retailer = {
  id: string;
  name: string; // parent company
  banner: string | null; // account/banner
  channel: string | null;
  hq_region: string | null;
  store_count: number | null;
  team_owner: string | null;
  rep_owner_user_id: string | null;
};

type Role = "admin" | "rep" | "client" | null;
type ScheduleMode = "scheduled" | "open";

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

type TimingRow = {
  id?: string;
  brand_id: string;
  retailer_id: string;
  account_status: AccountStatus;
  schedule_mode: ScheduleMode;
  category_review_date: string | null;
  reset_date: string | null;
  submitted_date: string | null;
  submitted_notes: string | null;
  notes: string | null;
};

function todayISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function addDaysISO(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function isBetweenInclusive(dateISO: string, startISO: string, endISO: string) {
  return dateISO >= startISO && dateISO <= endISO;
}

function dueStatus(row: TimingRow): { label: string; tone: "neutral" | "good" | "warn" | "bad" } {
  if (row.schedule_mode === "open") {
    if (row.submitted_date) return { label: `Submitted ${row.submitted_date}`, tone: "good" };
    return { label: "Open (no schedule)", tone: "neutral" };
  }

  if (row.submitted_date) return { label: `Submitted ${row.submitted_date}`, tone: "good" };
  if (!row.category_review_date) return { label: "No review date set", tone: "warn" };

  const t = todayISO();
  if (row.category_review_date < t) return { label: "Past due", tone: "bad" };

  const next30 = addDaysISO(t, 30);
  if (isBetweenInclusive(row.category_review_date, t, next30)) {
    return { label: `Upcoming (${row.category_review_date})`, tone: "warn" };
  }

  return { label: `Review ${row.category_review_date}`, tone: "neutral" };
}

function latestActivityLabel(row: TimingRow): string {
  if (row.submitted_date) return `Submitted ${row.submitted_date}`;
  if (row.category_review_date && row.schedule_mode === "scheduled") return `Review ${row.category_review_date}`;
  if (row.notes?.trim()) return "Account summary on file";
  return "No recent activity";
}

function Badge({ label, tone }: { label: string; tone: "neutral" | "good" | "warn" | "bad" }) {
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
  { value: "past_due", label: "Past Due Reviews" },
  { value: "submitted_recent", label: "Recently Submitted" },
  { value: "open", label: "Open (No Schedule)" },
  { value: "no_review_date", label: "Needs Review Date" },
];

export default function BrandRetailersPage() {
  const params = useParams();
  const searchParams = useSearchParams();

  const brandId = (Array.isArray(params?.id) ? params?.id[0] : params?.id) as string;
  const filterFromUrl = (searchParams?.get("filter") ?? "all") as string;

  const [brand, setBrand] = useState<Brand | null>(null);
  const [retailers, setRetailers] = useState<Retailer[]>([]);
  const [timingMap, setTimingMap] = useState<Record<string, TimingRow>>({});
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

      const { data: timingData, error: timingError } = await supabase
        .from("brand_retailer_timing")
        .select("*")
        .eq("brand_id", brandId);

      if (timingError) {
        setStatus(timingError.message);
        return;
      }

      const nextMap: Record<string, TimingRow> = {};
      (timingData ?? []).forEach((row: any) => {
        nextMap[row.retailer_id] = {
          id: row.id,
          brand_id: row.brand_id,
          retailer_id: row.retailer_id,
          account_status: (row.account_status ?? "upcoming_review") as AccountStatus,
          schedule_mode: (row.schedule_mode ?? "open") as ScheduleMode,
          category_review_date: row.category_review_date ?? null,
          reset_date: row.reset_date ?? null,
          submitted_date: row.submitted_date ?? null,
          submitted_notes: row.submitted_notes ?? null,
          notes: row.notes ?? null,
        };
      });
      setTimingMap(nextMap);
    }

    load();
  }, [brandId]);

  const repOptions = useMemo(() => {
    const names = Array.from(
      new Set(retailers.map((r) => r.team_owner).filter((v): v is string => !!v && v.trim() !== ""))
    ).sort((a, b) => a.localeCompare(b));
    return names;
  }, [retailers]);

  function defaultRow(retailerId: string): TimingRow {
    return {
      brand_id: brandId,
      retailer_id: retailerId,
      account_status: "upcoming_review",
      schedule_mode: "open",
      category_review_date: null,
      reset_date: null,
      submitted_date: null,
      submitted_notes: null,
      notes: null,
    };
  }

  function updateLocal(retailerId: string, patch: Partial<TimingRow>) {
    setTimingMap((prev) => {
      const current = prev[retailerId] ?? defaultRow(retailerId);
      return { ...prev, [retailerId]: { ...current, ...patch } };
    });
  }

  async function save(retailerId: string) {
    const row = timingMap[retailerId] ?? defaultRow(retailerId);
    setStatus("Saving…");

    const payload = {
      brand_id: brandId,
      retailer_id: retailerId,
      account_status: row.account_status,
      schedule_mode: row.schedule_mode,
      category_review_date: row.schedule_mode === "open" ? null : row.category_review_date,
      reset_date: row.schedule_mode === "open" ? null : row.reset_date,
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

  async function saveRepOwner(retailerId: string, repName: string) {
    setStatus("Saving rep owner…");

    const { error } = await supabase
      .from("retailers")
      .update({
        team_owner: repName || null,
      })
      .eq("id", retailerId);

    if (error) {
      setStatus(error.message);
      return;
    }

    setRetailers((prev) =>
      prev.map((r) =>
        r.id === retailerId
          ? {
              ...r,
              team_owner: repName || null,
            }
          : r
      )
    );

    setStatus("Saved rep owner ✅");
  }

  const brandName = useMemo(() => brand?.name ?? "Brand", [brand]);

  const filteredRetailers = useMemo(() => {
    const t = todayISO();
    const next30 = addDaysISO(t, 30);
    const prev30 = addDaysISO(t, -30);
    const q = query.trim().toLowerCase();

    function matchesFilter(r: Retailer): boolean {
      const row = timingMap[r.id] ?? defaultRow(r.id);

      if (selectedFilter === "all") return true;

      if (selectedFilter === "upcoming") {
        return (
          row.schedule_mode === "scheduled" &&
          !row.submitted_date &&
          !!row.category_review_date &&
          isBetweenInclusive(row.category_review_date, t, next30)
        );
      }

      if (selectedFilter === "past_due") {
        return (
          row.schedule_mode === "scheduled" &&
          !row.submitted_date &&
          !!row.category_review_date &&
          row.category_review_date < t
        );
      }

      if (selectedFilter === "submitted_recent") {
        return !!row.submitted_date && isBetweenInclusive(row.submitted_date, prev30, t);
      }

      if (selectedFilter === "open") {
        return row.schedule_mode === "open";
      }

      if (selectedFilter === "no_review_date") {
        return row.schedule_mode === "scheduled" && !row.submitted_date && !row.category_review_date;
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
  }, [retailers, timingMap, selectedFilter, query, selectedRep]);

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
            const row = timingMap[r.id] ?? defaultRow(r.id);
            const due = dueStatus(row);
            const headline = r.banner?.trim() ? r.banner : r.name;
            const latestActivity = latestActivityLabel(row);

            return (
              <div key={r.id} className="border rounded-lg p-4 space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div>
                      <div className="font-semibold text-lg">{headline}</div>
                      {r.banner ? <div className="text-sm text-gray-500">{r.name}</div> : null}
                      <div className="text-xs text-gray-500 mt-1">
                        {r.channel ? <span>{r.channel}</span> : null}
                        {r.hq_region ? <span>{r.channel ? " • " : ""}{r.hq_region}</span> : null}
                        {typeof r.store_count === "number" ? (
                          <span>{(r.channel || r.hq_region) ? " • " : ""}{r.store_count} stores</span>
                        ) : null}
                      </div>
                    </div>

                    <Link
                      className="text-sm underline mt-1"
                      href={`/brands/${brandId}/retailers/${r.id}`}
                    >
                      Open Messages
                    </Link>
                  </div>

                  <div className="flex flex-wrap gap-2 justify-end">
                    <Badge
                      label={row.schedule_mode === "open" ? "Open" : "Category Review"}
                      tone={row.schedule_mode === "open" ? "neutral" : "good"}
                    />
                    <Badge label={accountStatusLabel(row.account_status)} tone="neutral" />
                    <Badge label={due.label} tone={due.tone} />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                  <div className="border rounded p-3 bg-gray-50">
                    <div className="text-xs text-gray-500 mb-1">Rep Owner</div>
                    <div className="font-medium">{r.team_owner || "Unassigned"}</div>
                  </div>

                  <div className="border rounded p-3 bg-gray-50">
                    <div className="text-xs text-gray-500 mb-1">Review Date</div>
                    <div className="font-medium">
                      {row.schedule_mode === "open"
                        ? "Open"
                        : row.category_review_date || "Not set"}
                    </div>
                  </div>

                  <div className="border rounded p-3 bg-gray-50">
                    <div className="text-xs text-gray-500 mb-1">Last Activity</div>
                    <div className="font-medium">{latestActivity}</div>
                  </div>
                </div>

                <div>
                  <div className="text-xs text-gray-500 mb-1">Rep Owner</div>

                  {isRepOrAdmin ? (
                    <select
                      className="border rounded px-3 py-2 w-full"
                      value={r.team_owner ?? ""}
                      onChange={(e) => saveRepOwner(r.id, e.target.value)}
                    >
                      <option value="">Unassigned</option>
                      {repOptions.map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="border rounded px-3 py-2 bg-gray-50 text-sm">
                      {r.team_owner || "Unassigned"}
                    </div>
                  )}
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

                <div>
                  <div className="text-xs text-gray-500 mb-1">Review Type</div>
                  <select
                    className="border rounded px-3 py-2 w-full"
                    value={row.schedule_mode}
                    onChange={(e) => {
                      const mode = e.target.value as ScheduleMode;
                      updateLocal(r.id, {
                        schedule_mode: mode,
                        category_review_date: mode === "open" ? null : row.category_review_date,
                        reset_date: mode === "open" ? null : row.reset_date,
                      });
                    }}
                  >
                    <option value="scheduled">Category Review</option>
                    <option value="open">Open</option>
                  </select>
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
                      {row.submitted_date ? `Date: ${row.submitted_date}` : "Not submitted"}
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

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <div className="text-xs text-gray-500 mb-1">Review Date</div>
                    <input
                      type="date"
                      disabled={row.schedule_mode === "open"}
                      className="border rounded px-3 py-2 w-full disabled:bg-gray-100"
                      value={row.category_review_date ?? ""}
                      onChange={(e) =>
                        updateLocal(r.id, { category_review_date: e.target.value || null })
                      }
                    />
                  </div>

                  <div>
                    <div className="text-xs text-gray-500 mb-1">Reset Date</div>
                    <input
                      type="date"
                      disabled={row.schedule_mode === "open"}
                      className="border rounded px-3 py-2 w-full disabled:bg-gray-100"
                      value={row.reset_date ?? ""}
                      onChange={(e) =>
                        updateLocal(r.id, { reset_date: e.target.value || null })
                      }
                    />
                  </div>
                </div>

                <div>
                  <div className="text-xs text-gray-500 mb-1">
                    Account Summary (From Previous Tracker)
                  </div>

                  {isRepOrAdmin ? (
                    <textarea
                      className="border rounded px-3 py-2 w-full"
                      rows={3}
                      value={row.notes ?? ""}
                      onChange={(e) =>
                        updateLocal(r.id, { notes: e.target.value || null })
                      }
                    />
                  ) : (
                    <div className="border rounded px-3 py-2 bg-gray-50 text-sm whitespace-pre-wrap min-h-[88px]">
                      {row.notes?.trim() ? row.notes : "No account summary yet."}
                    </div>
                  )}
                </div>

                {isRepOrAdmin && (
                  <button
                    className="bg-black text-white px-4 py-2 rounded"
                    onClick={() => save(r.id)}
                  >
                    Save
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}