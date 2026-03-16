import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TEMP_PASSWORD = process.env.TEMP_PASSWORD || "TempPass123!";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  const { data: uploads, error: uploadError } = await supabase
    .from("user_uploads")
    .select("email, full_name, role, brand_name");

  if (uploadError) {
    console.error("Failed to read user_uploads:", uploadError.message);
    process.exit(1);
  }

  if (!uploads || uploads.length === 0) {
    console.log("No rows found in user_uploads.");
    process.exit(0);
  }

  for (const row of uploads) {
    const email = row.email?.trim().toLowerCase();
    const fullName = row.full_name?.trim() || null;
    const role = row.role?.trim().toLowerCase() || "client";

    if (!email) {
      console.log("Skipping row with no email.");
      continue;
    }

    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password: TEMP_PASSWORD,
      email_confirm: true,
      user_metadata: {
        full_name: fullName,
        role,
      },
    });

    if (error) {
      if (
        error.message.toLowerCase().includes("already been registered") ||
        error.message.toLowerCase().includes("user already registered")
      ) {
        console.log(`Already exists: ${email}`);
        continue;
      }

      console.log(`Failed: ${email} -> ${error.message}`);
      continue;
    }

    console.log(`Created: ${email} (${data.user?.id})`);
  }

  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});