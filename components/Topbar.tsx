"use client"

import { Button } from "@/components/ui/button"
import { supabase } from "@/lib/supabaseClient"

export default function Topbar() {
  async function logout() {
    await supabase.auth.signOut()
    window.location.href = "/login"
  }

  return (
    <header className="h-16 border-b flex items-center justify-between px-6">
      <h2 className="text-lg font-semibold">Dashboard</h2>
      <Button variant="outline" onClick={logout}>
        Logout
      </Button>
    </header>
  )
}
