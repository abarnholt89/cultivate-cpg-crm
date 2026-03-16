export function groupDistributorSupport(rows: any[]) {
  const map = new Map<string, any[]>();

  for (const row of rows) {
    const distributorName =
      row.distributor ||
      row.retailer_banner ||
      row.retailer_name ||
      "Distributor Program";

    const year = row.promo_year ?? "Unknown";
    const month = row.promo_month ?? "Unknown";
    const promoName = row.promo_name ?? "";
    const promoType = row.promo_type ?? "";

    const key = [
      distributorName,
      year,
      month,
      promoName,
      promoType,
    ].join("||");

    if (!map.has(key)) {
      map.set(key, []);
    }

    map.get(key)!.push(row);
  }

  return Array.from(map.entries()).map(([key, groupRows]) => {
    const first = groupRows[0];

    return {
      key,
      distributor:
        first.distributor ||
        first.retailer_banner ||
        first.retailer_name ||
        "Distributor Program",
      year: first.promo_year,
      month: first.promo_month,
      promoName: first.promo_name ?? "",
      promoType: first.promo_type ?? "",
      rows: groupRows,
    };
  });
}