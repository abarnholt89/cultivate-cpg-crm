import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: watches, error } = await supabase
    .from("gmail_mailbox_watches")
    .select("gmail_email");

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL!;
  const results: { email: string; ok: boolean; error?: string }[] = [];

  for (const watch of watches || []) {
    try {
      const res = await fetch(`${baseUrl}/api/gmail/watch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gmailEmail: watch.gmail_email }),
      });

      const json = await res.json();
      results.push({ email: watch.gmail_email, ok: json.ok === true, error: json.error });
    } catch (err: any) {
      results.push({ email: watch.gmail_email, ok: false, error: err.message });
    }
  }

  console.log("[renew-gmail-watch] results:", JSON.stringify(results));

  return Response.json({ renewed: results });
}
