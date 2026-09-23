"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Role = "admin" | "rep" | "client" | "owner" | null;

type BrandContact = {
  id: string;
  brand_name: string | null;
  contact_name: string | null;
  role: string | null;
  notes: string | null;
  email: string | null;
  phone: string | null;
  is_day_to_day: boolean | null;
  website: string | null;
  created_at: string;
};

type BrandMeta = {
  name: string;
  brand_status: string | null;
  cultivate_lead: string | null;
  archived: boolean;
};

type ColType = "text" | "email" | "tel" | "url" | "boolean";
type ColDef = { key: keyof BrandContact; label: string; type: ColType; width?: string };

// Editable contact-level columns. Brand-level Status/Lead are read-only from brands table.
const CONTACT_COLS: ColDef[] = [
  { key: "contact_name", label: "Contact", type: "text" },
  { key: "role",         label: "Role",    type: "text" },
  { key: "email",        label: "Email",   type: "email" },
  { key: "phone",        label: "Phone",   type: "tel" },
  { key: "is_day_to_day", label: "D2D",   type: "boolean" },
  { key: "website",      label: "Website", type: "url" },
  { key: "notes",        label: "Notes",   type: "text", width: "16rem" },
];
const N_COLS = CONTACT_COLS.length + 1; // + delete col

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

