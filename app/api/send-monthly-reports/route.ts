import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const APP_URL =
  process.env.NEXT_PUBLIC_SITE_URL ||
  process.env.NEXT_PUBLIC_APP_URL ||
  "https://cultivate-cpg-crm.vercel.app";
type BrandRow = { id: string; name: string; monthly_sales_folder_url: string | null };
type EmailRow = { email: string };

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const reportType: string = body.report_type ?? "distributor";
    const messageBody: string = body.message_body ?? "";
    const preview: boolean = body.preview === true;
    const typeLabel = reportType === "distributor" ? "Distributor Depletion" : "SPINS";
    // Optional test-send overrides — additive, no effect on the real send path when omitted.
    const brandId: string = typeof body.brand_id === "string" ? body.brand_id : "";
    const testEmail: string = typeof body.test_email === "string" ? body.test_email.trim() : "";

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceKey || !supabaseAnonKey) {
      return NextResponse.json({ error: "Missing env vars" }, { status: 500 });
    }

    // Verify caller is admin using their JWT.
    const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
    const userJwt = authHeader?.replace(/^Bearer\s+/i, "");
    if (!userJwt) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${userJwt}` } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: profile } = await admin
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();
    if ((profile as { role: string } | null)?.role !== "admin") {
      return NextResponse.json({ error: "Admin only" }, { status: 403 });
    }

    // Fetch all brands (or a single one, for a test send).
    let brandsQuery = admin
      .from("brands")
      .select("id,name,monthly_sales_folder_url")
      .eq("archived", false)
      .order("name");
    if (brandId) brandsQuery = brandsQuery.eq("id", brandId);
    const { data: brands, error: brandsError } = await brandsQuery;

    if (brandsError) {
      return NextResponse.json({ error: brandsError.message }, { status: 500 });
    }

    let totalBrands = 0;
    let totalContacts = 0;
    let totalSkipped = 0;
    let totalSent = 0;
    let totalFailed = 0;

    for (const brand of (brands ?? []) as BrandRow[]) {
      if (!brand.monthly_sales_folder_url) {
        totalSkipped++;
        continue;
      }

      // Test send: skip real client contacts entirely, send only to the override address.
      let emails: string[];
      if (testEmail) {
        emails = [testEmail];
      } else {
        const { data: emailRows } = await admin.rpc("get_brand_client_emails", { p_brand_id: brand.id });
        emails = ((emailRows ?? []) as EmailRow[]).map((r) => r.email).filter(Boolean);
      }

      if (emails.length === 0) {
        totalSkipped++;
        continue;
      }

      totalBrands++;
      totalContacts += emails.length;

      if (preview) continue;

      for (const email of emails) {
        let sendOk = false;
        let sendError: string | null = null;

        try {
          const resp = await fetch(`${APP_URL}/api/send-client-email`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              brand_name: brand.name,
              message_body: `${messageBody}\n\n${typeLabel} Report: ${brand.monthly_sales_folder_url}`,
              recipients: [email],
              actor_name: "The Hub",
              event_type: "message",
              brand_id: brand.id,
            }),
          });
          const result = await resp.json().catch(() => ({}));
          sendOk = resp.ok;
          if (!resp.ok) sendError = result?.error || `HTTP ${resp.status}`;
        } catch (e) {
          sendError = e instanceof Error ? e.message : "send_error";
        }

        sendOk ? totalSent++ : totalFailed++;

        // Fire-and-forget log — never block the send loop on DB errors.
        admin
          .from("monthly_report_sends")
          .insert({
            report_type: reportType,
            brand_id: brand.id,
            brand_name: brand.name,
            recipient_email: email,
            status: sendOk ? "sent" : "failed",
            error: sendError,
          })
          .then(() => {}, () => {});
      }
    }

    if (preview) {
      return NextResponse.json({ preview: true, brands: totalBrands, contacts: totalContacts, skipped: totalSkipped });
    }

    return NextResponse.json({ sent: totalSent, failed: totalFailed, skipped: totalSkipped, brands: totalBrands });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
