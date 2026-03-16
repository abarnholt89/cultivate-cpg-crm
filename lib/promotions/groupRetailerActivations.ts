export function groupRetailerActivations(rows: any[]) {
  const map = new Map<string, any[]>()

  for (const r of rows) {
    const retailer = r.retailer_name || "Unknown Retailer"
    const year = r.promo_year
    const month = r.promo_month

    const key = `${retailer}_${year}_${month}`

    if (!map.has(key)) map.set(key, [])

    map.get(key)!.push(r)
  }

  const groups = Array.from(map.entries()).map(([key, rows]) => {
    const [retailer, year, month] = key.split("_")

    return {
      key,
      retailer,
      year: Number(year),
      month: Number(month),
      rows
    }
  })

  return groups.sort((a, b) => {
    if (a.year !== b.year) return b.year - a.year
    if (a.month !== b.month) return b.month - a.month
    return a.retailer.localeCompare(b.retailer)
  })
}