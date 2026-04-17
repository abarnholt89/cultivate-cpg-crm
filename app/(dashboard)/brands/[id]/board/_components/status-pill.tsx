const STYLES: Record<string, string> = {
  "Upcoming Review": "bg-amber-200 text-amber-900",
  "Awaiting Retailer Decision": "bg-blue-200 text-blue-900",
  "Under Review": "bg-blue-200 text-blue-900",
  "Active Account": "bg-teal-200 text-teal-900",
  "Not a Target": "bg-slate-200 text-slate-600",
  "Distributor Required": "bg-orange-200 text-orange-900",
};

export function StatusPill({ status }: { status: string | null }) {
  if (!status) return <span className="text-xs text-slate-400">—</span>;
  const cls = STYLES[status] ?? "bg-slate-200 text-slate-700";
  return (
    <span className={`text-[11px] font-medium px-2.5 py-1 rounded-full ${cls}`}>{status}</span>
  );
}
