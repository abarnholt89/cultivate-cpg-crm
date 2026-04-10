import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

async function getRepByEmail(gmailEmail: string) {
  const email = normalizeEmail(gmailEmail);

  const { data: repUpload, error: repUploadError } = await supabase
    .from("rep_user_uploads")
    .select("id, rep_email, rep_full_name")
    .eq("rep_email", email)
    .maybeSingle();

  if (repUploadError) {
    throw new Error(`rep_user_uploads lookup failed: ${repUploadError.message}`);
  }

  if (repUpload) {
    return {
      id: repUpload.id,
      email: repUpload.rep_email,
      fullName: repUpload.rep_full_name,
    };
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, email, full_name")
    .eq("email", email)
    .maybeSingle();

  if (profileError) {
    throw new Error(`profiles lookup failed: ${profileError.message}`);
  }

  if (profile) {
    return {
      id: profile.id,
      email: profile.email,
      fullName: profile.full_name,
    };
  }

  throw new Error(`No rep found for ${email} in rep_user_uploads or profiles`);
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const repEmail = normalizeEmail(body.repEmail || "");
    const retailerId = body.retailerId;
    const brandId = body.brandId;
    const activityTypeKey = body.activityTypeKey;

    if (!repEmail || !retailerId || !brandId || !activityTypeKey) {
      return Response.json(
        { ok: false, error: "Missing required fields" },
        { status: 400 }
      );
    }

    const rep = await getRepByEmail(repEmail);
    const token = crypto.randomUUID();

    const { error: tokenError } = await supabase
      .from("email_log_tokens")
      .insert({
        token,
        rep_id: rep.id,
        retailer_id: retailerId,
        brand_id: brandId,
        activity_type_key: activityTypeKey,
        status: "pending",
        created_at: new Date().toISOString(),
      });

    if (tokenError) {
      return Response.json(
        { ok: false, error: tokenError.message },
        { status: 500 }
      );
    }

    return Response.json({
      ok: true,
      token,
      repId: rep.id,
      repEmail: rep.email,
    });
  } catch (err: any) {
    console.error("email-log-tokens error", err);

    return Response.json(
      {
        ok: false,
        error: err.message || "Unknown error",
      },
      { status: 500 }
    );
  }
}