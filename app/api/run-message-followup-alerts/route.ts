import { createClient } from "@supabase/supabase-js";

type BrandRetailerMessage = {
  id: string;
  brand_id: string;
  retailer_id: string;
  visibility: string;
  sender_id: string;
  sender_name: string | null;
  body: string;
  created_at: string;
};

type ProfileRow = {
  id: string;
  full_name: string | null;
  role: string | null;
};

type RetailerRow = {
  id: string;
  name: string;
  banner: string | null;
  rep_owner_user_id: string | null;
};

type BrandRetailerTimingRow = {
  id: string;
  brand_id: string;
  retailer_id: string;
};

type AlertSentRow = {
  id: string;
  message_id: string;
  alert_type: string;
  recipient_email: string;
  sent_at: string;
};

export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return Response.json(
      { error: "Missing Supabase environment variables" },
      { status: 500 }
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const url = new URL(req.url);
  if (url.searchParams.get("backfill") === "true") {
    return runRepBackfill(supabase, supabaseUrl, serviceRoleKey);
  }

  const now = new Date();
  const hours24Ago = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const hours48Ago = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString();

  const { data: messages, error: messagesError } = await supabase
    .from("brand_retailer_messages")
    .select("id, brand_id, retailer_id, visibility, sender_id, sender_name, body, created_at")
    .eq("visibility", "client")
    .lte("created_at", hours24Ago)
    .order("created_at", { ascending: true });

  if (messagesError) {
    return Response.json({ error: messagesError.message }, { status: 500 });
  }

  const clientMessages = (messages ?? []) as BrandRetailerMessage[];
  if (clientMessages.length === 0) {
    return Response.json({
      success: true,
      checked: 0,
      rep_alerts_sent: 0,
      admin_alerts_sent: 0,
      tasks_created: 0,
    });
  }

  const senderIds = [...new Set(clientMessages.map((m) => m.sender_id).filter(Boolean))];

  const { data: senderProfiles, error: senderProfilesError } = await supabase
    .from("profiles")
    .select("id, full_name, role")
    .in("id", senderIds);

  if (senderProfilesError) {
    return Response.json({ error: senderProfilesError.message }, { status: 500 });
  }

  const senderProfilesById = new Map(
    ((senderProfiles ?? []) as ProfileRow[]).map((p) => [p.id, p])
  );

  const actualClientMessages = clientMessages.filter((m) => {
    const senderProfile = senderProfilesById.get(m.sender_id);
    return senderProfile?.role === "client";
  });

  if (actualClientMessages.length === 0) {
    return Response.json({
      success: true,
      checked: 0,
      rep_alerts_sent: 0,
      admin_alerts_sent: 0,
      tasks_created: 0,
    });
  }

  const brandIds = [...new Set(actualClientMessages.map((m) => m.brand_id))];
  const retailerIds = [...new Set(actualClientMessages.map((m) => m.retailer_id))];

  const [
    repliesResult,
    retailersResult,
    timingsResult,
    repProfilesResult,
    adminProfilesResult,
    alertsSentResult,
    brandsResult,
  ] = await Promise.all([
    supabase
      .from("brand_retailer_messages")
      .select("id, brand_id, retailer_id, visibility, sender_id, sender_name, body, created_at")
      .eq("visibility", "client")
      .in("brand_id", brandIds)
      .in("retailer_id", retailerIds)
      .order("created_at", { ascending: true }),

    supabase
      .from("retailers")
      .select("id, name, banner, rep_owner_user_id")
      .in("id", retailerIds),

    supabase
      .from("brand_retailer_timing")
      .select("id, brand_id, retailer_id")
      .in("brand_id", brandIds)
      .in("retailer_id", retailerIds),

    supabase
      .from("profiles")
      .select("id, full_name")
      .eq("role", "rep"),

    supabase
      .from("profiles")
      .select("id, full_name")
      .eq("role", "admin"),

    supabase
      .from("message_alerts_sent")
      .select("id, message_id, alert_type, recipient_email, sent_at"),

    supabase
      .from("brands")
      .select("id, name, message_notifications_enabled")
      .in("id", brandIds),
  ]);

  if (repliesResult.error) {
    return Response.json({ error: repliesResult.error.message }, { status: 500 });
  }
  if (retailersResult.error) {
    return Response.json({ error: retailersResult.error.message }, { status: 500 });
  }
  if (timingsResult.error) {
    return Response.json({ error: timingsResult.error.message }, { status: 500 });
  }
  if (repProfilesResult.error) {
    return Response.json({ error: repProfilesResult.error.message }, { status: 500 });
  }
  if (adminProfilesResult.error) {
    return Response.json({ error: adminProfilesResult.error.message }, { status: 500 });
  }
  if (alertsSentResult.error) {
    return Response.json({ error: alertsSentResult.error.message }, { status: 500 });
  }
  if (brandsResult.error) {
    return Response.json({ error: brandsResult.error.message }, { status: 500 });
  }

  const allThreadMessages = (repliesResult.data ?? []) as BrandRetailerMessage[];
  const retailers = (retailersResult.data ?? []) as RetailerRow[];
  const timings = (timingsResult.data ?? []) as BrandRetailerTimingRow[];
  const repProfiles = (repProfilesResult.data ?? []) as { id: string; full_name: string | null }[];
  const adminProfiles = (adminProfilesResult.data ?? []) as { id: string; full_name: string | null }[];
  const alertsSent = (alertsSentResult.data ?? []) as AlertSentRow[];
  const brands = (brandsResult.data ?? []) as {
    id: string;
    name: string;
    message_notifications_enabled: boolean;
  }[];

  const retailerById = new Map(retailers.map((r) => [r.id, r]));
  const brandById = new Map(brands.map((b) => [b.id, b]));
  const timingByBrandRetailer = new Map(
    timings.map((t) => [`${t.brand_id}:${t.retailer_id}`, t])
  );

  const repIds = retailers
    .map((r) => r.rep_owner_user_id)
    .filter((v): v is string => Boolean(v));

  const repUserIds = [...new Set(repIds)];
  const repUserProfilesById = new Map(repProfiles.map((p) => [p.id, p]));

  const repAuthUsersResult = repUserIds.length
    ? await supabase.auth.admin.listUsers()
    : { data: { users: [] }, error: null as { message: string } | null };

  if (repAuthUsersResult.error) {
    return Response.json({ error: repAuthUsersResult.error.message }, { status: 500 });
  }

  const authUsers = repAuthUsersResult.data.users ?? [];
  const emailByUserId = new Map(authUsers.map((u) => [u.id, u.email ?? ""]));

  const adminAuthResult = await supabase.auth.admin.listUsers();
  if (adminAuthResult.error) {
    return Response.json({ error: adminAuthResult.error.message }, { status: 500 });
  }

  const adminEmailByUserId = new Map(
    (adminAuthResult.data.users ?? []).map((u) => [u.id, u.email ?? ""])
  );

  const alertsSentKey = new Set(
    alertsSent.map((a) => `${a.message_id}:${a.alert_type}:${a.recipient_email}`)
  );

  let repAlertsSent = 0;
  let adminAlertsSent = 0;
  let tasksCreated = 0;
  let checked = 0;

  for (const message of actualClientMessages) {
    checked += 1;

    const messageCreatedAt = new Date(message.created_at);
    const hoursSince = (now.getTime() - messageCreatedAt.getTime()) / (1000 * 60 * 60);

    const threadMessages = allThreadMessages.filter(
      (m) =>
        m.brand_id === message.brand_id &&
        m.retailer_id === message.retailer_id &&
        new Date(m.created_at).getTime() > messageCreatedAt.getTime()
    );

    const hasStaffReply = threadMessages.some((m) => {
      const senderProfile = senderProfilesById.get(m.sender_id);
      return senderProfile?.role === "rep" || senderProfile?.role === "admin";
    });

    if (hasStaffReply) continue;

    const retailer = retailerById.get(message.retailer_id);
    const timing = timingByBrandRetailer.get(`${message.brand_id}:${message.retailer_id}`);
    const brand = brandById.get(message.brand_id);
    const brandName = brand?.name ?? "Brand";
    const retailerName = retailer?.banner?.trim() || retailer?.name || "Retailer";

    if (!brand?.message_notifications_enabled) {
      continue;
    }

    if (!retailer?.rep_owner_user_id || !timing?.id) {
      continue;
    }

    const repUserId = retailer.rep_owner_user_id;
    const repEmail = emailByUserId.get(repUserId);
    const repName = repUserProfilesById.get(repUserId)?.full_name ?? "Assigned Rep";

    if (hoursSince >= 24 && repEmail) {
      const repAlertKey = `${message.id}:24h_rep:${repEmail}`;

      if (!alertsSentKey.has(repAlertKey)) {
        const { error: insertTaskError } = await supabase.from("rep_tasks").insert({
          brand_retailer_timing_id: timing.id,
          assigned_to_user_id: repUserId,
          created_by_user_id: repUserId,
          title: "Client message needs response",
          details: `${brandName} • ${retailerName}\n\n${message.sender_name ?? "Client"} wrote:\n${message.body}`,
          task_type: "client_message_followup",
          priority: "high",
          status: "open",
          due_at: new Date(messageCreatedAt.getTime() + 24 * 60 * 60 * 1000).toISOString(),
          created_at: now.toISOString(),
          updated_at: now.toISOString(),
          is_client_visible: false,
        });

        if (!insertTaskError) {
          tasksCreated += 1;
        }

        await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/send-client-message-email`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
            Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
          },
          body: JSON.stringify({
            brand_name: brandName,
            retailer_name: retailerName,
            message_body: `Unanswered client message (24h)\n\n${message.sender_name ?? "Client"} wrote:\n${message.body}`,
            recipients: [repEmail],
            actor_name: "The Hub",
            event_type: "message_followup",
          }),
        }).catch(() => null);

        await supabase.from("message_alerts_sent").insert({
          message_id: message.id,
          alert_type: "24h_rep",
          recipient_email: repEmail,
        });

        alertsSentKey.add(repAlertKey);
        repAlertsSent += 1;
      }
    }

    if (hoursSince >= 48 && adminProfiles.length > 0) {
      for (const admin of adminProfiles) {
        const adminEmail = adminEmailByUserId.get(admin.id);
        if (!adminEmail) continue;

        const adminAlertKey = `${message.id}:48h_admin:${adminEmail}`;
        if (alertsSentKey.has(adminAlertKey)) continue;

        await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/send-client-message-email`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
            Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
          },
          body: JSON.stringify({
            brand_name: brandName,
            retailer_name: retailerName,
            message_body: `Still unanswered after 48h\n\nAssigned rep: ${repName}\n\n${message.sender_name ?? "Client"} wrote:\n${message.body}`,
            recipients: [adminEmail],
            actor_name: "The Hub",
            event_type: "message_followup",
          }),
        }).catch(() => null);

        await supabase.from("message_alerts_sent").insert({
          message_id: message.id,
          alert_type: "48h_admin",
          recipient_email: adminEmail,
        });

        alertsSentKey.add(adminAlertKey);
        adminAlertsSent += 1;
      }
    }
  }

  return Response.json({
    success: true,
    checked,
    rep_alerts_sent: repAlertsSent,
    admin_alerts_sent: adminAlertsSent,
    tasks_created: tasksCreated,
  });
}

