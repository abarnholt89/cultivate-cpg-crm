"use client"

export default function GroupedPromotions({ groups }: { groups: any[] }) {
  if (!groups.length) {
    return (
      <div className="text-sm text-gray-500">
        No promotions found
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {groups.map((g) => (
        <details
          key={g.key}
          className="border rounded-md bg-white"
        >
          <summary className="cursor-pointer px-4 py-3 font-medium">
            {g.distributor && (
              <div>
                {g.distributor} • {g.year}
                <div className="text-xs text-gray-500">
                  Portfolio-wide unless noted otherwise
                </div>
              </div>
            )}

            {g.retailer && (
              <div>
                {g.retailer} • {g.month}/{g.year}
              </div>
            )}
          </summary>

          <div className="border-t p-4 text-sm">
            {/* replace with your existing SKU details UI */}
            {g.rows.length} promotion rows
          </div>
        </details>
      ))}
    </div>
  )
}