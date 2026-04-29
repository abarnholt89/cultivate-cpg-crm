"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { logActivity } from "@/lib/logActivity";

type Brand = { id: string; name: string; message_notifications_enabled: boolean };

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
  | ""
  | "awaiting_submission_opportunity"
  | "in_process"
  | "not_a_target_account"
  | "retailer_declined"
  | "working_to_secure_anchor_account"
  // legacy values (kept for rows not yet migrated)
  | "active_account"
  | "cultivate_does_not_rep"
  | "waiting_for_retailer_to_publish_review"
  | "under_review"
  | "open_review"
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
  authorized_items_note: string | null;
  universal_category: string | null;
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
  retailer_id: string;
  authorized_item_count: number;
  authorized_upc_count: number;
};

type MessageRow = {
  id: string;
  retailer_id: string;
  brand_id: string;
  sender_name: string | null;
  body: string;
  created_at: string;
  visibility: "client" | "internal";
};

type AttachmentRow = {
  id: string;
  retailer_id: string;
  message_id: string | null;
  bucket_name: string;
  storage_path: string;
  file_name: string;
  mime_type: string | null;
  file_size: number | null;
};

type ManualReviewDraft = {
  localId: string;
  category: string;
  category_review_date: string;
  reset_date: string;
  notes: string;
};

type ManualReviewRow = {
  id: string;
  brand_id: string;
  retailer_id: string;
  category: string;
  category_review_date: string | null;
  reset_date: string | null;
  notes: string | null;
};

type RetailerTask = {
  id: string;
  title: string;
  due_date: string | null;
  assigned_profile: { full_name: string | null } | null;
};

type SubmissionRow = {
  id: string;
  brand_id: string;
  retailer_id: string;
  category: string | null;
  submitted_at: string;
  notes: string | null;
  created_by: string | null;
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
    case "awaiting_submission_opportunity": return "Awaiting Submission Opportunity";
    case "in_process":                     return "In Process";
    case "retailer_declined":              return "Retailer Declined";
    case "not_a_target_account":           return "Not a Target Account";
    case "working_to_secure_anchor_account": return "Distributor Required";
    // legacy
    case "active_account":                 return "Active Account";
    case "open_review":                    return "In Progress";
    case "under_review":                   return "Under Review";
    case "upcoming_review":                return "Upcoming Review";
    case "waiting_for_retailer_to_publish_review": return "Awaiting Retailer Decision";
    case "cultivate_does_not_rep":         return "Not Managed by Cultivate";
    default:                               return "";
  }
}

function reviewTypeLabel(mode: "scheduled" | "open") {
  return mode === "open" ? "Open Review" : "Scheduled Category Review";
}

function isImageMime(mime: string | null): boolean {
  return !!mime && mime.toLowerCase().startsWith("image/");
}

