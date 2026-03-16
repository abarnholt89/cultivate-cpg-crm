"use client";

import { logActivity } from "@/lib/logActivity";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";

type Brand = { id: string; name: string };

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
  const [attachmentsByMessageId, setAttachmentsByMessageId] = useState<
    Record<string, AttachmentRow[]>
  >({});
  const [body, setBody] = useState("");
  const [status, setStatus] = useState("");
  const [timingRowId, setTimingRowId] = useState<string | null>(null);
  const [nudges, setNudges] = useState<RepTaskRow[]>([]);
  const [nudgesLoading, setNudgesLoading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);

  const isRepOrAdmin = role === "rep" || role === "admin";

  useEffect(() => {
    if (!brandId || !retailerId) return;

    async function loadPage() {
      setStatus("");

      const { data: b, error: bErr } = await supabase
        .from("brands")
        .select("id,name")
        .eq("id", brandId)
        .single();

      if (bErr) {
        setStatus(bErr.message);
        return;
      }
      setBrand(b);

      const { data: r, error: rErr } = await supabase
        .from("retailers")
        .select("id,name,banner")
        .eq("id", retailerId)
        .single();

      if (rErr) {
        setStatus(rErr.message);
        return;
      }
      setRetailer(r);

      const { data: timingRow, error: timingErr } = await supabase
        .from("brand_retailer_timing")
        .select("id")
        .eq("brand_id", brandId)
        .eq("retailer_id", retailerId)
        .single();

      if (timingErr) {
        setStatus(timingErr.message);
        return;
      }

      setTimingRowId(timingRow.id);

      const { data: authData } = await supabase.auth.getUser();
      const userId = authData?.user?.id;

      if (!userId) {
        setRole(null);
        return;
      }

      const { data: profile, error: profileErr } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", userId)
        .single();

      if (profileErr) {
        setStatus(profileErr.message);
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
        .order("created_at", { ascending: true });

      if (error) {
        setStatus(error.message);
        setMessages([]);
        return;
      }

      setMessages((data as MessageRow[]) ?? []);

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

    const mapped: RepTaskRow[] =
      (data ?? []).map((row: any) => ({
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
      })) ?? [];

    setNudges(mapped);
    setNudgesLoading(false);
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
      return;
    }
  }

  async function reloadMessagesAndAttachments(visibilityToSend: Visibility) {
    const { data: refreshed, error: reloadErr } = await supabase
      .from("brand_retailer_messages")
      .select("*")
      .eq("brand_id", brandId)
      .eq("retailer_id", retailerId)
      .eq("visibility", visibilityToSend)
      .order("created_at", { ascending: true });

    if (reloadErr) {
      setStatus(reloadErr.message);
      return;
    }

    setMessages((refreshed as MessageRow[]) ?? []);

    const { data: refreshedAttachments, error: attachmentReloadErr } = await supabase
      .from("brand_retailer_attachments")
      .select("*")
      .eq("brand_id", brandId)
      .eq("retailer_id", retailerId)
      .eq("visibility", visibilityToSend)
      .order("created_at", { ascending: true });

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
    retailer?.name
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

        {status && <p className="mt-2 text-sm text-red-600">{status}</p>}
      </div>

      {isRepOrAdmin ? (
        <div className="flex gap-2">
          <button
            className={`px-4 py-2 rounded border ${
              tab === "client" ? "bg-black text-white" : "hover:bg-gray-50"
            }`}
            onClick={() => setTab("client")}
          >
            Client-visible
          </button>

          <button
            className={`px-4 py-2 rounded border ${
              tab === "internal" ? "bg-black text-white" : "hover:bg-gray-50"
            }`}
            onClick={() => setTab("internal")}
          >
            Internal-only
          </button>
        </div>
      ) : (
        <div className="text-sm font-semibold">Messages</div>
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

      <div className="border rounded-xl p-4 space-y-3">
        {messages.length === 0 ? (
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

                {attachmentsByMessageId[m.id]?.length ? (
                  <div className="mt-3 space-y-2">
                    {attachmentsByMessageId[m.id].map((attachment) => (
                      <button
                        key={attachment.id}
                        type="button"
                        onClick={() => openAttachment(attachment.storage_path)}
                        className="block text-left border rounded-lg px-3 py-2 hover:bg-gray-50 w-full"
                      >
                        <div className="font-medium">{attachment.file_name}</div>
                        <div className="text-xs text-gray-500 mt-1">
                          {attachment.mime_type ?? "File"}
                          {attachment.file_size
                            ? ` • ${Math.round(attachment.file_size / 1024)} KB`
                            : ""}
                        </div>
                      </button>
                    ))}
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

        <button className="bg-black text-white px-4 py-2 rounded" onClick={send}>
          Send
        </button>
      </div>
    </div>
  );
}