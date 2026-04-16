"use client";

import { logActivity } from "@/lib/logActivity";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";

type Brand = { id: string; name: string; message_notifications_enabled: boolean };

type Retailer = {
  id: string;
  name: string;
  banner: string | null;
};

type Visibility = "client" | "internal";
type Role = "admin" | "rep" | "client" | null;

type MessageRow = {
  id: string;
  brand_id: string;
  retailer_id: string;
  visibility: Visibility;
  sender_id: string | null;
  sender_name: string | null;
  body: string;
  created_at: string;
};

type PendingReviewRow = {
  id: string;
  activity_kind: string;
  visibility: string;
  approval_status: string;
  email_subject: string | null;
  email_body_raw: string | null;
  ai_summary: string | null;
  client_draft_summary: string | null;
  client_visible_message: string | null;
  created_at: string;
};

type ApprovedActivityRow = {
  id: string;
  client_visible_message: string | null;
  email_subject: string | null;
  created_at: string;
  activity_kind: string | null;
};

type RepTaskRow = {
  task_id: string;
  brand_retailer_timing_id: string;
  retailer_id: string;
  retailer_name: string;
  brand_id: string;
  title: string;
  details: string | null;
  task_type: string;
  priority: "low" | "medium" | "high";
  status: string;
  due_at: string | null;
  created_at: string;
  created_by_name: string | null;
};

type AttachmentRow = {
  id: string;
  brand_id: string;
  retailer_id: string;
  message_id: string | null;
  visibility: Visibility;
  bucket_name: string;
  storage_path: string;
  file_name: string;
  mime_type: string | null;
  file_size: number | null;
  uploaded_by_user_id: string | null;
  created_at: string;
};

type ClientEmailRow = {
  user_id: string;
  email: string;
};
type ClientTimelineItem =
  | {
      kind: "message";
      id: string;
      created_at: string;
      sender_name: string | null;
      body: string;
      attachments: AttachmentRow[];
    }
  | {
      kind: "approved_activity";
      id: string;
      created_at: string;
      email_subject: string | null;
      client_visible_message: string | null;
      activity_kind: string | null;
    };

function isImageMime(mimeType: string | null): boolean {
  if (!mimeType) return false;
  return mimeType.toLowerCase().startsWith("image/");
}

