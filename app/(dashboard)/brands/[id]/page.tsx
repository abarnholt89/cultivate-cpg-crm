"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Brand = {
  id: string;
  name: string;
};

type PipelineRow = {
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
  submitted_date: string | null;
  notes: string | null;
};

type CategoryReviewRow = {
  brand_id: string;
  retailer_id: string | null;
  retailer_name: string;
  retailer_category_review_name: string | null;
  universal_department: string | null;
  universal_category: string;
  review_date: string | null;
  reset_date: string | null;
};

type Retailer = {
  id: string;
  name: string;
  banner: string | null;
};

type AuthorizedRow = {
  retailer_id: string;
  retailer_name: string | null;
  authorized_item_count: number;
  authorized_upc_count: number;
};

function todayISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function addDaysISO(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function isBetweenInclusive(dateISO: string, startISO: string, endISO: string) {
  return dateISO >= startISO && dateISO <= endISO;
}

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

function statusLabel(status: PipelineRow["account_status"]) {
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
  const [pipelineRows, setPipelineRows] = useState<PipelineRow[]>([]);
  const [calendarRows, setCalendarRows] = useState<CategoryReviewRow[]>([]);
  const [authorizedRows, setAuthorizedRows] = useState<AuthorizedRow[]>([]);
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

      const [pipelineResponse, calendarResponse, authorizedResponse] = await Promise.all([
        supabase
          .from("brand_retailer_timing")
          .select("id,retailer_id,account_status,schedule_mode,submitted_date,notes")
          .eq("brand_id", brandId),
        supabase
          .from("brand_category_review_view")
          .select(
            "brand_id,retailer_id,retailer_name,retailer_category_review_name,universal_department,universal_category,review_date,reset_date"
          )
          .eq("brand_id", brandId),
        supabase
          .from("authorized_accounts_with_brand_id")
          .select("retailer_id,retailer_name,authorized_item_count,authorized_upc_count")
          .eq("brand_id", brandId),
      ]);

      if (pipelineResponse.error) {
        setError(pipelineResponse.error.message);
        return;
      }

      if (calendarResponse.error) {
        setError(calendarResponse.error.message);
        return;
      }

      if (authorizedResponse.error) {
        setError(authorizedResponse.error.message);
        return;
      }

      const nextPipelineRows = (pipelineResponse.data as PipelineRow[]) ?? [];
      const nextCalendarRows = (calendarResponse.data as CategoryReviewRow[]) ?? [];
      const nextAuthorizedRows = (authorizedResponse.data as AuthorizedRow[]) ?? [];

      setPipelineRows(nextPipelineRows);
      setCalendarRows(nextCalendarRows);
      setAuthorizedRows(nextAuthorizedRows);

      const retailerIds = [
        ...new Set([
          ...nextPipelineRows.map((r) => r.retailer_id).filter(Boolean),
          ...nextCalendarRows.map((r) => r.retailer_id).filter(Boolean) as string[],
          ...nextAuthorizedRows.map((r) => r.retailer_id).filter(Boolean),
        ]),
      ];

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

    let upcomingReviews = 0;
    let inProgress = 0;
    let underReview = 0;
    let activeAccounts = 0;
    let awaitingDecision = 0;
    let distributorRequired = 0;

    calendarRows.forEach((r) => {
      if (r.review_date && isBetweenInclusive(r.review_date, today, next30)) {
        upcomingReviews++;
      }
    });

    pipelineRows.forEach((r) => {
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
      allRetailers: new Set(pipelineRows.map((r) => r.retailer_id)).size,
      authorizedAccounts: new Set(authorizedRows.map((r) => r.retailer_id)).size,
      authorizedItems: authorizedRows.reduce((sum, r) => sum + (r.authorized_item_count ?? 0), 0),
    };
  }, [pipelineRows, calendarRows, authorizedRows]);

  const upcomingList = useMemo(() => {
    const today = todayISO();
    const next30 = addDaysISO(today, 30);

    return [...calendarRows]
      .filter((r) => !!r.review_date && isBetweenInclusive(r.review_date, today, next30))
      .sort((a, b) => (a.review_date || "").localeCompare(b.review_date || ""))
      .slice(0, 8);
  }, [calendarRows]);

  const recentWorkflow = useMemo(() => {
    return [...pipelineRows]
      .filter((r) => r.submitted_date || r.notes)
      .sort((a, b) => {
        const aDate = a.submitted_date || "";
        const bDate = b.submitted_date || "";
        return bDate.localeCompare(aDate);
      })
      .slice(0, 8);
  }, [pipelineRows]);

  const topAuthorized = useMemo(() => {
    return [...authorizedRows]
      .sort((a, b) => (b.authorized_item_count || 0) - (a.authorized_item_count || 0))
      .slice(0, 8);
  }, [authorizedRows]);

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
        {error ? <div className="text-red-600 text-sm mt-2">{error}</div> : null}
      </div>

      <div className="flex flex-wrap gap-3">
        <Link
          href={`/brands/${brandId}/retailers`}
          className="inline-block bg-black text-white px-4 py-2 rounded"
        >
          Open Retailers
        </Link>
        <Link
          href={`/brands/${brandId}/category-review`}
          className="inline-block border px-4 py-2 rounded"
        >
          Open Category Review
        </Link>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SummaryCard
          label="Upcoming Reviews"
          value={summary.upcomingReviews}
          href={`/brands/${brandId}/category-review`}
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
          label="Authorized Accounts"
          value={summary.authorizedAccounts}
          href={`/brands/${brandId}/retailers?filter=authorized`}
        />
        <SummaryCard
          label="Authorized Items"
          value={summary.authorizedItems}
          href={`/brands/${brandId}/retailers?filter=authorized`}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="border rounded-xl p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Upcoming Reviews (30 days)</h2>
            <Link
              href={`/brands/${brandId}/category-review`}
              className="text-sm underline"
            >
              View all
            </Link>
          </div>

          {upcomingList.length === 0 ? (
            <p className="text-sm text-gray-600 mt-4">
              No upcoming reviews in the next 30 days.
            </p>
          ) : (
            <div className="space-y-3 mt-4">
              {upcomingList.map((row, idx) => (
                <div
                  key={`${row.retailer_name}-${row.universal_category}-${idx}`}
                  className="block border rounded-lg p-3"
                >
                  <div className="font-medium">{row.retailer_name}</div>
                  {row.retailer_category_review_name ? (
                    <div className="text-sm text-gray-500">
                      {row.retailer_category_review_name}
                    </div>
                  ) : null}
                  <div className="text-sm text-gray-600 mt-1">
                    Universal Category: {row.universal_category}
                  </div>
                  <div className="text-sm text-gray-600">
                    Review Date: {prettyDate(row.review_date)}
                  </div>
                  <div className="text-sm text-gray-600">
                    Reset Date: {prettyDate(row.reset_date)}
                  </div>
                  {row.retailer_id ? (
                    <div className="mt-2">
                      <Link
                        href={`/brands/${brandId}/retailers/${row.retailer_id}`}
                        className="text-sm underline"
                      >
                        Open retailer
                      </Link>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="border rounded-xl p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Authorized Accounts</h2>
            <Link
              href={`/brands/${brandId}/retailers?filter=authorized`}
              className="text-sm underline"
            >
              View all
            </Link>
          </div>

          {topAuthorized.length === 0 ? (
            <p className="text-sm text-gray-600 mt-4">No authorized accounts loaded yet.</p>
          ) : (
            <div className="space-y-3 mt-4">
              {topAuthorized.map((row, index) => {
                const retailer = retailersById[row.retailer_id];
                const headline = retailer?.banner?.trim()
                  ? retailer.banner
                  : row.retailer_name || retailer?.name || "Retailer";

                return (
                  <Link
                    key={`${row.retailer_id ?? "no-retailer"}-${index}`}
                    href={`/brands/${brandId}/retailers`}
                    className="block border rounded-lg p-3 hover:bg-gray-50"
                  >
                    <div className="font-medium">{headline}</div>
                    <div className="text-sm text-gray-600 mt-1">
                      {row.authorized_item_count} items • {row.authorized_upc_count} UPCs
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="border rounded-xl p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Recent Workflow Notes</h2>
          <Link href={`/brands/${brandId}/retailers`} className="text-sm underline">
            Open retailer list
          </Link>
        </div>

        {recentWorkflow.length === 0 ? (
          <p className="text-sm text-gray-600 mt-4">No recent workflow notes yet.</p>
        ) : (
          <div className="space-y-3 mt-4">
            {recentWorkflow.map((row, index) => {
              const retailer = retailersById[row.retailer_id];
              const headline = retailer?.banner?.trim()
                ? retailer.banner
                : retailer?.name ?? "Retailer";

              return (
                <Link
                  key={row.id ?? `${row.retailer_id ?? "no-retailer"}-${index}`}
                  href={`/brands/${brandId}/retailers/${row.retailer_id}`}
                  className="block border rounded-lg p-3 hover:bg-gray-50"
                >
                  <div className="font-medium">{headline}</div>
                  <div className="text-sm text-gray-600 mt-1">
                    Status: {statusLabel(row.account_status)}
                  </div>
                  {row.submitted_date ? (
                    <div className="text-sm text-gray-600">
                      Submitted: {prettyDate(row.submitted_date)}
                    </div>
                  ) : null}
                  {row.notes ? (
                    <div className="text-sm text-gray-700 mt-2 line-clamp-3">
                      {row.notes}
                    </div>
                  ) : null}
                </Link>
              );
            })}
          </div>
        )}
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