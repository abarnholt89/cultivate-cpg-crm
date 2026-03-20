import { google } from "googleapis";

export async function POST(req: Request) {
  try {
    const body = await req.json();

    console.log("📩 PubSub message received:", body);

    const message = body?.message;

    if (!message?.data) {
      return new Response("No data", { status: 200 });
    }

    const decoded = JSON.parse(
      Buffer.from(message.data, "base64").toString("utf-8")
    );

    console.log("📬 Decoded Gmail event:", decoded);

    const { emailAddress, historyId } = decoded;

    // 🔑 ENV
    const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL!;
    const privateKey = process.env.GOOGLE_PRIVATE_KEY!;
    
    const auth = new google.auth.JWT({
      email: clientEmail,
      key: privateKey,
      scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
      subject: emailAddress,
    });

    const gmail = google.gmail({ version: "v1", auth });

    // 🔎 Fetch history (what actually changed)
    const history = await gmail.users.history.list({
      userId: "me",
      startHistoryId: historyId,
    });

    console.log("📚 Gmail history:", history.data);

    return new Response("OK", { status: 200 });

  } catch (err: any) {
    console.error("❌ webhook error", err);
    return new Response("Error", { status: 500 });
  }
}