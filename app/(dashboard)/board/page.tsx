"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";

type Role = "admin" | "rep" | "client" | null;

type Brand = { id: string; name: string };

type TimingRow = {
  id: string;
  brand_id: string;
  retailer_id: string;
  account_status: string;
  submitted_date: string | null;
};

type Retailer = {
  id: string;
  name: string;
  banner: string | null;
};

type Message = {
  id: string;
  brand_id: string;
  retailer_id: string;
  body: string;
  created_at: string;
};

type BoardRetailerRow = {
  timingId: string;
  retailerId: string;
  banner: string;
  accountStatus: string;
  submittedDate: string | null;
  latestNote: string | null;
  latestNoteDate: string | null;
};

type BoardBrand = {
  id: string;
  name: string;
  lastActivity: string | null; // max submitted_date across retailers
  rows: BoardRetailerRow[];
};

function statusLabel(status: string) {
  switch (status) {
    case "active_account":                         return "Active Account";
    case "open_review":                            return "In Progress";
    case "under_review":                           return "Under Review";
    case "upcoming_review":                        return "Upcoming Review";
    case "waiting_for_retailer_to_publish_review": return "Awaiting Retailer Decision";
    case "working_to_secure_anchor_account":       return "Distributor Required";
    case "not_a_target_account":                   return "Not a Target";
    case "cultivate_does_not_rep":                 return "Not Managed by Cultivate";
    case "retailer_declined":                      return "Retailer Declined";
    default:                                       return status;
  }
}

