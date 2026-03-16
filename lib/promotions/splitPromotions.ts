export function splitPromotions(rows: any[]) {
  const distributorSupport = rows.filter(
    (r) => r.promo_scope === "distributor"
  )

  const retailerActivations = rows.filter(
    (r) => r.promo_scope === "retailer"
  )

  return {
    distributorSupport,
    retailerActivations
  }
}