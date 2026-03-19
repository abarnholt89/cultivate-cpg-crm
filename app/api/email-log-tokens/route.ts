import { NextResponse } from "next/server";
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
    const body = await req.json();
    const { repEmail, retailerId, brandId, activityTypeKey } = body;

    if (!repEmail || !retailerId || !brandId || !activityTypeKey) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    const { data: repProfile, error: repLookupError } = await supabase
      .from("profiles")
      .select("id, email")
      .eq("email", repEmail)
      .maybeSingle();

    if (repLookupError) {
      return NextResponse.json(
        { error: repLookupError.message },
        { status: 500 }
      );
    }

    if (!repProfile) {
      return NextResponse.json(
        { error: `No profile found for ${repEmail}` },
        { status: 404 }
      );
    }

    const token = generateToken();

    const { error: insertError } = await supabase.from("email_log_tokens").insert({
      token,
      rep_id: repProfile.id,
      retailer_id: retailerId,
      brand_id: brandId,
      activity_type_key: activityTypeKey,
    });

    if (insertError) {
      return NextResponse.json(
        { error: insertError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ token });
  } catch (err) {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }
}