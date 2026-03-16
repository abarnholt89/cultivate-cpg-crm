"use client";

import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import Link from "next/link";

type Role = "admin" | "rep" | "client" | null;

type PromotionRow = {
  id: string;
  brand_id: string;
  retailer_id: string | null;
  brand_name: string;
  retailer_name: string;
  retailer_banner: string | null;
  distributor: string | null;
  cultivate_rep: string | null;
  sku_description: string;
  unit_upc: string | null;
  promo_year: number;
  promo_month: number;
  promo_name: string | null;
  promo_type: string;
  promo_status: string;
  promo_scope: "retailer" | "distributor" | null;
  start_date: string | null;
  end_date: string | null;
  discount_percent: number | null;
  discount_amount: number | null;
  promo_text_raw: string | null;
  notes: string | null;
};

type DistributorGroup = {
  key: string;
  distributor: string;
  brand_name: string;
  promo_year: number;
  promo_month: number;
  promo_name: string | null;
  promo_type: string;
  promo_status: string;
  start_date: string | null;
  end_date: string | null;
  promo_text_raw: string | null;
  rows: PromotionRow[];
};

type RetailerPromoGroup = {
  key: string;
  promo_year: number;
  promo_month: number;
  promo_name: string | null;
  promo_type: string;
  promo_status: string;
  start_date: string | null;
  end_date: string | null;
  promo_text_raw: string | null;
  rows: PromotionRow[];
};

type RetailerBrandGroup = {
  key: string;
  brand_id: string;
  brand_name: string;
  rows: PromotionRow[];
  promoGroups: RetailerPromoGroup[];
};

type RetailerGroup = {
  key: string;
  retailer_name: string;
  retailer_banner: string | null;
  distributor: string | null;
  rows: PromotionRow[];
  brandGroups: RetailerBrandGroup[];
};

