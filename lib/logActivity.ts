import { supabase } from "@/lib/supabaseClient";

export async function logActivity({
  userId,
  brandId,
  retailerId,
  type,
  description,
}: {
  userId: string | null;
  brandId?: string | null;
  retailerId?: string | null;
  type: string;
  description: string;
}) {
  if (!userId) return;

  const { error } = await supabase.from("activities").insert({
    user_id: userId,
    brand_id: brandId ?? null,
    retailer_id: retailerId ?? null,
    type,
    description,
  });

  if (error) {
    console.error("Activity logging failed:", error.message);
    throw new Error(error.message);
  }
}