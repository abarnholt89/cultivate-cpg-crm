import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { createClient } from "@supabase/supabase-js";

async function authorizeRequest() {
  const headerStore = await headers();
  const authHeader = headerStore.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  return authHeader === expected;
}

// Fuzzy-match a promo's retailer_name to the retailers table (name or banner,
// case-insensitive), then return the rep's email via auth.admin.
// Falls back to the brand's cultivate_rep_id if no retailer match is found.
// Returns null silently — callers must not block on this.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function lookupRepEmail(
  supabase: any,
  promoRetailerName: string,
  brandId: string
): Promise<string | null> {
  const name = (promoRetailerName ?? "").trim();
  if (!name) return null;

  // ilike on both name and banner — already case-insensitive
  const { data: rows } = await supabase
    .from("retailers")
    .select("id, name, banner, rep_owner_user_id")
    .or(`name.ilike.${name},banner.ilike.${name}`);

  // If exact ilike didn't hit, try contains in either direction
  let matched = ((rows ?? []) as {
    id: string;
    name: string | null;
    banner: string | null;
    rep_owner_user_id: string | null;
  }[]).find((r) => r.rep_owner_user_id);

  if (!matched) {
    // Broader contains search
    const norm = name.toLowerCase();
    const { data: fuzzy } = await supabase
      .from("retailers")
      .select("id, name, banner, rep_owner_user_id")
      .or(`name.ilike.%${name}%,banner.ilike.%${name}%`);

    type RetailerRow = { id: string; name: string | null; banner: string | null; rep_owner_user_id: string | null };
    matched = ((fuzzy ?? []) as RetailerRow[])?.find((r) => {
      if (!r.rep_owner_user_id) return false;
      const rn = (r.name ?? "").toLowerCase();
      const rb = (r.banner ?? "").toLowerCase();
      return (
        rn.includes(norm) || norm.includes(rn) ||
        rb.includes(norm) || norm.includes(rb)
      );
    });
  }

  const repUserId = matched?.rep_owner_user_id ?? null;

  // If still no retailer match, fall back to brand's cultivate_rep_id
  const resolvedUserId = repUserId ?? await (async () => {
    const { data: brandRow } = await supabase
      .from("brands")
      .select("cultivate_rep_id")
      .eq("id", brandId)
      .maybeSingle();
    return (brandRow as { cultivate_rep_id: string | null } | null)?.cultivate_rep_id ?? null;
  })();

  if (!resolvedUserId) return null;

  const { data: userData } = await supabase.auth.admin.getUserById(resolvedUserId);
  return userData?.user?.email ?? null;
}

async function runPromoAlerts() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const today = new Date();
  const sevenDays = new Date();
  const thirtyDays = new Date();

  sevenDays.setDate(today.getDate() + 7);
  thirtyDays.setDate(today.getDate() + 30);

  const format = (d: Date) => d.toISOString().slice(0, 10);

  const todayStr = format(today);
  const sevenDaysStr = format(sevenDays);
  const thirtyDaysStr = format(thirtyDays);

  const { data: promos, error } = await supabase
    .from("promotions")
    .select(`
      id,
      brand_id,
      brand_name,
      retailer_name,
      promo_name,
      promo_type,
      start_date,
      end_date,
      promo_text_raw,
      brands (
        id,
        name,
        archived,
        promo_alerts_enabled,
        promo_alert_test_mode,
        promo_alerts_live_date
      )
    `)
    .gte("start_date", todayStr)
    .lte("start_date", thirtyDaysStr)
    .order("start_date", { ascending: true });

  if (error) throw error;

  let sent = 0;
  let candidates = 0;

  for (const promo of promos ?? []) {
    const brand = promo.brands as any;

    if (brand?.archived) continue;
    if (!brand?.promo_alerts_enabled) continue;

    if (brand.promo_alerts_live_date && todayStr < brand.promo_alerts_live_date) {
      continue;
    }

    // Only 7-day and day-of alerts
    const isRealAlertWindow =
      promo.start_date === todayStr ||
      promo.start_date === sevenDaysStr;

    if (!isRealAlertWindow) continue;

    // Skip EDLP / EDLC promotions
    const promoTypeUp = (promo.promo_type ?? "").toUpperCase();
    const promoNameUp = (promo.promo_name ?? "").toUpperCase();
    if (
      promoTypeUp.includes("EDLP") || promoTypeUp.includes("EDLC") ||
      promoNameUp.includes("EDLP") || promoNameUp.includes("EDLC")
    ) {
      continue;
    }

    candidates++;

    const alertType = promo.start_date === sevenDaysStr ? "7_day" : "day_of";

    let recipients: string[] = [];

    if (brand.promo_alert_test_mode) {
      recipients = ["aaron@cultivatecpg.com"];
    } else {
      // Client emails
      const { data: clientRows, error: clientError } = await supabase.rpc(
        "get_brand_client_emails",
        { p_brand_id: promo.brand_id }
      );

      if (clientError) {
        console.error("Client email lookup failed", clientError);
        continue;
      }

      recipients = ((clientRows as { email: string }[]) ?? [])
        .map((row) => row.email)
        .filter(Boolean);

      // Rep email via retailer name → rep_owner_user_id lookup
      const repEmail = await lookupRepEmail(supabase, promo.retailer_name ?? "", promo.brand_id);
      if (repEmail && !recipients.includes(repEmail)) {
        recipients.push(repEmail);
      }
    }

    if (recipients.length === 0) continue;

    for (const recipient of recipients) {
      const { data: existingAlert, error: existingAlertError } = await supabase
        .from("promotion_alerts_sent")
        .select("id")
        .eq("promotion_id", promo.id)
        .eq("recipient_email", recipient)
        .eq("alert_type", alertType)
        .maybeSingle();

      if (existingAlertError) {
        console.error("Failed checking promo alert", existingAlertError);
        continue;
      }

      if (existingAlert) continue;

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/send-client-message-email`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!}`,
          },
          body: JSON.stringify({
            brand_name: promo.brand_name,
            retailer_name: promo.retailer_name,
            message_body:
              `Promo alert (${alertType}): ${promo.promo_name || promo.promo_type}\n` +
              `Starts: ${promo.start_date}\n` +
              `Ends: ${promo.end_date || "TBD"}\n` +
              `${promo.promo_text_raw || ""}`,
            recipients: [recipient],
            actor_name: "The Hub",
            event_type: "promo_starting",
          }),
        }
      );

      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        console.error("Promo alert email failed", result);
        continue;
      }

      await supabase.from("promotion_alerts_sent").insert({
        promotion_id: promo.id,
        recipient_email: recipient,
        alert_type: alertType,
      });

      sent++;
    }
  }

  return {
    success: true,
    promos_checked: promos?.length ?? 0,
    promo_candidates: candidates,
    alerts_sent: sent,
  };
}

export async function GET() {
  try {
    const authorized = await authorizeRequest();
    if (!authorized) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const result = await runPromoAlerts();
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}

export async function POST() {
  try {
    const authorized = await authorizeRequest();
    if (!authorized) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const result = await runPromoAlerts();
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
