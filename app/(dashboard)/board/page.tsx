"use client";

import { useEffect, useState, useMemo } from "react";
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

  // expandedKey = `${brandId}__${retailerId}`
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<Record<string, string>>({});

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    setError("");

    const { data: authData } = await supabase.auth.getUser();
    const uid = authData?.user?.id ?? null;
    setUserId(uid);

    if (!uid) {
      router.replace("/login");
      return;
    }

    const { data: profileData } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", uid)
      .maybeSingle();

    const role = (profileData?.role as Role) ?? "client";

    if (role === "client") {
      router.replace("/brands");
      return;
    }

    // Parallel fetch: brands, timing, messages
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

    // Fetch retailers for all retailer_ids in timing
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

    // Latest internal message per brand+retailer
    const latestNoteMap: Record<string, Message> = {};
    messages.forEach((m) => {
      const key = `${m.brand_id}__${m.retailer_id}`;
      if (!latestNoteMap[key]) latestNoteMap[key] = m;
    });

    // Group timing by brand_id
    const timingByBrand: Record<string, TimingRow[]> = {};
    timing.forEach((t) => {
      if (!timingByBrand[t.brand_id]) timingByBrand[t.brand_id] = [];
      timingByBrand[t.brand_id].push(t);
    });

    // Build board structure
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
        return { id: brand.id, name: brand.name, rows };
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

  function toggleExpand(brandId: string, retailerId: string) {
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
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold" style={{ color: "var(--foreground)" }}>
            All Brands Board
          </h1>
          <p className="mt-1 text-sm" style={{ color: "var(--muted-foreground)" }}>
            Internal notes across every brand — click a row to add a note
          </p>
        </div>
      </div>

      {/* Search */}
      <div>
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
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {loading ? (
        <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>Loading…</p>
      ) : filteredBrands.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
          {search ? "No brands match your search." : "No retailer data found."}
        </p>
      ) : (
        <div className="space-y-10">
          {filteredBrands.map((brand) => (
            <div key={brand.id}>
              {/* Sticky brand header */}
              <div
                className="sticky top-0 z-10 flex items-center justify-between px-4 py-2"
                style={{
                  background: "var(--muted)",
                  borderTop: "1px solid var(--border)",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                <Link
                  href={`/brands/${brand.id}/board`}
                  className="font-semibold text-sm hover:underline"
                  style={{ color: "var(--foreground)" }}
                >
                  {brand.name}
                </Link>
                <Link
                  href={`/brands/${brand.id}/board`}
                  className="text-xs underline"
                  style={{ color: "var(--muted-foreground)" }}
                >
                  Open brand board →
                </Link>
              </div>

              {/* Retailer table for this brand */}
              <div
                className="overflow-hidden"
                style={{ border: "1px solid var(--border)", borderTop: "none" }}
              >
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ background: "var(--secondary)", color: "var(--muted-foreground)" }}>
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
                      const isExpanded = expandedKey === key;
                      const isEven = idx % 2 === 0;
                      return (
                        <>
                          <tr
                            key={key}
                            style={{
                              background: isExpanded
                                ? "var(--accent)"
                                : isEven
                                ? "var(--card)"
                                : "var(--secondary)",
                              borderTop: "1px solid var(--border)",
                              cursor: "pointer",
                            }}
                            onClick={() => toggleExpand(brand.id, row.retailerId)}
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
                                <span>
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
                                </span>
                              ) : (
                                <span className="italic text-xs">No notes yet</span>
                              )}
                            </td>
                            <td className="px-2 py-2.5 text-right" style={{ color: "var(--muted-foreground)", fontSize: "0.7rem" }}>
                              {isExpanded ? "▲" : "▼"}
                            </td>
                          </tr>

                          {isExpanded && (
                            <tr
                              key={`${key}-expand`}
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
                                      onClick={(e) => { e.stopPropagation(); toggleExpand(brand.id, row.retailerId); }}
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
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
