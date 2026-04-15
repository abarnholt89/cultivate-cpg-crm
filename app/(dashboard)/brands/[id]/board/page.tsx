"use client";

import { useEffect, useState, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import StatusBadge from "@/components/StatusBadge";

type Role = "admin" | "rep" | "client" | null;

type TimingRow = {
  id: string;
  retailer_id: string;
  account_status: string;
  submitted_date: string | null;
};

type RetailerRow = {
  id: string;
  name: string;
  banner: string | null;
  rep_owner_user_id: string | null;
};

type RepProfile = {
  id: string;
  full_name: string | null;
};

type MessageRow = {
  id: string;
  retailer_id: string;
  body: string;
  visibility: "client" | "internal";
  created_at: string;
};

type BoardRow = {
  timingId: string;
  retailerId: string;
  banner: string;
  accountStatus: string;
  submittedDate: string | null;
  latestNote: string | null;
  latestNoteDate: string | null;
  repOwnerId: string | null;
};


function prettyDate(value: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export default function BrandBoardPage() {
  const params = useParams();
  const idParam = params?.id;
  const brandId = (Array.isArray(idParam) ? idParam[0] : idParam) as string;

  const [role, setRole] = useState<Role>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [brandName, setBrandName] = useState("");
  const [boardRows, setBoardRows] = useState<BoardRow[]>([]);
  const [reps, setReps] = useState<RepProfile[]>([]);
  const [repFilter, setRepFilter] = useState<string>("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  // expand / note state (admin + rep only)
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<Record<string, string>>({});

  const repFilterInitialized = useRef(false);

  const isRepOrAdmin = role === "admin" || role === "rep";

  useEffect(() => {
    if (!brandId) return;
    load();
  }, [brandId]);

  async function load() {
    setLoading(true);
    setError("");

    // 1. Auth + role
    const { data: authData } = await supabase.auth.getUser();
    const uid = authData?.user?.id ?? null;
    setUserId(uid);

    let resolvedRole: Role = "client";
    if (uid) {
      const { data: profileData } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", uid)
        .maybeSingle();
      resolvedRole = (profileData?.role as Role) ?? "client";
    }
    setRole(resolvedRole);

    const isAdminOrRep = resolvedRole === "admin" || resolvedRole === "rep";

    // 2. Brand name
    const { data: brandData, error: brandError } = await supabase
      .from("brands")
      .select("id, name")
      .eq("id", brandId)
      .maybeSingle();

    if (brandError || !brandData) {
      setError(brandError?.message ?? "Brand not found.");
      setLoading(false);
      return;
    }
    setBrandName(brandData.name);

    // 3. Timing rows for this brand
    const { data: timingData, error: timingError } = await supabase
      .from("brand_retailer_timing")
      .select("id, retailer_id, account_status, submitted_date")
      .eq("brand_id", brandId);

    if (timingError) {
      setError(timingError.message);
      setLoading(false);
      return;
    }

    const timing = (timingData as TimingRow[]) ?? [];
    if (timing.length === 0) {
      setBoardRows([]);
      setLoading(false);
      return;
    }

    const retailerIds = [...new Set(timing.map((t) => t.retailer_id))];

    // 4. Retailer names + reps list in parallel
    const [retailerRes, repsRes] = await Promise.all([
      supabase.from("retailers").select("id, name, banner, rep_owner_user_id").in("id", retailerIds),
      supabase.from("profiles").select("id, full_name").in("role", ["rep", "admin"]).order("full_name"),
    ]);

    const retailerData = retailerRes.data;
    const retailerError = retailerRes.error;

    if (!repsRes.error) {
      setReps((repsRes.data ?? []) as RepProfile[]);
    }

    if (retailerError) {
      setError(retailerError.message);
      setLoading(false);
      return;
    }

    const retailerMap: Record<string, RetailerRow> = {};
    ((retailerData as RetailerRow[]) ?? []).forEach((r) => {
      retailerMap[r.id] = r;
    });

    // 5. Latest messages per retailer
    let messagesQuery = supabase
      .from("brand_retailer_messages")
      .select("id, retailer_id, body, visibility, created_at")
      .eq("brand_id", brandId)
      .in("retailer_id", retailerIds)
      .order("created_at", { ascending: false });

    if (!isAdminOrRep) {
      messagesQuery = messagesQuery.eq("visibility", "client");
    }

    const { data: messagesData, error: messagesError } = await messagesQuery;

    if (messagesError) {
      setError(messagesError.message);
      setLoading(false);
      return;
    }

    // Pick the most recent message per retailer_id
    const latestByRetailer: Record<string, MessageRow> = {};
    ((messagesData as MessageRow[]) ?? []).forEach((m) => {
      if (!latestByRetailer[m.retailer_id]) {
        latestByRetailer[m.retailer_id] = m;
      }
    });

    // 6. Build board rows sorted by retailer banner
    const rows: BoardRow[] = timing.map((t) => {
      const retailer = retailerMap[t.retailer_id];
      const banner = retailer?.banner?.trim() || retailer?.name || "Unknown Retailer";
      const latest = latestByRetailer[t.retailer_id] ?? null;
      return {
        timingId: t.id,
        retailerId: t.retailer_id,
        banner,
        accountStatus: t.account_status,
        submittedDate: t.submitted_date,
        latestNote: latest?.body ?? null,
        latestNoteDate: latest?.created_at ?? null,
        repOwnerId: retailer?.rep_owner_user_id ?? null,
      };
    });

    rows.sort((a, b) => a.banner.localeCompare(b.banner));
    setBoardRows(rows);

    if (!repFilterInitialized.current) {
      repFilterInitialized.current = true;
      if (resolvedRole === "rep" && uid) {
        setRepFilter(uid);
      }
    }

    setLoading(false);
  }

  async function saveNote(retailerId: string) {
    const text = noteText.trim();
    if (!text) return;
    if (!userId) {
      setSaveStatus((s) => ({ ...s, [retailerId]: "Not signed in." }));
      return;
    }

    setSaving(true);
    setSaveStatus((s) => ({ ...s, [retailerId]: "" }));

    const { error } = await supabase.from("brand_retailer_messages").insert({
      brand_id: brandId,
      retailer_id: retailerId,
      visibility: "internal",
      sender_id: userId,
      body: text,
    });

    setSaving(false);

    if (error) {
      setSaveStatus((s) => ({ ...s, [retailerId]: error.message }));
      return;
    }

    setSaveStatus((s) => ({ ...s, [retailerId]: "Saved." }));
    setExpandedId(null);
    setNoteText("");
    await load();
  }

  function toggleExpand(retailerId: string) {
    if (expandedId === retailerId) {
      setExpandedId(null);
      setNoteText("");
    } else {
      setExpandedId(retailerId);
      setNoteText("");
    }
  }

  if (!brandId) return <div className="p-6">No brand ID in URL.</div>;

  return (
    <div className="p-6 space-y-6">
      <Link href={`/brands/${brandId}`} className="underline text-sm" style={{ color: "var(--muted-foreground)" }}>
        ← Back to {brandName || "Brand"}
      </Link>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold mt-2" style={{ color: "var(--foreground)" }}>
            {brandName}
          </h1>
          <p className="mt-1 text-sm" style={{ color: "var(--muted-foreground)" }}>
            Retailer Board {isRepOrAdmin ? "— click a row to add a note" : ""}
          </p>
        </div>

        {/* Nav tabs */}
        <div className="flex gap-2 text-sm flex-wrap">
          <Link href={`/brands/${brandId}`} className="px-3 py-1.5 rounded border hover:bg-gray-50">
            Overview
          </Link>
          <Link href={`/brands/${brandId}/retailers`} className="px-3 py-1.5 rounded border hover:bg-gray-50">
            Retailers
          </Link>
          <span
            className="px-3 py-1.5 rounded border text-white"
            style={{ background: "var(--foreground)" }}
          >
            Board
          </span>
          <Link href={`/brands/${brandId}/category-review`} className="px-3 py-1.5 rounded border hover:bg-gray-50">
            Category Review
          </Link>
        </div>
      </div>

      {reps.length > 0 && (
        <select
          value={repFilter}
          onChange={(e) => setRepFilter(e.target.value)}
          className="rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2"
          style={{ border: "1px solid var(--border)", background: "var(--card)", color: "var(--foreground)" }}
        >
          <option value="">All reps</option>
          {reps.map((r) => (
            <option key={r.id} value={r.id}>
              {r.full_name ?? r.id}
            </option>
          ))}
        </select>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      {loading ? (
        <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>Loading…</p>
      ) : (() => {
        const displayRows = repFilter
          ? boardRows.filter((r) => r.repOwnerId === repFilter)
          : boardRows;
        return displayRows.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
            {repFilter ? "No retailers assigned to this rep." : "No retailer data found for this brand."}
          </p>
        ) : (
        <div
          className="rounded-xl overflow-hidden"
          style={{ border: "1px solid var(--border)" }}
        >
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: "var(--muted)", color: "var(--muted-foreground)" }}>
                <th className="text-left px-4 py-3 font-medium">Retailer</th>
                <th className="text-left px-4 py-3 font-medium">Account Status</th>
                <th className="text-left px-4 py-3 font-medium">Last Activity</th>
                <th className="text-left px-4 py-3 font-medium">Latest Note</th>
                {isRepOrAdmin && <th className="w-10" />}
              </tr>
            </thead>
            <tbody>
              {displayRows.map((row, idx) => {
                const isExpanded = expandedId === row.retailerId;
                const isEven = idx % 2 === 0;
                return (
                  <>
                    <tr
                      key={row.retailerId}
                      style={{
                        background: isExpanded
                          ? "var(--accent)"
                          : isEven
                          ? "var(--card)"
                          : "var(--secondary)",
                        borderTop: "1px solid var(--border)",
                        cursor: isRepOrAdmin ? "pointer" : "default",
                      }}
                      onClick={() => isRepOrAdmin && toggleExpand(row.retailerId)}
                    >
                      <td
                        className="px-4 py-3 font-medium"
                        style={{ color: "var(--foreground)" }}
                      >
                        <Link
                          href={`/brands/${brandId}/retailers/${row.retailerId}`}
                          className="underline"
                          style={{ color: "var(--foreground)" }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {row.banner}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={row.accountStatus} />
                      </td>
                      <td className="px-4 py-3" style={{ color: "var(--muted-foreground)" }}>
                        {prettyDate(row.submittedDate)}
                      </td>
                      <td
                        className="px-4 py-3 max-w-xs truncate"
                        style={{ color: row.latestNote ? "var(--foreground)" : "var(--muted-foreground)" }}
                        title={row.latestNote ?? undefined}
                      >
                        {row.latestNote ? (
                          <span>
                            {row.latestNote.length > 80
                              ? row.latestNote.slice(0, 80) + "…"
                              : row.latestNote}
                            {row.latestNoteDate && (
                              <span
                                className="ml-2 text-xs"
                                style={{ color: "var(--muted-foreground)" }}
                              >
                                {prettyDate(row.latestNoteDate)}
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="italic">No notes yet</span>
                        )}
                      </td>
                      {isRepOrAdmin && (
                        <td className="px-4 py-3 text-right">
                          <span style={{ color: "var(--muted-foreground)", fontSize: "0.75rem" }}>
                            {isExpanded ? "▲" : "▼"}
                          </span>
                        </td>
                      )}
                    </tr>

                    {isRepOrAdmin && isExpanded && (
                      <tr
                        key={`${row.retailerId}-expand`}
                        style={{ background: "var(--accent)", borderTop: "1px solid var(--border)" }}
                      >
                        <td colSpan={5} className="px-4 pb-4 pt-2">
                          <div className="space-y-2">
                            <p className="text-xs font-medium" style={{ color: "var(--muted-foreground)" }}>
                              Add internal note for {row.banner}
                            </p>
                            <textarea
                              className="w-full rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2"
                              style={{
                                border: "1px solid var(--border)",
                                background: "var(--card)",
                                color: "var(--foreground)",
                                minHeight: "80px",
                                "--tw-ring-color": "var(--ring)",
                              } as React.CSSProperties}
                              placeholder="Write a note…"
                              value={noteText}
                              onChange={(e) => setNoteText(e.target.value)}
                              onClick={(e) => e.stopPropagation()}
                            />
                            <div className="flex items-center gap-3">
                              <button
                                className="px-4 py-1.5 rounded-lg text-sm font-medium"
                                style={{
                                  background: "var(--foreground)",
                                  color: "var(--background)",
                                  opacity: saving || !noteText.trim() ? 0.5 : 1,
                                  cursor: saving || !noteText.trim() ? "not-allowed" : "pointer",
                                }}
                                disabled={saving || !noteText.trim()}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  saveNote(row.retailerId);
                                }}
                              >
                                {saving ? "Saving…" : "Save Note"}
                              </button>
                              <button
                                className="text-sm underline"
                                style={{ color: "var(--muted-foreground)" }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleExpand(row.retailerId);
                                }}
                              >
                                Cancel
                              </button>
                              {saveStatus[row.retailerId] && (
                                <span className="text-sm" style={{ color: "var(--muted-foreground)" }}>
                                  {saveStatus[row.retailerId]}
                                </span>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
        );
      })()}
    </div>
  );
}
