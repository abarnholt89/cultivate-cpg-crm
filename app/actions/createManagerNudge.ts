'use server'

import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createManagerNudge(
  brandRetailerTimingId: string,
  title: string,
  details?: string
) {
  const cookieStore = await cookies()

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value
        },
        set() {},
        remove() {},
      },
    }
  )

  const { data, error } = await supabase.rpc('create_manager_nudge', {
    p_brand_retailer_timing_id: brandRetailerTimingId,
    p_title: title,
    p_details: details ?? null,
    p_priority: 'high',
    p_due_at: null,
  })

  if (error) {
    throw new Error(error.message)
  }

  return data
}