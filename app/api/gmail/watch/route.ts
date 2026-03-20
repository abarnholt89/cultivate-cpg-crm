import { google } from "googleapis";

export async function POST(req: Request) {
  try {
    const { gmailEmail } = await req.json();

    if (!gmailEmail) {
      return Response.json({ error: "Missing gmailEmail" }, { status: 400 });
    }

    const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL!;
    const privateKey = process.env.GOOGLE_PRIVATE_KEY!.replace(/\\n/g, "\n");
    const projectId = process.env.GOOGLE_CLOUD_PROJECT_ID!;

    const auth = new google.auth.JWT({
      email: clientEmail,
      key: privateKey,
      scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
      subject: gmailEmail,
    });

    const gmail = google.gmail({ version: "v1", auth });

    const topicName = `projects/${projectId}/topics/gmail-updates`;

    const res = await gmail.users.watch({
      userId: "me",
      requestBody: {
        topicName,
      },
    });

    return Response.json({
      ok: true,
      gmailEmail,
      historyId: res.data.historyId,
      expiration: res.data.expiration,
      topicName,
    });
  } catch (err: any) {
    console.error("gmail watch error", err);

    return Response.json(
      {
        ok: false,
        error: err.message,
      },
      { status: 500 }
    );
  }
}