"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"

const navItems = [
  { name: "Dashboard", href: "/dashboard" },
  { name: "Brands", href: "/brands" },
  { name: "Retailers", href: "/retailers" },
  { name: "Pipeline", href: "/pipeline" },
  { name: "Messages", href: "/messages" },
]

export default function Sidebar() {
  const pathname = usePathname()

  return (
    <aside className="w-64 bg-slate-900 text-white p-6">
      <h1 className="text-xl font-bold mb-8">Cultivate CRM</h1>
      <nav className="space-y-2">
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "block px-4 py-2 rounded hover:bg-slate-700",
              pathname.startsWith(item.href) && "bg-slate-800"
            )}
          >
            {item.name}
          </Link>
        ))}
      </nav>
    </aside>
  )
}
