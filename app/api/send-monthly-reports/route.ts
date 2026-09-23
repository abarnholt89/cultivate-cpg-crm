import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const APP_URL =
  process.env.NEXT_PUBLIC_SITE_URL ||
  process.env.NEXT_PUBLIC_APP_URL ||
  "https://cultivate-cpg-crm.vercel.app";
const LOGO_URL = `${APP_URL}/cultivate-icon.jpeg`;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildMonthlyReportEmail({
  brandName,
  reportType,
  messageBody,
  folderUrl,
}: {
  brandName: string;
  reportType: string;
  messageBody: string;
  folderUrl: string;
}) {
  const typeLabel = reportType === "distributor" ? "Distributor" : "SPINS";
  const escapedBody = escapeHtml(messageBody).replace(/\n/g, "<br>");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Monthly ${typeLabel} Report — ${escapeHtml(brandName)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f6f8;font-family:Inter,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:32px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">

          <!-- Logo header -->
          <tr>
            <td style="background:#123b52;padding:24px 32px;">
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="vertical-align:middle;padding-right:12px;">
                    <img src="${LOGO_URL}" alt="The Hub" width="36" height="36"
                         style="border-radius:6px;display:block;" />
                  </td>
                  <td style="vertical-align:middle;">
                    <span style="color:#78f5cd;font-size:18px;font-weight:700;letter-spacing:-0.3px;">
                      The Hub
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Context bar -->
          <tr>
            <td style="background:#f0faf6;padding:12px 32px;border-bottom:1px solid #e2e8f0;">
              <span style="font-size:13px;color:#4a5568;">
                <strong style="color:#123b52;">${escapeHtml(brandName)}</strong>
                &nbsp;·&nbsp;Monthly ${typeLabel} Report
              </span>
            </td>
          </tr>

          <!-- Message body -->
          <tr>
            <td style="padding:32px 32px 24px;">
              <div style="font-size:15px;line-height:1.6;color:#2d3748;">${escapedBody}</div>
            </td>
          </tr>

          <!-- CTA button -->
          <tr>
            <td style="padding:0 32px 36px;">
              <a href="${folderUrl}"
                 style="display:inline-block;background:#123b52;color:#78f5cd;text-decoration:none;
                        font-size:14px;font-weight:600;padding:12px 24px;border-radius:8px;">
                View Monthly Reports →
              </a>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 32px;border-top:1px solid #e2e8f0;">
              <p style="margin:0;font-size:12px;color:#a0aec0;">
                You're receiving this because you're a client of ${escapeHtml(brandName)} on The Hub.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

type BrandRow = { id: string; name: string; monthly_sales_folder_url: string | null };
type EmailRow = { email: string };

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const reportType: string = body.report_type ?? "distributor";
    const messageBody: string = body.message_body ?? "";
    const preview: boolean = body.preview === true;

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

    // Fetch all brands.
    const { data: brands, error: brandsError } = await admin
      .from("brands")
      .select("id,name,monthly_sales_folder_url")
      .order("name");

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

      const { data: emailRows } = await admin.rpc("get_brand_client_emails", { p_brand_id: brand.id });
      const emails: string[] = ((emailRows ?? []) as EmailRow[]).map((r) => r.email).filter(Boolean);

      if (emails.length === 0) {
        totalSkipped++;
        continue;
      }

      totalBrands++;
      totalContacts += emails.length;

      if (preview) continue;

      for (const email of emails) {
        const htmlBody = buildMonthlyReportEmail({
          brandName: brand.name,
          reportType,
          messageBody,
          folderUrl: brand.monthly_sales_folder_url!,
        });

        let sendOk = false;
        let sendError: string | null = null;

        try {
          const resp = await fetch(
            `${supabaseUrl}/functions/v1/send-client-message-email`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                apikey: supabaseAnonKey,
                Authorization: `Bearer ${supabaseAnonKey}`,
              },
              body: JSON.stringify({ recipients: [email], html_body: htmlBody }),
            }
          );
          sendOk = resp.ok;
          if (!resp.ok) sendError = `HTTP ${resp.status}`;
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
