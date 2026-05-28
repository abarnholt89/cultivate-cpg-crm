"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Role = "admin" | "rep" | "client" | "owner" | null;

type BrandContact = {
  id: string;
  brand_name: string | null;
  cultivate_lead: string | null;
  status: string | null;
  contact_name: string | null;
  role: string | null;
  notes: string | null;
  email: string | null;
  phone: string | null;
  is_day_to_day: boolean | null;
  website: string | null;
  created_at: string;
};

type ColumnType = "text" | "email" | "tel" | "url" | "boolean";

type ColumnDef = {
  key: keyof BrandContact;
  label: string;
  type: ColumnType;
  width?: string;
};

const COLUMNS: ColumnDef[] = [
  { key: "brand_name", label: "Brand", type: "text" },
  { key: "cultivate_lead", label: "Lead", type: "text" },
  { key: "status", label: "Status", type: "text" },
  { key: "contact_name", label: "Contact", type: "text" },
  { key: "role", label: "Role", type: "text" },
  { key: "email", label: "Email", type: "email" },
  { key: "phone", label: "Phone", type: "tel" },
  { key: "is_day_to_day", label: "Day-to-Day", type: "boolean" },
  { key: "website", label: "Website", type: "url" },
  { key: "notes", label: "Notes", type: "text", width: "20rem" },
];