export default function BrandContactsAdminPage() {
  const router = useRouter();

  const [authChecked, setAuthChecked] = useState(false);
  const [authorized, setAuthorized] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [contacts, setContacts] = useState<BrandContact[]>([]);
  const [brandsMap, setBrandsMap] = useState<Map<string, BrandMeta>>(new Map());
  const [newRowId, setNewRowId] = useState<string | null>(null);

  const [showInactive, setShowInactive] = useState(false);
  const [expandedBrands, setExpandedBrands] = useState<Set<string>>(new Set());
  const [showOrphanPanel, setShowOrphanPanel] = useState(false);
  const [filterBrand, setFilterBrand] = useState("");
  const [filterLead, setFilterLead] = useState("");

  const [editing, setEditing] = useState<{ id: string; col: keyof BrandContact } | null>(null);
  const [editValue, setEditValue] = useState("");

  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    (async () => {
      const { data: authData } = await supabase.auth.getUser();
      const uid = authData?.user?.id;
      if (!uid) { router.replace("/login"); return; }
      const { data: profile } = await supabase
        .from("profiles").select("role").eq("id", uid).maybeSingle();
      const role = (profile?.role as Role) ?? null;
      setAuthChecked(true);
      if (role !== "admin" && role !== "rep") { router.replace("/brands"); return; }
      setAuthorized(true);
      await loadAll();
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadAll() {
    setLoading(true);
    const [contactsRes, brandsRes] = await Promise.all([
      supabase
        .from("brand_contacts")
        .select("id,brand_name,contact_name,role,notes,email,phone,is_day_to_day,website,created_at")
        .order("brand_name", { ascending: true, nullsFirst: false }),
      supabase
        .from("brands")
        .select("name,brand_status,cultivate_lead,archived"),
    ]);
    if (contactsRes.error) { setError(contactsRes.error.message); setLoading(false); return; }

    // Build lookup keyed by normalized brand name
    const map = new Map<string, BrandMeta>();
    (brandsRes.data ?? []).forEach((b: BrandMeta) => map.set(norm(b.name), b));
    setBrandsMap(map);
    setContacts((contactsRes.data as BrandContact[]) ?? []);
    setLoading(false);
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  const getMeta = (brandName: string | null) => brandsMap.get(norm(brandName));

  const isInactiveBrand = (brandName: string | null) => {
    const m = getMeta(brandName);
    if (!m) return false;
    return m.brand_status === "Inactive" || m.archived;
  };

  const isOrphan = (brandName: string | null) => {
    if (!brandName?.trim()) return false;
    return !brandsMap.has(norm(brandName));
  };

  // Lead options from brands table (not from stale contact rows)
  const leadOptions = useMemo(() => {
    const leads = new Set<string>();
    brandsMap.forEach((b) => { if (b.cultivate_lead) leads.add(b.cultivate_lead); });
    return [...leads].sort();
  }, [brandsMap]);

  // Orphan brand names — brands in contacts not present in brands table
  const orphanBrandNames = useMemo(() => {
    const seen = new Set<string>();
    const orphans: string[] = [];
    contacts.forEach((c) => {
      if (c.brand_name?.trim() && isOrphan(c.brand_name) && !seen.has(c.brand_name)) {
        seen.add(c.brand_name);
        orphans.push(c.brand_name);
      }
    });
    return orphans.sort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contacts, brandsMap]);

  // Count of inactive brand groups (for toggle label)
  const inactiveBrandCount = useMemo(() => {
    const names = new Set(contacts.map((c) => c.brand_name).filter(Boolean));
    return [...names].filter((n) => isInactiveBrand(n)).length;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contacts, brandsMap]);

  // Grouped contacts after filters
  const groups = useMemo(() => {
    // Junk filter — skip rows with no name AND no email (but never skip the active new row)
    let rows = contacts.filter((c) =>
      c.id === newRowId || c.contact_name?.trim() || c.email?.trim()
    );

    // Inactive brand filter
    if (!showInactive) rows = rows.filter((c) => !isInactiveBrand(c.brand_name));

    // Brand search
    const q = filterBrand.trim().toLowerCase();
    if (q) rows = rows.filter((c) => norm(c.brand_name).includes(q));

    // Lead filter (from brands map)
    if (filterLead) {
      rows = rows.filter((c) => getMeta(c.brand_name)?.cultivate_lead === filterLead);
    }

    // Group by brand_name
    const map = new Map<string, BrandContact[]>();
    rows.forEach((c) => {
      const key = c.brand_name?.trim() || "(No Brand)";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(c);
    });

    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contacts, brandsMap, showInactive, filterBrand, filterLead, newRowId]);

  const totalVisible = groups.reduce((n, [, g]) => n + g.length, 0);

  function toggleExpand(brandName: string) {
    setExpandedBrands((prev) => {
      const next = new Set(prev);
      next.has(brandName) ? next.delete(brandName) : next.add(brandName);
      return next;
    });
  }

  // ── toast ────────────────────────────────────────────────────────────────

  function showToast(msg: string) {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2000);
  }

  async function copyToClipboard(value: string) {
    try { await navigator.clipboard.writeText(value); showToast(`Copied · ${value}`); }
    catch { showToast("Copy failed"); }
  }

  // ── edit ─────────────────────────────────────────────────────────────────

  function startEdit(id: string, col: keyof BrandContact, current: unknown) {
    setEditing({ id, col });
    setEditValue(typeof current === "string" ? current : current == null ? "" : String(current));
  }

  function cancelEdit() { setEditing(null); setEditValue(""); }

  async function commitEdit() {
    if (!editing) return;
    const { id, col } = editing;
    const original = contacts.find((c) => c.id === id);
    if (!original) { cancelEdit(); return; }

    const trimmed = editValue.trim();
    const newVal: string | null = trimmed === "" ? null : trimmed;
    setEditing(null);
    setEditValue("");
    if ((original[col] ?? null) === newVal) return;

    if (id === newRowId && newVal) setNewRowId(null);

    setContacts((prev) => prev.map((c) => c.id === id ? { ...c, [col]: newVal } : c));
    const { error: err } = await supabase.from("brand_contacts").update({ [col]: newVal }).eq("id", id);
    if (err) {
      setContacts((prev) => prev.map((c) => c.id === id ? original : c));
      showToast(`Save failed · ${err.message}`);
    }
  }

  async function toggleDayToDay(id: string, current: boolean | null) {
    const next = !current;
    const original = contacts.find((c) => c.id === id);
    setContacts((prev) => prev.map((c) => c.id === id ? { ...c, is_day_to_day: next } : c));
    const { error: err } = await supabase.from("brand_contacts").update({ is_day_to_day: next }).eq("id", id);
    if (err && original) {
      setContacts((prev) => prev.map((c) => c.id === id ? original : c));
      showToast(`Save failed · ${err.message}`);
    }
  }

  async function addRow() {
    const { data, error: err } = await supabase
      .from("brand_contacts")
      .insert({ is_day_to_day: false })
      .select("id,brand_name,contact_name,role,notes,email,phone,is_day_to_day,website,created_at")
      .single();
    if (err) { showToast(`Add failed · ${err.message}`); return; }
    const row = data as BrandContact;
    setContacts((prev) => [row, ...prev]);
    setNewRowId(row.id);
    setEditing({ id: row.id, col: "brand_name" });
    setEditValue("");
  }

  async function deleteRow(id: string) {
    const ok = window.confirm("Delete this contact? This can't be undone.");
    if (!ok) return;
    const original = contacts.find((c) => c.id === id);
    setContacts((prev) => prev.filter((c) => c.id !== id));
    if (id === newRowId) setNewRowId(null);
    const { error: err } = await supabase.from("brand_contacts").delete().eq("id", id);
    if (err && original) {
      setContacts((prev) => [original, ...prev]);
      showToast(`Delete failed · ${err.message}`);
    }
  }

  // ── render ───────────────────────────────────────────────────────────────

  if (!authChecked) return <div className="p-6 text-sm" style={{ color: "var(--muted-foreground)" }}>Checking access…</div>;
  if (!authorized) return null;

  return (
    <div className="p-6 space-y-5 min-h-screen">
      {toast && (
        <div className="fixed bottom-5 right-5 z-50 rounded-lg px-4 py-2 text-sm font-medium shadow-lg"
          style={{ background: "var(--foreground)", color: "var(--background)" }}>
          {toast}
        </div>
      )}

      <div>
        <h1 className="text-3xl font-bold" style={{ color: "var(--foreground)" }}>Brand Contacts</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--muted-foreground)" }}>
          Internal-only directory. Click a cell to edit · click email/phone to copy.
          Status & lead mirror the Roster — edit there.
        </p>
      </div>

      {/* Orphan warning banner */}
      {orphanBrandNames.length > 0 && (
        <div className="rounded-lg border px-4 py-3 text-sm" style={{ background: "#fff7ed", borderColor: "#fed7aa" }}>
          <div className="flex items-center justify-between">
            <span className="font-medium text-orange-800">
              ⚠ {orphanBrandNames.length} brand{orphanBrandNames.length !== 1 ? "s" : ""} in Contacts not found in the brands table
            </span>
            <button onClick={() => setShowOrphanPanel((p) => !p)}
              className="text-xs text-orange-700 hover:underline ml-4">
              {showOrphanPanel ? "Hide" : "Show list"}
            </button>
          </div>
          {showOrphanPanel && (
            <div className="mt-2 text-orange-900 text-xs space-y-0.5">
              {orphanBrandNames.map((n) => <div key={n}>· {n}</div>)}
              <div className="mt-2 text-orange-700">
                These contacts are flagged ⚠ in the table. Delete individually with × if confirmed — no bulk removal.
              </div>
            </div>
          )}
        </div>
      )}

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder="Filter by brand name…"
          value={filterBrand}
          onChange={(e) => setFilterBrand(e.target.value)}
          className="w-full max-w-xs rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2"
          style={{ border: "1px solid var(--border)", background: "var(--card)", color: "var(--foreground)" }}
        />
        <select
          value={filterLead}
          onChange={(e) => setFilterLead(e.target.value)}
          className="rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2"
          style={{ border: "1px solid var(--border)", background: "var(--card)", color: "var(--foreground)" }}
        >
          <option value="">All leads</option>
          {leadOptions.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
        <button
          onClick={() => setShowInactive((v) => !v)}
          className="rounded-lg px-3 py-2 text-sm border transition-colors"
          style={showInactive
            ? { background: "#fef2f2", borderColor: "#fca5a5", color: "#991b1b" }
            : { background: "var(--card)", color: "var(--muted-foreground)" }}
        >
          {showInactive ? "Hiding inactive ×" : `Show inactive brands (${inactiveBrandCount})`}
        </button>
        <span className="text-sm ml-auto" style={{ color: "var(--muted-foreground)" }}>
          {totalVisible} contact{totalVisible !== 1 ? "s" : ""} · {groups.length} brand{groups.length !== 1 ? "s" : ""}
        </span>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {loading ? (
        <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>Loading…</p>
      ) : (
        <div className="rounded-xl overflow-auto" style={{ border: "1px solid var(--border)", background: "var(--card)" }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: "var(--secondary)", color: "var(--muted-foreground)", borderBottom: "1px solid var(--border)" }}>
                {CONTACT_COLS.map((col) => (
                  <th key={col.key as string} className="text-left px-3 py-2 font-medium whitespace-nowrap" style={{ minWidth: col.width }}>
                    {col.label}
                  </th>
                ))}
                <th className="px-2 py-2" />
              </tr>
            </thead>

            {groups.map(([brandName, groupContacts]) => {
              const meta = getMeta(brandName);
              const inactive = isInactiveBrand(brandName);
              const orphan = isOrphan(brandName) && brandName !== "(No Brand)";
              const isExpanded = expandedBrands.has(brandName);

              const primary = groupContacts.find((c) =>
                c.role?.toLowerCase().includes("primary")
              ) ?? groupContacts[0];
              const visible = isExpanded ? groupContacts : [primary];
              const hiddenCount = groupContacts.length - 1;

              return (
                <tbody key={brandName}>
                  {/* Brand group header */}
                  <tr style={{
                    background: inactive ? "#fff1f2" : "var(--muted)",
                    borderTop: "2px solid var(--border)",
                  }}>
                    <td colSpan={N_COLS} className="px-3 py-1.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-xs" style={{ color: "var(--foreground)" }}>
                          {brandName}
                        </span>

                        {orphan && (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                            style={{ background: "#fed7aa", color: "#92400e" }}>
                            ⚠ orphan
                          </span>
                        )}

                        {meta?.cultivate_lead && (
                          <span className="text-xs" style={{ color: "var(--muted-foreground)" }}>
                            · {meta.cultivate_lead}
                          </span>
                        )}

                        {inactive ? (
                          <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded"
                            style={{ background: "#fecaca", color: "#991b1b" }}>
                            Inactive
                          </span>
                        ) : meta ? (
                          <span className="text-[10px] px-1.5 py-0.5 rounded"
                            style={{ background: "#dcfce7", color: "#15803d" }}>
                            Active
                          </span>
                        ) : null}

                        {hiddenCount > 0 && (
                          <button
                            onClick={() => toggleExpand(brandName)}
                            className="ml-auto text-xs hover:underline"
                            style={{ color: "var(--muted-foreground)" }}
                          >
                            {isExpanded ? "↑ Collapse" : `↓ ${hiddenCount} more`}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>

                  {/* Contact rows */}
                  {visible.map((c, idx) => (
                    <tr
                      key={c.id}
                      style={{
                        background: inactive
                          ? (idx % 2 === 0 ? "#fff1f2" : "#ffe4e6")
                          : (idx % 2 === 0 ? "var(--card)" : "var(--secondary)"),
                        borderTop: "1px solid var(--border)",
                      }}
                    >
                      {CONTACT_COLS.map((col) => {
                        const isEditingCell = editing?.id === c.id && editing.col === col.key;
                        const value = c[col.key];

                        if (col.type === "boolean") {
                          return (
                            <td key={col.key as string} className="px-3 py-2">
                              <input
                                type="checkbox"
                                checked={!!value}
                                onChange={() => toggleDayToDay(c.id, value as boolean | null)}
                                style={{ cursor: "pointer" }}
                              />
                            </td>
                          );
                        }

                        if (isEditingCell) {
                          return (
                            <td key={col.key as string} className="px-1 py-1">
                              <input
                                type={col.type === "email" ? "email" : col.type === "tel" ? "tel" : col.type === "url" ? "url" : "text"}
                                value={editValue}
                                autoFocus
                                onChange={(e) => setEditValue(e.target.value)}
                                onBlur={commitEdit}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") { e.preventDefault(); commitEdit(); }
                                  else if (e.key === "Escape") { e.preventDefault(); cancelEdit(); }
                                }}
                                className="w-full rounded px-2 py-1 text-sm focus:outline-none focus:ring-1"
                                style={{ border: "1px solid var(--border)", background: "var(--background)", color: "var(--foreground)" }}
                              />
                            </td>
                          );
                        }

                        const isCopyable = col.key === "email" || col.key === "phone";
                        const display = (value as string | null) ?? "";

                        return (
                          <td
                            key={col.key as string}
                            className="px-3 py-2"
                            style={{
                              cursor: isCopyable && display ? "copy" : "text",
                              color: display ? "var(--foreground)" : "var(--muted-foreground)",
                              maxWidth: col.width ?? "16rem",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                            title={isCopyable && display
                              ? `${display} · click to copy · double-click to edit`
                              : display || "Click to edit"}
                            onClick={() => {
                              if (isCopyable && display) copyToClipboard(display);
                              else startEdit(c.id, col.key, value);
                            }}
                            onDoubleClick={() => startEdit(c.id, col.key, value)}
                          >
                            {display || <span className="italic" style={{ color: "var(--muted-foreground)" }}>—</span>}
                          </td>
                        );
                      })}
                      <td className="px-2 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => deleteRow(c.id)}
                          title="Delete contact"
                          className="text-xs hover:text-red-600 transition-colors"
                          style={{ color: "var(--muted-foreground)" }}
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              );
            })}

            {groups.length === 0 && !loading && (
              <tbody>
                <tr>
                  <td colSpan={N_COLS} className="px-4 py-8 text-sm italic text-center"
                    style={{ color: "var(--muted-foreground)" }}>
                    No contacts match.
                  </td>
                </tr>
              </tbody>
            )}
          </table>

          <div className="px-3 py-3" style={{ borderTop: "1px solid var(--border)", background: "var(--card)" }}>
            <button
              type="button"
              onClick={addRow}
              className="text-sm px-3 py-1.5 rounded-lg font-medium"
              style={{ background: "var(--foreground)", color: "var(--background)" }}
            >
              + Add Contact
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
