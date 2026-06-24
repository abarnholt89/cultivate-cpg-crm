import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const APP_URL =
  process.env.NEXT_PUBLIC_SITE_URL ||
  process.env.NEXT_PUBLIC_APP_URL ||
  "https://cultivate-cpg-crm.vercel.app";
const LOGO_URL = `${APP_URL}/cultivate-icon.jpeg`;

// Resolve the rep email for a retailer + brand, honoring opt-outs.
// Returns null on any miss so the caller can decide whether to skip the send.
// Uses the service-role client because auth.users.email is not readable
// via anon-key RLS, and we also need to look across the whole profiles table.
async function resolveRepEmail(
  retailerId: string,
  brandId: string
): Promise<string | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;

  const admin = createClient(url, serviceKey);

  const { data: retailer } = await admin
    .from("retailers")
    .select("rep_owner_user_id, team_owner")
    .eq("id", retailerId)
    .maybeSingle();
  if (!retailer) return null;

  let repUserId: string | null = (retailer as { rep_owner_user_id: string | null }).rep_owner_user_id ?? null;

  if (!repUserId) {
    const teamOwner = (retailer as { team_owner: string | null }).team_owner?.trim();
    if (teamOwner) {
      const { data: profile } = await admin
        .from("profiles")
        .select("id")
        .ilike("full_name", teamOwner)
        .limit(1)
        .maybeSingle();
      repUserId = (profile as { id: string } | null)?.id ?? null;
    }
  }

  if (!repUserId) return null;

  // Per-user opt-out: brand_users row with email_notifications_enabled=false blocks the send.
  // No row => treat as allowed (reps typically don't have brand_users rows).
  const { data: bu } = await admin
    .from("brand_users")
    .select("email_notifications_enabled")
    .eq("brand_id", brandId)
    .eq("user_id", repUserId)
    .maybeSingle();
  if (bu && (bu as { email_notifications_enabled: boolean | null }).email_notifications_enabled === false) {
    return null;
  }

  const { data: userRes } = await admin.auth.admin.getUserById(repUserId);
  return userRes?.user?.email ?? null;
}