export default function BrandContactsAdminPage() {
  const router = useRouter();

  const [authChecked, setAuthChecked] = useState(false);
  const [authorized, setAuthorized] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [contacts, setContacts] = useState<BrandContact[]>([]);

  const [filterBrand, setFilterBrand] = useState("");
  const [filterLead, setFilterLead] = useState("");

  const [editing, setEditing] = useState<{ id: string; column: keyof BrandContact } | null>(null);
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

      if (role !== "admin" && role !== "rep") {
        router.replace("/brands");
        return;
      }

      setAuthorized(true);
      await loadContacts();
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadContacts() {
    setLoading(true);
    const { data, error } = await supabase
      .from("brand_contacts")
      .select("id, brand_name, cultivate_lead, status, contact_name, role, notes, email, phone, is_day_to_day, website, created_at")
      .order("brand_name", { ascending: true, nullsFirst: false });
    if (error) { setError(error.message); setLoading(false); return; }
    setContacts((data as BrandContact[]) ?? []);
    setLoading(false);
  }

  const leadOptions = useMemo(
    () => [...new Set(contacts.map((c) => c.cultivate_lead).filter((v): v is string => !!v))].sort(),
    [contacts]
  );

  const filtered = useMemo(() => {
    const q = filterBrand.trim().toLowerCase();
    return contacts.filter((c) => {
      if (q && !(c.brand_name ?? "").toLowerCase().includes(q)) return false;
      if (filterLead && c.cultivate_lead !== filterLead) return false;
      return true;
    });
  }, [contacts, filterBrand, filterLead]);

  function showToast(msg: string) {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2000);
  }

  async function copyToClipboard(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      showToast(`Copied · ${value}`);
    } catch {
      showToast("Copy failed");
    }
  }

  function startEdit(id: string, column: keyof BrandContact, current: unknown) {
    setEditing({ id, column });
    setEditValue(typeof current === "string" ? current : current == null ? "" : String(current));
  }

  function cancelEdit() {
    setEditing(null);
    setEditValue("");
  }

  async function commitEdit() {
    // Guard against double-fire: Enter triggers commit + blur fires on unmount.
    if (!editing) return;
    const { id, column } = editing;
    const original = contacts.find((c) => c.id === id);
    if (!original) { cancelEdit(); return; }

    const trimmed = editValue.trim();
    const newValue: string | null = trimmed === "" ? null : trimmed;
    const currentValue = original[column];

    setEditing(null);
    setEditValue("");

    if ((currentValue ?? null) === newValue) return;

    setContacts((prev) => prev.map((c) => c.id === id ? { ...c, [column]: newValue } : c));

    const { error } = await supabase
      .from("brand_contacts")
      .update({ [column]: newValue })
      .eq("id", id);

    if (error) {
      setContacts((prev) => prev.map((c) => c.id === id ? original : c));
      showToast(`Save failed · ${error.message}`);
    }
  }

  async function toggleDayToDay(id: string, current: boolean | null) {
    const next = !current;
    const original = contacts.find((c) => c.id === id);
    setContacts((prev) => prev.map((c) => c.id === id ? { ...c, is_day_to_day: next } : c));
    const { error } = await supabase
      .from("brand_contacts")
      .update({ is_day_to_day: next })
      .eq("id", id);
    if (error && original) {
      setContacts((prev) => prev.map((c) => c.id === id ? original : c));
      showToast(`Save failed · ${error.message}`);
    }
  }

  async function addRow() {
    const { data, error } = await supabase
      .from("brand_contacts")
      .insert({ is_day_to_day: false })
      .select("id, brand_name, cultivate_lead, status, contact_name, role, notes, email, phone, is_day_to_day, website, created_at")
      .single();
    if (error) { showToast(`Add failed · ${error.message}`); return; }
    setContacts((prev) => [data as BrandContact, ...prev]);
    // Drop the user straight into editing the brand name of the new row
    const newRow = data as BrandContact;
    setEditing({ id: newRow.id, column: "brand_name" });
    setEditValue("");
  }

  async function deleteRow(id: string) {
    const ok = window.confirm("Delete this contact? This can't be undone.");
    if (!ok) return;
    const original = contacts.find((c) => c.id === id);
    setContacts((prev) => prev.filter((c) => c.id !== id));
    const { error } = await supabase.from("brand_contacts").delete().eq("id", id);
    if (error && original) {
      setContacts((prev) => [original, ...prev]);
      showToast(`Delete failed · ${error.message}`);
    }
  }

  if (!authChecked) {
    return (
      <div className="p-6 text-sm" style={{ color: "var(--muted-foreground)" }}>
        Checking access…
      </div>
    );
  }

  if (!authorized) return null;

  return (
    <div className="p-6 space-y-5 min-h-screen">
      {toast && (
        <div
          className="fixed bottom-5 right-5 z-50 rounded-lg px-4 py-2 text-sm font-medium shadow-lg"
          style={{ background: "var(--foreground)", color: "var(--background)" }}
        >
          {toast}
        </div>
      )}

      <div>
        <h1 className="text-3xl font-bold" style={{ color: "var(--foreground)" }}>
          Brand Contacts
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--muted-foreground)" }}>
          Internal-only directory. Click a cell to edit · click email/phone to copy.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder="Filter by brand name…"
          value={filterBrand}
          onChange={(e) => setFilterBrand(e.target.value)}
          className="w-full max-w-sm rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2"
          style={{ border: "1px solid var(--border)", background: "var(--card)", color: "var(--foreground)" }}
        />
        <select
          value={filterLead}
          onChange={(e) => setFilterLead(e.target.value)}
          className="rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2"
          style={{ border: "1px solid var(--border)", background: "var(--card)", color: "var(--foreground)" }}
        >
          <option value="">All leads</option>
          {leadOptions.map((l) => (
            <option key={l} value={l}>{l}</option>
          ))}
        </select>
        <span className="text-sm" style={{ color: "var(--muted-foreground)" }}>
          {filtered.length} of {contacts.length}
        </span>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {loading ? (
        <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>Loading…</p>
      ) : (
        <div
          className="rounded-xl overflow-auto"
          style={{ border: "1px solid var(--border)", background: "var(--card)" }}
        >
          <table className="w-full text-sm">
            <thead>
              <tr style={{
                background: "var(--secondary)",
                color: "var(--muted-foreground)",
                borderBottom: "1px solid var(--border)",
              }}>
                {COLUMNS.map((col) => (
                  <th
                    key={col.key as string}
                    className="text-left px-3 py-2 font-medium whitespace-nowrap"
                    style={{ minWidth: col.width }}
                  >
                    {col.label}
                  </th>
                ))}
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={COLUMNS.length + 1} className="px-4 py-6 text-sm italic" style={{ color: "var(--muted-foreground)" }}>
                    No contacts yet. Add one below.
                  </td>
                </tr>
              ) : filtered.map((c, idx) => (
                <tr
                  key={c.id}
                  style={{
                    background: idx % 2 === 0 ? "var(--card)" : "var(--secondary)",
                    borderTop: "1px solid var(--border)",
                  }}
                >
                  {COLUMNS.map((col) => {
                    const isEditingCell = editing?.id === c.id && editing.column === col.key;
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
                            style={{
                              border: "1px solid var(--border)",
                              background: "var(--background)",
                              color: "var(--foreground)",
                            }}
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
                        title={
                          isCopyable && display
                            ? `${display} · click to copy · double-click to edit`
                            : display || "Click to edit"
                        }
                        onClick={() => {
                          if (isCopyable && display) copyToClipboard(display);
                          else startEdit(c.id, col.key, value);
                        }}
                        onDoubleClick={() => startEdit(c.id, col.key, value)}
                      >
                        {display || <span className="italic">—</span>}
                      </td>
                    );
                  })}
                  <td className="px-2 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => deleteRow(c.id)}
                      title="Delete contact"
                      className="text-xs"
                      style={{ color: "var(--muted-foreground)" }}
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div
            className="px-3 py-3"
            style={{ borderTop: "1px solid var(--border)", background: "var(--card)" }}
          >
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
