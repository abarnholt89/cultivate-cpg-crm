import { supabase } from "@/lib/supabaseClient";

export async function sendEmailNotification({
  brand_name,
  retailer_name,
  message_body,
  recipients,
  event_type = "message",
  actor_name,
}: {
  brand_name: string;
  retailer_name: string;
  message_body?: string;
  recipients: string[];
  event_type?: string;
  actor_name?: string;
}) {
  const { data, error } = await supabase.functions.invoke(
    "send-client-message-email",
    {
      body: {
        brand_name,
        retailer_name,
        message_body,
        recipients,
        event_type,
        actor_name,
      },
    }
  );

  if (error) {
    throw new Error(error.message || "Failed to send email notification");
  }

  return data;
}