import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function generateToken(length = 12) {
  const chars =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

export async function POST(req: Request) {
  try {
    const { repEmail, retailerId, brandId, activityTypeKey } = await req.json();

    if (!repEmail || !retailerId || !brandId || !activityTypeKey) {
      return Response.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    const { data: repProfile, error: repError } = await supabase
      .from("profiles")
      .select("id, email")
      .eq("email", repEmail)
      .maybeSingle();

    if (repError) {
      return Response.json({ error: repError.message }, { status: 500 });
    }

    if (!repProfile) {
      return Response.json(
        { error: `No profile found for ${repEmail}` },
        { status: 404 }
      );
    }

    const token = generateToken();

    const { error: tokenError } = await supabase.from("email_log_tokens").insert({
      token,
      rep_id: repProfile.id,
      retailer_id: retailerId,
      brand_id: brandId,
      activity_type_key: activityTypeKey,
    });

    if (tokenError) {
      return Response.json({ error: tokenError.message }, { status: 500 });
    }

    const { error: pendingError } = await supabase
      .from("gmail_pending_context")
      .insert({
        rep_id: repProfile.id,
        gmail_email: repEmail,
        retailer_id: retailerId,
        brand_id: brandId,
        activity_type_key: activityTypeKey,
      });

    if (pendingError) {
      return Response.json({ error: pendingError.message }, { status: 500 });
    }

    return Response.json({ ok: true, token });
  } catch (err: any) {
    return Response.json(
      { error: err.message || "Unknown error" },
      { status: 500 }
    );
  }
}