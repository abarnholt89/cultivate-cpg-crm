"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import StatusBadge from "@/components/StatusBadge";

type Role = "admin" | "rep" | "client" | null;

type Task = {
  id: string;
  title: string;
  notes: string | null;
  due_date: string | null;
  assigned_to: string | null;
  brand_id: string | null;
  retailer_id: string | null;
  status: string;
  created_at: string;
  assigned_profile: { full_name: string | null } | null;
  created_profile: { full_name: string | null } | null;
  brand: { name: string } | null;
  retailer: { name: string; banner: string | null } | null;
};

type AgingRow = {
  brand_retailer_timing_id: string;
  brand_id: string;
  retailer_id: string;
  retailer_name: string;
  account_status: string;
  last_activity_at: string | null;
  last_status_change_at: string | null;
  aging_bucket: "30+ days" | "60+ days";
};

type Brand = {
  id: string;
  name: string;
};

type TimingRow = {
  id: string;
  brand_id: string;
  retailer_id: string;
  account_status:
    | "active_account"
    | "cultivate_does_not_rep"
    | "not_a_target_account"
    | "retailer_declined"
    | "waiting_for_retailer_to_publish_review"
    | "under_review"
    | "open_review"
    | "working_to_secure_anchor_account"
    | "upcoming_review";
  category_review_date: string | null;
  reset_date: string | null;
  next_follow_up_at: string | null;
};

type Retailer = {
  id: string;
  name: string;
  banner: string | null;
  rep_owner_user_id: string | null;
};

type UpcomingItem = {
  id: string;
  brand_id: string;
  brand_name: string;
  retailer_id: string;
  retailer_name: string;
  retailer_headline: string;
  milestone_type: "Category Review" | "Reset Date" | "Follow Up";
  milestone_date: string;
  account_status: TimingRow["account_status"];
};

type CalendarViewRow = {
  brand_id: string;
  retailer_id: string | null;
  retailer_name: string;
  retailer_category_review_name: string | null;
  universal_category: string;
  review_date: string | null;
};

type ClientMessageInboxRow = {
  id: string;
  brand_id: string;
  retailer_id: string;
  sender_id: string | null;
  sender_name: string | null;
  body: string;
  created_at: string;
};

type ActivityRow = {
  user_id: string;
  brand_id: string | null;
  retailer_id: string | null;
  created_at: string;
};

type LeaderboardRow = {
  user_id: string;
  full_name: string;
  accountsTouched: number;
  activityCount: number;
};

function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function addDaysISO(iso: string, days: number) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function taskUrgency(due_date: string | null): "overdue" | "soon" | "normal" {
  if (!due_date) return "normal";
  const today = todayISO();
  if (due_date < today) return "overdue";
  if (due_date <= addDaysISO(today, 7)) return "soon";
  return "normal";
}

function isBetweenInclusive(dateISO: string, startISO: string, endISO: string) {
  return dateISO >= startISO && dateISO <= endISO;
}

function statusLabel(status: TimingRow["account_status"] | string) {
  switch (status) {
    case "active_account":
      return "Active Account";
    case "open_review":
      return "In Progress";
    case "under_review":
      return "Under Review";
    case "working_to_secure_anchor_account":
      return "Distributor Required";
    case "waiting_for_retailer_to_publish_review":
      return "Waiting for Retailer to Publish Review";
    case "upcoming_review":
      return "Upcoming Review";
    case "not_a_target_account":
      return "Not a Target";
    case "cultivate_does_not_rep":
      return "Not Managed by Cultivate";
    case "retailer_declined":
      return "Retailer Declined";
    default:
      return status;
  }
}

function prettyDate(value: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString();
}