function formatFileSize(bytes: number): string {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

function daysAgo(iso: string): number {
  return Math.floor((Date.now() - new Date(iso + "T00:00:00").getTime()) / 86400000);
}

function workedBadgeStyle(workedAt: string | null): { bg: string; fg: string } {
  if (!workedAt) return { bg: "#ef4444", fg: "#fff" };
  const d = daysAgo(workedAt);
  if (d <= 14) return { bg: "#15803d", fg: "#fff" };
  if (d <= 30) return { bg: "#86efac", fg: "#14532d" };
  if (d <= 45) return { bg: "#fde047", fg: "#713f12" };
  if (d <= 60) return { bg: "#fb923c", fg: "#431407" };
  return { bg: "#ef4444", fg: "#fff" };
}

function statusLeftBorderColor(status: string | undefined): string {
  switch (status) {
    case "awaiting_submission_opportunity":
    // legacy
    case "active_account":
    case "upcoming_review":
    case "waiting_for_retailer_to_publish_review":
      return "#f59e0b"; // amber
    case "in_process":
    // legacy
    case "open_review":
    case "under_review":
    case "working_to_secure_anchor_account":
      return "#3b82f6"; // blue
    case "retailer_declined":
      return "#f43f5e"; // rose
    case "not_a_target_account":
    case "cultivate_does_not_rep":
      return "#94a3b8"; // slate
    default:
      return "#e2e8f0"; // light gray
  }
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
  { value: "awaiting_submission_opportunity", label: "Awaiting Submission Opportunity" },
  { value: "in_process", label: "In Process" },
  { value: "retailer_declined", label: "Retailer Declined" },
  { value: "not_a_target_account", label: "Not a Target Account" },
  { value: "working_to_secure_anchor_account", label: "Distributor Required" },
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
  const [pipelineMap, setPipelineMap] = useState<Record<string, PipelineRow[]>>({});
  const [calendarMap, setCalendarMap] = useState<Record<string, CategoryReviewRow[]>>({});
  const [authorizedMap, setAuthorizedMap] = useState<Record<string, AuthorizedRow>>({});
  const [inlineMessages, setInlineMessages] = useState<Record<string, { client: MessageRow[]; internal: MessageRow[] }>>({});
  const [role, setRole] = useState<Role>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [userFullName, setUserFullName] = useState<string>("");
  const [dateOverrides, setDateOverrides] = useState<Record<string, { review_date: string | null; reset_date: string | null }>>({});
  const [pendingDateEdits, setPendingDateEdits] = useState<Record<string, { review_date?: string | null; reset_date?: string | null }>>({});
  const [status, setStatus] = useState("");
  const [query, setQuery] = useState("");
  const [selectedFilter, setSelectedFilter] = useState(filterFromUrl);
  const [selectedRep, setSelectedRep] = useState("all");

  // Per-retailer card state
  const [cardTab, setCardTab] = useState<Record<string, "client" | "internal">>({});
  const [cardExpanded, setCardExpanded] = useState<Record<string, { client: boolean; internal: boolean }>>({});
  const [cardCompose, setCardCompose] = useState<Record<string, string>>({});
  const [cardFile, setCardFile] = useState<Record<string, File | null>>({});
  const [cardSending, setCardSending] = useState<Record<string, boolean>>({});
  const [editingMessages, setEditingMessages] = useState<Record<string, string>>({});
  const [deletingMessageId, setDeletingMessageId] = useState<string | null>(null);
  // Attachments: retailer_id → message_id → AttachmentRow[]
  const [cardAttachments, setCardAttachments] = useState<Record<string, Record<string, AttachmentRow[]>>>({});
  const [signedImageUrls, setSignedImageUrls] = useState<Record<string, string>>({});
  // Category review dismissals
  const [dismissedReviewKeys, setDismissedReviewKeys] = useState<Set<string>>(new Set());
  const [cardDismissedOpen, setCardDismissedOpen] = useState<Record<string, boolean>>({});
  // Manual category review entries
  const [pendingManualReviews, setPendingManualReviews] = useState<Record<string, ManualReviewDraft[]>>({});
  const [savedManualReviews, setSavedManualReviews] = useState<Record<string, ManualReviewRow[]>>({});
  const [manualMenuOpen, setManualMenuOpen] = useState<string | null>(null);
  const [manualEditingId, setManualEditingId] = useState<string | null>(null);
  const [manualEditDraft, setManualEditDraft] = useState<ManualReviewRow | null>(null);
  // Per-row "More" toggle (submitted date/notes)
  const [rowMoreOpen, setRowMoreOpen] = useState<Record<string, boolean>>({});

  // Date Worked (brand-level, for the logged-in rep)
  const [dateWorked, setDateWorked] = useState<string | null>(null);
  const [dateWorkedSaving, setDateWorkedSaving] = useState(false);

  // Submissions per retailer
  const [submissionsMap, setSubmissionsMap] = useState<Record<string, SubmissionRow[]>>({});
  const [submissionFormOpen, setSubmissionFormOpen] = useState<Record<string, boolean>>({});
  const [submissionForms, setSubmissionForms] = useState<Record<string, { submitted_at: string; category: string; notes: string }>>({});
  const [submissionSaving, setSubmissionSaving] = useState<Record<string, boolean>>({});
  // brand categories (for submission category dropdown)
  const [brandCategories, setBrandCategories] = useState<string[]>([]);

  // SKU modal state
  const [skuModal, setSkuModal] = useState<{ retailerId: string; retailerName: string } | null>(null);
  const [skuModalItems, setSkuModalItems] = useState<{ sku_description: string; upc: string }[]>([]);
  const [skuModalLoading, setSkuModalLoading] = useState(false);
  const [skuEditMode, setSkuEditMode] = useState(false);
  const [allBrandProducts, setAllBrandProducts] = useState<{ id: string; description: string; retail_upc: string | null }[]>([]);
  const [skuEditSelected, setSkuEditSelected] = useState<Set<string>>(new Set()); // set of upc strings
  const [skuEditSaving, setSkuEditSaving] = useState(false);

  // Task form state
  const [repProfilesList, setRepProfilesList] = useState<{ id: string; full_name: string }[]>([]);
  const [taskFormOpen, setTaskFormOpen] = useState<Record<string, boolean>>({});
  const [taskForms, setTaskForms] = useState<Record<string, { title: string; notes: string; due_date: string; assigned_to: string }>>({});
  const [taskSaving, setTaskSaving] = useState<Record<string, boolean>>({});
  const [retailerTasksMap, setRetailerTasksMap] = useState<Record<string, RetailerTask[]>>({});

  const isRepOrAdmin = role === "admin" || role === "rep";

  const didHashScrollRef = useRef(false);

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
          .select("role,full_name")
          .eq("id", userId)
          .maybeSingle();

        if (profileError) {
          setStatus(profileError.message);
          return;
        }

        resolvedRole = (profileData?.role as Role) ?? "client";
        setRole(resolvedRole);
        setUserFullName(profileData?.full_name ?? "");
      }

      const { data: brandData, error: brandError } = await supabase
        .from("brands")
        .select("id,name,message_notifications_enabled")
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
        .not("rep_owner_user_id", "is", null)
        .order("banner", { ascending: true });

      if (retailerError) {
        setStatus(retailerError.message);
        return;
      }
      setRetailers((retailerData as Retailer[]) ?? []);

      const { data: pipelineData, error: pipelineError } = await supabase
        .from("brand_retailer_timing")
        .select("id,brand_id,retailer_id,account_status,schedule_mode,submitted_date,submitted_notes,notes,authorized_items_note,universal_category")
        .eq("brand_id", brandId);

      if (pipelineError) {
        setStatus(pipelineError.message);
        return;
      }

      const nextPipelineMap: Record<string, PipelineRow[]> = {};
      (pipelineData ?? []).forEach((row: any) => {
        if (!nextPipelineMap[row.retailer_id]) nextPipelineMap[row.retailer_id] = [];
        nextPipelineMap[row.retailer_id].push({
          id: row.id,
          brand_id: row.brand_id,
          retailer_id: row.retailer_id,
          account_status: (row.account_status ?? "upcoming_review") as AccountStatus,
          schedule_mode: (row.schedule_mode ?? "open") as "scheduled" | "open",
          submitted_date: row.submitted_date ?? null,
          submitted_notes: row.submitted_notes ?? null,
          notes: row.notes ?? null,
          authorized_items_note: row.authorized_items_note ?? null,
          universal_category: row.universal_category ?? null,
        });
      });
      // Sort: null/primary category first, then alphabetical
      Object.keys(nextPipelineMap).forEach((rid) => {
        nextPipelineMap[rid].sort((a, b) => {
          if (!a.universal_category && b.universal_category) return -1;
          if (a.universal_category && !b.universal_category) return 1;
          return (a.universal_category ?? "").localeCompare(b.universal_category ?? "");
        });
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

      const { data: dismissalData } = await supabase
        .from("brand_category_review_dismissals")
        .select("retailer_name,universal_category,retailer_category_review_name")
        .eq("brand_id", brandId);

      const dismissedKeys = new Set<string>(
        ((dismissalData ?? []) as Array<{ retailer_name: string; universal_category: string; retailer_category_review_name: string }>).map((d) =>
          rowKey(d.retailer_name, d.universal_category, d.retailer_category_review_name)
        )
      );
      setDismissedReviewKeys(dismissedKeys);

      const { data: manualData } = await supabase
        .from("brand_retailer_category_timing")
        .select("id,brand_id,retailer_id,category,category_review_date,reset_date,notes")
        .eq("brand_id", brandId);

      const nextSavedManual: Record<string, ManualReviewRow[]> = {};
      ((manualData ?? []) as ManualReviewRow[]).forEach((row) => {
        if (!nextSavedManual[row.retailer_id]) nextSavedManual[row.retailer_id] = [];
        nextSavedManual[row.retailer_id].push(row);
      });
      setSavedManualReviews(nextSavedManual);
      setPendingManualReviews({});

      const { data: authorizedData } = await supabase
        .from("authorized_accounts_with_brand_id")
        .select("retailer_id,authorized_item_count,authorized_upc_count")
        .eq("brand_id", brandId);

      const nextAuthorizedMap: Record<string, AuthorizedRow> = {};
      ((authorizedData ?? []) as AuthorizedRow[]).forEach((row) => {
        nextAuthorizedMap[row.retailer_id] = row;
      });
      setAuthorizedMap(nextAuthorizedMap);

      // Load all messages per retailer for inline display
      const isAdminOrRep = resolvedRole === "admin" || resolvedRole === "rep";
      let msgsQuery = supabase
        .from("brand_retailer_messages")
        .select("id,brand_id,retailer_id,sender_name,body,created_at,visibility")
        .eq("brand_id", brandId)
        .order("created_at", { ascending: false });

      if (!isAdminOrRep) {
        msgsQuery = msgsQuery.eq("visibility", "client");
      } else {
        msgsQuery = msgsQuery.in("visibility", ["client", "internal"]);
      }

      const { data: messagesData } = await msgsQuery;

      const nextInlineMessages: Record<string, { client: MessageRow[]; internal: MessageRow[] }> = {};
      ((messagesData ?? []) as MessageRow[]).forEach((m) => {
        if (!nextInlineMessages[m.retailer_id]) {
          nextInlineMessages[m.retailer_id] = { client: [], internal: [] };
        }
        const stream = m.visibility === "internal" ? "internal" : "client";
        nextInlineMessages[m.retailer_id][stream].push(m);
      });
      setInlineMessages(nextInlineMessages);

      // Load all attachments for this brand in a single query
      const { data: attachmentsData } = await supabase
        .from("brand_retailer_attachments")
        .select("id,retailer_id,message_id,bucket_name,storage_path,file_name,mime_type,file_size")
        .eq("brand_id", brandId);

      const nextCardAttachments: Record<string, Record<string, AttachmentRow[]>> = {};
      ((attachmentsData ?? []) as AttachmentRow[]).forEach((a) => {
        if (!a.message_id) return;
        if (!nextCardAttachments[a.retailer_id]) nextCardAttachments[a.retailer_id] = {};
        if (!nextCardAttachments[a.retailer_id][a.message_id]) nextCardAttachments[a.retailer_id][a.message_id] = [];
        nextCardAttachments[a.retailer_id][a.message_id].push(a);
      });
      setCardAttachments(nextCardAttachments);

      // Fetch open tasks for this brand to display on retailer cards
      if (resolvedRole === "admin" || resolvedRole === "rep") {
        const { data: tasksData } = await supabase
          .from("tasks")
          .select("id,title,due_date,retailer_id,assigned_profile:profiles!assigned_to(full_name)")
          .eq("brand_id", brandId)
          .eq("status", "open")
          .order("due_date", { ascending: true, nullsFirst: false });

        const nextTasksMap: Record<string, RetailerTask[]> = {};
        ((tasksData ?? []) as unknown as (RetailerTask & { retailer_id: string | null })[]).forEach((t) => {
          if (!t.retailer_id) return;
          if (!nextTasksMap[t.retailer_id]) nextTasksMap[t.retailer_id] = [];
          nextTasksMap[t.retailer_id].push(t);
        });
        setRetailerTasksMap(nextTasksMap);
      }

      // Fetch most recent date worked for this brand + logged-in rep
      if ((resolvedRole === "admin" || resolvedRole === "rep") && userId) {
        const { data: workedData } = await supabase
          .from("brand_date_worked")
          .select("worked_at")
          .eq("brand_id", brandId)
          .eq("rep_id", userId)
          .order("worked_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        setDateWorked(workedData?.worked_at ?? null);
      }

      // Fetch submissions for this brand
      const { data: submissionsData } = await supabase
        .from("submissions")
        .select("id,brand_id,retailer_id,category,submitted_at,notes,created_by")
        .eq("brand_id", brandId)
        .order("submitted_at", { ascending: false });

      const nextSubmissionsMap: Record<string, SubmissionRow[]> = {};
      ((submissionsData ?? []) as SubmissionRow[]).forEach((s) => {
        if (!nextSubmissionsMap[s.retailer_id]) nextSubmissionsMap[s.retailer_id] = [];
        nextSubmissionsMap[s.retailer_id].push(s);
      });
      setSubmissionsMap(nextSubmissionsMap);

      // Fetch brand categories for submission dropdown
      const { data: catData } = await supabase
        .from("brand_category_access")
        .select("universal_category")
        .eq("brand_id", brandId)
        .order("universal_category");
      setBrandCategories(((catData ?? []) as { universal_category: string }[]).map((c) => c.universal_category));

      // Scroll to hashed retailer card after all data is loaded and rendered.
      // We defer with setTimeout so React has flushed all the state updates above
      // into the DOM before we attempt getElementById.
      if (!didHashScrollRef.current) {
        const hash = window.location.hash;
        if (hash) {
          const targetId = hash.slice(1);
          setTimeout(() => {
            const el = document.getElementById(targetId);
            if (!el) {
              console.warn(`[hash-scroll] element #${targetId} not found — may be filtered out`);
              return;
            }
            el.scrollIntoView({ behavior: "smooth", block: "start" });
            didHashScrollRef.current = true;
          }, 100);
        }
      }
    }

    load();
  }, [brandId]);

  // Fetch rep profiles for task assignment (admin/rep only)
  useEffect(() => {
    if (!isRepOrAdmin) return;
    supabase
      .from("profiles")
      .select("id,full_name")
      .in("role", ["rep", "admin"])
      .order("full_name")
      .then(({ data }) => {
        setRepProfilesList((data as { id: string; full_name: string }[]) ?? []);
      });
  }, [isRepOrAdmin]);

  // Generate signed URLs for all image attachments whenever cardAttachments loads
  useEffect(() => {
    const allAttachments = Object.values(cardAttachments).flatMap((byMsg) =>
      Object.values(byMsg).flat()
    );
    const imageAttachments = allAttachments.filter((a) => isImageMime(a.mime_type));
    if (!imageAttachments.length) return;

    Promise.all(
      imageAttachments.map(async (a) => {
        const { data } = await supabase.storage
          .from(a.bucket_name)
          .createSignedUrl(a.storage_path, 3600);
        return { id: a.id, url: data?.signedUrl ?? null };
      })
    ).then((results) => {
      const next: Record<string, string> = {};
      results.forEach(({ id, url }) => { if (url) next[id] = url; });
      setSignedImageUrls((prev) => ({ ...prev, ...next }));
    });
  }, [cardAttachments]);

  const repOptions = useMemo(() => {
    return Array.from(
      new Set(retailers.map((r) => r.team_owner).filter((v): v is string => !!v && v.trim() !== ""))
    ).sort((a, b) => a.localeCompare(b));
  }, [retailers]);

  function defaultPipelineRow(retailerId: string): PipelineRow {
    return {
      brand_id: brandId,
      retailer_id: retailerId,
      account_status: "",
      schedule_mode: "open",
      submitted_date: null,
      submitted_notes: null,
      notes: null,
      authorized_items_note: null,
      universal_category: null,
    };
  }

  // Update a field on the primary (first) row — used for authorized_items_note
  function updateLocal(retailerId: string, patch: Partial<PipelineRow>) {
    setPipelineMap((prev) => {
      const rows = prev[retailerId] ?? [defaultPipelineRow(retailerId)];
      return { ...prev, [retailerId]: rows.map((r, i) => i === 0 ? { ...r, ...patch } : r) };
    });
  }

  // Update a specific row by id
  function updateLocalRow(retailerId: string, rowId: string | undefined, patch: Partial<PipelineRow>) {
    setPipelineMap((prev) => {
      const rows = prev[retailerId] ?? [defaultPipelineRow(retailerId)];
      return {
        ...prev,
        [retailerId]: rows.map((r) => r.id === rowId ? { ...r, ...patch } : r),
      };
    });
  }

  function updateDateEdit(key: string, field: "review_date" | "reset_date", value: string | null) {
    setPendingDateEdits((prev) => ({
      ...prev,
      [key]: { ...prev[key], [field]: value },
    }));
  }

  // Save a single brand_retailer_timing row (account_status, submitted_date, etc.)
  async function saveRow(retailerId: string, pRow: PipelineRow) {
    setStatus("Saving…");

    // Also save authorized_items_note from the primary row whenever any row is saved
    const primaryRow = (pipelineMap[retailerId] ?? [defaultPipelineRow(retailerId)])[0];

    if (pRow.id) {
      const { error } = await supabase
        .from("brand_retailer_timing")
        .update({
          account_status: pRow.account_status,
          schedule_mode: pRow.schedule_mode,
          submitted_date: pRow.submitted_date,
          submitted_notes: pRow.submitted_notes,
          notes: pRow.notes,
          authorized_items_note: pRow.id === primaryRow.id ? primaryRow.authorized_items_note : undefined,
          last_activity_at: new Date().toISOString(),
        })
        .eq("id", pRow.id);
      if (error) { setStatus(error.message); return; }
    } else {
      const { data: inserted, error } = await supabase
        .from("brand_retailer_timing")
        .upsert({
          brand_id: brandId,
          retailer_id: retailerId,
          account_status: pRow.account_status,
          schedule_mode: pRow.schedule_mode,
          submitted_date: pRow.submitted_date,
          submitted_notes: pRow.submitted_notes,
          notes: pRow.notes,
          authorized_items_note: pRow.authorized_items_note,
          universal_category: pRow.universal_category,
          last_activity_at: new Date().toISOString(),
        }, { onConflict: "brand_id,retailer_id,universal_category" })
        .select("id")
        .single();
      if (error) { setStatus(error.message); return; }
      if (inserted?.id) {
        setPipelineMap((prev) => {
          const rows = prev[retailerId] ?? [];
          return {
            ...prev,
            [retailerId]: rows.map((r) =>
              r.id === undefined && r.universal_category === pRow.universal_category
                ? { ...r, id: inserted.id }
                : r
            ),
          };
        });
      }
    }

    setStatus("Saved ✅");
  }

  // Save authorized_items_note + date overrides + manual reviews (non-pipeline fields)
  async function save(retailerId: string) {
    setStatus("Saving…");

    // Save authorized_items_note on the primary row
    const primaryRow = (pipelineMap[retailerId] ?? [defaultPipelineRow(retailerId)])[0];
    if (primaryRow.id) {
      const { error } = await supabase
        .from("brand_retailer_timing")
        .update({ authorized_items_note: primaryRow.authorized_items_note })
        .eq("id", primaryRow.id);
      if (error) { setStatus(error.message); return; }
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

    // Insert pending manual review rows (non-empty category only)
    const drafts = (pendingManualReviews[retailerId] ?? []).filter((d) => d.category.trim());
    for (const draft of drafts) {
      const { data: inserted, error: manualError } = await supabase
        .from("brand_retailer_category_timing")
        .insert({
          brand_id: brandId,
          retailer_id: retailerId,
          category: draft.category.trim(),
          category_review_date: draft.category_review_date || null,
          reset_date: draft.reset_date || null,
          notes: draft.notes || null,
        })
        .select("id,brand_id,retailer_id,category,category_review_date,reset_date,notes")
        .single();

      if (manualError) {
        setStatus(manualError.message);
        return;
      }

      if (inserted) {
        setSavedManualReviews((prev) => ({
          ...prev,
          [retailerId]: [...(prev[retailerId] ?? []), inserted as ManualReviewRow],
        }));
      }
    }
    setPendingManualReviews((prev) => ({ ...prev, [retailerId]: [] }));

    setStatus("Saved ✅");
  }

  async function saveTask(retailerId: string) {
    const form = taskForms[retailerId];
    if (!form?.title?.trim()) return;
    setTaskSaving((prev) => ({ ...prev, [retailerId]: true }));
    try {
      await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.title.trim(),
          notes: form.notes || null,
          due_date: form.due_date || null,
          assigned_to: form.assigned_to || userId || null,
          created_by: userId || null,
          brand_id: brandId,
          retailer_id: retailerId,
        }),
      });
      setTaskFormOpen((prev) => ({ ...prev, [retailerId]: false }));
      setTaskForms((prev) => ({ ...prev, [retailerId]: { title: "", notes: "", due_date: "", assigned_to: "" } }));
      // Optimistically prepend to the retailer task list
      const assigneeName = repProfilesList.find((p) => p.id === (form.assigned_to || userId))?.full_name ?? null;
      const optimisticTask: RetailerTask = {
        id: `optimistic-${Date.now()}`,
        title: form.title.trim(),
        due_date: form.due_date || null,
        assigned_profile: { full_name: assigneeName },
      };
      setRetailerTasksMap((prev) => ({
        ...prev,
        [retailerId]: [optimisticTask, ...(prev[retailerId] ?? [])],
      }));
    } finally {
      setTaskSaving((prev) => ({ ...prev, [retailerId]: false }));
    }
  }

  async function saveSubmission(retailerId: string) {
    const form = submissionForms[retailerId];
    if (!form?.submitted_at) return;
    setSubmissionSaving((prev) => ({ ...prev, [retailerId]: true }));
    const { data: inserted, error } = await supabase
      .from("submissions")
      .insert({
        brand_id: brandId,
        retailer_id: retailerId,
        category: form.category || null,
        submitted_at: form.submitted_at,
        notes: form.notes || null,
        created_by: userId || null,
      })
      .select("id,brand_id,retailer_id,category,submitted_at,notes,created_by")
      .single();
    setSubmissionSaving((prev) => ({ ...prev, [retailerId]: false }));
    if (error) { setStatus(error.message); return; }
    if (inserted) {
      setSubmissionsMap((prev) => ({
        ...prev,
        [retailerId]: [inserted as SubmissionRow, ...(prev[retailerId] ?? [])],
      }));
    }
    setSubmissionFormOpen((prev) => ({ ...prev, [retailerId]: false }));
    setSubmissionForms((prev) => ({ ...prev, [retailerId]: { submitted_at: todayISO(), category: "", notes: "" } }));
  }

  async function deleteSubmission(retailerId: string, submissionId: string) {
    const { error } = await supabase.from("submissions").delete().eq("id", submissionId);
    if (error) { setStatus(error.message); return; }
    setSubmissionsMap((prev) => ({
      ...prev,
      [retailerId]: (prev[retailerId] ?? []).filter((s) => s.id !== submissionId),
    }));
  }

  async function markWorkedBrand() {
    if (!userId || !brandId) return;
    setDateWorkedSaving(true);
    const today = new Date().toISOString().split("T")[0];
    const { error } = await supabase.from("brand_date_worked").insert({
      brand_id: brandId,
      rep_id: userId,
      worked_at: today,
    });
    if (!error) setDateWorked(today);
    setDateWorkedSaving(false);
  }

  async function openSkuModal(retailerId: string, retailerName: string) {
    setSkuModal({ retailerId, retailerName });
    setSkuEditMode(false);
    setSkuModalLoading(true);
    setSkuModalItems([]);

    const brandName = brand?.name ?? "";

    // Two separate queries to avoid PostgREST .or() issues with ilike percent signs:
    // Query 1: rows with brand_id set; Query 2: legacy rows with brand_id null matched by client_name
    const [byIdRes, byNameRes, bpRes] = await Promise.all([
      supabase.from("authorized_products").select("upc").eq("brand_id", brandId).eq("retailer_id", retailerId),
      supabase.from("authorized_products").select("upc").is("brand_id", null).ilike("client_name", `%${brandName}%`).eq("retailer_id", retailerId),
      supabase.from("brand_products").select("id,description,retail_upc").eq("brand_id", brandId).order("description"),
    ]);

    // Merge and deduplicate by UPC
    const seenUpcs = new Set<string>();
    const mergedUpcs: { upc: string }[] = [];
    for (const r of [...(byIdRes.data ?? []), ...(byNameRes.data ?? [])] as { upc: string }[]) {
      if (r.upc && !seenUpcs.has(r.upc)) { seenUpcs.add(r.upc); mergedUpcs.push(r); }
    }
    mergedUpcs.sort((a, b) => a.upc.localeCompare(b.upc));

    const bpData = (bpRes.data ?? []) as { id: string; description: string; retail_upc: string | null }[];

    // Join descriptions from brand_products by UPC
    const bpByUpc: Record<string, string> = {};
    bpData.forEach((p) => { if (p.retail_upc) bpByUpc[p.retail_upc] = p.description; });

    setAllBrandProducts(bpData);
    setSkuModalItems(
      mergedUpcs.map((r) => ({ sku_description: bpByUpc[r.upc] ?? r.upc, upc: r.upc }))
    );
    setSkuModalLoading(false);
  }

  function enterSkuEditMode() {
    const currentUpcs = new Set(skuModalItems.map((i) => i.upc).filter(Boolean));
    setSkuEditSelected(currentUpcs);
    setSkuEditMode(true);
  }

  async function saveSkuEdit() {
    if (!skuModal || !brand) return;
    setSkuEditSaving(true);

    const brandName = brand.name;
    const retailerId = skuModal.retailerId;
    const retailerName = skuModal.retailerName;

    // Determine additions and removals by comparing with current authorized set
    const currentUpcs = new Set(skuModalItems.map((i) => i.upc).filter(Boolean));
    const toAdd = [...skuEditSelected].filter((upc) => !currentUpcs.has(upc));
    const toRemove = [...currentUpcs].filter((upc) => !skuEditSelected.has(upc));

    // Remove deauthorized rows (scoped to this brand+retailer+upc)
    for (const upc of toRemove) {
      await supabase
        .from("authorized_products")
        .delete()
        .eq("brand_id", brandId)
        .eq("retailer_id", retailerId)
        .eq("upc", String(upc));
    }

    // Add newly authorized rows
    if (toAdd.length > 0) {
      const insertRows = toAdd.map((upc) => {
        const product = allBrandProducts.find((p) => p.retail_upc === upc);
        return {
          brand_id: brandId,
          client_name: brandName,
          brand_source: brandName,
          sku_description: product?.description ?? upc,
          upc: String(upc),
          raw_retailer_name: retailerName,
          retailer_name: retailerName,
          retailer_id: retailerId,
          authorized: true,
          authorization_source: "manual",
        };
      });
      await supabase.from("authorized_products").insert(insertRows);
    }

    // Refresh modal items using brand_id + retailer_id
    const { data } = await supabase
      .from("authorized_products")
      .select("sku_description,upc")
      .eq("brand_id", brandId)
      .eq("retailer_id", retailerId)
      .order("sku_description");

    setSkuModalItems((data ?? []) as { sku_description: string; upc: string }[]);
    setSkuEditMode(false);
    setSkuEditSaving(false);
  }

  async function openAttachment(storagePath: string) {
    const { data, error } = await supabase.storage
      .from("brand-message-attachments")
      .createSignedUrl(storagePath, 60);
    if (error || !data?.signedUrl) {
      setStatus(error?.message || "Unable to open attachment.");
      return;
    }
    window.open(data.signedUrl, "_blank");
  }

  async function dismissReview(review: CategoryReviewRow) {
    if (!userId) return;
    const key = rowKey(review.retailer_name, review.universal_category, review.retailer_category_review_name);

    // Optimistic
    setDismissedReviewKeys((prev) => new Set([...prev, key]));

    const { error } = await supabase
      .from("brand_category_review_dismissals")
      .upsert(
        {
          brand_id: brandId,
          retailer_name: review.retailer_name,
          retailer_id: review.retailer_id ?? null,
          universal_category: review.universal_category,
          retailer_category_review_name: review.retailer_category_review_name ?? "",
          review_date: review.review_date ?? null,
          dismissed_by_user_id: userId,
        },
        { onConflict: "brand_id,retailer_name,universal_category,retailer_category_review_name" }
      );

    if (error) {
      setDismissedReviewKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
      setStatus(error.message);
    }
  }

  async function restoreReview(review: CategoryReviewRow) {
    const key = rowKey(review.retailer_name, review.universal_category, review.retailer_category_review_name);

    // Optimistic
    setDismissedReviewKeys((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });

    const { error } = await supabase
      .from("brand_category_review_dismissals")
      .delete()
      .eq("brand_id", brandId)
      .eq("retailer_name", review.retailer_name)
      .eq("universal_category", review.universal_category)
      .eq("retailer_category_review_name", review.retailer_category_review_name ?? "");

    if (error) {
      setDismissedReviewKeys((prev) => new Set([...prev, key]));
      setStatus(error.message);
    }
  }

  async function deleteManualReview(retailerId: string, rowId: string) {
    const { error } = await supabase
      .from("brand_retailer_category_timing")
      .delete()
      .eq("id", rowId);
    if (error) { setStatus(error.message); return; }
    setSavedManualReviews((prev) => ({
      ...prev,
      [retailerId]: (prev[retailerId] ?? []).filter((r) => r.id !== rowId),
    }));
  }

  async function saveManualEdit(retailerId: string) {
    if (!manualEditDraft || !manualEditDraft.category.trim()) return;
    const { error } = await supabase
      .from("brand_retailer_category_timing")
      .update({
        category: manualEditDraft.category.trim(),
        category_review_date: manualEditDraft.category_review_date || null,
        reset_date: manualEditDraft.reset_date || null,
        notes: manualEditDraft.notes || null,
      })
      .eq("id", manualEditDraft.id);
    if (error) { setStatus(error.message); return; }
    setSavedManualReviews((prev) => ({
      ...prev,
      [retailerId]: (prev[retailerId] ?? []).map((r) =>
        r.id === manualEditDraft.id ? { ...r, ...manualEditDraft } : r
      ),
    }));
    setManualEditingId(null);
    setManualEditDraft(null);
  }

  async function getClientEmails(): Promise<string[]> {
    if (!brandId) return [];
    const { data, error } = await supabase.rpc("get_brand_client_emails", { p_brand_id: brandId });
    if (error) return [];
    return ((data as Array<{ email: string }>) ?? []).map((r) => r.email).filter(Boolean);
  }

  async function uploadCardFile(retailerId: string, visibility: "client" | "internal", messageId: string, file: File) {
    const fileExt = file.name.split(".").pop() || "file";
    const filePath = `${brandId}/${retailerId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${fileExt}`;
    const { error: storageError } = await supabase.storage
      .from("brand-message-attachments")
      .upload(filePath, file);
    if (storageError) { console.error("Upload failed:", storageError.message); return; }
    await supabase.from("brand_retailer_attachments").insert({
      brand_id: brandId,
      retailer_id: retailerId,
      message_id: messageId,
      visibility,
      bucket_name: "brand-message-attachments",
      storage_path: filePath,
      file_name: file.name,
      mime_type: file.type || null,
      file_size: file.size,
      uploaded_by_user_id: userId,
    });
  }

  async function editMessage(messageId: string, retailerId: string, visibility: "client" | "internal", newBody: string) {
    const { error } = await supabase
      .from("brand_retailer_messages")
      .update({ body: newBody })
      .eq("id", messageId);
    if (error) { setStatus(error.message); return; }
    setInlineMessages((prev) => {
      const stream = visibility === "internal" ? "internal" : "client";
      const msgs = prev[retailerId]?.[stream] ?? [];
      return {
        ...prev,
        [retailerId]: {
          ...prev[retailerId],
          [stream]: msgs.map((m) => m.id === messageId ? { ...m, body: newBody } : m),
        },
      };
    });
    setEditingMessages((prev) => {
      const next = { ...prev };
      delete next[messageId];
      return next;
    });
  }

  async function deleteMessage(messageId: string, retailerId: string, visibility: "client" | "internal") {
    const { error } = await supabase
      .from("brand_retailer_messages")
      .delete()
      .eq("id", messageId);
    if (error) { setStatus(error.message); return; }
    setInlineMessages((prev) => {
      const stream = visibility === "internal" ? "internal" : "client";
      const msgs = prev[retailerId]?.[stream] ?? [];
      return {
        ...prev,
        [retailerId]: {
          ...prev[retailerId],
          [stream]: msgs.filter((m) => m.id !== messageId),
        },
      };
    });
    setDeletingMessageId(null);
  }

  async function sendMessage(retailerId: string) {
    const activeTab: "client" | "internal" = cardTab[retailerId] ?? "client";
    const text = (cardCompose[retailerId] ?? "").trim();
    const file = cardFile[retailerId] ?? null;
    if (!text && !file) return;

    setCardSending((prev) => ({ ...prev, [retailerId]: true }));

    const senderName = userFullName || "Cultivate";
    const { data: insertedMsg, error: msgError } = await supabase
      .from("brand_retailer_messages")
      .insert({
        brand_id: brandId,
        retailer_id: retailerId,
        visibility: activeTab,
        sender_id: userId,
        sender_name: senderName,
        body: text || "[Attachment]",
      })
      .select("id,brand_id,retailer_id,sender_name,body,created_at,visibility")
      .single();

    if (msgError || !insertedMsg) {
      setStatus(msgError?.message || "Unable to send message.");
      setCardSending((prev) => ({ ...prev, [retailerId]: false }));
      return;
    }

    // Optimistic update
    const newMsg: MessageRow = insertedMsg as MessageRow;
    setInlineMessages((prev) => {
      const current = prev[retailerId] ?? { client: [], internal: [] };
      return {
        ...prev,
        [retailerId]: {
          ...current,
          [activeTab]: [newMsg, ...current[activeTab]],
        },
      };
    });

    setCardCompose((prev) => ({ ...prev, [retailerId]: "" }));
    setCardFile((prev) => ({ ...prev, [retailerId]: null }));

    if (file) {
      await uploadCardFile(retailerId, activeTab, insertedMsg.id, file);
    }

    try {
      await logActivity({ userId, brandId, retailerId, type: "note", description: activeTab === "client" ? "Client message" : "Internal note" });
    } catch { /* non-fatal */ }

    if (isRepOrAdmin && activeTab === "client" && brand?.message_notifications_enabled) {
      try {
        const r = retailers.find((ret) => ret.id === retailerId);
        const retailerName = r?.banner?.trim() ? r.banner : r?.name ?? "Retailer";
        const recipients = await getClientEmails();
        if (recipients.length > 0) {
          await fetch("/api/send-client-email", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              brand_name: brand!.name,
              retailer_name: retailerName,
              message_body: text || "New attachment added.",
              recipients,
              actor_name: senderName,
              event_type: "message",
              brand_id: brandId,
              retailer_id: retailerId,
            }),
          });
        }
      } catch (emailErr) {
        console.error("Email notification failed", emailErr);
      }
    }

    setCardSending((prev) => ({ ...prev, [retailerId]: false }));
    setStatus("Sent ✅");
  }

  const brandName = useMemo(() => brand?.name ?? "Brand", [brand]);

  const filteredRetailers = useMemo(() => {
    const t = todayISO();
    const next30 = addDaysISO(t, 30);
    const prev30 = addDaysISO(t, -30);
    const q = query.trim().toLowerCase();

    function matchesFilter(r: Retailer): boolean {
      const rows = pipelineMap[r.id] ?? [defaultPipelineRow(r.id)];
      const primaryRow = rows[0];
      const calendarRows = calendarMap[r.id] ?? [];
      const nextReview = calendarRows.find((entry) => !!entry.review_date);

      if (selectedFilter === "all") return true;

      if (selectedFilter === "in_motion") {
        return rows.some(
          (row) =>
            row.account_status === "in_process" ||
            // legacy
            row.account_status === "open_review" ||
            row.account_status === "under_review" ||
            row.account_status === "waiting_for_retailer_to_publish_review"
        );
      }

      if (selectedFilter === "upcoming") {
        return (
          primaryRow.schedule_mode === "scheduled" &&
          !primaryRow.submitted_date &&
          !!nextReview?.review_date &&
          isBetweenInclusive(nextReview.review_date, t, next30)
        );
      }

      if (selectedFilter === "submitted_recent") {
        return rows.some(
          (row) => !!row.submitted_date && isBetweenInclusive(row.submitted_date, prev30, t)
        );
      }

      if (selectedFilter === "authorized") {
        return !!authorizedMap[r.id];
      }

      // Direct status match (new + legacy values)
      return rows.some((row) => row.account_status === selectedFilter);
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
      <div className="flex flex-wrap items-end justify-between gap-4">
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

        <div className="flex gap-2 text-sm flex-wrap">
          <Link href={`/brands/${brandId}`} className="px-3 py-1.5 rounded border hover:bg-gray-50">
            Overview
          </Link>
          <span className="px-3 py-1.5 rounded border text-white" style={{ background: "var(--foreground)" }}>
            Retailers
          </span>
          <Link href={`/brands/${brandId}/products`} className="px-3 py-1.5 rounded border hover:bg-gray-50">
            Products
          </Link>
          {isRepOrAdmin && (
            <Link href="/board" className="px-3 py-1.5 rounded border hover:bg-gray-50">
              Board
            </Link>
          )}
          <Link href={`/brands/${brandId}/category-review`} className="px-3 py-1.5 rounded border hover:bg-gray-50">
            Category Review
          </Link>
        </div>
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
            const pipelineRows = pipelineMap[r.id] ?? [defaultPipelineRow(r.id)];
            const row = pipelineRows[0]; // primary row — used for header badge, border, legacy fields
            const isMultiCategory = pipelineRows.length > 1;
            const headline = r.banner?.trim() ? r.banner : r.name;
            const allReviewRows = calendarMap[r.id] ?? [];
            const reviewRows = allReviewRows.filter(
              (rev) => !dismissedReviewKeys.has(rowKey(rev.retailer_name, rev.universal_category, rev.retailer_category_review_name))
            );
            const dismissedCardRows = isRepOrAdmin
              ? allReviewRows.filter((rev) =>
                  dismissedReviewKeys.has(rowKey(rev.retailer_name, rev.universal_category, rev.retailer_category_review_name))
                )
              : [];
            const authorized = authorizedMap[r.id];
            const hasLegacyNotes = !!row.notes?.trim();
            const activeTab: "client" | "internal" = cardTab[r.id] ?? "client";
            const clientMsgs = inlineMessages[r.id]?.client ?? [];
            const internalMsgs = inlineMessages[r.id]?.internal ?? [];
            const currentMsgs = activeTab === "client" ? clientMsgs : internalMsgs;
            const isExpanded = cardExpanded[r.id]?.[activeTab] ?? false;
            const visibleMsgs = isExpanded ? currentMsgs : currentMsgs.slice(0, 1);

            return (
              <div
                key={r.id}
                id={`retailer-${r.id}`}
                className="rounded-xl p-5 space-y-4"
                style={{
                  border: "1px solid var(--border)",
                  background: "var(--card)",
                  borderLeft: `4px solid ${statusLeftBorderColor(row.account_status)}`,
                  boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
                }}
              >
                {/* Header */}
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="font-bold text-xl" style={{ color: "var(--foreground)" }}>
                        {headline}
                      </span>
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
                      <button
                        onClick={() => openSkuModal(r.id, r.banner?.trim() ? r.banner : r.name)}
                        className="cursor-pointer"
                        title="View authorized SKUs"
                      >
                        <Badge
                          label={`${authorized.authorized_item_count} SKUs authorized`}
                          tone="good"
                        />
                      </button>
                    ) : null}
                    <a
                      className="text-xs underline cursor-pointer"
                      style={{ color: "var(--muted-foreground)" }}
                      href={`#messages-${r.id}`}
                      onClick={(e) => {
                        e.preventDefault();
                        document.getElementById(`messages-${r.id}`)?.scrollIntoView({ behavior: "smooth" });
                      }}
                    >
                      Open →
                    </a>
                  </div>
                </div>

                {/* Meta grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                  <div className="rounded-lg p-3" style={{ border: "1px solid var(--border)", background: "var(--muted)" }}>
                    <div className="text-xs mb-1" style={{ color: "var(--muted-foreground)" }}>Rep Owner</div>
                    <div className="font-medium" style={{ color: "var(--foreground)" }}>{r.team_owner || "Unassigned"}</div>
                  </div>

                  <div className="rounded-lg p-3" style={{ border: "1px solid var(--border)", background: "var(--muted)" }}>
                    <div className="text-xs mb-1" style={{ color: "var(--muted-foreground)" }}>Authorized Items (notes)</div>
                    {isRepOrAdmin ? (
                      <textarea
                        className="w-full text-sm bg-transparent resize-none focus:outline-none"
                        style={{ color: "var(--foreground)", minHeight: "2.5rem" }}
                        rows={2}
                        value={row.authorized_items_note ?? ""}
                        placeholder="e.g., 4 SKUs: Original, Salted Caramel, Maple, Vanilla — cheat sheet, see APL file for official list"
                        onChange={(e) => updateLocal(r.id, { authorized_items_note: e.target.value || null })}
                      />
                    ) : (
                      <div className="text-sm font-medium" style={{ color: row.authorized_items_note ? "var(--foreground)" : "var(--muted-foreground)" }}>
                        {row.authorized_items_note || "No notes yet"}
                      </div>
                    )}
                  </div>
                </div>

                {/* Account status — compact horizontal grid, one cell per category */}
                {isRepOrAdmin && (
                  <div className={`grid gap-2 ${pipelineRows.length === 1 ? "grid-cols-1" : pipelineRows.length === 2 ? "grid-cols-2" : "grid-cols-2 md:grid-cols-3"}`}>
                    {pipelineRows.map((pRow) => {
                      const pRowKey = pRow.id ?? `default-${r.id}-${pRow.universal_category ?? "none"}`;
                      const moreOpen = rowMoreOpen[pRowKey] ?? false;
                      return (
                        <div
                          key={pRowKey}
                          className="rounded-lg p-2.5 space-y-2"
                          style={{ border: "1px solid var(--border)", background: "var(--muted)" }}
                        >
                          {isMultiCategory ? (
                            <div className="text-xs font-semibold truncate" style={{ color: "var(--foreground)" }}>
                              {pRow.universal_category ?? "Primary"}
                            </div>
                          ) : (
                            <div className="text-xs" style={{ color: "var(--muted-foreground)" }}>Account Status</div>
                          )}
                          <select
                            className="border rounded px-2 py-1 w-full text-xs"
                            style={{ borderColor: "var(--border)", background: "var(--card)", color: "var(--foreground)" }}
                            value={pRow.account_status}
                            onChange={(e) => updateLocalRow(r.id, pRow.id, { account_status: e.target.value as AccountStatus })}
                          >
                            <option value="">— No Status —</option>
                            <option value="awaiting_submission_opportunity">Awaiting Submission Opportunity</option>
                            <option value="in_process">In Process</option>
                            <option value="retailer_declined">Retailer Declined</option>
                            <option value="not_a_target_account">Not a Target Account</option>
                            <option value="working_to_secure_anchor_account">Distributor Required</option>
                          </select>

                          {moreOpen && (
                            <div className="space-y-1.5 pt-0.5">
                              <div>
                                <div className="text-xs mb-0.5" style={{ color: "var(--muted-foreground)" }}>Submitted Date</div>
                                <input
                                  type="date"
                                  className="border rounded px-2 py-1 w-full text-xs"
                                  style={{ borderColor: "var(--border)", background: "var(--card)", color: "var(--foreground)" }}
                                  value={pRow.submitted_date ?? ""}
                                  onChange={(e) => updateLocalRow(r.id, pRow.id, { submitted_date: e.target.value || null })}
                                />
                              </div>
                              <div>
                                <div className="text-xs mb-0.5" style={{ color: "var(--muted-foreground)" }}>Submitted Notes</div>
                                <input
                                  className="border rounded px-2 py-1 w-full text-xs"
                                  style={{ borderColor: "var(--border)", background: "var(--card)", color: "var(--foreground)" }}
                                  value={pRow.submitted_notes ?? ""}
                                  onChange={(e) => updateLocalRow(r.id, pRow.id, { submitted_notes: e.target.value || null })}
                                  placeholder="Optional"
                                />
                              </div>
                            </div>
                          )}

                          <div className="flex items-center justify-between gap-1 pt-0.5">
                            <button
                              className="text-xs"
                              style={{ color: "var(--muted-foreground)" }}
                              onClick={() => setRowMoreOpen((prev) => ({ ...prev, [pRowKey]: !moreOpen }))}
                            >
                              {moreOpen ? "▴ Less" : "▾ More"}
                            </button>
                            <button
                              className="px-2.5 py-1 rounded text-xs font-medium"
                              style={{ background: "var(--foreground)", color: "var(--background)" }}
                              onClick={() => saveRow(r.id, pRow)}
                            >
                              Save
                            </button>
                          </div>
                        </div>
                      );
                    })}
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
                            <div className="flex items-start gap-2">
                              <div className="flex-1">
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
                              {isRepOrAdmin && (
                                <button
                                  className="mt-5 text-xs shrink-0 opacity-40 hover:opacity-100 transition-opacity"
                                  title="Dismiss from this brand's view"
                                  onClick={() => dismissReview(review)}
                                >
                                  ✕
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Dismissed category reviews — collapsible, reps/admins only */}
                  {isRepOrAdmin && dismissedCardRows.length > 0 && (
                    <div>
                      <button
                        className="text-xs"
                        style={{ color: "var(--muted-foreground)" }}
                        onClick={() =>
                          setCardDismissedOpen((prev) => ({ ...prev, [r.id]: !prev[r.id] }))
                        }
                      >
                        {cardDismissedOpen[r.id] ? "▾" : "▸"} Dismissed ({dismissedCardRows.length})
                      </button>
                      {cardDismissedOpen[r.id] && (
                        <div className="mt-2 space-y-2">
                          {dismissedCardRows.map((review, idx) => (
                            <div
                              key={`dismissed-${review.retailer_name}-${review.universal_category}-${idx}`}
                              className="rounded-lg px-3 py-2 text-sm flex items-center justify-between gap-3"
                              style={{ border: "1px solid var(--border)", background: "var(--muted)", opacity: 0.6 }}
                            >
                              <div className="min-w-0">
                                <span className="font-medium" style={{ color: "var(--foreground)" }}>
                                  {review.retailer_category_review_name || review.universal_category}
                                </span>
                                {review.review_date && (
                                  <span className="ml-2 text-xs" style={{ color: "var(--muted-foreground)" }}>
                                    {prettyDate(review.review_date)}
                                  </span>
                                )}
                              </div>
                              <button
                                className="text-xs underline shrink-0"
                                style={{ color: "var(--muted-foreground)" }}
                                onClick={() => restoreReview(review)}
                              >
                                Restore
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Saved manual review rows */}
                  {(savedManualReviews[r.id] ?? []).map((mr) => {
                    const isEditing = manualEditingId === mr.id;
                    const draft = isEditing ? manualEditDraft! : null;
                    return (
                      <div
                        key={mr.id}
                        className="rounded-lg p-3"
                        style={{ border: "1px solid var(--border)", background: "var(--muted)" }}
                      >
                        {isEditing && draft ? (
                          <div className="space-y-2">
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                              <div>
                                <div className="text-xs mb-1" style={{ color: "var(--muted-foreground)" }}>Category *</div>
                                <input
                                  className="border rounded-lg px-2 py-1.5 w-full text-sm"
                                  style={{ borderColor: "var(--border)", background: "var(--card)", color: "var(--foreground)" }}
                                  value={draft.category}
                                  placeholder="Category"
                                  onChange={(e) => setManualEditDraft({ ...draft, category: e.target.value })}
                                />
                              </div>
                              <div>
                                <div className="text-xs mb-1" style={{ color: "var(--muted-foreground)" }}>Review Date</div>
                                <input
                                  type="date"
                                  className="border rounded-lg px-2 py-1.5 w-full text-sm"
                                  style={{ borderColor: "var(--border)", background: "var(--card)", color: "var(--foreground)" }}
                                  value={draft.category_review_date ?? ""}
                                  onChange={(e) => setManualEditDraft({ ...draft, category_review_date: e.target.value || null })}
                                />
                              </div>
                              <div>
                                <div className="text-xs mb-1" style={{ color: "var(--muted-foreground)" }}>Reset Date</div>
                                <input
                                  type="date"
                                  className="border rounded-lg px-2 py-1.5 w-full text-sm"
                                  style={{ borderColor: "var(--border)", background: "var(--card)", color: "var(--foreground)" }}
                                  value={draft.reset_date ?? ""}
                                  onChange={(e) => setManualEditDraft({ ...draft, reset_date: e.target.value || null })}
                                />
                              </div>
                              <div>
                                <div className="text-xs mb-1" style={{ color: "var(--muted-foreground)" }}>Notes</div>
                                <input
                                  className="border rounded-lg px-2 py-1.5 w-full text-sm"
                                  style={{ borderColor: "var(--border)", background: "var(--card)", color: "var(--foreground)" }}
                                  placeholder="Optional"
                                  value={draft.notes ?? ""}
                                  onChange={(e) => setManualEditDraft({ ...draft, notes: e.target.value || null })}
                                />
                              </div>
                            </div>
                            <div className="flex gap-2 justify-end">
                              <button
                                className="text-xs px-3 py-1.5 rounded-lg"
                                style={{ border: "1px solid var(--border)", color: "var(--muted-foreground)" }}
                                onClick={() => { setManualEditingId(null); setManualEditDraft(null); }}
                              >
                                Cancel
                              </button>
                              <button
                                className="text-xs px-3 py-1.5 rounded-lg font-medium"
                                style={{ background: "var(--foreground)", color: "var(--background)" }}
                                onClick={() => saveManualEdit(r.id)}
                              >
                                Save edit
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                            <div>
                              <div className="text-xs mb-1" style={{ color: "var(--muted-foreground)" }}>Category</div>
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="font-medium" style={{ color: "var(--foreground)" }}>{mr.category}</span>
                                <span
                                  className="text-xs px-1.5 py-0.5 rounded font-medium"
                                  style={{ background: "rgba(100,116,139,0.15)", color: "var(--muted-foreground)", fontSize: "0.65rem" }}
                                >
                                  Manual
                                </span>
                              </div>
                            </div>
                            <div>
                              <div className="text-xs mb-1" style={{ color: "var(--muted-foreground)" }}>Review Date</div>
                              <div className="font-medium" style={{ color: "var(--foreground)" }}>{prettyDate(mr.category_review_date)}</div>
                            </div>
                            <div>
                              <div className="text-xs mb-1" style={{ color: "var(--muted-foreground)" }}>Reset Date</div>
                              <div className="font-medium" style={{ color: "var(--foreground)" }}>{prettyDate(mr.reset_date)}</div>
                            </div>
                            <div>
                              <div className="text-xs mb-1" style={{ color: "var(--muted-foreground)" }}>Notes</div>
                              <div className="font-medium" style={{ color: "var(--foreground)" }}>{mr.notes || "—"}</div>
                            </div>
                            {isRepOrAdmin && (
                              <div className="col-span-2 md:col-span-4 flex justify-end">
                                <div className="relative">
                                  <button
                                    className="text-xs px-2 py-0.5 rounded"
                                    style={{ border: "1px solid var(--border)", color: "var(--muted-foreground)" }}
                                    onClick={() => setManualMenuOpen(manualMenuOpen === mr.id ? null : mr.id)}
                                  >
                                    ⋯
                                  </button>
                                  {manualMenuOpen === mr.id && (
                                    <div
                                      className="absolute right-0 top-full mt-1 rounded-lg shadow-lg z-10 py-1 min-w-[100px]"
                                      style={{ background: "var(--card)", border: "1px solid var(--border)" }}
                                    >
                                      <button
                                        className="block w-full text-left px-3 py-1.5 text-xs hover:opacity-70"
                                        style={{ color: "var(--foreground)" }}
                                        onClick={() => {
                                          setManualEditingId(mr.id);
                                          setManualEditDraft({ ...mr });
                                          setManualMenuOpen(null);
                                        }}
                                      >
                                        Edit
                                      </button>
                                      <button
                                        className="block w-full text-left px-3 py-1.5 text-xs hover:opacity-70"
                                        style={{ color: "#ef4444" }}
                                        onClick={() => {
                                          setManualMenuOpen(null);
                                          if (window.confirm("Delete this manual review entry? This can't be undone.")) {
                                            deleteManualReview(r.id, mr.id);
                                          }
                                        }}
                                      >
                                        Delete
                                      </button>
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* Draft (unsaved) manual review rows */}
                  {isRepOrAdmin && (pendingManualReviews[r.id] ?? []).map((draft) => (
                    <div
                      key={draft.localId}
                      className="rounded-lg p-3"
                      style={{ border: "1px dashed var(--border)", background: "rgba(100,116,139,0.06)" }}
                    >
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                        <div>
                          <div className="text-xs mb-1" style={{ color: "var(--muted-foreground)" }}>Category *</div>
                          <input
                            className="border rounded-lg px-2 py-1.5 w-full text-sm"
                            style={{ borderColor: "var(--border)", background: "var(--card)", color: "var(--foreground)" }}
                            placeholder="Category"
                            value={draft.category}
                            onChange={(e) =>
                              setPendingManualReviews((prev) => ({
                                ...prev,
                                [r.id]: (prev[r.id] ?? []).map((d) =>
                                  d.localId === draft.localId ? { ...d, category: e.target.value } : d
                                ),
                              }))
                            }
                          />
                        </div>
                        <div>
                          <div className="text-xs mb-1" style={{ color: "var(--muted-foreground)" }}>Review Date</div>
                          <input
                            type="date"
                            className="border rounded-lg px-2 py-1.5 w-full text-sm"
                            style={{ borderColor: "var(--border)", background: "var(--card)", color: "var(--foreground)" }}
                            value={draft.category_review_date}
                            onChange={(e) =>
                              setPendingManualReviews((prev) => ({
                                ...prev,
                                [r.id]: (prev[r.id] ?? []).map((d) =>
                                  d.localId === draft.localId ? { ...d, category_review_date: e.target.value } : d
                                ),
                              }))
                            }
                          />
                        </div>
                        <div>
                          <div className="text-xs mb-1" style={{ color: "var(--muted-foreground)" }}>Reset Date</div>
                          <input
                            type="date"
                            className="border rounded-lg px-2 py-1.5 w-full text-sm"
                            style={{ borderColor: "var(--border)", background: "var(--card)", color: "var(--foreground)" }}
                            value={draft.reset_date}
                            onChange={(e) =>
                              setPendingManualReviews((prev) => ({
                                ...prev,
                                [r.id]: (prev[r.id] ?? []).map((d) =>
                                  d.localId === draft.localId ? { ...d, reset_date: e.target.value } : d
                                ),
                              }))
                            }
                          />
                        </div>
                        <div>
                          <div className="text-xs mb-1" style={{ color: "var(--muted-foreground)" }}>Notes</div>
                          <input
                            className="border rounded-lg px-2 py-1.5 w-full text-sm"
                            style={{ borderColor: "var(--border)", background: "var(--card)", color: "var(--foreground)" }}
                            placeholder="Optional"
                            value={draft.notes}
                            onChange={(e) =>
                              setPendingManualReviews((prev) => ({
                                ...prev,
                                [r.id]: (prev[r.id] ?? []).map((d) =>
                                  d.localId === draft.localId ? { ...d, notes: e.target.value } : d
                                ),
                              }))
                            }
                          />
                        </div>
                      </div>
                      <div className="flex justify-end mt-2">
                        <button
                          className="text-xs"
                          style={{ color: "var(--muted-foreground)" }}
                          onClick={() =>
                            setPendingManualReviews((prev) => ({
                              ...prev,
                              [r.id]: (prev[r.id] ?? []).filter((d) => d.localId !== draft.localId),
                            }))
                          }
                        >
                          ✕ Remove
                        </button>
                      </div>
                    </div>
                  ))}

                  {/* + Add review button */}
                  {isRepOrAdmin && (
                    <button
                      className="text-xs px-3 py-1.5 rounded-lg"
                      style={{ border: "1px dashed var(--border)", color: "var(--muted-foreground)" }}
                      onClick={() =>
                        setPendingManualReviews((prev) => ({
                          ...prev,
                          [r.id]: [
                            ...(prev[r.id] ?? []),
                            { localId: `${Date.now()}-${Math.random()}`, category: "", category_review_date: "", reset_date: "", notes: "" },
                          ],
                        }))
                      }
                    >
                      + Add review
                    </button>
                  )}
                </div>

                {/* ── Inline Messages ──────────────────────────────── */}
                <div
                  id={`messages-${r.id}`}
                  className="rounded-lg p-3 space-y-3"
                  style={{ border: "1px solid var(--border)" }}
                >
                  <div className="text-sm font-medium" style={{ color: "var(--foreground)" }}>Messages</div>

                  {/* Tab bar — team only; clients see client-visible stream with no tab chrome */}
                  {isRepOrAdmin && (
                    <div className="flex gap-2">
                      <button
                        className="px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors"
                        style={
                          activeTab === "client"
                            ? { background: "var(--foreground)", color: "var(--background)", borderColor: "var(--foreground)" }
                            : { background: "transparent", color: "var(--muted-foreground)", borderColor: "var(--border)" }
                        }
                        onClick={() => setCardTab((prev) => ({ ...prev, [r.id]: "client" }))}
                      >
                        Client-visible ({clientMsgs.length})
                      </button>
                      <button
                        className="px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors"
                        style={
                          activeTab === "internal"
                            ? { background: "var(--foreground)", color: "var(--background)", borderColor: "var(--foreground)" }
                            : { background: "transparent", color: "var(--muted-foreground)", borderColor: "var(--border)" }
                        }
                        onClick={() => setCardTab((prev) => ({ ...prev, [r.id]: "internal" }))}
                      >
                        Internal-only ({internalMsgs.length})
                      </button>
                    </div>
                  )}

                  {/* Message list */}
                  <div className="space-y-2">
                    {currentMsgs.length === 0 ? (
                      <div className="text-sm" style={{ color: "var(--muted-foreground)" }}>
                        No messages yet in this thread.
                      </div>
                    ) : (
                      <>
                        {visibleMsgs.map((m) => {
                          const attachments = cardAttachments[r.id]?.[m.id] ?? [];
                          const hideBody = m.body === "[Attachment]" && attachments.length > 0;
                          const isEditing = editingMessages[m.id] !== undefined;
                          const isDeleting = deletingMessageId === m.id;
                          return (
                            <div
                              key={m.id}
                              className="rounded-md px-3 py-2 text-sm space-y-1.5"
                              style={{ background: "var(--muted)" }}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-xs font-medium" style={{ color: "var(--foreground)" }}>
                                  {m.sender_name ?? "Cultivate"}
                                </span>
                                <div className="flex items-center gap-2 shrink-0">
                                  <span className="text-xs" style={{ color: "var(--muted-foreground)" }}>
                                    {timeAgo(m.created_at)}
                                  </span>
                                  {isRepOrAdmin && !isEditing && !isDeleting && (
                                    <>
                                      <button
                                        className="text-xs opacity-40 hover:opacity-100 transition-opacity"
                                        style={{ color: "var(--muted-foreground)" }}
                                        onClick={() => setEditingMessages((prev) => ({ ...prev, [m.id]: m.body }))}
                                      >
                                        Edit
                                      </button>
                                      <button
                                        className="text-xs opacity-40 hover:opacity-100 transition-opacity"
                                        style={{ color: "var(--muted-foreground)" }}
                                        onClick={() => setDeletingMessageId(m.id)}
                                      >
                                        Delete
                                      </button>
                                    </>
                                  )}
                                </div>
                              </div>
                              {isDeleting ? (
                                <div className="space-y-2 pt-1">
                                  <div className="text-xs" style={{ color: "var(--muted-foreground)" }}>Delete this message?</div>
                                  <div className="flex gap-2">
                                    <button
                                      className="text-xs px-2 py-1 rounded font-medium"
                                      style={{ background: "#dc2626", color: "#fff" }}
                                      onClick={() => deleteMessage(m.id, r.id, m.visibility)}
                                    >
                                      Confirm delete
                                    </button>
                                    <button
                                      className="text-xs px-2 py-1 rounded"
                                      style={{ border: "1px solid var(--border)", color: "var(--muted-foreground)" }}
                                      onClick={() => setDeletingMessageId(null)}
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                </div>
                              ) : isEditing ? (
                                <div className="space-y-2 pt-1">
                                  <textarea
                                    className="border rounded-lg px-3 py-2 w-full text-sm"
                                    style={{ borderColor: "var(--border)", background: "var(--card)", color: "var(--foreground)" }}
                                    rows={3}
                                    value={editingMessages[m.id]}
                                    onChange={(e) => setEditingMessages((prev) => ({ ...prev, [m.id]: e.target.value }))}
                                  />
                                  <div className="flex gap-2">
                                    <button
                                      className="text-xs px-2 py-1 rounded font-medium"
                                      style={{ background: "var(--foreground)", color: "var(--background)" }}
                                      onClick={() => editMessage(m.id, r.id, m.visibility, editingMessages[m.id])}
                                    >
                                      Save
                                    </button>
                                    <button
                                      className="text-xs px-2 py-1 rounded"
                                      style={{ border: "1px solid var(--border)", color: "var(--muted-foreground)" }}
                                      onClick={() => setEditingMessages((prev) => { const next = { ...prev }; delete next[m.id]; return next; })}
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <>
                                  {!hideBody && (
                                    <div style={{ color: "var(--foreground)" }}>{m.body}</div>
                                  )}
                                  {attachments.length > 0 && (
                                    <div className="space-y-1.5 pt-0.5">
                                      {attachments.map((a) => {
                                        if (isImageMime(a.mime_type)) {
                                          const url = signedImageUrls[a.id];
                                          return url ? (
                                            <img
                                              key={a.id}
                                              src={url}
                                              alt={a.file_name}
                                              title="Click to open full size"
                                              onClick={() => openAttachment(a.storage_path)}
                                              style={{
                                                maxWidth: 200,
                                                maxHeight: 160,
                                                borderRadius: 6,
                                                objectFit: "cover",
                                                display: "block",
                                                cursor: "pointer",
                                              }}
                                              onError={(e) => {
                                                (e.currentTarget as HTMLImageElement).style.display = "none";
                                                e.currentTarget.insertAdjacentText("afterend", "File unavailable");
                                              }}
                                            />
                                          ) : (
                                            <div key={a.id} className="text-xs italic" style={{ color: "var(--muted-foreground)" }}>
                                              Loading image…
                                            </div>
                                          );
                                        }
                                        return (
                                          <button
                                            key={a.id}
                                            type="button"
                                            onClick={() => openAttachment(a.storage_path)}
                                            className="flex items-center gap-1.5 text-xs rounded-md px-2 py-1.5 hover:opacity-80 transition-opacity"
                                            style={{
                                              background: "var(--secondary)",
                                              border: "1px solid var(--border)",
                                              color: "var(--foreground)",
                                            }}
                                          >
                                            📄 {a.file_name}
                                            {a.file_size ? <span style={{ color: "var(--muted-foreground)" }}>· {formatFileSize(a.file_size)}</span> : null}
                                          </button>
                                        );
                                      })}
                                    </div>
                                  )}
                                </>
                              )}
                            </div>
                          );
                        })}
                        {currentMsgs.length > 1 && (
                          <button
                            className="text-xs pt-0.5"
                            style={{ color: "var(--muted-foreground)" }}
                            onClick={() =>
                              setCardExpanded((prev) => ({
                                ...prev,
                                [r.id]: { ...(prev[r.id] ?? { client: false, internal: false }), [activeTab]: !isExpanded },
                              }))
                            }
                          >
                            {isExpanded ? "Show less" : `Show all messages (${currentMsgs.length})`}
                          </button>
                        )}
                      </>
                    )}
                  </div>

                  {/* Compose box */}
                  <div
                    className="rounded-lg p-3 space-y-2"
                    style={
                      activeTab === "internal"
                        ? { background: "rgba(100,116,139,0.08)", border: "1px solid var(--border)" }
                        : { border: "1px solid var(--border)" }
                    }
                  >
                    {activeTab === "internal" && (
                      <div className="text-xs font-medium" style={{ color: "var(--muted-foreground)" }}>
                        Not visible to client
                      </div>
                    )}
                    <div className="text-xs mb-1" style={{ color: "var(--muted-foreground)" }}>
                      {activeTab === "client" ? "New client-visible message" : "New internal-only note"}
                    </div>
                    <textarea
                      className="border rounded-lg px-3 py-2 w-full text-sm"
                      style={{ borderColor: "var(--border)", background: "var(--card)", color: "var(--foreground)" }}
                      rows={3}
                      placeholder={
                        activeTab === "client"
                          ? "Write a message the client can see…"
                          : "Write an internal-only note…"
                      }
                      value={cardCompose[r.id] ?? ""}
                      onChange={(e) => setCardCompose((prev) => ({ ...prev, [r.id]: e.target.value }))}
                    />
                    <div className="flex items-center justify-between gap-2">
                      <label
                        className="text-xs cursor-pointer flex items-center gap-1"
                        style={{ color: "var(--muted-foreground)" }}
                      >
                        <input
                          type="file"
                          className="hidden"
                          onChange={(e) =>
                            setCardFile((prev) => ({ ...prev, [r.id]: e.target.files?.[0] ?? null }))
                          }
                        />
                        📎 {cardFile[r.id] ? cardFile[r.id]!.name : "Attach file"}
                      </label>
                      {cardFile[r.id] && (
                        <button
                          className="text-xs"
                          style={{ color: "var(--muted-foreground)" }}
                          onClick={() => setCardFile((prev) => ({ ...prev, [r.id]: null }))}
                        >
                          ✕ Remove
                        </button>
                      )}
                      <button
                        className="ml-auto px-4 py-1.5 rounded-lg text-sm font-medium"
                        style={{
                          background: "var(--primary, #14b8a6)",
                          color: "var(--primary-foreground, #fff)",
                          opacity: cardSending[r.id] ? 0.6 : 1,
                        }}
                        disabled={!!cardSending[r.id]}
                        onClick={() => sendMessage(r.id)}
                      >
                        {cardSending[r.id] ? "Sending…" : "Send"}
                      </button>
                    </div>
                  </div>
                </div>


                {hasLegacyNotes ? (
                  <div>
                    <div className="text-xs mb-1" style={{ color: "var(--muted-foreground)" }}>Legacy Notes</div>
                    <textarea
                      className="border rounded-lg px-3 py-2 w-full text-sm"
                      style={{ borderColor: "var(--border)", background: "var(--card)", color: "var(--foreground)" }}
                      rows={3}
                      value={row.notes ?? ""}
                      onChange={(e) => updateLocalRow(r.id, row.id, { notes: e.target.value || null })}
                    />
                  </div>
                ) : null}

                {isRepOrAdmin ? (
                  <button
                    className="px-4 py-2 rounded-lg text-sm font-medium"
                    style={{ background: "var(--foreground)", color: "var(--background)" }}
                    onClick={() => save(r.id)}
                  >
                    Save Calendar Changes
                  </button>
                ) : null}

                {isRepOrAdmin ? (
                  <div className="border-t border-border pt-4 mt-2 space-y-3">
                    {(retailerTasksMap[r.id] ?? []).length > 0 && (
                      <div className="space-y-1.5">
                        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Open Tasks</div>
                        {(retailerTasksMap[r.id] ?? []).map((t) => {
                          const today = todayISO();
                          const urgency = !t.due_date ? "normal" : t.due_date < today ? "overdue" : t.due_date <= (() => { const d = new Date(today + "T00:00:00"); d.setDate(d.getDate() + 7); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; })() ? "soon" : "normal";
                          return (
                            <div
                              key={t.id}
                              className={`flex items-center justify-between gap-2 rounded px-2 py-1.5 text-sm ${urgency === "overdue" ? "bg-red-50 border border-red-200" : urgency === "soon" ? "bg-amber-50 border border-amber-200" : "bg-secondary border border-border"}`}
                            >
                              <span className="font-medium truncate text-foreground">{t.title}</span>
                              <div className="flex items-center gap-2 flex-shrink-0 text-xs text-muted-foreground whitespace-nowrap">
                                {t.assigned_profile?.full_name && <span>{t.assigned_profile.full_name}</span>}
                                {t.due_date && (
                                  <span className={urgency === "overdue" ? "text-red-600 font-medium" : urgency === "soon" ? "text-amber-600 font-medium" : ""}>
                                    {prettyDate(t.due_date)}
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {!taskFormOpen[r.id] ? (
                      <button
                        onClick={() => {
                          setTaskFormOpen((prev) => ({ ...prev, [r.id]: true }));
                          if (!taskForms[r.id]) {
                            setTaskForms((prev) => ({
                              ...prev,
                              [r.id]: { title: "", notes: "", due_date: "", assigned_to: userId ?? "" },
                            }));
                          }
                        }}
                        className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                      >
                        + Add Task
                      </button>
                    ) : (
                      <div className="space-y-3">
                        <div className="text-sm font-medium text-foreground">New Task</div>
                        <input
                          type="text"
                          placeholder="Task title"
                          value={taskForms[r.id]?.title ?? ""}
                          onChange={(e) => setTaskForms((prev) => ({ ...prev, [r.id]: { ...prev[r.id], title: e.target.value } }))}
                          className="border rounded-lg px-3 py-2 w-full text-sm"
                          style={{ borderColor: "var(--border)", background: "var(--card)", color: "var(--foreground)" }}
                        />
                        <textarea
                          placeholder="Notes (optional)"
                          value={taskForms[r.id]?.notes ?? ""}
                          onChange={(e) => setTaskForms((prev) => ({ ...prev, [r.id]: { ...prev[r.id], notes: e.target.value } }))}
                          rows={2}
                          className="border rounded-lg px-3 py-2 w-full text-sm"
                          style={{ borderColor: "var(--border)", background: "var(--card)", color: "var(--foreground)" }}
                        />
                        <div className="flex gap-3 flex-wrap">
                          <div className="flex-1 min-w-0">
                            <label className="block text-xs text-muted-foreground mb-1">Due Date</label>
                            <input
                              type="date"
                              value={taskForms[r.id]?.due_date ?? ""}
                              onChange={(e) => setTaskForms((prev) => ({ ...prev, [r.id]: { ...prev[r.id], due_date: e.target.value } }))}
                              className="border rounded-lg px-3 py-2 w-full text-sm"
                              style={{ borderColor: "var(--border)", background: "var(--card)", color: "var(--foreground)" }}
                            />
                          </div>
                          <div className="flex-1 min-w-0">
                            <label className="block text-xs text-muted-foreground mb-1">Assign To</label>
                            <select
                              value={taskForms[r.id]?.assigned_to ?? ""}
                              onChange={(e) => setTaskForms((prev) => ({ ...prev, [r.id]: { ...prev[r.id], assigned_to: e.target.value } }))}
                              className="border rounded-lg px-3 py-2 w-full text-sm"
                              style={{ borderColor: "var(--border)", background: "var(--card)", color: "var(--foreground)" }}
                            >
                              <option value={userId ?? ""}>Me</option>
                              {repProfilesList.filter((p) => p.id !== userId).map((p) => (
                                <option key={p.id} value={p.id}>{p.full_name}</option>
                              ))}
                            </select>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => saveTask(r.id)}
                            disabled={!taskForms[r.id]?.title?.trim() || taskSaving[r.id]}
                            className="px-3 py-1.5 rounded-lg text-sm font-medium disabled:opacity-50"
                            style={{ background: "var(--foreground)", color: "var(--background)" }}
                          >
                            {taskSaving[r.id] ? "Saving…" : "Save Task"}
                          </button>
                          <button
                            onClick={() => setTaskFormOpen((prev) => ({ ...prev, [r.id]: false }))}
                            className="px-3 py-1.5 rounded-lg text-sm text-muted-foreground hover:text-foreground transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ) : null}

                {/* Submissions — rep/admin only */}
                {isRepOrAdmin && (() => {
                  const retailerSubmissions = submissionsMap[r.id] ?? [];
                  const formOpen = submissionFormOpen[r.id] ?? false;
                  const form = submissionForms[r.id] ?? { submitted_at: todayISO(), category: "", notes: "" };
                  return (
                    <div className="border rounded-lg p-3 space-y-2" style={{ border: "1px solid var(--border)" }}>
                      <div className="flex items-center justify-between">
                        <div className="text-sm font-medium" style={{ color: "var(--foreground)" }}>Submissions</div>
                        {!formOpen && (
                          <button
                            onClick={() => {
                              setSubmissionFormOpen((prev) => ({ ...prev, [r.id]: true }));
                              setSubmissionForms((prev) => ({
                                ...prev,
                                [r.id]: prev[r.id] ?? { submitted_at: todayISO(), category: "", notes: "" },
                              }));
                            }}
                            className="text-xs font-medium"
                            style={{ color: "var(--foreground)" }}
                          >
                            + Add Submission
                          </button>
                        )}
                      </div>

                      {retailerSubmissions.length === 0 && !formOpen && (
                        <div className="text-xs" style={{ color: "var(--muted-foreground)" }}>No submissions yet.</div>
                      )}

                      {retailerSubmissions.length > 0 && (
                        <div className="space-y-1.5">
                          {retailerSubmissions.map((s) => (
                            <div key={s.id} className="flex items-start justify-between gap-2 rounded-lg px-2 py-1.5" style={{ background: "var(--muted)" }}>
                              <div className="min-w-0">
                                <div className="text-xs font-medium" style={{ color: "var(--foreground)" }}>
                                  {prettyDate(s.submitted_at)}{s.category ? ` · ${s.category}` : ""}
                                </div>
                                {s.notes && (
                                  <div className="text-xs mt-0.5 truncate" style={{ color: "var(--muted-foreground)" }}>{s.notes}</div>
                                )}
                              </div>
                              <button
                                onClick={() => deleteSubmission(r.id, s.id)}
                                className="text-xs shrink-0"
                                style={{ color: "var(--muted-foreground)" }}
                              >
                                ✕
                              </button>
                            </div>
                          ))}
                        </div>
                      )}

                      {formOpen && (
                        <div className="space-y-2 pt-1">
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="block text-xs mb-0.5" style={{ color: "var(--muted-foreground)" }}>Date Submitted</label>
                              <input
                                type="date"
                                value={form.submitted_at}
                                onChange={(e) => setSubmissionForms((prev) => ({ ...prev, [r.id]: { ...prev[r.id] ?? { submitted_at: todayISO(), category: "", notes: "" }, submitted_at: e.target.value } }))}
                                className="border rounded px-2 py-1 w-full text-xs"
                                style={{ borderColor: "var(--border)", background: "var(--card)", color: "var(--foreground)" }}
                              />
                            </div>
                            <div>
                              <label className="block text-xs mb-0.5" style={{ color: "var(--muted-foreground)" }}>Category</label>
                              <select
                                value={form.category}
                                onChange={(e) => setSubmissionForms((prev) => ({ ...prev, [r.id]: { ...prev[r.id] ?? { submitted_at: todayISO(), category: "", notes: "" }, category: e.target.value } }))}
                                className="border rounded px-2 py-1 w-full text-xs"
                                style={{ borderColor: "var(--border)", background: "var(--card)", color: "var(--foreground)" }}
                              >
                                <option value="">— Select Category —</option>
                                {brandCategories.map((cat) => (
                                  <option key={cat} value={cat}>{cat}</option>
                                ))}
                              </select>
                            </div>
                          </div>
                          <div>
                            <label className="block text-xs mb-0.5" style={{ color: "var(--muted-foreground)" }}>Notes</label>
                            <textarea
                              value={form.notes}
                              onChange={(e) => setSubmissionForms((prev) => ({ ...prev, [r.id]: { ...prev[r.id] ?? { submitted_at: todayISO(), category: "", notes: "" }, notes: e.target.value } }))}
                              rows={2}
                              className="border rounded px-2 py-1 w-full text-xs resize-none"
                              style={{ borderColor: "var(--border)", background: "var(--card)", color: "var(--foreground)" }}
                              placeholder="Optional notes"
                            />
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={() => saveSubmission(r.id)}
                              disabled={!form.submitted_at || submissionSaving[r.id]}
                              className="px-3 py-1 rounded text-xs font-medium disabled:opacity-50"
                              style={{ background: "var(--foreground)", color: "var(--background)" }}
                            >
                              {submissionSaving[r.id] ? "Saving…" : "Save Submission"}
                            </button>
                            <button
                              onClick={() => setSubmissionFormOpen((prev) => ({ ...prev, [r.id]: false }))}
                              className="px-3 py-1 rounded text-xs"
                              style={{ color: "var(--muted-foreground)" }}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Mark Worked Today — rep/admin only */}
                {isRepOrAdmin && (() => {
                  const badge = workedBadgeStyle(dateWorked);
                  const daysWorked = dateWorked ? daysAgo(dateWorked) : null;
                  const lastWorkedLabel = daysWorked === null
                    ? "Never worked this brand"
                    : daysWorked === 0
                      ? "Last worked: today"
                      : `Last worked: ${daysWorked}d ago`;
                  return (
                    <div className="border-t border-border pt-3 mt-1 flex items-center gap-3 flex-wrap">
                      <span
                        className="text-xs font-medium rounded px-2 py-0.5"
                        style={{ background: badge.bg, color: badge.fg }}
                      >
                        {lastWorkedLabel}
                      </span>
                      <button
                        onClick={markWorkedBrand}
                        disabled={dateWorkedSaving}
                        className="text-xs px-3 py-1 rounded-lg font-medium transition-opacity"
                        style={{
                          background: "#123b52",
                          color: "#78f5cd",
                          opacity: dateWorkedSaving ? 0.6 : 1,
                        }}
                      >
                        {dateWorkedSaving ? "Saving…" : "Mark Worked Today"}
                      </button>
                    </div>
                  );
                })()}
              </div>
            );
          })}
        </div>
      )}

      {/* SKU Modal */}
      {skuModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => { setSkuModal(null); setSkuEditMode(false); }}
        >
          <div
            className="relative w-full max-w-lg mx-4 rounded-xl border border-border bg-card shadow-xl p-6 space-y-4 max-h-[80vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-foreground">Authorized SKUs</h2>
                <p className="text-sm text-muted-foreground mt-0.5">{skuModal.retailerName}</p>
              </div>
              <button
                onClick={() => { setSkuModal(null); setSkuEditMode(false); }}
                className="text-muted-foreground hover:text-foreground transition-colors text-xl leading-none"
              >
                ×
              </button>
            </div>

            <div className="overflow-y-auto flex-1 min-h-0">
              {skuModalLoading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : !skuEditMode ? (
                <>
                  {skuModalItems.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No authorized SKUs on record.</p>
                  ) : (
                    <div className="space-y-1">
                      {skuModalItems.map((item, i) => (
                        <div key={i} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-secondary px-3 py-2 text-sm">
                          <span className="text-foreground">{item.sku_description}</span>
                          <span className="text-muted-foreground font-mono text-xs shrink-0">{item.upc}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                // Edit mode: checklist of all brand products
                <div className="space-y-1.5">
                  <p className="text-xs text-muted-foreground mb-2">Check SKUs to authorize for this retailer:</p>
                  {allBrandProducts.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No products in catalog yet. Add products from the Products tab first.</p>
                  ) : (
                    allBrandProducts.map((p) => {
                      const upc = p.retail_upc ?? "";
                      const checked = skuEditSelected.has(upc);
                      return (
                        <label key={p.id} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2 cursor-pointer hover:bg-accent transition-colors">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => {
                              setSkuEditSelected((prev) => {
                                const next = new Set(prev);
                                if (checked) next.delete(upc); else next.add(upc);
                                return next;
                              });
                            }}
                          />
                          <span className="flex-1 text-sm text-foreground">{p.description}</span>
                          <span className="text-xs text-muted-foreground font-mono shrink-0">{p.retail_upc ?? "—"}</span>
                        </label>
                      );
                    })
                  )}
                </div>
              )}
            </div>

            <div className="flex gap-2 pt-2 border-t border-border">
              {!skuEditMode ? (
                <>
                  {isRepOrAdmin && (
                    <button
                      onClick={enterSkuEditMode}
                      className="px-4 py-2 rounded-lg text-sm font-medium"
                      style={{ background: "var(--foreground)", color: "var(--background)" }}
                    >
                      Edit
                    </button>
                  )}
                  <button
                    onClick={() => setSkuModal(null)}
                    className="px-4 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Close
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={saveSkuEdit}
                    disabled={skuEditSaving}
                    className="px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
                    style={{ background: "var(--foreground)", color: "var(--background)" }}
                  >
                    {skuEditSaving ? "Saving…" : "Save"}
                  </button>
                  <button
                    onClick={() => setSkuEditMode(false)}
                    className="px-4 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Cancel
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}