type RecentMessage = {
  sender_name: string | null;
  body: string;
  created_at: string;
};

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function relativeTime(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  const days = Math.floor(mins / 1440);
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function buildEmailHtml({
  brandName,
  retailerName,
  messageBody,
  actorName,
  brandId,
  retailerId,
  recentMessages,
}: {
  brandName: string;
  retailerName: string;
  messageBody: string;
  actorName: string;
  brandId: string;
  retailerId: string;
  recentMessages?: RecentMessage[];
}) {
  const viewReplyUrl =
    brandId && retailerId
      ? `${APP_URL}/brands/${brandId}/retailers#retailer-${retailerId}`
      : APP_URL;
  const escapedBody = escapeHtml(messageBody).replace(/\n/g, "<br>");

  // Recent thread block — rendered below the main message, above the CTA.
  // Only shown when prior context exists; otherwise the block is omitted.
  const recentBlock = recentMessages && recentMessages.length > 0
    ? `
          <!-- Recent thread -->
          <tr>
            <td style="padding:0 32px 24px;">
              <p style="margin:0 0 12px;font-size:12px;color:#94a3b8;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">
                Recent thread
              </p>
              <table width="100%" cellpadding="0" cellspacing="0">
                ${recentMessages.map((m) => `
                <tr>
                  <td style="padding:10px 14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;margin-bottom:8px;">
                    <div style="font-size:12px;color:#64748b;margin-bottom:4px;">
                      <strong style="color:#475569;">${escapeHtml(m.sender_name ?? "Unknown")}</strong>
                      &nbsp;·&nbsp;${escapeHtml(relativeTime(m.created_at))}
                    </div>
                    <div style="font-size:13px;line-height:1.5;color:#475569;">
                      ${escapeHtml(m.body).replace(/\n/g, "<br>")}
                    </div>
                  </td>
                </tr>
                <tr><td style="height:8px;"></td></tr>`).join("")}
              </table>
            </td>
          </tr>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>New message from The Hub</title>
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

          ${recentBlock}
          <!-- CTA button -->
          <tr>
            <td style="padding:0 32px 36px;">
              <a href="${viewReplyUrl}"
                 style="display:inline-block;background:#123b52;color:#78f5cd;text-decoration:none;
                        font-size:14px;font-weight:600;padding:12px 24px;border-radius:8px;">
                View &amp; Reply →
              </a>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 32px;border-top:1px solid #e2e8f0;">
              <p style="margin:0;font-size:12px;color:#a0aec0;">
                You're receiving this because you're a client of ${brandName} on The Hub.
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
    const actorName: string = body.actor_name || "The Hub";
    const brandId: string = body.brand_id || "";
    const retailerId: string = body.retailer_id || "";
    const notifyRepForRetailerId: string = body.notify_rep_for_retailer_id || "";
    const messageId: string = body.message_id || "";

    // When the caller asks us to notify the rep assigned to a retailer,
    // resolve the email server-side (auth.users isn't reachable client-side).
    // We add to recipients rather than replace so a caller can combine both.
    // Keep the resolved rep email separately so we can record the send into
    // message_alerts_sent (lets the backfill skip messages already notified).
    let recipients: string[] = Array.isArray(body.recipients) ? [...body.recipients] : [];
    let resolvedRepEmail: string | null = null;
    if (notifyRepForRetailerId && brandId) {
      resolvedRepEmail = await resolveRepEmail(notifyRepForRetailerId, brandId);
      if (resolvedRepEmail && !recipients.includes(resolvedRepEmail)) recipients.push(resolvedRepEmail);
    }

    if (notifyRepForRetailerId && recipients.length === 0) {
      // Nothing to send (no rep found or rep opted out) — succeed silently.
      return NextResponse.json({ success: true, skipped: "no_rep_recipient" });
    }

    const replyUrl =
      brandId && retailerId
        ? `${APP_URL}/brands/${brandId}/retailers#retailer-${retailerId}`
        : APP_URL;

    // Fetch up to 3 recent client-visible messages for the brand+retailer so
    // the email shows conversation context. Uses the service-role client only
    // when both ids are present, since brand_retailer_messages RLS would
    // otherwise hide most threads. Failures degrade silently — context is a
    // nice-to-have, not blocking.
    let recentMessages: RecentMessage[] | undefined;
    if (brandId && retailerId) {
      const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (serviceKey) {
        try {
          const admin = createClient(supabaseUrl, serviceKey);
          const { data: rows } = await admin
            .from("brand_retailer_messages")
            .select("sender_name, body, created_at")
            .eq("brand_id", brandId)
            .eq("retailer_id", retailerId)
            .eq("visibility", "client")
            .order("created_at", { ascending: false })
            .limit(3);
          recentMessages = (rows ?? []) as RecentMessage[];
        } catch {
          recentMessages = undefined;
        }
      }
    }

    const htmlBody = buildEmailHtml({
      brandName,
      retailerName,
      messageBody,
      actorName,
      brandId,
      retailerId,
      recentMessages,
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
          recipients,
          html_body: htmlBody,
          reply_url: replyUrl,
          brand_id: brandId,
          retailer_id: retailerId,
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

    // Record the rep notification so the backfill can dedupe against it.
    // Fire-and-forget — table errors (incl. unique-violation if a constraint
    // exists) shouldn't fail the user-facing send.
    if (notifyRepForRetailerId && messageId && resolvedRepEmail) {
      const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (serviceKey) {
        const admin = createClient(supabaseUrl, serviceKey);
        admin
          .from("message_alerts_sent")
          .insert({
            message_id: messageId,
            alert_type: "rep_immediate",
            recipient_email: resolvedRepEmail,
          })
          .then(() => {}, () => {});
      }
    }

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
