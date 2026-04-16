import { NextResponse } from "next/server";

const APP_URL = "https://cultivate-cpg-crm.vercel.app";
const LOGO_URL = `${APP_URL}/cultivate-icon.jpeg`;

function buildEmailHtml({
  brandName,
  retailerName,
  messageBody,
  actorName,
  replyUrl,
}: {
  brandName: string;
  retailerName: string;
  messageBody: string;
  actorName: string;
  replyUrl: string;
}) {
  const escapedBody = messageBody
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>New message from Cultivate</title>
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
                    <img src="${LOGO_URL}" alt="Cultivate" width="36" height="36"
                         style="border-radius:6px;display:block;" />
                  </td>
                  <td style="vertical-align:middle;">
                    <span style="color:#78f5cd;font-size:18px;font-weight:700;letter-spacing:-0.3px;">
                      Cultivate CPG
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
                <strong style="color:#123b52;">${brandName}</strong>
                &nbsp;·&nbsp;
                ${retailerName}
              </span>
            </td>
          </tr>

          <!-- Message body -->
          <tr>
            <td style="padding:32px;">
              <p style="margin:0 0 8px;font-size:13px;color:#718096;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">
                New message from ${actorName}
              </p>
              <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:20px;margin-top:8px;font-size:15px;line-height:1.6;color:#2d3748;">
                ${escapedBody}
              </div>
            </td>
          </tr>

          <!-- CTA button -->
          <tr>
            <td style="padding:0 32px 36px;">
              <a href="${replyUrl}"
                 style="display:inline-block;background:#123b52;color:#78f5cd;text-decoration:none;
                        font-size:14px;font-weight:600;padding:12px 24px;border-radius:8px;">
                Reply in CRM →
              </a>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 32px;border-top:1px solid #e2e8f0;">
              <p style="margin:0;font-size:12px;color:#a0aec0;">
                You're receiving this because you're a client of ${brandName} on the Cultivate CPG CRM.
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

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      return NextResponse.json(
        { error: "Missing Supabase environment variables" },
        { status: 500 }
      );
    }

    const brandName: string = body.brand_name || "Brand";
    const retailerName: string = body.retailer_name || "Retailer";
    const messageBody: string = body.message_body || "";
    const actorName: string = body.actor_name || "Cultivate";
    const brandId: string = body.brand_id || "";
    const retailerId: string = body.retailer_id || "";

    const replyUrl =
      brandId && retailerId
        ? `${APP_URL}/brands/${brandId}/retailers/${retailerId}`
        : APP_URL;

    const htmlBody = buildEmailHtml({
      brandName,
      retailerName,
      messageBody,
      actorName,
      replyUrl,
    });

    const response = await fetch(
      `${supabaseUrl}/functions/v1/send-client-message-email`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${supabaseAnonKey}`,
        },
        body: JSON.stringify({
          ...body,
          html_body: htmlBody,
          reply_url: replyUrl,
        }),
      }
    );

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      return NextResponse.json(
        { error: result?.error || "Failed to call edge function", details: result },
        { status: response.status }
      );
    }

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
