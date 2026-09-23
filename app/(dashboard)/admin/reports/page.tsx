"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Role = "admin" | "rep" | "client" | null;

type BrandRow = {
  id: string;
  name: string;
  monthly_sales_folder_url: string | null;
};

type SendLogRow = {
  id: string;
  report_type: string;
  brand_name: string;
  recipient_email: string;
  status: string;
  error: string | null;
  sent_at: string;
};

type PreviewResult = {
  brands: number;
  contacts: number;
  skipped: number;
};

type SendResult = {
  sent: number;
  failed: number;
  skipped: number;
  brands: number;
};

const inputCls = "w-full border rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400";

export default function AdminReportsPage() {
  const router = useRouter();

  const [authChecked, setAuthChecked] = useState(false);
  const [authorized, setAuthorized] = useState(false);
  const [brands, setBrands] = useState<BrandRow[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingUrl, setEditingUrl] = useState("");
  const [saving, setSaving] = useState(false);

  const [sendLog, setSendLog] = useState<SendLogRow[]>([]);

  // Modal state
  const [modalType, setModalType] = useState<"distributor" | "spins" | null>(null);
  const [messageBody, setMessageBody] = useState("");
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<SendResult | null>(null);
  const [sendError, setSendError] = useState("");

  const messageRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    async function check() {
      const { data: authData } = await supabase.auth.getUser();
      const userId = authData?.user?.id;
      if (!userId) { router.replace("/login"); return; }
      const { data: profile } = await supabase.from("profiles").select("role").eq("id", userId).maybeSingle();
      if ((profile as { role: Role } | null)?.role !== "admin") { router.replace("/brands"); return; }
      setAuthorized(true);
      setAuthChecked(true);
      await Promise.all([loadBrands(), loadSendLog()]);
    }
    check();
  }, [router]);

  async function loadBrands() {
    const { data } = await supabase
      .from("brands")
      .select("id,name,monthly_sales_folder_url")
      .eq("archived", false)
      .order("name");
    setBrands((data ?? []) as BrandRow[]);
  }

  async function loadSendLog() {
    const { data } = await supabase
      .from("monthly_report_sends")
      .select("id,report_type,brand_name,recipient_email,status,error,sent_at")
      .order("sent_at", { ascending: false })
      .limit(200);
    setSendLog((data ?? []) as SendLogRow[]);
  }

  async function saveUrl(brandId: string) {
    setSaving(true);
    const url = editingUrl.trim() || null;
    await supabase.from("brands").update({ monthly_sales_folder_url: url }).eq("id", brandId);
    setBrands((prev) => prev.map((b) => b.id === brandId ? { ...b, monthly_sales_folder_url: url } : b));
    setEditingId(null);
    setEditingUrl("");
    setSaving(false);
  }

  async function openModal(type: "distributor" | "spins") {
    setModalType(type);
    setMessageBody("");
    setPreview(null);
    setSendResult(null);
    setSendError("");
  }

  async function fetchPreview() {
    setPreviewing(true);
    setSendError("");
    try {
      const { data: session } = await supabase.auth.getSession();
      const jwt = session.session?.access_token;
      const resp = await fetch("/api/send-monthly-reports", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
        body: JSON.stringify({ report_type: modalType, message_body: messageBody, preview: true }),
      });
      const result = await resp.json();
      if (!resp.ok) { setSendError(result.error ?? "Preview failed."); return; }
      setPreview(result as PreviewResult);
    } finally {
      setPreviewing(false);
    }
  }

  async function confirmSend() {
    setSending(true);
    setSendError("");
    try {
      const { data: session } = await supabase.auth.getSession();
      const jwt = session.session?.access_token;
      const resp = await fetch("/api/send-monthly-reports", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
        body: JSON.stringify({ report_type: modalType, message_body: messageBody }),
      });
      const result = await resp.json();
      if (!resp.ok) { setSendError(result.error ?? "Send failed."); return; }
      setSendResult(result as SendResult);
      await loadSendLog();
    } finally {
      setSending(false);
    }
  }

  function closeModal() {
    setModalType(null);
    setPreview(null);
    setSendResult(null);
    setSendError("");
    setMessageBody("");
  }

  if (!authChecked) {
    return <div className="p-6 text-sm text-muted-foreground">Checking access…</div>;
  }
  if (!authorized) return null;

  const withUrl = brands.filter((b) => b.monthly_sales_folder_url);
  const withoutUrl = brands.filter((b) => !b.monthly_sales_folder_url);
  const typeLabel = modalType === "distributor" ? "Distributor" : "SPINS";

  return (
    <div className="p-6 space-y-8 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold">Monthly Reports</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage Google Drive folder links and bulk-notify brand clients.
        </p>
      </div>

      {/* ── Bulk notify buttons ─────────────────────────────────────────── */}
      <div className="flex gap-3 flex-wrap">
        <button
          onClick={() => openModal("distributor")}
          className="px-4 py-2 rounded-lg text-sm font-medium"
          style={{ background: "var(--foreground)", color: "var(--background)" }}
        >
          Notify Distributor Contacts
        </button>
        <button
          onClick={() => openModal("spins")}
          className="px-4 py-2 rounded-lg text-sm font-medium border"
        >
          Notify SPINS Contacts
        </button>
      </div>

      {/* ── Folder management table ─────────────────────────────────────── */}
      <div>
        <h2 className="text-base font-semibold mb-3">
          Folder Links
          <span className="ml-2 text-sm font-normal text-muted-foreground">
            {withUrl.length} set · {withoutUrl.length} missing
          </span>
        </h2>
        <div className="border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/30">
                <th className="px-4 py-2 text-left font-medium">Brand</th>
                <th className="px-4 py-2 text-left font-medium">Google Drive Folder URL</th>
                <th className="px-4 py-2 w-24"></th>
              </tr>
            </thead>
            <tbody>
              {brands.map((brand) => {
                const missing = !brand.monthly_sales_folder_url;
                const isEditing = editingId === brand.id;
                return (
                  <tr
                    key={brand.id}
                    className="border-b last:border-0 hover:bg-muted/10 transition-colors"
                    style={missing ? { background: "#fff8f0" } : undefined}
                  >
                    <td className="px-4 py-2.5 font-medium">
                      {brand.name}
                      {missing && (
                        <span className="ml-2 text-[10px] font-semibold px-1.5 py-0.5 rounded"
                          style={{ background: "#fde68a", color: "#92400e" }}>
                          MISSING
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      {isEditing ? (
                        <input
                          type="url"
                          className={inputCls}
                          value={editingUrl}
                          onChange={(e) => setEditingUrl(e.target.value)}
                          placeholder="https://drive.google.com/drive/folders/..."
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveUrl(brand.id);
                            if (e.key === "Escape") { setEditingId(null); setEditingUrl(""); }
                          }}
                        />
                      ) : brand.monthly_sales_folder_url ? (
                        <a
                          href={brand.monthly_sales_folder_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:underline truncate block max-w-sm"
                        >
                          {brand.monthly_sales_folder_url}
                        </a>
                      ) : (
                        <span className="text-muted-foreground italic text-xs">No URL set</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {isEditing ? (
                        <div className="flex gap-2 justify-end">
                          <button
                            onClick={() => saveUrl(brand.id)}
                            disabled={saving}
                            className="text-xs px-2 py-1 rounded font-medium"
                            style={{ background: "var(--foreground)", color: "var(--background)" }}
                          >
                            {saving ? "…" : "Save"}
                          </button>
                          <button
                            onClick={() => { setEditingId(null); setEditingUrl(""); }}
                            className="text-xs text-muted-foreground hover:text-foreground"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => { setEditingId(brand.id); setEditingUrl(brand.monthly_sales_folder_url ?? ""); }}
                          className="text-xs text-muted-foreground hover:text-foreground"
                        >
                          {brand.monthly_sales_folder_url ? "Edit" : "Add URL"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Send log ────────────────────────────────────────────────────── */}
      {sendLog.length > 0 && (
        <div>
          <h2 className="text-base font-semibold mb-3">Send Log</h2>
          <div className="border rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="px-4 py-2 text-left font-medium">Sent</th>
                    <th className="px-4 py-2 text-left font-medium">Type</th>
                    <th className="px-4 py-2 text-left font-medium">Brand</th>
                    <th className="px-4 py-2 text-left font-medium">Recipient</th>
                    <th className="px-4 py-2 text-left font-medium">Status</th>
                    <th className="px-4 py-2 text-left font-medium">Error</th>
                  </tr>
                </thead>
                <tbody>
                  {sendLog.map((row) => (
                    <tr key={row.id} className="border-b last:border-0">
                      <td className="px-4 py-2 text-muted-foreground whitespace-nowrap">
                        {new Date(row.sent_at).toLocaleString()}
                      </td>
                      <td className="px-4 py-2 capitalize">{row.report_type}</td>
                      <td className="px-4 py-2">{row.brand_name}</td>
                      <td className="px-4 py-2">{row.recipient_email}</td>
                      <td className="px-4 py-2">
                        <span
                          className="px-1.5 py-0.5 rounded text-[10px] font-semibold"
                          style={row.status === "sent"
                            ? { background: "#d1fae5", color: "#065f46" }
                            : { background: "#fee2e2", color: "#991b1b" }}
                        >
                          {row.status}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-red-600">{row.error ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── Send modal ──────────────────────────────────────────────────── */}
      {modalType && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.4)" }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 p-6 space-y-5">
            {sendResult ? (
              <>
                <h2 className="text-lg font-semibold">Sent ✓</h2>
                <div className="text-sm space-y-1">
                  <div><span className="font-medium">{sendResult.sent}</span> emails sent</div>
                  {sendResult.failed > 0 && (
                    <div className="text-red-600"><span className="font-medium">{sendResult.failed}</span> failed</div>
                  )}
                  <div className="text-muted-foreground"><span className="font-medium">{sendResult.skipped}</span> brands skipped</div>
                </div>
                <button
                  onClick={closeModal}
                  className="w-full py-2 rounded-lg text-sm font-medium"
                  style={{ background: "var(--foreground)", color: "var(--background)" }}
                >
                  Done
                </button>
              </>
            ) : (
              <>
                <h2 className="text-lg font-semibold">Send Monthly {typeLabel} Report</h2>

                <div>
                  <label className="block text-xs text-muted-foreground mb-1.5">Message</label>
                  <textarea
                    ref={messageRef}
                    value={messageBody}
                    onChange={(e) => { setMessageBody(e.target.value); setPreview(null); }}
                    rows={5}
                    placeholder={`Hi team, your monthly ${typeLabel.toLowerCase()} sales data is ready…`}
                    className="w-full border rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-blue-400"
                  />
                </div>

                {!preview && (
                  <button
                    onClick={fetchPreview}
                    disabled={previewing || !messageBody.trim()}
                    className="w-full py-2 rounded-lg text-sm font-medium border disabled:opacity-50"
                  >
                    {previewing ? "Calculating…" : "Preview Send Counts"}
                  </button>
                )}

                {preview && (
                  <div className="rounded-lg border p-4 space-y-2 text-sm bg-muted/10">
                    <div>
                      <span className="font-semibold">{preview.brands} brands</span>
                      {" · "}
                      <span className="font-semibold">{preview.contacts} contacts</span>
                      {preview.skipped > 0 && (
                        <span className="text-muted-foreground"> · {preview.skipped} skipped (no folder URL or no contacts)</span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Each brand's clients receive one email with a link to their own folder. This cannot be undone.
                    </div>
                    {sendError && <div className="text-sm text-red-600">{sendError}</div>}
                    <div className="flex gap-3 pt-1">
                      <button
                        onClick={confirmSend}
                        disabled={sending || preview.contacts === 0}
                        className="flex-1 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
                        style={{ background: "var(--foreground)", color: "var(--background)" }}
                      >
                        {sending ? "Sending…" : `Send to ${preview.contacts} contact${preview.contacts !== 1 ? "s" : ""} →`}
                      </button>
                      <button
                        onClick={closeModal}
                        className="px-4 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground border"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {!preview && (
                  <button
                    onClick={closeModal}
                    className="w-full py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground border"
                  >
                    Cancel
                  </button>
                )}

                {sendError && !preview && (
                  <div className="text-sm text-red-600">{sendError}</div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