function prettyDateTime(value: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

export default function RepInboxPage() {
  const router = useRouter();

  const [role, setRole] = useState<Role>(null);
  const [authorized, setAuthorized] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [taskRepFilter, setTaskRepFilter] = useState("");
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [newTaskForm, setNewTaskForm] = useState({ title: "", notes: "", due_date: "", assigned_to: "" });
  const [newTaskSaving, setNewTaskSaving] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);
  const [completedTasks, setCompletedTasks] = useState<Task[]>([]);
  const [loadingCompleted, setLoadingCompleted] = useState(false);
  const [agingAccounts, setAgingAccounts] = useState<AgingRow[]>([]);
  const [upcoming, setUpcoming] = useState<UpcomingItem[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [clientMessages, setClientMessages] = useState<ClientMessageInboxRow[]>([]);
  const [brandsById, setBrandsById] = useState<Record<string, Brand>>({});
  const [retailersById, setRetailersById] = useState<Record<string, Retailer>>({});
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([]);
  const [repProfiles, setRepProfiles] = useState<{ id: string; full_name: string }[]>([]);
  const [agingRepFilter, setAgingRepFilter] = useState("");
  const [pulse, setPulse] = useState({
    followUps: 0,
    stalled: 0,
    upcoming: 0,
    reminders: 0,
  });

  useEffect(() => {
    async function load() {
      setLoading(true);
      setStatus("");

      const { data: authData } = await supabase.auth.getUser();
      const userId = authData?.user?.id;

      if (!userId) {
        router.replace("/login");
        return;
      }

      setCurrentUserId(userId);

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", userId)
        .single();

      if (profileError) {
        setStatus(profileError.message);
        setLoading(false);
        return;
      }

      const nextRole = (profile?.role as Role) ?? null;
      setRole(nextRole);

      if (nextRole === "client") {
        router.replace("/brands");
        return;
      }

      setAuthorized(true);

      const today = todayISO();
      const next30 = addDaysISO(today, 30);
      const prev30 = addDaysISO(today, -30);
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);

      let ownedRetailerIds: string[] = [];

// Fetch owned retailer IDs for both reps and admins.
// Admins with no assigned retailers intentionally see empty results in
// Client Messages and Review Activity (same scoping as reps).
{
  const { data: ownedRetailers, error: ownedRetailersError } = await supabase
    .from("retailers")
    .select("id")
    .eq("rep_owner_user_id", userId);

  if (ownedRetailersError) {
    setStatus(ownedRetailersError.message);
    setLoading(false);
    return;
  }

  ownedRetailerIds = (ownedRetailers ?? []).map((r) => r.id);
}

const followUpCountPromise =
  nextRole === "rep"
    ? ownedRetailerIds.length === 0
      ? Promise.resolve({ count: 0, error: null })
      : supabase
          .from("brand_retailer_timing")
          .select("*", { count: "exact", head: true })
          .in("retailer_id", ownedRetailerIds)
          .lt("next_follow_up_at", new Date().toISOString())
    : supabase
        .from("brand_retailer_timing")
        .select("*", { count: "exact", head: true })
        .lt("next_follow_up_at", new Date().toISOString());

const timingPromise =
  ownedRetailerIds.length === 0
    ? Promise.resolve({ data: [], error: null })
    : supabase
        .from("brand_retailer_timing")
        .select(
          "id,brand_id,retailer_id,account_status,category_review_date,reset_date,next_follow_up_at"
        )
        .in("retailer_id", ownedRetailerIds);

const clientMessagesPromise =
  ownedRetailerIds.length === 0
    ? Promise.resolve({ data: [], error: null })
    : supabase
        .from("brand_retailer_messages")
        .select("id,brand_id,retailer_id,sender_id,sender_name,body,created_at")
        .eq("visibility", "client")
        .in("retailer_id", ownedRetailerIds)
        .neq("sender_id", userId)
        .order("created_at", { ascending: false })
        .limit(50);

const calendarPromise =
  ownedRetailerIds.length === 0
    ? Promise.resolve({ data: [], error: null })
    : supabase
        .from("brand_category_review_view")
        .select("brand_id,retailer_id,retailer_name,retailer_category_review_name,universal_category,review_date")
        .in("retailer_id", ownedRetailerIds)
        .not("review_date", "is", null)
        .gte("review_date", prev30)
        .lte("review_date", next30);

      const tasksBaseQuery = supabase
        .from("tasks")
        .select("id,title,notes,due_date,assigned_to,brand_id,retailer_id,status,created_at,assigned_profile:profiles!assigned_to(full_name),created_profile:profiles!created_by(full_name),brand:brands(name),retailer:retailers(name,banner)")
        .eq("status", "open")
        .order("due_date", { ascending: true, nullsFirst: false })
        .limit(50);

      const tasksQuery = nextRole === "admin"
        ? tasksBaseQuery
        : tasksBaseQuery.eq("assigned_to", userId);

      const [
        followUpCountResult,
        tasksResult,
        timingResult,
        clientMessagesResult,
        agingResult,
        activitiesResult,
        calendarResult,
      ] = await Promise.all([
        followUpCountPromise,
        tasksQuery,
        timingPromise,
        clientMessagesPromise,
        supabase.rpc("get_rep_aging_accounts", {
          p_limit: 50,
          p_offset: 0,
        }),
        supabase
          .from("activities")
          .select("user_id,brand_id,retailer_id,created_at")
          .gte("created_at", monthStart.toISOString()),
        calendarPromise,
      ]);

      const taskRows = (tasksResult.data as unknown as Task[]) ?? [];
      const clientMessageRows =
        (clientMessagesResult.data as ClientMessageInboxRow[]) ?? [];
      const agingRows = (agingResult.data as AgingRow[]) ?? [];
      const followUps = followUpCountResult.count ?? 0;
      const activityRows = (activitiesResult.data as ActivityRow[]) ?? [];

      if (tasksResult.error) {
        setStatus(tasksResult.error.message);
      } else {
        setTasks(taskRows);
      }

if (clientMessagesResult.error) {
  setStatus((prev) => prev || clientMessagesResult.error.message);
} else {
  let unreadClientMessages = clientMessageRows;

  if (clientMessageRows.length > 0) {
    const messageIds = clientMessageRows.map((m) => m.id);

    const { data: readRows, error: readError } = await supabase
      .from("message_reads")
      .select("message_id")
      .eq("user_id", userId)
      .in("message_id", messageIds);

    if (readError) {
      setStatus((prev) => prev || readError.message);
    } else {
      const readIds = new Set((readRows ?? []).map((r) => r.message_id));
      unreadClientMessages = clientMessageRows.filter((m) => !readIds.has(m.id));
    }
  }

  setClientMessages(unreadClientMessages);
}

      if (agingResult.error) {
        setStatus((prev) => prev || agingResult.error.message);
      } else {
        setAgingAccounts(agingRows);
      }

      if (timingResult.error) {
        setStatus((prev) => prev || timingResult.error.message);
        setUpcoming([]);
        setLoading(false);
        return;
      }

      const timingRows = ((timingResult.data as TimingRow[]) ?? []).filter((row) => {
        return (
          (row.category_review_date &&
            isBetweenInclusive(row.category_review_date, prev30, next30)) ||
          (row.reset_date &&
            isBetweenInclusive(row.reset_date, prev30, next30)) ||
          (row.next_follow_up_at &&
            isBetweenInclusive(row.next_follow_up_at.slice(0, 10), today, next30))
        );
      });

      const calendarRows = ((calendarResult.data as CalendarViewRow[]) ?? []);

      const brandIds = [
        ...new Set([
          ...timingRows.map((r) => r.brand_id),
          ...clientMessageRows.map((m) => m.brand_id),
          ...taskRows.map((t) => t.brand_id),
          ...agingRows.map((a) => a.brand_id),
          ...calendarRows.map((r) => r.brand_id),
        ]),
      ];

      const retailerIds = [
        ...new Set([
          ...timingRows.map((r) => r.retailer_id),
          ...clientMessageRows.map((m) => m.retailer_id),
          ...taskRows.map((t) => t.retailer_id),
          ...agingRows.map((a) => a.retailer_id),
          ...(calendarRows.map((r) => r.retailer_id).filter(Boolean) as string[]),
        ]),
      ];

      const [brandsResult, retailersResult, repProfilesResult] = await Promise.all([
        brandIds.length
          ? supabase.from("brands").select("id,name").in("id", brandIds)
          : Promise.resolve({ data: [], error: null }),
        retailerIds.length
          ? supabase.from("retailers").select("id,name,banner,rep_owner_user_id").in("id", retailerIds)
          : Promise.resolve({ data: [], error: null }),
        nextRole === "admin"
          ? supabase.from("profiles").select("id,full_name").in("role", ["rep", "admin"]).order("full_name")
          : Promise.resolve({ data: [], error: null }),
      ]);

      if (brandsResult.error) {
        setStatus((prev) => prev || brandsResult.error.message);
      }

      if (retailersResult.error) {
        setStatus((prev) => prev || retailersResult.error.message);
      }

      const nextBrandsById: Record<string, Brand> = {};
      ((brandsResult.data as Brand[]) ?? []).forEach((b) => {
        nextBrandsById[b.id] = b;
      });
      setBrandsById(nextBrandsById);

      const nextRetailersById: Record<string, Retailer> = {};
      ((retailersResult.data as Retailer[]) ?? []).forEach((r) => {
        nextRetailersById[r.id] = r;
      });
      setRetailersById(nextRetailersById);

      setRepProfiles(
        ((repProfilesResult.data as { id: string; full_name: string }[]) ?? [])
      );

      const activityUserIds = [
        ...new Set(activityRows.map((row) => row.user_id).filter(Boolean)),
      ];

      let nextLeaderboard: LeaderboardRow[] = [];

      if (activityUserIds.length > 0) {
        const { data: activityProfiles, error: activityProfilesError } = await supabase
          .from("profiles")
          .select("id,full_name,role")
          .in("id", activityUserIds);

        if (activityProfilesError) {
          setStatus((prev) => prev || activityProfilesError.message);
        } else {
          const profilesById: Record<string, { full_name: string; role: string }> = {};

          ((activityProfiles as { id: string; full_name: string; role: string }[]) ?? []).forEach(
            (profile) => {
              profilesById[profile.id] = {
                full_name: profile.full_name,
                role: profile.role,
              };
            }
          );

          const grouped: Record<
            string,
            { full_name: string; activityCount: number; touched: Set<string> }
          > = {};

          activityRows.forEach((row) => {
            const profile = profilesById[row.user_id];
            if (!profile) return;
            if (profile.role !== "rep" && profile.role !== "admin") return;

            if (!grouped[row.user_id]) {
              grouped[row.user_id] = {
                full_name: profile.full_name || "Unknown",
                activityCount: 0,
                touched: new Set<string>(),
              };
            }

            grouped[row.user_id].activityCount += 1;

            if (row.brand_id && row.retailer_id) {
              grouped[row.user_id].touched.add(`${row.brand_id}:${row.retailer_id}`);
            }
          });

          nextLeaderboard = Object.entries(grouped)
            .map(([user_id, value]) => ({
              user_id,
              full_name: value.full_name,
              accountsTouched: value.touched.size,
              activityCount: value.activityCount,
            }))
            .sort((a, b) => {
              if (b.accountsTouched !== a.accountsTouched) {
                return b.accountsTouched - a.accountsTouched;
              }
              return b.activityCount - a.activityCount;
            });
        }
      }

      setLeaderboard(nextLeaderboard);

      const upcomingItems: UpcomingItem[] = [];

      timingRows.forEach((row) => {
        const brand = nextBrandsById[row.brand_id];
        const retailer = nextRetailersById[row.retailer_id];
        const retailerHeadline =
          retailer?.banner?.trim() ? retailer.banner : retailer?.name ?? "Retailer";

        if (
          row.category_review_date &&
          isBetweenInclusive(row.category_review_date, prev30, next30)
        ) {
          upcomingItems.push({
            id: `${row.id}-category_review_date`,
            brand_id: row.brand_id,
            brand_name: brand?.name ?? "Brand",
            retailer_id: row.retailer_id,
            retailer_name: retailer?.name ?? "Retailer",
            retailer_headline: retailerHeadline,
            milestone_type: "Category Review",
            milestone_date: row.category_review_date,
            account_status: row.account_status,
          });
        }

        if (row.reset_date && isBetweenInclusive(row.reset_date, prev30, next30)) {
          upcomingItems.push({
            id: `${row.id}-reset_date`,
            brand_id: row.brand_id,
            brand_name: brand?.name ?? "Brand",
            retailer_id: row.retailer_id,
            retailer_name: retailer?.name ?? "Retailer",
            retailer_headline: retailerHeadline,
            milestone_type: "Reset Date",
            milestone_date: row.reset_date,
            account_status: row.account_status,
          });
        }

        if (
          row.next_follow_up_at &&
          isBetweenInclusive(row.next_follow_up_at.slice(0, 10), today, next30)
        ) {
          upcomingItems.push({
            id: `${row.id}-next_follow_up_at`,
            brand_id: row.brand_id,
            brand_name: brand?.name ?? "Brand",
            retailer_id: row.retailer_id,
            retailer_name: retailer?.name ?? "Retailer",
            retailer_headline: retailerHeadline,
            milestone_type: "Follow Up",
            milestone_date: row.next_follow_up_at.slice(0, 10),
            account_status: row.account_status,
          });
        }
      });

      calendarRows.forEach((row, idx) => {
        if (!row.review_date) return;
        const brand = nextBrandsById[row.brand_id];
        const retailer = row.retailer_id ? nextRetailersById[row.retailer_id] : null;
        const retailerHeadline =
          retailer?.banner?.trim() ? retailer.banner : retailer?.name ?? row.retailer_name;
        upcomingItems.push({
          id: `cal-${row.brand_id}-${row.retailer_name}-${row.universal_category}-${idx}`,
          brand_id: row.brand_id,
          brand_name: brand?.name ?? "Brand",
          retailer_id: row.retailer_id ?? "",
          retailer_name: retailer?.name ?? row.retailer_name,
          retailer_headline: retailerHeadline,
          milestone_type: "Category Review",
          milestone_date: row.review_date,
          account_status: "upcoming_review",
        });
      });

      upcomingItems.sort((a, b) => a.milestone_date.localeCompare(b.milestone_date));
      setUpcoming(upcomingItems);

      setPulse({
        followUps,
        stalled: agingRows.length,
        upcoming: upcomingItems.length,
        reminders: taskRows.length,
      });

      setLoading(false);
    }

    load();
  }, [router]);

  const filteredAgingAccounts = useMemo(() => {
    if (!agingRepFilter) return agingAccounts;
    return agingAccounts.filter(
      (item) => retailersById[item.retailer_id]?.rep_owner_user_id === agingRepFilter
    );
  }, [agingAccounts, agingRepFilter, retailersById]);

  const filteredTasks = useMemo(() => {
    if (!taskRepFilter) return tasks;
    return tasks.filter((t) => t.assigned_to === taskRepFilter);
  }, [tasks, taskRepFilter]);

  async function markTaskDone(id: string) {
    await fetch(`/api/tasks/${id}/done`, { method: "PATCH" });
    setTasks((prev) => prev.filter((t) => t.id !== id));
  }

  async function saveNewTask() {
    if (!newTaskForm.title.trim()) return;
    setNewTaskSaving(true);
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newTaskForm.title.trim(),
          notes: newTaskForm.notes || null,
          due_date: newTaskForm.due_date || null,
          assigned_to: newTaskForm.assigned_to || currentUserId || null,
          created_by: currentUserId || null,
          brand_id: null,
          retailer_id: null,
        }),
      });
      if (res.ok) {
        setNewTaskOpen(false);
        setNewTaskForm({ title: "", notes: "", due_date: "", assigned_to: "" });
        // Optimistically update task count in pulse
        setPulse((prev) => ({ ...prev, reminders: prev.reminders + 1 }));
      }
    } finally {
      setNewTaskSaving(false);
    }
  }

  async function toggleShowCompleted() {
    const next = !showCompleted;
    setShowCompleted(next);
    if (next && completedTasks.length === 0) {
      setLoadingCompleted(true);
      try {
        const q = supabase
          .from("tasks")
          .select("id,title,notes,due_date,assigned_to,brand_id,retailer_id,status,created_at,assigned_profile:profiles!assigned_to(full_name),created_profile:profiles!created_by(full_name),brand:brands(name),retailer:retailers(name,banner)")
          .eq("status", "done")
          .order("created_at", { ascending: false })
          .limit(30);
        const finalQ = role === "admin" ? q : q.eq("assigned_to", currentUserId!);
        const { data } = await finalQ;
        setCompletedTasks((data as unknown as Task[]) ?? []);
      } finally {
        setLoadingCompleted(false);
      }
    }
  }

  const counts = useMemo(
    () => ({
      messages: clientMessages.length,
      nudges: tasks.length,
      upcoming: upcoming.length,
      aging: agingAccounts.length,
    }),
    [clientMessages, tasks, upcoming, agingAccounts]
  );

  if (loading) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Loading inbox…
      </div>
    );
  }

  if (!authorized || role === "client") {
    return null;
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Rep Inbox</h1>
        <p className="mt-1 text-muted-foreground">
          Client messages, open tasks, upcoming milestones, and aging accounts.
        </p>
        {status ? <p className="mt-2 text-sm text-red-600">{status}</p> : null}
      </div>

      <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
        <div className="mb-3 text-sm font-semibold text-foreground">
          Rep Performance Pulse
        </div>

        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <PulseMetric label="Needs Follow Up" value={pulse.followUps} />
          <PulseMetric label="Stalled Accounts" value={pulse.stalled} />
          <PulseMetric label="Review Activity" value={pulse.upcoming} />
          <PulseMetric label="Open Tasks" value={pulse.reminders} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Client Messages" value={counts.messages} highlight />
        <SummaryCard label="Tasks" value={counts.nudges} />
        <SummaryCard label="Review Activity" value={counts.upcoming} />
        <SummaryCard label="Aging Accounts" value={counts.aging} />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
        <section className="space-y-4 rounded-xl border border-border bg-card p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-foreground">Client Messages</h2>
          </div>

          {clientMessages.length === 0 ? (
            <p className="text-sm text-muted-foreground">No recent client messages.</p>
          ) : (
            <div className="space-y-3">
              {clientMessages.map((message) => {
                const brandName = brandsById[message.brand_id]?.name ?? "Brand";
                const retailer = retailersById[message.retailer_id];
                const retailerHeadline =
                  retailer?.banner?.trim()
                    ? retailer.banner
                    : retailer?.name ?? "Retailer";

                return (
                  <Link
                    key={message.id}
                    href={`/brands/${message.brand_id}/retailers#retailer-${message.retailer_id}`}
                    className="block rounded-lg border border-border bg-card p-3 transition-colors hover:bg-accent"
                  >
                    <div className="font-medium text-foreground">{retailerHeadline}</div>
                    <div className="mt-1 text-sm text-muted-foreground">{brandName}</div>
                    <div className="mt-2 text-xs text-muted-foreground">
                      {message.sender_name ?? "Unknown"} • {prettyDateTime(message.created_at)}
                    </div>
                    <div className="mt-2 line-clamp-3 text-sm text-foreground/85">
                      {message.body}
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </section>

        <section className="space-y-4 rounded-xl border border-border bg-card p-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h2 className="text-lg font-semibold text-foreground mr-auto">Tasks</h2>
            {role === "admin" && repProfiles.length > 0 && (
              <select
                value={taskRepFilter}
                onChange={(e) => setTaskRepFilter(e.target.value)}
                className="text-sm border border-border rounded px-2 py-1 bg-card text-foreground"
              >
                <option value="">All</option>
                {repProfiles.map((rep) => (
                  <option key={rep.id} value={rep.id}>{rep.full_name}</option>
                ))}
              </select>
            )}
            <button
              onClick={toggleShowCompleted}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors whitespace-nowrap"
            >
              {showCompleted ? "Hide completed" : "Show completed"}
            </button>
            <button
              onClick={() => setNewTaskOpen((prev) => !prev)}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors whitespace-nowrap"
            >
              + New Task
            </button>
          </div>

          {newTaskOpen && (
            <div className="rounded-lg border border-border bg-secondary p-3 space-y-3">
              <input
                type="text"
                placeholder="Task title"
                value={newTaskForm.title}
                onChange={(e) => setNewTaskForm((prev) => ({ ...prev, title: e.target.value }))}
                className="border rounded-lg px-3 py-2 w-full text-sm bg-card text-foreground border-border focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <textarea
                placeholder="Notes (optional)"
                value={newTaskForm.notes}
                onChange={(e) => setNewTaskForm((prev) => ({ ...prev, notes: e.target.value }))}
                rows={2}
                className="border rounded-lg px-3 py-2 w-full text-sm bg-card text-foreground border-border focus:outline-none resize-none"
              />
              <div className="flex gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                  <label className="block text-xs text-muted-foreground mb-1">Due Date</label>
                  <input
                    type="date"
                    value={newTaskForm.due_date}
                    onChange={(e) => setNewTaskForm((prev) => ({ ...prev, due_date: e.target.value }))}
                    className="border rounded-lg px-3 py-2 w-full text-sm bg-card text-foreground border-border focus:outline-none"
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <label className="block text-xs text-muted-foreground mb-1">Assign To</label>
                  <select
                    value={newTaskForm.assigned_to}
                    onChange={(e) => setNewTaskForm((prev) => ({ ...prev, assigned_to: e.target.value }))}
                    className="border rounded-lg px-3 py-2 w-full text-sm bg-card text-foreground border-border focus:outline-none"
                  >
                    <option value="">Me</option>
                    {repProfiles.filter((p) => p.id !== currentUserId).map((p) => (
                      <option key={p.id} value={p.id}>{p.full_name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={saveNewTask}
                  disabled={!newTaskForm.title.trim() || newTaskSaving}
                  className="px-3 py-1.5 rounded-lg text-sm font-medium disabled:opacity-50"
                  style={{ background: "var(--foreground)", color: "var(--background)" }}
                >
                  {newTaskSaving ? "Saving…" : "Save Task"}
                </button>
                <button
                  onClick={() => { setNewTaskOpen(false); setNewTaskForm({ title: "", notes: "", due_date: "", assigned_to: "" }); }}
                  className="px-3 py-1.5 rounded-lg text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {filteredTasks.length === 0 ? (
            <p className="text-sm text-muted-foreground">No open tasks.</p>
          ) : (
            <div className="space-y-3">
              {filteredTasks.map((task) => <TaskTile key={task.id} task={task} onDone={markTaskDone} />)}
            </div>
          )}

          {showCompleted && (
            <div className="mt-4 border-t border-border pt-4 space-y-2">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Completed</div>
              {loadingCompleted ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : completedTasks.length === 0 ? (
                <p className="text-sm text-muted-foreground">No completed tasks.</p>
              ) : (
                <div className="space-y-2">
                  {completedTasks.map((task) => <TaskTile key={task.id} task={task} done />)}
                </div>
              )}
            </div>
          )}
        </section>

        <section className="space-y-4 rounded-xl border border-border bg-card p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-foreground">Review Activity</h2>
          </div>

          {upcoming.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No review activity in the past or next 30 days.
            </p>
          ) : (
            <div className="space-y-3">
              {upcoming.map((item) => (
                <Link
                  key={item.id}
                  href={`/brands/${item.brand_id}/retailers#retailer-${item.retailer_id}`}
                  className="block rounded-lg border border-border bg-card p-3 transition-colors hover:bg-accent"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-medium text-foreground">{item.retailer_headline}</div>
                    <div className="text-sm font-medium text-foreground">
                      {prettyDate(item.milestone_date)}
                    </div>
                  </div>
                  <div className="mt-1 text-sm text-muted-foreground">{item.brand_name}</div>
                  <div className="mt-2 flex items-center gap-2 flex-wrap">
                    <span className="text-sm text-foreground/85">{item.milestone_type}</span>
                    <StatusBadge status={item.account_status} />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-4 rounded-xl border border-border bg-card p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-foreground">Aging Accounts</h2>
            {role === "admin" && repProfiles.length > 0 && (
              <select
                value={agingRepFilter}
                onChange={(e) => setAgingRepFilter(e.target.value)}
                className="text-sm border border-border rounded px-2 py-1 bg-card text-foreground"
              >
                <option value="">All Reps</option>
                {repProfiles.map((rep) => (
                  <option key={rep.id} value={rep.id}>{rep.full_name}</option>
                ))}
              </select>
            )}
          </div>

          {filteredAgingAccounts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No aging accounts right now.</p>
          ) : (
            <div className="space-y-3">
              {filteredAgingAccounts.map((item) => {
                const brandName = brandsById[item.brand_id]?.name ?? "Brand";
                const retailer = retailersById[item.retailer_id];
                const retailerHeadline =
                  retailer?.banner?.trim()
                    ? retailer.banner
                    : retailer?.name ?? item.retailer_name ?? "Retailer";

                return (
                  <Link
                    key={item.brand_retailer_timing_id}
                    href={`/brands/${item.brand_id}/retailers#retailer-${item.retailer_id}`}
                    className="block rounded-lg border border-border bg-card p-3 transition-colors hover:bg-accent"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-medium text-foreground">{retailerHeadline}</div>
                      <AgingBadge aging={item.aging_bucket} />
                    </div>
                    <div className="mt-1 text-sm text-muted-foreground">{brandName}</div>
                    <div className="mt-2">
                      <StatusBadge status={item.account_status} />
                    </div>
                    <div className="mt-2 text-xs text-muted-foreground">
                      Last activity: {prettyDate(item.last_activity_at)}
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </section>

        {role === "admin" ? (
          <section className="space-y-4 rounded-xl border border-border bg-card p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-foreground">
                Team Activity This Month
              </h2>
            </div>

            {leaderboard.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No team activity recorded yet this month.
              </p>
            ) : (
              <div className="space-y-3">
                {leaderboard.map((row, index) => (
                  <div
                    key={row.user_id}
                    className="flex items-center justify-between gap-4 rounded-lg border border-border bg-card p-3"
                  >
                    <div>
                      <div className="font-medium text-foreground">
                        {index + 1}. {row.full_name}
                      </div>
                      <div className="mt-1 text-sm text-muted-foreground">
                        {row.accountsTouched} accounts touched
                      </div>
                    </div>

                    <div className="text-sm text-foreground/85">
                      {row.activityCount} activities
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        ) : null}
      </div>
    </div>
  );
}

function TaskTile({
  task,
  onDone,
  done = false,
}: {
  task: Task;
  onDone?: (id: string) => void;
  done?: boolean;
}) {
  const urgency = done ? "normal" : taskUrgency(task.due_date);

  const tileClass =
    urgency === "overdue"
      ? "flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-3"
      : urgency === "soon"
      ? "flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3"
      : "flex items-start gap-3 rounded-lg border border-border bg-card p-3";

  const dueDateClass =
    urgency === "overdue"
      ? "mt-2 text-xs text-red-600 font-medium"
      : urgency === "soon"
      ? "mt-2 text-xs text-amber-600 font-medium"
      : "mt-2 text-xs text-muted-foreground";

  const href =
    task.brand_id && task.retailer_id
      ? `/brands/${task.brand_id}/retailers#retailer-${task.retailer_id}`
      : task.brand_id
      ? `/brands/${task.brand_id}/retailers`
      : "/inbox";

  return (
    <div className={tileClass}>
      {!done && onDone && (
        <button
          onClick={() => onDone(task.id)}
          className="mt-0.5 flex-shrink-0 w-4 h-4 rounded border border-border hover:border-primary hover:bg-primary/10 transition-colors"
          title="Mark done"
        />
      )}
      {done && (
        <div className="mt-0.5 flex-shrink-0 w-4 h-4 rounded border border-border bg-muted flex items-center justify-center">
          <span className="text-[10px] text-muted-foreground">✓</span>
        </div>
      )}
      <Link href={href} className="min-w-0 flex-1 hover:opacity-80 transition-opacity">
        <div className={`font-medium ${done ? "line-through text-muted-foreground" : "text-foreground"}`}>
          {task.title}
        </div>
        {(task.brand?.name || task.retailer?.name) && (
          <div className="mt-1 text-sm text-muted-foreground">
            {[task.brand?.name, task.retailer?.name].filter(Boolean).join(" · ")}
          </div>
        )}
        {!done && task.notes ? (
          <div className="mt-2 line-clamp-2 text-sm text-foreground/85">{task.notes}</div>
        ) : null}
        {task.due_date && (
          <div className={dueDateClass}>
            Due {prettyDate(task.due_date)}
            {urgency === "overdue" ? " · Overdue" : ""}
          </div>
        )}
      </Link>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: number;
  highlight?: boolean;
}) {
  return (
    <div
      className={
        highlight
          ? "rounded-lg border border-primary/30 bg-primary/10 p-4"
          : "rounded-lg border border-border bg-card p-4"
      }
    >
      <div className="text-2xl font-bold text-foreground">{value}</div>
      <div className="mt-1 text-sm text-muted-foreground">{label}</div>
    </div>
  );
}

function AgingBadge({ aging }: { aging: "30+ days" | "60+ days" | string }) {
  const isSixty = aging === "60+ days";

  return (
    <span
      className={
        isSixty
          ? "rounded-full border border-orange-200 bg-orange-100 px-2 py-1 text-xs text-orange-800"
          : "rounded-full border border-yellow-200 bg-yellow-100 px-2 py-1 text-xs text-yellow-800"
      }
    >
      {aging}
    </span>
  );
}

function PulseMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="text-xl font-bold text-foreground">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}