function prettyDate(value: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export default function AllBrandsBoardPage() {
  const router = useRouter();

  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [boardBrands, setBoardBrands] = useState<BoardBrand[]>([]);
  const [search, setSearch] = useState("");

  // Which brand sections are expanded (by brand id)
  const [expandedBrandIds, setExpandedBrandIds] = useState<Set<string>>(new Set());

  // Retailer-level note editor: key = `${brandId}__${retailerId}`
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<Record<string, string>>({});

  // Track previous search to detect transitions
  const prevSearchRef = useRef("");

  useEffect(() => {
    load();
  }, []);

  // Auto-expand matching brands when search is typed; collapse all when cleared
  useEffect(() => {
    const q = search.trim().toLowerCase();
    const prev = prevSearchRef.current.trim().toLowerCase();
    prevSearchRef.current = search;

    if (q) {
      // Expand all brands whose name matches
      setExpandedBrandIds((current) => {
        const next = new Set(current);
        boardBrands.forEach((b) => {
          if (b.name.toLowerCase().includes(q)) next.add(b.id);
        });
        return next;
      });
    } else if (prev && !q) {
      // Search was cleared — collapse everything
      setExpandedBrandIds(new Set());
      setExpandedKey(null);
      setNoteText("");
    }
  }, [search, boardBrands]);

  async function load() {
    setLoading(true);
    setError("");

    const { data: authData } = await supabase.auth.getUser();
    const uid = authData?.user?.id ?? null;
    setUserId(uid);

    if (!uid) { router.replace("/login"); return; }

    const { data: profileData } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", uid)
      .maybeSingle();

    const role = (profileData?.role as Role) ?? "client";
    if (role === "client") { router.replace("/brands"); return; }

    const [brandsRes, timingRes, messagesRes] = await Promise.all([
      supabase.from("brands").select("id, name").order("name", { ascending: true }),
      supabase.from("brand_retailer_timing").select("id, brand_id, retailer_id, account_status, submitted_date"),
      supabase
        .from("brand_retailer_messages")
        .select("id, brand_id, retailer_id, body, created_at")
        .eq("visibility", "internal")
        .order("created_at", { ascending: false }),
    ]);

    if (brandsRes.error) { setError(brandsRes.error.message); setLoading(false); return; }
    if (timingRes.error) { setError(timingRes.error.message); setLoading(false); return; }
    if (messagesRes.error) { setError(messagesRes.error.message); setLoading(false); return; }

    const brands = (brandsRes.data as Brand[]) ?? [];
    const timing = (timingRes.data as TimingRow[]) ?? [];
    const messages = (messagesRes.data as Message[]) ?? [];

    const allRetailerIds = [...new Set(timing.map((t) => t.retailer_id))];
    let retailerMap: Record<string, Retailer> = {};
    if (allRetailerIds.length > 0) {
      const { data: retailerData, error: retailerError } = await supabase
        .from("retailers")
        .select("id, name, banner")
        .in("id", allRetailerIds);
      if (retailerError) { setError(retailerError.message); setLoading(false); return; }
      ((retailerData as Retailer[]) ?? []).forEach((r) => { retailerMap[r.id] = r; });
    }

    // Latest internal note per brand+retailer
    const latestNoteMap: Record<string, Message> = {};
    messages.forEach((m) => {
      const key = `${m.brand_id}__${m.retailer_id}`;
      if (!latestNoteMap[key]) latestNoteMap[key] = m;
    });

    const timingByBrand: Record<string, TimingRow[]> = {};
    timing.forEach((t) => {
      if (!timingByBrand[t.brand_id]) timingByBrand[t.brand_id] = [];
      timingByBrand[t.brand_id].push(t);
    });

    const board: BoardBrand[] = brands
      .map((brand) => {
        const brandTiming = timingByBrand[brand.id] ?? [];
        const rows: BoardRetailerRow[] = brandTiming
          .map((t) => {
            const retailer = retailerMap[t.retailer_id];
            const banner = retailer?.banner?.trim() || retailer?.name || "Unknown Retailer";
            const noteKey = `${brand.id}__${t.retailer_id}`;
            const latest = latestNoteMap[noteKey] ?? null;
            return {
              timingId: t.id,
              retailerId: t.retailer_id,
              banner,
              accountStatus: t.account_status,
              submittedDate: t.submitted_date,
              latestNote: latest?.body ?? null,
              latestNoteDate: latest?.created_at ?? null,
            };
          })
          .sort((a, b) => a.banner.localeCompare(b.banner));

        // Most recent submitted_date across all retailers for this brand
        const lastActivity = rows.reduce<string | null>((best, r) => {
          if (!r.submittedDate) return best;
          if (!best) return r.submittedDate;
          return r.submittedDate > best ? r.submittedDate : best;
        }, null);

        return { id: brand.id, name: brand.name, lastActivity, rows };
      })
      .filter((b) => b.rows.length > 0);

    setBoardBrands(board);
    setLoading(false);
  }

  const filteredBrands = useMemo(() => {
    if (!search.trim()) return boardBrands;
    const q = search.trim().toLowerCase();
    return boardBrands.filter((b) => b.name.toLowerCase().includes(q));
  }, [boardBrands, search]);

  function toggleBrand(brandId: string) {
    setExpandedBrandIds((prev) => {
      const next = new Set(prev);
      if (next.has(brandId)) {
        next.delete(brandId);
        // Close any open note editor in this brand
        if (expandedKey?.startsWith(`${brandId}__`)) {
          setExpandedKey(null);
          setNoteText("");
        }
      } else {
        next.add(brandId);
      }
      return next;
    });
  }

  function toggleNoteEditor(brandId: string, retailerId: string) {
    const key = `${brandId}__${retailerId}`;
    if (expandedKey === key) {
      setExpandedKey(null);
      setNoteText("");
    } else {
      setExpandedKey(key);
      setNoteText("");
    }
  }

  async function saveNote(brandId: string, retailerId: string) {
    const text = noteText.trim();
    if (!text || !userId) return;
    const key = `${brandId}__${retailerId}`;

    setSaving(true);
    setSaveStatus((s) => ({ ...s, [key]: "" }));

    const { error } = await supabase.from("brand_retailer_messages").insert({
      brand_id: brandId,
      retailer_id: retailerId,
      visibility: "internal",
      sender_id: userId,
      body: text,
    });

    setSaving(false);

    if (error) {
      setSaveStatus((s) => ({ ...s, [key]: error.message }));
      return;
    }

    setSaveStatus((s) => ({ ...s, [key]: "Saved." }));
    setExpandedKey(null);
    setNoteText("");
    await load();
  }

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-3xl font-bold" style={{ color: "var(--foreground)" }}>
          All Brands Board
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--muted-foreground)" }}>
          Click a brand to expand — click a retailer row to add an internal note
        </p>
      </div>

      <input
        type="text"
        placeholder="Filter by brand name…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full max-w-sm rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2"
        style={{
          border: "1px solid var(--border)",
          background: "var(--card)",
          color: "var(--foreground)",
        }}
      />

      {error && <p className="text-sm text-red-600">{error}</p>}

      {loading ? (
        <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>Loading…</p>
      ) : filteredBrands.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
          {search ? "No brands match your search." : "No retailer data found."}
        </p>
      ) : (
        <div className="space-y-2">
          {filteredBrands.map((brand) => {
            const isOpen = expandedBrandIds.has(brand.id);
            return (
              <div
                key={brand.id}
                className="rounded-xl overflow-hidden"
                style={{ border: "1px solid var(--border)" }}
              >
                {/* ── Brand summary / header row ── */}
                <button
                  type="button"
                  className="w-full flex items-center justify-between px-4 py-3 text-left"
                  style={{
                    background: isOpen ? "var(--accent)" : "var(--muted)",
                    cursor: "pointer",
                  }}
                  onClick={() => toggleBrand(brand.id)}
                >
                  <div className="flex items-center gap-4 min-w-0">
                    <span
                      className="font-semibold text-sm truncate"
                      style={{ color: "var(--foreground)" }}
                    >
                      {brand.name}
                    </span>
                    <span
                      className="text-xs shrink-0"
                      style={{ color: "var(--muted-foreground)" }}
                    >
                      {brand.rows.length} retailer{brand.rows.length !== 1 ? "s" : ""}
                    </span>
                    <span
                      className="text-xs shrink-0"
                      style={{ color: "var(--muted-foreground)" }}
                    >
                      Last activity: {prettyDate(brand.lastActivity)}
                    </span>
                  </div>

                  <div className="flex items-center gap-3 shrink-0 ml-4">
                    <Link
                      href={`/brands/${brand.id}/board`}
                      className="text-xs underline"
                      style={{ color: "var(--muted-foreground)" }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      Open brand board
                    </Link>
                    <span
                      style={{ color: "var(--muted-foreground)", fontSize: "0.65rem" }}
                    >
                      {isOpen ? "▲" : "▼"}
                    </span>
                  </div>
                </button>

                {/* ── Expanded retailer table ── */}
                {isOpen && (
                  <table className="w-full text-sm">
                    <thead>
                      <tr
                        style={{
                          background: "var(--secondary)",
                          color: "var(--muted-foreground)",
                          borderTop: "1px solid var(--border)",
                        }}
                      >
                        <th className="text-left px-4 py-2 font-medium">Retailer</th>
                        <th className="text-left px-4 py-2 font-medium">Account Status</th>
                        <th className="text-left px-4 py-2 font-medium">Last Activity</th>
                        <th className="text-left px-4 py-2 font-medium">Latest Internal Note</th>
                        <th className="w-8" />
                      </tr>
                    </thead>
                    <tbody>
                      {brand.rows.map((row, idx) => {
                        const key = `${brand.id}__${row.retailerId}`;
                        const isNoteOpen = expandedKey === key;
                        const isEven = idx % 2 === 0;
                        return (
                          <>
                            <tr
                              key={key}
                              style={{
                                background: isNoteOpen
                                  ? "var(--accent)"
                                  : isEven
                                  ? "var(--card)"
                                  : "var(--secondary)",
                                borderTop: "1px solid var(--border)",
                                cursor: "pointer",
                              }}
                              onClick={() => toggleNoteEditor(brand.id, row.retailerId)}
                            >
                              <td
                                className="px-4 py-2.5 font-medium"
                                style={{ color: "var(--foreground)" }}
                              >
                                <Link
                                  href={`/brands/${brand.id}/retailers/${row.retailerId}`}
                                  className="underline"
                                  style={{ color: "var(--foreground)" }}
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {row.banner}
                                </Link>
                              </td>
                              <td className="px-4 py-2.5" style={{ color: "var(--foreground)" }}>
                                {statusLabel(row.accountStatus)}
                              </td>
                              <td className="px-4 py-2.5" style={{ color: "var(--muted-foreground)" }}>
                                {prettyDate(row.submittedDate)}
                              </td>
                              <td
                                className="px-4 py-2.5 max-w-xs"
                                style={{ color: row.latestNote ? "var(--foreground)" : "var(--muted-foreground)" }}
                              >
                                {row.latestNote ? (
                                  <>
                                    <span className="line-clamp-1">
                                      {row.latestNote.length > 80
                                        ? row.latestNote.slice(0, 80) + "…"
                                        : row.latestNote}
                                    </span>
                                    {row.latestNoteDate && (
                                      <span className="text-xs block" style={{ color: "var(--muted-foreground)" }}>
                                        {prettyDate(row.latestNoteDate)}
                                      </span>
                                    )}
                                  </>
                                ) : (
                                  <span className="italic text-xs">No notes yet</span>
                                )}
                              </td>
                              <td
                                className="px-2 py-2.5 text-right"
                                style={{ color: "var(--muted-foreground)", fontSize: "0.7rem" }}
                              >
                                {isNoteOpen ? "▲" : "▼"}
                              </td>
                            </tr>

                            {isNoteOpen && (
                              <tr
                                key={`${key}-editor`}
                                style={{
                                  background: "var(--accent)",
                                  borderTop: "1px solid var(--border)",
                                }}
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
                                        minHeight: "72px",
                                      }}
                                      placeholder="Write an internal note…"
                                      value={noteText}
                                      onChange={(e) => setNoteText(e.target.value)}
                                      onClick={(e) => e.stopPropagation()}
                                      autoFocus
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
                                        onClick={(e) => { e.stopPropagation(); saveNote(brand.id, row.retailerId); }}
                                      >
                                        {saving ? "Saving…" : "Save Note"}
                                      </button>
                                      <button
                                        className="text-sm underline"
                                        style={{ color: "var(--muted-foreground)" }}
                                        onClick={(e) => { e.stopPropagation(); toggleNoteEditor(brand.id, row.retailerId); }}
                                      >
                                        Cancel
                                      </button>
                                      {saveStatus[key] && (
                                        <span className="text-sm" style={{ color: "var(--muted-foreground)" }}>
                                          {saveStatus[key]}
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
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