export default function BrandRetailerMessagesPage() {
  const params = useParams();
  const idParam = params?.id;
  const retailerParam = params?.retailerId;

  const brandId = (Array.isArray(idParam) ? idParam[0] : idParam) as string;
  const retailerId = (Array.isArray(retailerParam) ? retailerParam[0] : retailerParam) as string;

  const [brand, setBrand] = useState<Brand | null>(null);
  const [retailer, setRetailer] = useState<Retailer | null>(null);
  const [role, setRole] = useState<Role>(null);
  const [tab, setTab] = useState<Visibility>("client");

  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [approvedActivities, setApprovedActivities] = useState<ApprovedActivityRow[]>([]);
  const [attachmentsByMessageId, setAttachmentsByMessageId] = useState<Record<string, AttachmentRow[]>>({});
  const [signedImageUrls, setSignedImageUrls] = useState<Record<string, string>>({});
  const [pendingReviews, setPendingReviews] = useState<PendingReviewRow[]>([]);
  const [reviewEdits, setReviewEdits] = useState<Record<string, string>>({});
  const [approvingId, setApprovingId] = useState<string | null>(null);

  const [body, setBody] = useState("");
  const [status, setStatus] = useState("");
  const [timingRowId, setTimingRowId] = useState<string | null>(null);
  const [nudges, setNudges] = useState<RepTaskRow[]>([]);
  const [nudgesLoading, setNudgesLoading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [reactions, setReactions] = useState<Record<string, { count: number; liked: boolean }>>({});

  const isRepOrAdmin = role === "rep" || role === "admin";

  // Fetch signed URLs for all image attachments whenever the attachment map updates
  useEffect(() => {
    const allAttachments = Object.values(attachmentsByMessageId).flat();
    const imageAttachments = allAttachments.filter((a) => isImageMime(a.mime_type));
    if (imageAttachments.length === 0) return;

    Promise.all(
      imageAttachments.map(async (a) => {
        const { data } = await supabase.storage
          .from(a.bucket_name)
          .createSignedUrl(a.storage_path, 3600);
        return { id: a.id, url: data?.signedUrl ?? null };
      })
    ).then((results) => {
      const next: Record<string, string> = {};
      results.forEach(({ id, url }) => {
        if (url) next[id] = url;
      });
      setSignedImageUrls((prev) => ({ ...prev, ...next }));
    });
  }, [attachmentsByMessageId]);

  useEffect(() => {
    if (!brandId || !retailerId) return;

    async function loadPage() {
      setStatus("");

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
        .select("id,name,banner")
        .eq("id", retailerId)
        .single();

      if (retailerError) {
        setStatus(retailerError.message);
        return;
      }
      setRetailer(retailerData);

      const { data: timingRow, error: timingError } = await supabase
        .from("brand_retailer_timing")
        .select("id")
        .eq("brand_id", brandId)
        .eq("retailer_id", retailerId)
        .single();

      if (timingError) {
        setStatus(timingError.message);
        return;
      }

      setTimingRowId(timingRow.id);

      const { data: authData } = await supabase.auth.getUser();
      const userId = authData?.user?.id;

      if (!userId) {
        setRole(null);
        return;
      }

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", userId)
        .single();

      if (profileError) {
        setStatus(profileError.message);
        return;
      }

      setRole((profile?.role as Role) ?? "client");
    }

    loadPage();
  }, [brandId, retailerId]);

  useEffect(() => {
    if (!brandId || !retailerId || !role) return;

    async function loadMessages() {
      const visibilityToLoad: Visibility = isRepOrAdmin ? tab : "client";

      const { data, error } = await supabase
        .from("brand_retailer_messages")
        .select("*")
        .eq("brand_id", brandId)
        .eq("retailer_id", retailerId)
        .eq("visibility", visibilityToLoad)
        .order("created_at", { ascending: false });

      if (error) {
        setStatus(error.message);
        setMessages([]);
        return;
      }

      const loadedMessages = (data as MessageRow[]) ?? [];
      setMessages(loadedMessages);
      if (loadedMessages.length) loadReactions(loadedMessages.map((m) => m.id));

      if (visibilityToLoad === "client") {
        const { data: authData } = await supabase.auth.getUser();
        const userId = authData?.user?.id;

        if (userId && data?.length) {
          const reads = data.map((m) => ({
            user_id: userId,
            message_id: m.id,
          }));

          const { error: readError } = await supabase
            .from("message_reads")
            .upsert(reads, { onConflict: "user_id,message_id" });

          if (readError) {
            setStatus(`Read tracking failed: ${readError.message}`);
          }
        }
      }
    }

    loadMessages();
  }, [brandId, retailerId, role, tab, isRepOrAdmin]);

  useEffect(() => {
    if (!brandId || !retailerId || !role) return;

    async function loadAttachments() {
      const visibilityToLoad: Visibility = isRepOrAdmin ? tab : "client";

      const { data, error } = await supabase
        .from("brand_retailer_attachments")
        .select("*")
        .eq("brand_id", brandId)
        .eq("retailer_id", retailerId)
        .eq("visibility", visibilityToLoad)
        .order("created_at", { ascending: true });

      if (error) {
        setStatus(error.message);
        setAttachmentsByMessageId({});
        return;
      }

      const grouped: Record<string, AttachmentRow[]> = {};
      ((data as AttachmentRow[]) ?? []).forEach((attachment) => {
        if (!attachment.message_id) return;
        if (!grouped[attachment.message_id]) grouped[attachment.message_id] = [];
        grouped[attachment.message_id].push(attachment);
      });

      setAttachmentsByMessageId(grouped);
    }

    loadAttachments();
  }, [brandId, retailerId, role, tab, isRepOrAdmin]);

  useEffect(() => {
    if (!timingRowId || !isRepOrAdmin || tab !== "internal") {
      setNudges([]);
      return;
    }

    loadNudges();
  }, [timingRowId, isRepOrAdmin, tab]);

  useEffect(() => {
    if (!brandId || !retailerId || !isRepOrAdmin || tab !== "internal") {
      setPendingReviews([]);
      return;
    }

    loadPendingReviews();
  }, [brandId, retailerId, isRepOrAdmin, tab]);

  useEffect(() => {
    if (!brandId || !retailerId || tab !== "client") {
      setApprovedActivities([]);
      return;
    }

    loadApprovedActivities();
  }, [brandId, retailerId, tab]);

  const title = useMemo(() => {
    const brandName = brand?.name ?? "Brand";
    const retailerHeadline = retailer?.banner?.trim()
      ? retailer.banner
      : retailer?.name ?? "Retailer";

    return `${brandName} • ${retailerHeadline}`;
  }, [brand, retailer]);

  async function resolveSenderName(): Promise<string> {
    const { data } = await supabase.auth.getUser();
    const user = data?.user;

    if (!user) return "User";

    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", user.id)
      .single();

    return profile?.full_name || user.email || "User";
  }

  async function getClientEmails(): Promise<string[]> {
    if (!brandId) return [];

    const { data: clientRows, error } = await supabase.rpc("get_brand_client_emails", {
      p_brand_id: brandId,
    });

    if (error) {
      setStatus(`Client email lookup failed: ${error.message}`);
      return [];
    }

    return ((clientRows as ClientEmailRow[]) ?? [])
      .map((row) => row.email)
      .filter(Boolean);
  }

  async function loadNudges() {
    if (!timingRowId) return;

    setNudgesLoading(true);

    const { data, error } = await supabase
      .from("rep_tasks")
      .select(`
        id,
        brand_retailer_timing_id,
        title,
        details,
        task_type,
        priority,
        status,
        due_at,
        created_at,
        assigned_to_user_id,
        created_by_user_id,
        profiles!rep_tasks_created_by_user_id_fkey(full_name)
      `)
      .eq("brand_retailer_timing_id", timingRowId)
      .eq("status", "open")
      .order("created_at", { ascending: false });

    if (error) {
      setStatus(error.message);
      setNudges([]);
      setNudgesLoading(false);
      return;
    }

    const mapped: RepTaskRow[] = (data ?? []).map((row: any) => ({
      task_id: row.id,
      brand_retailer_timing_id: row.brand_retailer_timing_id,
      retailer_id: retailerId,
      retailer_name: retailer?.name ?? "Retailer",
      brand_id: brandId,
      title: row.title,
      details: row.details,
      task_type: row.task_type,
      priority: row.priority,
      status: row.status,
      due_at: row.due_at,
      created_at: row.created_at,
      created_by_name: row.profiles?.full_name ?? null,
    }));

    setNudges(mapped);
    setNudgesLoading(false);
  }

  async function loadPendingReviews() {
    const { data, error } = await supabase
      .from("crm_activities")
      .select(`
        id,
        activity_kind,
        visibility,
        approval_status,
        email_subject,
        email_body_raw,
        ai_summary,
        client_draft_summary,
        client_visible_message,
        created_at
      `)
      .eq("brand_id", brandId)
      .eq("retailer_id", retailerId)
      .eq("activity_kind", "retailer_reply")
      .eq("approval_status", "pending_review")
      .order("created_at", { ascending: false });

    if (error) {
      setStatus(error.message);
      setPendingReviews([]);
      return;
    }

    const rows = (data as PendingReviewRow[]) ?? [];
    setPendingReviews(rows);

    const initialEdits: Record<string, string> = {};
    rows.forEach((row) => {
      initialEdits[row.id] =
        row.client_draft_summary || row.ai_summary || row.email_subject || "";
    });
    setReviewEdits(initialEdits);
  }

  async function loadApprovedActivities() {
    const { data, error } = await supabase
      .from("crm_activities")
      .select(`
        id,
        client_visible_message,
        email_subject,
        created_at,
        activity_kind
      `)
      .eq("brand_id", brandId)
      .eq("retailer_id", retailerId)
      .eq("visibility", "client_visible")
      .order("created_at", { ascending: false });

    if (error) {
      setStatus(error.message);
      setApprovedActivities([]);
      return;
    }

    setApprovedActivities((data as ApprovedActivityRow[]) ?? []);
  }

  async function createNudge() {
    if (!timingRowId) {
      setStatus("No brand-retailer timing record found.");
      return;
    }

    setStatus("Creating MacGruber reminder...");

    const { error } = await supabase.rpc("create_manager_nudge", {
      p_brand_retailer_timing_id: timingRowId,
      p_title: "Manager follow up",
      p_details: "Please update buyer outreach notes",
      p_priority: "high",
      p_due_at: null,
    });

    if (error) {
      setStatus(error.message);
      return;
    }

    setStatus("MacGruber reminder created ✅");
    await loadNudges();
  }

  async function completeNudge(taskId: string) {
    setStatus("Completing reminder...");

    const { error } = await supabase.rpc("complete_rep_task", {
      p_task_id: taskId,
    });

    if (error) {
      setStatus(error.message);
      return;
    }

    setStatus("MacGruber reminder completed ✅");
    await loadNudges();
  }

  async function uploadAttachment(visibilityToSend: Visibility, messageId: string) {
    if (!selectedFile) return;

    const { data: authData } = await supabase.auth.getUser();
    const userId = authData?.user?.id ?? null;

    if (!userId) {
      setStatus("You must be signed in to upload files.");
      return;
    }

    const fileExt = selectedFile.name.split(".").pop() || "file";
    const filePath = `${brandId}/${retailerId}/${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}.${fileExt}`;

    const { error: storageError } = await supabase.storage
      .from("brand-message-attachments")
      .upload(filePath, selectedFile);

    if (storageError) {
      setStatus(storageError.message);
      return;
    }

    const { error: attachmentError } = await supabase
      .from("brand_retailer_attachments")
      .insert({
        brand_id: brandId,
        retailer_id: retailerId,
        message_id: messageId,
        visibility: visibilityToSend,
        bucket_name: "brand-message-attachments",
        storage_path: filePath,
        file_name: selectedFile.name,
        mime_type: selectedFile.type || null,
        file_size: selectedFile.size,
        uploaded_by_user_id: userId,
      });

    if (attachmentError) {
      setStatus(attachmentError.message);
    }
  }

  async function reloadMessagesAndAttachments(visibilityToSend: Visibility) {
    const { data: refreshed, error: reloadErr } = await supabase
      .from("brand_retailer_messages")
      .select("*")
      .eq("brand_id", brandId)
      .eq("retailer_id", retailerId)
      .eq("visibility", visibilityToSend)
      .order("created_at", { ascending: false });

    if (reloadErr) {
      setStatus(reloadErr.message);
      return;
    }

    const reloadedMessages = (refreshed as MessageRow[]) ?? [];
    setMessages(reloadedMessages);
    if (reloadedMessages.length) loadReactions(reloadedMessages.map((m) => m.id));

    const { data: refreshedAttachments, error: attachmentReloadErr } = await supabase
      .from("brand_retailer_attachments")
      .select("*")
      .eq("brand_id", brandId)
      .eq("retailer_id", retailerId)
      .eq("visibility", visibilityToSend)
      .order("created_at", { ascending: false });

    if (attachmentReloadErr) {
      setStatus(attachmentReloadErr.message);
      return;
    }

    const grouped: Record<string, AttachmentRow[]> = {};
    ((refreshedAttachments as AttachmentRow[]) ?? []).forEach((attachment) => {
      if (!attachment.message_id) return;
      if (!grouped[attachment.message_id]) grouped[attachment.message_id] = [];
      grouped[attachment.message_id].push(attachment);
    });

    setAttachmentsByMessageId(grouped);
  }

  async function approveReview(activityId: string) {
    try {
      setApprovingId(activityId);
      setStatus("Approving summary...");

      const editedSummary = reviewEdits[activityId]?.trim() || undefined;

      const response = await fetch("/api/crm-activities/approve", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          activityId,
          editedSummary,
        }),
      });

      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(result?.error || "Failed to approve summary");
      }

      setStatus("Summary approved ✅");
      await loadPendingReviews();
      await loadApprovedActivities();
    } catch (err: any) {
      setStatus(err.message || "Failed to approve summary");
    } finally {
      setApprovingId(null);
    }
  }

  async function loadReactions(messageIds: string[]) {
    if (!messageIds.length) return;
    const { data: authData } = await supabase.auth.getUser();
    const userId = authData?.user?.id ?? null;

    const { data } = await supabase
      .from("message_reactions")
      .select("message_id, user_id")
      .in("message_id", messageIds);

    const next: Record<string, { count: number; liked: boolean }> = {};
    messageIds.forEach((id) => { next[id] = { count: 0, liked: false }; });
    ((data as { message_id: string; user_id: string }[]) ?? []).forEach((r) => {
      if (!next[r.message_id]) next[r.message_id] = { count: 0, liked: false };
      next[r.message_id].count += 1;
      if (r.user_id === userId) next[r.message_id].liked = true;
    });
    setReactions((prev) => ({ ...prev, ...next }));
  }

  async function toggleReaction(messageId: string) {
    const { data: authData } = await supabase.auth.getUser();
    const userId = authData?.user?.id ?? null;
    if (!userId) return;

    const current = reactions[messageId];
    if (current?.liked) {
      await supabase
        .from("message_reactions")
        .delete()
        .eq("message_id", messageId)
        .eq("user_id", userId)
        .eq("reaction", "thumbs_up");
      setReactions((prev) => ({
        ...prev,
        [messageId]: { count: Math.max(0, (prev[messageId]?.count ?? 1) - 1), liked: false },
      }));
    } else {
      await supabase.from("message_reactions").insert({
        message_id: messageId,
        user_id: userId,
        reaction: "thumbs_up",
      });
      setReactions((prev) => ({
        ...prev,
        [messageId]: { count: (prev[messageId]?.count ?? 0) + 1, liked: true },
      }));
    }
  }

  async function send() {
    const text = body.trim();
    const visibilityToSend: Visibility = isRepOrAdmin ? tab : "client";

    if (!text && !selectedFile) return;

    setStatus("Sending…");

    const sender_name = await resolveSenderName();
    const { data } = await supabase.auth.getUser();
    const sender_id = data?.user?.id ?? null;

    const { data: insertedMessage, error: messageError } = await supabase
      .from("brand_retailer_messages")
      .insert({
        brand_id: brandId,
        retailer_id: retailerId,
        visibility: visibilityToSend,
        sender_id,
        sender_name,
        body: text || "[Attachment]",
      })
      .select()
      .single();

    if (messageError || !insertedMessage?.id) {
      setStatus(messageError?.message || "Unable to create message.");
      return;
    }

    try {
      await logActivity({
        userId: sender_id,
        brandId,
        retailerId,
        type: "note",
        description: visibilityToSend === "client" ? "Client message" : "Internal note",
      });
    } catch (err) {
      console.error("Activity log failed", err);
    }

    if (selectedFile) {
      await uploadAttachment(visibilityToSend, insertedMessage.id);
    }

    let emailFailed = false;

    try {
      if (
        isRepOrAdmin &&
        visibilityToSend === "client" &&
        brand?.name &&
        retailer?.name &&
        brand?.message_notifications_enabled
      ) {
        const recipients = await getClientEmails();
        const retailerName = retailer.banner?.trim() ? retailer.banner : retailer.name;

        if (recipients.length > 0) {
          const response = await fetch("/api/send-client-email", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              brand_name: brand.name,
              retailer_name: retailerName,
              message_body: text || "New attachment added.",
              recipients,
              actor_name: sender_name,
              event_type: "message",
              brand_id: brandId,
              retailer_id: retailerId,
            }),
          });

          const result = await response.json().catch(() => ({}));

          if (!response.ok) {
            throw new Error(result?.error || "Failed to send email notification");
          }
        }
      }
    } catch (emailErr) {
      emailFailed = true;
      console.error("Email notification failed", emailErr);
    }

    setBody("");
    setSelectedFile(null);

    if (emailFailed) {
      setStatus("Sent ✅ (message saved, but email notification failed)");
    } else {
      setStatus("Sent ✅");
    }

    await reloadMessagesAndAttachments(visibilityToSend);

    if (visibilityToSend === "client") {
      await loadApprovedActivities();
    }
  }

  async function openAttachment(path: string) {
    const { data, error } = await supabase.storage
      .from("brand-message-attachments")
      .createSignedUrl(path, 60);

    if (error || !data?.signedUrl) {
      setStatus(error?.message || "Unable to open attachment.");
      return;
    }

    window.open(data.signedUrl, "_blank");
  }

  const visibleLabel = isRepOrAdmin
    ? tab === "client"
      ? "client-visible message"
      : "internal note"
    : "message";
