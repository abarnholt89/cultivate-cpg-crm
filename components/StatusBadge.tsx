type Props = {
  status: string;
  className?: string;
};

type Config = { label: string; colors: string };

const STATUS_MAP: Record<string, Config> = {
  active_account:                         { label: "Active Account",              colors: "bg-green-100 text-green-800 border-green-200" },
  open_review:                            { label: "In Progress",                 colors: "bg-amber-100 text-amber-800 border-amber-200" },
  under_review:                           { label: "Under Review",                colors: "bg-amber-100 text-amber-800 border-amber-200" },
  upcoming_review:                        { label: "Upcoming Review",             colors: "bg-amber-100 text-amber-800 border-amber-200" },
  waiting_for_retailer_to_publish_review: { label: "Awaiting Retailer Decision",  colors: "bg-blue-100 text-blue-800 border-blue-200" },
  retailer_declined:                      { label: "Retailer Declined",           colors: "bg-red-100 text-red-800 border-red-200" },
  not_a_target_account:                   { label: "Not a Target",               colors: "bg-gray-100 text-gray-600 border-gray-200" },
  cultivate_does_not_rep:                 { label: "Not Managed by Cultivate",    colors: "bg-gray-100 text-gray-600 border-gray-200" },
  working_to_secure_anchor_account:       { label: "Distributor Required",        colors: "bg-orange-100 text-orange-800 border-orange-200" },
};

export default function StatusBadge({ status, className = "" }: Props) {
  const config = STATUS_MAP[status];
  const label = config?.label ?? status;
  const colors = config?.colors ?? "bg-gray-100 text-gray-600 border-gray-200";

  return (
    <span
      className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap ${colors} ${className}`}
    >
      {label}
    </span>
  );
}