// One-time backfill: notify reps about client (owner/viewer) messages from
// the last 3 days that haven't already had a rep notification recorded.
// Triggered via ?backfill=true. Dedupes against message_alerts_sent with
// alert_type='rep_immediate_backfill', so re-running this is a no-op.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function runRepBackfill(supabase: any, supabaseUrl: string, serviceRoleKey: string) {
  const since = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const ALERT_TYPE = "rep_immediate_backfill";

  // 1. brand_users with role owner/viewer — defines who counts as "a client"
  const { data: clientBu, error: buError } = await supabase
    .from("brand_users")
    .select("user_id")
    .in("role", ["owner", "viewer"]);
  if (buError) return Response.json({ error: buError.message }, { status: 500 });
  const clientUserIds = [...new Set(((clientBu ?? []) as { user_id: string }[]).map((r) => r.user_id).filter(Boolean))];
  if (clientUserIds.length === 0) {
    return Response.json({ success: true, checked: 0, notified: 0, skipped: 0 });
  }

  // 2. Client-visible messages in the window posted by those users
  const { data: messages, error: msgError } = await supabase
    .from("brand_retailer_messages")
    .select("id, brand_id, retailer_id, sender_id, sender_name, body, created_at")
    .eq("visibility", "client")
    .gte("created_at", since)
    .in("sender_id", clientUserIds)
    .order("created_at", { ascending: true });
  if (msgError) return Response.json({ error: msgError.message }, { status: 500 });
  const targetMessages = (messages ?? []) as BrandRetailerMessage[];
  if (targetMessages.length === 0) {
    return Response.json({ success: true, checked: 0, notified: 0, skipped: 0 });
  }

  const brandIds = [...new Set(targetMessages.map((m) => m.brand_id))];
  const retailerIds = [...new Set(targetMessages.map((m) => m.retailer_id))];

  // 3. Batched lookups — brands, retailers, dedupe rows, rep emails, rep opt-outs
  const [brandsRes, retailersRes, alertsRes, usersRes] = await Promise.all([
    supabase.from("brands").select("id, name, message_notifications_enabled").in("id", brandIds),
    supabase.from("retailers").select("id, name, banner, rep_owner_user_id").in("id", retailerIds),
    supabase.from("message_alerts_sent").select("message_id, alert_type, recipient_email").eq("alert_type", ALERT_TYPE),
    supabase.auth.admin.listUsers(),
  ]);
  if (brandsRes.error) return Response.json({ error: brandsRes.error.message }, { status: 500 });
  if (retailersRes.error) return Response.json({ error: retailersRes.error.message }, { status: 500 });
  if (alertsRes.error) return Response.json({ error: alertsRes.error.message }, { status: 500 });
  if (usersRes.error) return Response.json({ error: usersRes.error.message }, { status: 500 });

  const brandById = new Map(
    ((brandsRes.data ?? []) as { id: string; name: string; message_notifications_enabled: boolean }[])
      .map((b) => [b.id, b])
  );
  const retailerById = new Map(
    ((retailersRes.data ?? []) as RetailerRow[]).map((r) => [r.id, r])
  );
  const alertKey = new Set(
    ((alertsRes.data ?? []) as { message_id: string; alert_type: string; recipient_email: string }[])
      .map((a) => `${a.message_id}:${a.alert_type}:${a.recipient_email}`)
  );
  const emailByUserId = new Map(
    (usersRes.data.users ?? []).map((u: { id: string; email: string | null }) => [u.id, u.email ?? ""])
  );

  // Per-rep opt-out by (brand_id, user_id) — fetched only for the rep ids we'll actually try.
  const repIds = [...new Set(
    retailerIds
      .map((id) => retailerById.get(id)?.rep_owner_user_id ?? null)
      .filter((v): v is string => Boolean(v))
  )];
  const optOutKey = new Set<string>();
  if (repIds.length > 0) {
    const { data: optOuts, error: optErr } = await supabase
      .from("brand_users")
      .select("brand_id, user_id, email_notifications_enabled")
      .in("brand_id", brandIds)
      .in("user_id", repIds)
      .eq("email_notifications_enabled", false);
    if (optErr) return Response.json({ error: optErr.message }, { status: 500 });
    ((optOuts ?? []) as { brand_id: string; user_id: string }[]).forEach((r) => {
      optOutKey.add(`${r.brand_id}:${r.user_id}`);
    });
  }

  let notified = 0;
  let skipped = 0;
  const reasons: Record<string, number> = {};
  const bump = (k: string) => { reasons[k] = (reasons[k] ?? 0) + 1; };

  for (const message of targetMessages) {
    const brand = brandById.get(message.brand_id);
    const retailer = retailerById.get(message.retailer_id);

    if (!brand?.message_notifications_enabled) { skipped++; bump("brand_notifications_off"); continue; }
    if (!retailer?.rep_owner_user_id) { skipped++; bump("no_rep_owner"); continue; }

    const repUserId = retailer.rep_owner_user_id;
    if (optOutKey.has(`${message.brand_id}:${repUserId}`)) { skipped++; bump("rep_opted_out"); continue; }

    const repEmail = emailByUserId.get(repUserId);
    if (!repEmail) { skipped++; bump("no_rep_email"); continue; }

    if (alertKey.has(`${message.id}:${ALERT_TYPE}:${repEmail}`)) { skipped++; bump("already_sent"); continue; }

    const retailerName = retailer.banner?.trim() || retailer.name || "Retailer";

    const sendRes = await fetch(
      `${supabaseUrl}/functions/v1/send-client-message-email`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
        },
        body: JSON.stringify({
          brand_name: brand.name,
          retailer_name: retailerName,
          message_body: message.body,
          subject: `New message from ${brand.name} on ${retailerName}`,
          recipients: [repEmail],
          actor_name: message.sender_name ?? "Client",
          event_type: "message",
          brand_id: message.brand_id,
          retailer_id: message.retailer_id,
        }),
      }
    ).catch(() => null);

    if (!sendRes || !sendRes.ok) { skipped++; bump("send_failed"); continue; }

    await supabase.from("message_alerts_sent").insert({
      message_id: message.id,
      alert_type: ALERT_TYPE,
      recipient_email: repEmail,
    });
    alertKey.add(`${message.id}:${ALERT_TYPE}:${repEmail}`);
    notified++;
  }

  return Response.json({
    success: true,
    mode: "backfill",
    window: "3d",
    checked: targetMessages.length,
    notified,
    skipped,
    skip_reasons: reasons,
  });
}