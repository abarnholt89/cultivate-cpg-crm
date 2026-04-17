"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export function ExpandedThread({ brandId, retailerId, userId }: { brandId: string; retailerId: string; userId: string }) {
  const [messages, setMessages] = useState<any[]>([]);
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => { load(); }, [brandId, retailerId]);

  async function load() {
    const { data } = await supabase
      .from("brand_retailer_messages")
      .select("id, body, sender_id, sender_name, visibility, created_at")
      .eq("brand_id", brandId)
      .eq("retailer_id", retailerId)
      .eq("visibility", "client")
      .order("created_at", { ascending: false })
      .limit(5);
    setMessages((data ?? []).reverse());
  }

  async function send() {
    if (!replyText.trim() || sending) return;
    setSending(true);
    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", userId)
      .single();
    await supabase.from("brand_retailer_messages").insert({
      brand_id: brandId,
      retailer_id: retailerId,
      sender_id: userId,
      sender_name: profile?.full_name ?? "Client",
      body: replyText,
      visibility: "client",
    });
    setReplyText("");
    await load();
    setSending(false);
  }

  return (
    <div className="px-5 pb-5 border-t border-dashed border-slate-200">
      {messages.length === 0 ? (
        <div className="py-4 text-sm text-slate-500">
          No messages yet on this retailer. Send the first one below.
        </div>
      ) : (
        messages.map((m) => (
          <div key={m.id} className="flex gap-3 py-3 border-t border-slate-100 first:border-t-0">
            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-medium flex-shrink-0 ${
              m.sender_id === userId ? "bg-slate-200 text-slate-700" : "bg-teal-200 text-teal-900"
            }`}>
              {(m.sender_name ?? "?").split(" ").map((p: string) => p[0]).slice(0, 2).join("").toUpperCase()}
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-sm font-medium">{m.sender_name}</span>
                <span className="text-[11px] text-slate-500">
                  {m.sender_id === userId ? "You" : "Cultivate"} · {relativeTime(m.created_at)}
                </span>
              </div>
              <div className="text-sm leading-relaxed whitespace-pre-wrap">{m.body}</div>
            </div>
          </div>
        ))
      )}

      <div className="mt-3 pt-3 border-t border-slate-100 flex gap-2">
        <textarea
          value={replyText}
          onChange={(e) => setReplyText(e.target.value)}
          placeholder="Write a message to the Cultivate team…"
          className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-md resize-none focus:outline-none focus:border-teal-500"
          rows={2}
        />
        <button
          onClick={send}
          disabled={!replyText.trim() || sending}
          className="px-4 py-2 bg-teal-400 text-teal-950 font-medium text-sm rounded-md hover:bg-teal-500 disabled:opacity-50 self-end"
        >
          Send
        </button>
      </div>
    </div>
  );
}

function relativeTime(ts: string) {
  const mins = Math.floor((Date.now() - new Date(ts).getTime()) / 60000);
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  return `${Math.floor(mins / 1440)}d ago`;
}
