"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";

type Brand = {
  id: string;
  name: string;
};

type TimingRow = {
  id: string;
  retailer_id: string;
  account_status:
    | "active_account"
    | "cultivate_does_not_rep"
    | "not_a_target_account"
    | "retailer_declined"
    | "waiting_for_retailer_to_publish_review"
    | "under_review"
    | "open_review"
    | "working_to_secure_anchor_account"
    | "upcoming_review";
  schedule_mode: "scheduled" | "open";
  category_review_date: string | null;
  reset_date: string | null;
  submitted_date: string | null;
  notes: string | null;
};

type Retailer = {
  id: string;
  name: string;
  banner: string | null;
};

function todayISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function addDaysISO(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function isBetweenInclusive(dateISO: string, startISO: string, endISO: string) {
  return dateISO >= startISO && dateISO <= endISO;
}

function statusLabel(status: TimingRow["account_status"]) {
  switch (status) {
    case "active_account":
      return "Active Account";
    case "open_review":
      return "In Progress";
    case "under_review":
      return "Under Review";
    case "working_to_secure_anchor_account":
      return "Distributor Required";
    case "waiting_for_retailer_to_publish_review":
      return "Awaiting Retailer Decision";
    case "upcoming_review":
      return "Upcoming Review";
    case "not_a_target_account":
      return "Not a Target";
    case "cultivate_does_not_rep":
      return "Not Managed by Cultivate";
    case "retailer_declined":
      return "Retailer Declined";
    default:
      return status;
  }
}

export default function BrandDashboardPage() {
  const params = useParams();
  const idParam = params?.id;
  const brandId = Array.isArray(idParam) ? idParam[0] : idParam;

  const [brand, setBrand] = useState<Brand | null>(null);
  const [rows, setRows] = useState<TimingRow[]>([]);
  const [retailersById, setRetailersById] = useState<Record<string, Retailer>>({});
  const [error, setError] = useState("");

  useEffect(() => {
    if (!brandId) return;

    async function load() {
      setError("");

      const { data: brandData, error: brandError } = await supabase
        .from("brands")
        .select("id,name")
        .eq("id", brandId)
        .maybeSingle();

      if (brandError) {
        setError(brandError.message);
        return;
      }

      if (!brandData) {
        setError("Brand not found.");
        return;
      }

      setBrand(brandData);

      const { data: timingData, error: timingError } = await supabase
        .from("brand_retailer_timing")
        .select("id,retailer_id,account_status,schedule_mode,category_review_date,reset_date,submitted_date,notes")
        .eq("brand_id", brandId);

      if (timingError) {
        setError(timingError.message);
        return;
      }

      const timingRows = (timingData as TimingRow[]) ?? [];
      setRows(timingRows);

      const retailerIds = [...new Set(timingRows.map((r) => r.retailer_id).filter(Boolean))];

      if (retailerIds.length === 0) {
        setRetailersById({});
        return;
      }

      const { data: retailerData, error: retailerError } = await supabase
        .from("retailers")
        .select("id,name,banner")
        .in("id", retailerIds);

      if (retailerError) {
        setError(retailerError.message);
        return;
      }

      const map: Record<string, Retailer> = {};
      (retailerData as Retailer[]).forEach((r) => {
        map[r.id] = r;
      });
      setRetailersById(map);
    }

    load();
  }, [brandId]);

  const summary = useMemo(() => {
    const today = todayISO();
    const next30 = addDaysISO(today, 30);
    function prettyDate(value: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;

  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

    let upcomingReviews = 0;
    let inProgress = 0;
    let underReview = 0;
    let activeAccounts = 0;
    let awaitingDecision = 0;
    let distributorRequired = 0;
    let pastDue = 0;

    rows.forEach((r) => {
      if (
        r.schedule_mode === "scheduled" &&
        !!r.category_review_date &&
        !r.submitted_date &&
        isBetweenInclusive(r.category_review_date, today, next30)
      ) {
        upcomingReviews++;
      }

      if (
        r.schedule_mode === "scheduled" &&
        !!r.category_review_date &&
        !r.submitted_date &&
        r.category_review_date < today
      ) {
        pastDue++;
      }

      if (r.account_status === "open_review") inProgress++;
      if (r.account_status === "under_review") underReview++;
      if (r.account_status === "active_account") activeAccounts++;
      if (r.account_status === "waiting_for_retailer_to_publish_review") awaitingDecision++;
      if (r.account_status === "working_to_secure_anchor_account") distributorRequired++;
    });

    return {
      upcomingReviews,
      inProgress,
      underReview,
      activeAccounts,
      awaitingDecision,
      distributorRequired,
      pastDue,
    };
  }, [rows]);

  const upcomingList = useMemo(() => {
    const today = todayISO();
    const next30 = addDaysISO(today, 30);

    return rows
      .filter(
        (r) =>
          r.schedule_mode === "scheduled" &&
          !!r.category_review_date &&
          !r.submitted_date &&
          isBetweenInclusive(r.category_review_date, today, next30)
      )
      .sort((a, b) => (a.category_review_date || "").localeCompare(b.category_review_date || ""))
      .slice(0, 8);
  }, [rows]);

  const recentActivity = useMemo(() => {
    return [...rows]
      .filter((r) => r.submitted_date || r.notes)
      .sort((a, b) => {
        const aDate = a.submitted_date || "";
        const bDate = b.submitted_date || "";
        return bDate.localeCompare(aDate);
      })
      .slice(0, 8);
  }, [rows]);
  const reviewCalendar = useMemo(() => {
  return [...rows]
    .filter((r) => r.category_review_date || r.reset_date)
    .sort((a, b) => {
      const aDate = a.category_review_date || a.reset_date || "";
      const bDate = b.category_review_date || b.reset_date || "";
      return aDate.localeCompare(bDate);
    });
}, [rows]);

  if (!brandId) {
    return <div className="p-6">No brand ID in URL.</div>;
  }

  return (
    <div className="p-6 space-y-6">
      <Link href="/brands" className="underline text-sm">
        ← Back to Brands
      </Link>

      <div>
        <h1 className="text-3xl font-bold mt-2">{brand?.name ?? "Brand"}</h1>
        <p className="text-gray-600 mt-1">Brand dashboard</p>
        {error && <div className="text-red-600 text-sm mt-2">{error}</div>}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SummaryCard
          label="Upcoming Reviews"
          value={summary.upcomingReviews}
          href={`/brands/${brandId}/retailers?filter=upcoming`}
        />
        <SummaryCard
          label="In Progress"
          value={summary.inProgress}
          href={`/brands/${brandId}/retailers?filter=open_review`}
        />
        <SummaryCard
          label="Under Review"
          value={summary.underReview}
          href={`/brands/${brandId}/retailers?filter=under_review`}
        />
        <SummaryCard
          label="Active Accounts"
          value={summary.activeAccounts}
          href={`/brands/${brandId}/retailers?filter=active_account`}
        />
        <SummaryCard
          label="Awaiting Decision"
          value={summary.awaitingDecision}
          href={`/brands/${brandId}/retailers?filter=waiting_for_retailer_to_publish_review`}
        />
        <SummaryCard
          label="Distributor Required"
          value={summary.distributorRequired}
          href={`/brands/${brandId}/retailers?filter=working_to_secure_anchor_account`}
        />
        <SummaryCard
          label="Past Due"
          value={summary.pastDue}
          href={`/brands/${brandId}/retailers?filter=past_due`}
        />
        <SummaryCard
          label="All Retailers"
          value={rows.length}
          href={`/brands/${brandId}/retailers`}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="border rounded-xl p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Upcoming Reviews (30 days)</h2>
            <Link
              href={`/brands/${brandId}/retailers?filter=upcoming`}
              className="text-sm underline"
            >
              View all
            </Link>
          </div>

          {upcomingList.length === 0 ? (
            <p className="text-sm text-gray-600 mt-4">No upcoming reviews in the next 30 days.</p>
          ) : (
            <div className="space-y-3 mt-4">
              {upcomingList.map((row) => {
                const retailer = retailersById[row.retailer_id];
                const headline = retailer?.banner?.trim() ? retailer.banner : retailer?.name ?? "Retailer";

                return (
                <Link
  key={row.id}
  href={`/brands/${brandId}/retailers/${row.retailer_id}`}
  className="block border rounded-lg p-3 hover:bg-gray-50"
>
                    <div className="font-medium">{headline}</div>
                    {retailer?.banner ? (
                      <div className="text-sm text-gray-500">{retailer.name}</div>
                    ) : null}
                    <div className="text-sm text-gray-600 mt-1">
                      Review Date: prettyDate(row.category_review_date)
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        <div className="border rounded-xl p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Recent Activity</h2>
            <Link
              href={`/brands/${brandId}/retailers`}
              className="text-sm underline"
            >
              Open retailer list
            </Link>
          </div>

{recentActivity.length === 0 ? (
  <p className="text-sm text-gray-600 mt-4">No recent activity yet.</p>
) : (
  <div className="space-y-3 mt-4">
    {recentActivity.map((row) => {
      const retailer = retailersById[row.retailer_id];
      const headline = retailer?.banner?.trim() ? retailer.banner : retailer?.name ?? "Retailer";

      return (
        <Link
          key={row.id}
          href={`/brands/${brandId}/retailers/${row.retailer_id}`}
          className="block border rounded-lg p-3 hover:bg-gray-50 cursor-pointer"
        >
          <div className="font-medium">{headline}</div>
          {retailer?.banner ? (
            <div className="text-sm text-gray-500">{retailer.name}</div>
          ) : null}
          <div className="text-sm text-gray-600 mt-1">
            Status: {statusLabel(row.account_status)}
          </div>
          {row.submitted_date ? (
            <div className="text-sm text-gray-600">Submitted: {row.submitted_date}</div>
          ) : null}
          {row.notes ? (
            <div className="text-sm text-gray-700 mt-2 line-clamp-3">{row.notes}</div>
          ) : null}
        </Link>
      );
    })}
  </div>
)}
        </div>
      </div>
<div className="border rounded-xl p-4">
  <div className="flex items-center justify-between">
    <h2 className="text-lg font-semibold">Upcoming Review Calendar</h2>
    <Link
      href={`/brands/${brandId}/retailers`}
      className="text-sm underline"
    >
      Open retailer list
    </Link>
  </div>

  {reviewCalendar.length === 0 ? (
    <p className="text-sm text-gray-600 mt-4">
      No category review or reset dates available yet.
    </p>
  ) : (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left border-b">
            <th className="py-2 pr-4">Retailer</th>
            <th className="py-2 pr-4">Category Review</th>
            <th className="py-2 pr-4">Reset Date</th>
            <th className="py-2 pr-4">Status</th>
          </tr>
        </thead>
        <tbody>
          {reviewCalendar.map((row) => {
            const retailer = retailersById[row.retailer_id];
            const headline =
              retailer?.banner?.trim() ? retailer.banner : retailer?.name ?? "Retailer";

            return (
              <tr key={row.id} className="border-b last:border-b-0">
                <td className="py-3 pr-4">
                  <Link
                    href={`/brands/${brandId}/retailers/${row.retailer_id}`}
                    className="underline hover:text-black"
                  >
                    {headline}
                  </Link>
                  {retailer?.banner ? (
                    <div className="text-xs text-gray-500">{retailer.name}</div>
                  ) : null}
                </td>
                <td className="py-3 pr-4">prettyDate(row.category_review_date)</td>
<td className="py-3 pr-4">prettyDate(row.reset_date)</td>
                <td className="py-3 pr-4">{statusLabel(row.account_status)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  )}
</div>
      <div>
        <Link
          href={`/brands/${brandId}/retailers`}
          className="inline-block bg-black text-white px-4 py-2 rounded"
        >
          Manage Retailers
        </Link>
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  href,
}: {
  label: string;
  value: number;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="border rounded-lg p-4 hover:bg-gray-50 transition block"
    >
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-sm text-gray-600 mt-1">{label}</div>
    </Link>
  );
}