function monthLabel(month: number) {
  return new Date(2026, month - 1, 1).toLocaleString(undefined, {
    month: "short",
  });
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

function getPromoStart(rows: PromotionRow[]) {
  return rows.map((r) => r.start_date).filter(Boolean).sort()[0] ?? null;
}

function getPromoEnd(rows: PromotionRow[]) {
  const dates = rows.map((r) => r.end_date).filter(Boolean).sort();
  return dates.length ? dates[dates.length - 1] : null;
}

function discountLabel(row: PromotionRow) {
  const parts: string[] = [];
  if (row.discount_percent != null) parts.push(`${row.discount_percent}%`);
  if (row.discount_amount != null) parts.push(`$${row.discount_amount}`);
  return parts.join(" • ");
}

async function fetchAllRows<T>(query: any): Promise<T[]> {
  const pageSize = 1000;
  let from = 0;
  let allRows: T[] = [];

  while (true) {
    const { data, error } = await query.range(from, from + pageSize - 1);
    if (error) throw error;

    const rows = (data ?? []) as T[];
    allRows = allRows.concat(rows);

    if (rows.length < pageSize) break;
    from += pageSize;
  }

  return allRows;
}

function splitPromotions(rows: PromotionRow[]) {
  const distributorSupport = rows.filter(
    (r) =>
      r.promo_scope === "distributor" ||
      r.promo_name === "Distributor OI" ||
      r.promo_type === "Distributor OI"
  );

  const retailerActivations = rows.filter(
    (r) =>
      !(
        r.promo_scope === "distributor" ||
        r.promo_name === "Distributor OI" ||
        r.promo_type === "Distributor OI"
      )
  );

  return { distributorSupport, retailerActivations };
}

function groupDistributorSupport(rows: PromotionRow[]): DistributorGroup[] {
  const grouped = new Map<string, DistributorGroup>();

  for (const row of rows) {
    const key = [
      row.distributor || "Distributor Program",
      row.promo_year,
      row.promo_month,
      row.brand_name,
    ].join("||");

    if (!grouped.has(key)) {
      grouped.set(key, {
        key,
        distributor: row.distributor || "Distributor Program",
        brand_name: row.brand_name,
        promo_year: row.promo_year,
        promo_month: row.promo_month,
        promo_name: row.promo_name,
        promo_type: row.promo_type,
        promo_status: row.promo_status,
        start_date: row.start_date,
        end_date: row.end_date,
        promo_text_raw: row.promo_text_raw,
        rows: [],
      });
    }

    grouped.get(key)!.rows.push(row);
  }

  return Array.from(grouped.values()).sort((a, b) => {
    if (a.promo_year !== b.promo_year) return b.promo_year - a.promo_year;
    if (a.promo_month !== b.promo_month) return b.promo_month - a.promo_month;
    if (a.distributor !== b.distributor) return a.distributor.localeCompare(b.distributor);
    return a.brand_name.localeCompare(b.brand_name);
  });
}

function groupRetailerActivations(rows: PromotionRow[]): RetailerGroup[] {
  const retailerMap = new Map<string, RetailerGroup>();

  for (const row of rows) {
    const retailerKey = [
      row.retailer_name || "Unknown Retailer",
      row.retailer_banner || "",
      row.distributor || "",
    ].join("||");

    if (!retailerMap.has(retailerKey)) {
      retailerMap.set(retailerKey, {
        key: retailerKey,
        retailer_name: row.retailer_name || "Unknown Retailer",
        retailer_banner: row.retailer_banner,
        distributor: row.distributor,
        rows: [],
        brandGroups: [],
      });
    }

    retailerMap.get(retailerKey)!.rows.push(row);
  }

  const retailerGroups = Array.from(retailerMap.values());

  for (const retailerGroup of retailerGroups) {
    const brandMap = new Map<string, RetailerBrandGroup>();

    for (const row of retailerGroup.rows) {
      const brandKey = `${retailerGroup.key}||${row.brand_id}`;

      if (!brandMap.has(brandKey)) {
        brandMap.set(brandKey, {
          key: brandKey,
          brand_id: row.brand_id,
          brand_name: row.brand_name,
          rows: [],
          promoGroups: [],
        });
      }

      brandMap.get(brandKey)!.rows.push(row);
    }

    const brandGroups = Array.from(brandMap.values());

    for (const brandGroup of brandGroups) {
      const promoMap = new Map<string, RetailerPromoGroup>();

      for (const row of brandGroup.rows) {
        const promoKey = [
          brandGroup.key,
          row.promo_year,
          row.promo_month,
          row.promo_name || "",
          row.promo_type,
        ].join("||");

        if (!promoMap.has(promoKey)) {
          promoMap.set(promoKey, {
            key: promoKey,
            promo_year: row.promo_year,
            promo_month: row.promo_month,
            promo_name: row.promo_name,
            promo_type: row.promo_type,
            promo_status: row.promo_status,
            start_date: row.start_date,
            end_date: row.end_date,
            promo_text_raw: row.promo_text_raw,
            rows: [],
          });
        }

        promoMap.get(promoKey)!.rows.push(row);
      }

      brandGroup.promoGroups = Array.from(promoMap.values()).sort((a, b) => {
        if (a.promo_year !== b.promo_year) return b.promo_year - a.promo_year;
        if (a.promo_month !== b.promo_month) return b.promo_month - a.promo_month;
        return (a.promo_name || a.promo_type).localeCompare(b.promo_name || b.promo_type);
      });
    }

    retailerGroup.brandGroups = brandGroups.sort((a, b) =>
      a.brand_name.localeCompare(b.brand_name)
    );
  }

  return retailerGroups.sort((a, b) =>
    (a.retailer_banner || a.retailer_name).localeCompare(
      b.retailer_banner || b.retailer_name
    )
  );
}

export default function PromotionsPage() {
  const [role, setRole] = useState<Role>(null);
  const [promotions, setPromotions] = useState<PromotionRow[]>([]);
  const [filtered, setFiltered] = useState<PromotionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");

  const [expandedRetailers, setExpandedRetailers] = useState<Record<string, boolean>>({});
  const [expandedDistributorGroups, setExpandedDistributorGroups] = useState<
    Record<string, boolean>
  >({});
  const [expandedBrands, setExpandedBrands] = useState<Record<string, boolean>>({});
  const [expandedPromoGroups, setExpandedPromoGroups] = useState<Record<string, boolean>>({});

  const [yearFilter, setYearFilter] = useState("all");
  const [brandFilter, setBrandFilter] = useState("all");
  const [retailerFilter, setRetailerFilter] = useState("all");
  const [monthFilter, setMonthFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [repFilter, setRepFilter] = useState("all");
  const [scopeFilter, setScopeFilter] = useState("all");

  useEffect(() => {
    async function load() {
      setLoading(true);
      setStatus("");

      try {
        const { data: authData } = await supabase.auth.getUser();
        const userId = authData?.user?.id;

        if (!userId) {
          setStatus("You must be signed in.");
          setLoading(false);
          return;
        }

        const { data: profile, error: profileError } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", userId)
          .single();

        if (profileError) {
          setStatus(profileError.message);
          setLoading(false);
          return;
        }

        const nextRole = (profile?.role as Role) ?? null;
        setRole(nextRole);

        if (nextRole === "client") {
          const { data: brandUsers, error: brandUsersError } = await supabase
            .from("brand_users")
            .select("brand_id")
            .eq("user_id", userId);

          if (brandUsersError) {
            setStatus(brandUsersError.message);
            setLoading(false);
            return;
          }

          const brandIds = (brandUsers ?? []).map((row) => row.brand_id);

          if (brandIds.length === 0) {
            setPromotions([]);
            setFiltered([]);
            setLoading(false);
            return;
          }

          const rows = await fetchAllRows<PromotionRow>(
            supabase
              .from("promotions")
              .select("*")
              .in("brand_id", brandIds)
              .order("promo_year", { ascending: false })
              .order("promo_month", { ascending: true })
          );

          setPromotions(rows);
          setFiltered(rows);
          setLoading(false);
          return;
        }

        if (nextRole === "rep") {
          const { data: ownedRetailers, error: ownedRetailersError } = await supabase
            .from("retailers")
            .select("id")
            .eq("rep_owner_user_id", userId);

          if (ownedRetailersError) {
            setStatus(ownedRetailersError.message);
            setLoading(false);
            return;
          }

          const retailerIds = (ownedRetailers ?? []).map((row) => row.id);

          const distributorRows = await fetchAllRows<PromotionRow>(
            supabase
              .from("promotions")
              .select("*")
              .or("promo_scope.eq.distributor,promo_name.eq.Distributor OI")
              .order("promo_year", { ascending: false })
              .order("promo_month", { ascending: true })
          );

          let retailerRows: PromotionRow[] = [];

          if (retailerIds.length > 0) {
            retailerRows = await fetchAllRows<PromotionRow>(
              supabase
                .from("promotions")
                .select("*")
                .in("retailer_id", retailerIds)
                .order("promo_year", { ascending: false })
                .order("promo_month", { ascending: true })
            );
          }

          const combined = [...retailerRows, ...distributorRows];
          const uniqueRows = Array.from(
            new Map(combined.map((row) => [row.id, row])).values()
          );

          setPromotions(uniqueRows);
          setFiltered(uniqueRows);
          setLoading(false);
          return;
        }

        if (nextRole === "admin") {
          const rows = await fetchAllRows<PromotionRow>(
            supabase
              .from("promotions")
              .select("*")
              .order("promo_year", { ascending: false })
              .order("promo_month", { ascending: true })
          );

          setPromotions(rows);
          setFiltered(rows);
          setLoading(false);
          return;
        }

        const rows = await fetchAllRows<PromotionRow>(
          supabase
            .from("promotions")
            .select("*")
            .order("promo_year", { ascending: false })
            .order("promo_month", { ascending: true })
        );

        setPromotions(rows);
        setFiltered(rows);
        setLoading(false);
      } catch (err: any) {
        setStatus(err?.message || "Failed to load promotions.");
        setLoading(false);
      }
    }

    load();
  }, []);

  useEffect(() => {
    let rows = [...promotions];

    if (brandFilter !== "all") {
      rows = rows.filter((r) => r.brand_name === brandFilter);
    }

    if (retailerFilter !== "all") {
      rows = rows.filter((r) => r.retailer_name === retailerFilter);
    }

    if (monthFilter !== "all") {
      rows = rows.filter((r) => String(r.promo_month) === monthFilter);
    }

    if (yearFilter !== "all") {
      rows = rows.filter((r) => String(r.promo_year) === yearFilter);
    }

    if (statusFilter !== "all") {
      rows = rows.filter((r) => r.promo_status === statusFilter);
    }

    if (repFilter !== "all") {
      rows = rows.filter((r) => (r.cultivate_rep || "") === repFilter);
    }

    if (scopeFilter !== "all") {
      rows = rows.filter((r) => r.promo_scope === scopeFilter);
    }

    setFiltered(rows);
  }, [
    promotions,
    brandFilter,
    retailerFilter,
    monthFilter,
    yearFilter,
    statusFilter,
    repFilter,
    scopeFilter,
  ]);

  const brands = useMemo(
    () => [...new Set(promotions.map((r) => r.brand_name).filter(Boolean))].sort(),
    [promotions]
  );

  const retailers = useMemo(
    () => [...new Set(promotions.map((r) => r.retailer_name).filter(Boolean))].sort(),
    [promotions]
  );

  const statuses = useMemo(
    () => [...new Set(promotions.map((r) => r.promo_status).filter(Boolean))].sort(),
    [promotions]
  );

  const reps = useMemo(
    () =>
      [...new Set(promotions.map((r) => r.cultivate_rep || "").filter((r) => r !== ""))].sort(),
    [promotions]
  );

  const years = useMemo(
    () => [...new Set(promotions.map((r) => r.promo_year))].sort((a, b) => b - a),
    [promotions]
  );

  const { distributorSupport, retailerActivations } = useMemo(
    () => splitPromotions(filtered),
    [filtered]
  );

  const distributorGroups = useMemo(
    () => groupDistributorSupport(distributorSupport),
    [distributorSupport]
  );

  const distributorOiKeys = useMemo(() => {
    const rows = promotions.filter(
      (r) =>
        r.promo_name === "Distributor OI" ||
        r.promo_type === "Distributor OI" ||
        r.promo_scope === "distributor"
    );

    return new Set(
      rows.map((r) =>
        [r.brand_id, r.distributor || "", r.promo_year, r.promo_month].join("||")
      )
    );
  }, [promotions]);

  const retailerGroups = useMemo(
    () => groupRetailerActivations(retailerActivations),
    [retailerActivations]
  );

  function renderDistributorGroups(groups: DistributorGroup[]) {
    return groups.map((group) => {
      const skuCount = group.rows.length;
      const startDate = getPromoStart(group.rows);
      const endDate = getPromoEnd(group.rows);

      return (
        <React.Fragment key={group.key}>
          <tr
            className="border-b cursor-pointer hover:bg-gray-50"
            onClick={() =>
              setExpandedDistributorGroups((prev) => ({
                ...prev,
                [group.key]: !prev[group.key],
              }))
            }
          >
            <td className="px-4 py-3">
              <div className="font-medium">{group.distributor}</div>
              <div className="text-xs text-gray-500">Distributor support</div>
            </td>

            <td className="px-4 py-3">
              <div className="font-medium">{group.brand_name}</div>
              <div className="text-xs text-gray-500">
                {group.promo_name || "Distributor OI"}
              </div>
            </td>

            <td className="px-4 py-3">
              <div>{skuCount} SKU{skuCount === 1 ? "" : "s"}</div>
              <div className="text-xs text-gray-500 mt-1">Click to view assortment</div>
            </td>

            <td className="px-4 py-3">
              {monthLabel(group.promo_month)} {group.promo_year}
            </td>

            <td className="px-4 py-3">{group.promo_name || "Distributor OI"}</td>

            <td className="px-4 py-3">{group.promo_status}</td>

            <td className="px-4 py-3">
              <div>{prettyDate(startDate)}</div>
              <div className="text-xs text-gray-500">{prettyDate(endDate)}</div>
            </td>

            <td className="px-4 py-3">
              <div>{group.promo_name || "Distributor OI"}</div>
              {group.promo_text_raw ? (
                <div className="text-xs text-gray-500 mt-1">{group.promo_text_raw}</div>
              ) : null}
            </td>
          </tr>

          {expandedDistributorGroups[group.key] ? (
            <tr className="bg-gray-50 border-b">
              <td colSpan={8} className="px-4 py-4">
                <div className="space-y-2 text-sm">
                  {group.rows.map((item) => (
                    <div key={item.id} className="border rounded p-3 bg-white mb-2">
                      <div className="font-medium">{item.sku_description}</div>

                      {item.unit_upc ? (
                        <div className="text-xs text-gray-500">UPC: {item.unit_upc}</div>
                      ) : null}

                      <div className="text-xs text-gray-500 mt-1">
                        Runs: {prettyDate(item.start_date)} → {prettyDate(item.end_date)}
                      </div>

                      {item.promo_type ? (
                        <div className="text-xs text-gray-500">TPR Type: {item.promo_type}</div>
                      ) : null}

                      {discountLabel(item) ? (
                        <div className="text-xs text-gray-500">
                          Discount: {discountLabel(item)}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </td>
            </tr>
          ) : null}
        </React.Fragment>
      );
    });
  }

  function renderRetailerGroups(groups: RetailerGroup[]) {
    return groups.map((group) => {
      const promoCount = group.brandGroups.reduce(
        (sum, brandGroup) => sum + brandGroup.promoGroups.length,
        0
      );
      const skuCount = group.rows.length;
      const brandCount = group.brandGroups.length;

      return (
        <React.Fragment key={group.key}>
          <tr
            className="border-b cursor-pointer hover:bg-gray-50"
            onClick={() =>
              setExpandedRetailers((prev) => ({
                ...prev,
                [group.key]: !prev[group.key],
              }))
            }
          >
            <td className="px-4 py-3">
              <div className="font-medium">{group.retailer_banner || group.retailer_name}</div>
              {group.distributor ? (
                <div className="text-xs text-gray-500">{group.distributor}</div>
              ) : null}
            </td>

            <td className="px-4 py-3">
              <div className="font-medium">
                {promoCount} Promotion{promoCount === 1 ? "" : "s"}
              </div>
              <div className="text-xs text-gray-500">
                {skuCount} SKU{skuCount === 1 ? "" : "s"} total
              </div>
            </td>

            <td className="px-4 py-3">
              <div className="font-medium">
                {brandCount} Brand{brandCount === 1 ? "" : "s"}
              </div>
              <div className="text-xs text-gray-500">Click to view brands on deal</div>
            </td>

            <td className="px-4 py-3">—</td>
            <td className="px-4 py-3">—</td>
            <td className="px-4 py-3">—</td>
            <td className="px-4 py-3">—</td>
            <td className="px-4 py-3">—</td>
          </tr>

          {expandedRetailers[group.key] ? (
            <tr className="bg-gray-50 border-b">
              <td colSpan={8} className="px-4 py-4">
                <div className="space-y-3">
                  {group.brandGroups.map((brandGroup) => {
                    const brandPromoCount = brandGroup.promoGroups.length;
                    const brandSkuCount = brandGroup.rows.length;
                    const hasAnyOiLoaded = brandGroup.promoGroups.some((promoGroup) =>
                      promoGroup.rows.some((item) =>
                        distributorOiKeys.has(
                          [
                            item.brand_id,
                            item.distributor || "",
                            item.promo_year,
                            item.promo_month,
                          ].join("||")
                        )
                      )
                    );

                    return (
                      <div key={brandGroup.key} className="border rounded bg-white">
                        <button
                          type="button"
                          className="w-full text-left p-3 hover:bg-gray-50"
                          onClick={(e) => {
                            e.stopPropagation();
                            setExpandedBrands((prev) => ({
                              ...prev,
                              [brandGroup.key]: !prev[brandGroup.key],
                            }));
                          }}
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div>
                              <div className="font-medium">{brandGroup.brand_name}</div>
                              <div className="text-xs text-gray-500 mt-1">
                                {brandPromoCount} Promotion
                                {brandPromoCount === 1 ? "" : "s"} • {brandSkuCount} SKU
                                {brandSkuCount === 1 ? "" : "s"}
                              </div>
                            </div>
                            

                            {hasAnyOiLoaded ? (
                              <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] text-green-700 border-green-300 bg-green-50">
                                ✓ OI loaded
                              </span>
                            ) : null}
                          </div>
                        </button>

                        {expandedBrands[brandGroup.key] ? (
                          <div className="px-3 pb-3 space-y-2">
                            {brandGroup.promoGroups.map((promoGroup) => {
                              const promoSkuCount = promoGroup.rows.length;
                              const hasOiLoaded = promoGroup.rows.some((item) =>
                                distributorOiKeys.has(
                                  [
                                    item.brand_id,
                                    item.distributor || "",
                                    item.promo_year,
                                    item.promo_month,
                                  ].join("||")
                                )
                              );

                              return (
                                <div key={promoGroup.key} className="border rounded bg-gray-50">
                                  <button
                                    type="button"
                                    className="w-full text-left p-3 hover:bg-gray-100"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setExpandedPromoGroups((prev) => ({
                                        ...prev,
                                        [promoGroup.key]: !prev[promoGroup.key],
                                      }));
                                    }}
                                  >
                                    <div className="font-medium">
                                      {monthLabel(promoGroup.promo_month)} {promoGroup.promo_year} —{" "}
                                      {promoGroup.promo_name || promoGroup.promo_type}
                                    </div>

                                    <div className="text-xs text-gray-500 mt-1 flex items-center gap-2">
                                      <span>
                                        {promoSkuCount} SKU{promoSkuCount === 1 ? "" : "s"} •{" "}
                                        {promoGroup.promo_status}
                                      </span>
                                      {hasOiLoaded ? (
                                        <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] text-green-700 border-green-300 bg-green-50">
                                          ✓ OI loaded
                                        </span>
                                      ) : null}
                                    </div>

                                    <div className="text-xs text-gray-500">
                                      Runs: {prettyDate(promoGroup.start_date)} →{" "}
                                      {prettyDate(promoGroup.end_date)}
                                    </div>

                                    <div className="text-xs text-gray-500 mt-1">
                                      TPR Type: {promoGroup.promo_type}
                                    </div>

                                    {promoGroup.promo_text_raw ? (
                                      <div className="text-xs text-gray-500 mt-1">
                                        {promoGroup.promo_text_raw}
                                      </div>
                                    ) : null}
                                  </button>
                        

                                  {expandedPromoGroups[promoGroup.key] ? (
                                    <div className="px-3 pb-3 space-y-2">
                                      {promoGroup.rows.map((item) => (
                                        <div
                                          key={item.id}
                                          className="border rounded p-3 bg-white"
                                        >
                                          <div className="font-medium">{item.sku_description}</div>

                                          {item.unit_upc ? (
                                            <div className="text-xs text-gray-500">
                                              UPC: {item.unit_upc}
                                            </div>
                                          ) : null}

                                          {item.cultivate_rep ? (
                                            <div className="text-xs text-gray-500">
                                              Rep: {item.cultivate_rep}
                                            </div>
                                          ) : null}

                                          {item.promo_type ? (
  <div className="text-xs text-gray-500">
    TPR Type: {item.promo_type}
  </div>
) : null}

{discountLabel(item) ? (
  <div className="text-xs text-gray-500">
    Discount: {discountLabel(item)}
  </div>
) : null}

<div className="text-xs text-gray-500">
  Runs: {prettyDate(item.start_date)} → {prettyDate(item.end_date)}
</div>

{item.notes ? (
  <div className="text-xs text-gray-500 mt-1">
    Notes: {item.notes}
  </div>
) : null}

<div className="mt-2">
  <Link
    href={`/promotions/${item.id}/edit`}
    className="text-xs underline"
  >
    Edit Promotion
  </Link>
</div>
                                            
                                         
                                        </div>
                                      ))}
                                    </div>
                                  ) : null}
                                </div>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </td>
            </tr>
          ) : null}
        </React.Fragment>
      );
    });
  }

  return (
<div className="p-6 space-y-6">

  <div className="flex items-center justify-between">
    <h1 className="text-3xl font-bold">Promotions</h1>

    <Link
      href="/promotions/new"
      className="bg-black text-white px-4 py-2 rounded text-sm"
    >
      Add Promotion
    </Link>
  </div>

      {status ? <div className="text-sm text-red-600">{status}</div> : null}

      <div className="grid grid-cols-1 md:grid-cols-8 gap-4">
        <select value={brandFilter} onChange={(e) => setBrandFilter(e.target.value)}>
          <option value="all">All Brands</option>
          {brands.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>

        <select value={retailerFilter} onChange={(e) => setRetailerFilter(e.target.value)}>
          <option value="all">All Retailers</option>
          {retailers.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>

        <select value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)}>
          <option value="all">All Months</option>
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
            <option key={m} value={String(m)}>
              {monthLabel(m)}
            </option>
          ))}
        </select>

        <select value={yearFilter} onChange={(e) => setYearFilter(e.target.value)}>
          <option value="all">All Years</option>
          {years.map((y) => (
            <option key={y} value={String(y)}>
              {y}
            </option>
          ))}
        </select>

        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="all">All Statuses</option>
          {statuses.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        <select value={scopeFilter} onChange={(e) => setScopeFilter(e.target.value)}>
          <option value="all">All Scopes</option>
          <option value="retailer">Retailer</option>
          <option value="distributor">Distributor</option>
        </select>

        {(role === "admin" || role === "rep") && (
          <select value={repFilter} onChange={(e) => setRepFilter(e.target.value)}>
            <option value="all">All Reps</option>
            {reps.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        )}
      </div>

      {loading ? (
        <div>Loading promotions…</div>
      ) : (
        <>
          {role === "client" && (
            <section>
              <p className="text-sm text-gray-500 mb-4">
                Distributor base support by brand and month.
              </p>

              <table className="w-full text-sm border rounded-xl">
                <tbody>{renderDistributorGroups(distributorGroups)}</tbody>
              </table>
            </section>
          )}

          <section>
            <h2 className="text-xl font-semibold mb-2">Retailer Activations</h2>
            <p className="text-sm text-gray-500 mb-4">
              Retailer-specific promotions by account, brand, month, and assortment.
            </p>

            <table className="w-full text-sm border rounded-xl">
              <tbody>{renderRetailerGroups(retailerGroups)}</tbody>
            </table>
          </section>

          {(role === "admin" || role === "rep") && (
            <div className="text-sm text-gray-600">
              CSV import is the next step after this page is live.
            </div>
          )}
        </>
      )}
    </div>
  );
}