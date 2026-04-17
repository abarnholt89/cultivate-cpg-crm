"use client";

import { useState } from "react";
import { ExpandedThread } from "./expanded-thread";
import { StatusPill } from "./status-pill";

export function RetailerRow({ row, brandId, userId }: { row: any; brandId: string; userId: string }) {
  const [expanded, setExpanded] = useState(false);
  const timestamp = row.latest_message_at ?? row.last_contact_date;
  const daysStale = timestamp
    ? Math.floor((Date.now() - new Date(timestamp).getTime()) / 86400000)
    : 999;
  const isNew = daysStale <= 3 && !!row.latest_message_at;
  const accent = isNew ? "border-l-[3px] border-teal-500" : "";
  const stale = daysStale > 21 ? "opacity-60" : "";
  const preview = row.latest_message_body ?? row.pipeline_notes ?? "No activity yet";
  const author = row.latest_message_sender ?? row.rep_name;

  return (
    <div className={`${accent} ${stale} border-b border-slate-100`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full grid grid-cols-[240px_160px_1fr_120px_24px] gap-4 px-5 py-3.5 items-center text-left hover:bg-slate-50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">{row.retailer_name}</span>
          {isNew && (
            <span className="text-[10px] font-medium text-teal-900 bg-teal-200 px-2 py-0.5 rounded-full">NEW</span>
          )}
        </div>
        <div><StatusPill status={row.account_status} /></div>
        <div className="text-sm truncate">
          {author && <span className="text-slate-500">{author}: </span>}
          {preview}
        </div>
        <div className="text-xs text-slate-500">{timestamp ? relativeTime(timestamp) : "—"}</div>
        <div className="text-slate-400">{expanded ? "▲" : "▼"}</div>
      </button>

      {expanded && (
        <ExpandedThread brandId={brandId} retailerId={row.retailer_id} userId={userId} />
      )}
    </div>
  );
}

function relativeTime(ts: string) {
  const mins = Math.floor((Date.now() - new Date(ts).getTime()) / 60000);
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  const days = Math.floor(mins / 1440);
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}