const clientTimeline = useMemo<ClientTimelineItem[]>(() => {
  if (tab !== "client") return [];

  const messageItems: ClientTimelineItem[] = messages.map((m) => ({
    kind: "message",
    id: m.id,
    created_at: m.created_at,
    sender_name: m.sender_name,
    body: m.body,
    attachments: attachmentsByMessageId[m.id] || [],
  }));

  const approvedActivityItems: ClientTimelineItem[] = approvedActivities.map((activity) => ({
    kind: "approved_activity",
    id: activity.id,
    created_at: activity.created_at,
    email_subject: activity.email_subject,
    client_visible_message: activity.client_visible_message,
    activity_kind: activity.activity_kind,
  }));

  return [...messageItems, ...approvedActivityItems].sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
}, [tab, messages, attachmentsByMessageId, approvedActivities]);
  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) setSelectedFile(file);
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <Link className="underline text-sm" href={`/brands/${brandId}/retailers`}>
          ← Back to Brand Retailers
        </Link>

        <h1 className="text-2xl font-bold mt-2">{title}</h1>
        {retailer?.banner ? <p className="text-gray-500">{retailer.name}</p> : null}
        {status && (
          <p
            className="mt-2 text-sm"
            style={{
              color: status.includes("✅")
                ? "var(--primary)"
                : status.endsWith("…") || status.endsWith("...")
                ? "var(--muted-foreground)"
                : "rgb(220 38 38)",
            }}
          >
            {status}
          </p>
        )}
      </div>

      {isRepOrAdmin ? (
        <div className="flex gap-2">
          <button
            className="px-4 py-2 rounded-lg border text-sm font-medium transition-colors"
            style={
              tab === "client"
                ? { background: "var(--foreground)", color: "var(--background)", borderColor: "var(--foreground)" }
                : { background: "transparent", color: "var(--muted-foreground)", borderColor: "var(--border)" }
            }
            onClick={() => setTab("client")}
          >
            Client-visible
          </button>

          <button
            className="px-4 py-2 rounded-lg border text-sm font-medium transition-colors"
            style={
              tab === "internal"
                ? { background: "var(--foreground)", color: "var(--background)", borderColor: "var(--foreground)" }
                : { background: "transparent", color: "var(--muted-foreground)", borderColor: "var(--border)" }
            }
            onClick={() => setTab("internal")}
          >
            Internal-only
          </button>
        </div>
      ) : (
        <div className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>Messages</div>
      )}

      {isRepOrAdmin && tab === "internal" && (
        <>
          <div className="border rounded-xl p-4 flex justify-between items-center">
            <div className="text-sm font-semibold">Manager Tools</div>
            <button
              onClick={createNudge}
              className="border px-3 py-2 rounded hover:bg-gray-50"
            >
              Create MacGruber Reminder
            </button>
          </div>

          <div className="border rounded-xl p-4 space-y-3">
            <div className="text-sm font-semibold">Open MacGruber Reminders</div>

            {nudgesLoading ? (
              <p className="text-sm text-gray-600">Loading reminders…</p>
            ) : nudges.length === 0 ? (
              <p className="text-sm text-gray-600">No open reminders.</p>
            ) : (
              <div className="space-y-3">
                {nudges.map((nudge) => (
                  <div key={nudge.task_id} className="border rounded-lg p-3 space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-medium">{nudge.title}</div>
                      <span className="text-xs border rounded-full px-2 py-1 bg-gray-50">
                        {nudge.priority === "high"
                          ? "High"
                          : nudge.priority === "medium"
                          ? "Medium"
                          : "Low"}
                      </span>
                    </div>

                    {nudge.details ? (
                      <div className="text-sm text-gray-700 whitespace-pre-wrap">
                        {nudge.details}
                      </div>
                    ) : null}

                    <div className="text-xs text-gray-500">
                      From {nudge.created_by_name ?? "Manager"}
                      {nudge.due_at
                        ? ` • Due ${new Date(nudge.due_at).toLocaleDateString()}`
                        : ""}
                    </div>

                    <div>
                      <button
                        onClick={() => completeNudge(nudge.task_id)}
                        className="border px-3 py-2 rounded hover:bg-gray-50 text-sm"
                      >
                        Mark Complete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {isRepOrAdmin && tab === "internal" && (
        <div className="border rounded-xl p-4 space-y-4">
          <div className="text-sm font-semibold">Pending Retailer Reply Reviews</div>

          {pendingReviews.length === 0 ? (
            <p className="text-sm text-gray-600">No pending reply drafts.</p>
          ) : (
            <div className="space-y-4">
              {pendingReviews.map((review) => (
                <div key={review.id} className="border rounded-lg p-4 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="font-medium">
                        {review.email_subject || "Retailer reply"}
                      </div>
                      <div className="text-xs text-gray-500">
                        {new Date(review.created_at).toLocaleString()}
                      </div>
                    </div>

                    <span className="text-xs border rounded-full px-2 py-1 bg-yellow-50">
                      Pending review
                    </span>
                  </div>

                  {review.ai_summary ? (
                    <div>
                      <div className="text-xs font-semibold text-gray-500 mb-1">
                        Internal AI Summary
                      </div>
                      <div className="text-sm border rounded-lg p-3 bg-gray-50">
                        {review.ai_summary}
                      </div>
                    </div>
                  ) : null}

                  {review.email_body_raw ? (
                    <div>
                      <div className="text-xs font-semibold text-gray-500 mb-1">
                        Retailer Reply
                      </div>
                      <div className="text-sm border rounded-lg p-3 bg-white whitespace-pre-wrap max-h-48 overflow-auto">
                        {review.email_body_raw}
                      </div>
                    </div>
                  ) : null}

                  <div>
                    <div className="text-xs font-semibold text-gray-500 mb-1">
                      Client-facing Draft
                    </div>
                    <textarea
                      className="border rounded px-3 py-2 w-full"
                      rows={3}
                      value={reviewEdits[review.id] || ""}
                      onChange={(e) =>
                        setReviewEdits((prev) => ({
                          ...prev,
                          [review.id]: e.target.value,
                        }))
                      }
                      placeholder="Edit summary before approving..."
                    />
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={() => approveReview(review.id)}
                      disabled={approvingId === review.id}
                      className="bg-black text-white px-4 py-2 rounded disabled:opacity-50"
                    >
                      {approvingId === review.id ? "Approving..." : "Approve & Publish"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

<div className="border rounded-xl p-4 space-y-3">
  {tab === "client" ? (
    clientTimeline.length === 0 ? (
      <p className="text-sm text-gray-600">No messages yet.</p>
    ) : (
      <div className="space-y-3">
        {clientTimeline.map((item) => {
          if (item.kind === "approved_activity") {
            return (
              <div key={item.id} className="border rounded-lg p-3">
                <div className="text-xs text-gray-500 flex items-center justify-between gap-2">
                  <span>
                    {item.activity_kind === "retailer_reply"
                      ? "Retailer replied"
                      : "Email update"}
                  </span>
                  <span>{new Date(item.created_at).toLocaleString()}</span>
                </div>

                {item.email_subject ? (
                  <div className="mt-2 text-sm font-medium">
                    {item.email_subject}
                  </div>
                ) : null}

                <div className="mt-2 text-sm whitespace-pre-wrap">
                  {item.client_visible_message || "Email activity approved."}
                </div>
              </div>
            );
          }

          return (
            <div key={item.id} className="border rounded-lg p-3">
              <div className="text-xs text-gray-500 flex items-center justify-between gap-2">
                <span>{item.sender_name ?? "Unknown"}</span>
                <span>{new Date(item.created_at).toLocaleString()}</span>
              </div>

              <div className="mt-2 text-sm whitespace-pre-wrap">{item.body}</div>

              <div className="mt-2">
                <button
                  type="button"
                  onClick={() => toggleReaction(item.id)}
                  className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full transition-colors"
                  style={{
                    background: reactions[item.id]?.liked ? "var(--primary)" : "var(--muted)",
                    color: reactions[item.id]?.liked ? "var(--primary-foreground)" : "var(--muted-foreground)",
                  }}
                >
                  👍{reactions[item.id]?.count ? ` ${reactions[item.id].count}` : ""}
                </button>
              </div>

              {item.attachments.length ? (
                <div className="mt-3 space-y-2">
                  {item.attachments.map((attachment) => {
                    const signedUrl = signedImageUrls[attachment.id];
                    if (isImageMime(attachment.mime_type)) {
                      return (
                        <div key={attachment.id}>
                          {signedUrl ? (
                            <img
                              src={signedUrl}
                              alt={attachment.file_name}
                              className="rounded-lg"
                              style={{ maxWidth: "100%", display: "block", cursor: "pointer" }}
                              title="Click to open full size"
                              onClick={() => openAttachment(attachment.storage_path)}
                            />
                          ) : (
                            <div className="border rounded-lg px-3 py-2 text-sm text-gray-400">
                              Loading image…
                            </div>
                          )}
                          <div className="text-xs text-gray-500 mt-1">
                            {attachment.file_name}
                            {attachment.file_size ? ` • ${Math.round(attachment.file_size / 1024)} KB` : ""}
                          </div>
                        </div>
                      );
                    }
                    return (
                      <button
                        key={attachment.id}
                        type="button"
                        onClick={() => openAttachment(attachment.storage_path)}
                        className="block text-left border rounded-lg px-3 py-2 hover:bg-gray-50 w-full"
                      >
                        <div className="font-medium">{attachment.file_name}</div>
                        <div className="text-xs text-gray-500 mt-1">
                          {attachment.mime_type ?? "File"}
                          {attachment.file_size ? ` • ${Math.round(attachment.file_size / 1024)} KB` : ""}
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    )
  ) : messages.length === 0 ? (
    <p className="text-sm text-gray-600">No messages yet.</p>
  ) : (
    <div className="space-y-3">
      {messages.map((m) => (
        <div key={m.id} className="border rounded-lg p-3">
          <div className="text-xs text-gray-500 flex items-center justify-between gap-2">
            <span>{m.sender_name ?? "Unknown"}</span>
            <span>{new Date(m.created_at).toLocaleString()}</span>
          </div>

          <div className="mt-2 text-sm whitespace-pre-wrap">{m.body}</div>

          <div className="mt-2">
            <button
              type="button"
              onClick={() => toggleReaction(m.id)}
              className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full transition-colors"
              style={{
                background: reactions[m.id]?.liked ? "var(--primary)" : "var(--muted)",
                color: reactions[m.id]?.liked ? "var(--primary-foreground)" : "var(--muted-foreground)",
              }}
            >
              👍{reactions[m.id]?.count ? ` ${reactions[m.id].count}` : ""}
            </button>
          </div>

          {attachmentsByMessageId[m.id]?.length ? (
            <div className="mt-3 space-y-2">
              {attachmentsByMessageId[m.id].map((attachment) => {
                const signedUrl = signedImageUrls[attachment.id];
                if (isImageMime(attachment.mime_type)) {
                  return (
                    <div key={attachment.id}>
                      {signedUrl ? (
                        <img
                          src={signedUrl}
                          alt={attachment.file_name}
                          className="rounded-lg"
                          style={{ maxWidth: "100%", display: "block", cursor: "pointer" }}
                          title="Click to open full size"
                          onClick={() => openAttachment(attachment.storage_path)}
                        />
                      ) : (
                        <div className="border rounded-lg px-3 py-2 text-sm text-gray-400">
                          Loading image…
                        </div>
                      )}
                      <div className="text-xs text-gray-500 mt-1">
                        {attachment.file_name}
                        {attachment.file_size ? ` • ${Math.round(attachment.file_size / 1024)} KB` : ""}
                      </div>
                    </div>
                  );
                }
                return (
                  <button
                    key={attachment.id}
                    type="button"
                    onClick={() => openAttachment(attachment.storage_path)}
                    className="block text-left border rounded-lg px-3 py-2 hover:bg-gray-50 w-full"
                  >
                    <div className="font-medium">{attachment.file_name}</div>
                    <div className="text-xs text-gray-500 mt-1">
                      {attachment.mime_type ?? "File"}
                      {attachment.file_size ? ` • ${Math.round(attachment.file_size / 1024)} KB` : ""}
                    </div>
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  )}
</div>

      <div className="border rounded-xl p-4 space-y-3">
        <div className="text-sm font-semibold">New {visibleLabel}</div>

        <textarea
          className="border rounded px-3 py-2 w-full"
          rows={3}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={
            isRepOrAdmin
              ? tab === "client"
                ? "Write a message the client can see…"
                : "Write an internal-only note…"
              : "Write a message…"
          }
        />

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={handleDrop}
          className={`border rounded-lg p-4 text-sm ${
            dragActive ? "bg-gray-100" : "bg-white"
          }`}
        >
          <div className="flex items-center gap-3 flex-wrap">
            <label
              htmlFor={`file-upload-${tab}`}
              className="inline-block border px-3 py-2 rounded cursor-pointer hover:bg-gray-50"
            >
              Attach file
            </label>

            <input
              id={`file-upload-${tab}`}
              type="file"
              className="hidden"
              onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
            />

            <span className="text-gray-600">or drag and drop a file here</span>
          </div>

          {selectedFile ? (
            <div className="mt-3 text-sm text-gray-700">
              Selected: {selectedFile.name}
              <button
                type="button"
                onClick={() => setSelectedFile(null)}
                className="ml-3 underline"
              >
                Remove
              </button>
            </div>
          ) : null}
        </div>

        <button
          className="px-4 py-2 rounded-lg text-sm font-medium"
          style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}
          onClick={send}
        >
          Send
        </button>
      </div>
    </div>
  );
}