import { google } from "googleapis";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: Request) {
  try {
    const { gmailEmail } = await req.json();

    if (!gmailEmail) {
      return Response.json({ error: "Missing gmailEmail" }, { status: 400 });
    }

    const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const privateKey = process.env.GOOGLE_PRIVATE_KEY;
    const projectId = process.env.GOOGLE_CLOUD_PROJECT_ID;
    const topic = process.env.GMAIL_PUBSUB_TOPIC || "gmail-updates";

    if (!clientEmail || !privateKey || !projectId) {
      return Response.json(
        { ok: false, error: "Missing Google env vars" },
        { status: 500 }
      );
    }

    const { data: repProfile, error: repError } = await supabase
      .from("profiles")
      .select("id, email")
      .eq("email", gmailEmail)
      .maybeSingle();

    if (repError) {
      return Response.json({ ok: false, error: repError.message }, { status: 500 });
    }

    if (!repProfile) {
      return Response.json(
        { ok: false, error: `No profile found for ${gmailEmail}` },
        { status: 404 }
      );
    }

    const auth = new google.auth.JWT({
      email: clientEmail,
      key: privateKey,
      scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
      subject: gmailEmail,
    });

    const gmail = google.gmail({ version: "v1", auth });

    const topicName = `projects/${projectId}/topics/${topic}`;

    const res = await gmail.users.watch({
      userId: "me",
      requestBody: {
        topicName,
        labelIds: ["SENT"],
        labelFilterAction: "include",
      },
    });

    const historyId = String(res.data.historyId || "");
    const expiration = res.data.expiration
      ? new Date(Number(res.data.expiration)).toISOString()
      : null;

    if (!historyId) {
      return Response.json(
        { ok: false, error: "Missing historyId from Gmail watch response" },
        { status: 500 }
      );
    }

    const { error: upsertError } = await supabase
      .from("gmail_mailbox_watches")
      .upsert(
        {
          rep_id: repProfile.id,
          gmail_email: gmailEmail,
          gmail_history_id: historyId,
          watch_expiration: expiration,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "gmail_email" }
      );

    if (upsertError) {
      return Response.json(
        { ok: false, error: upsertError.message },
        { status: 500 }
      );
    }

    return Response.json({
      ok: true,
      gmailEmail,
      historyId,
      expiration,
      topicName,
    });
  } catch (err: any) {
    console.error("gmail watch error", err);

    return Response.json(
      {
        ok: false,
        error: err.message || "Unknown error",
      },
      { status: 500 }
    );
  }
}