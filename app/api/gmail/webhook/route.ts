import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Pub/Sub push payload shape:
    // {
    //   message: {
    //     data: "base64-encoded-json",
    //     messageId: "...",
    //     publishTime: "..."
    //   },
    //   subscription: "..."
    // }

    const encoded = body?.message?.data;
    if (!encoded) {
      return NextResponse.json({ error: "Missing Pub/Sub message data" }, { status: 400 });
    }

    const decoded = JSON.parse(
      Buffer.from(encoded, "base64").toString("utf8")
    );

    // Gmail push payload usually includes:
    // { emailAddress: "aaron@cultivatecpg.com", historyId: "12345" }

    console.log("GMAIL PUSH RECEIVED", {
      subscription: body?.subscription,
      messageId: body?.message?.messageId,
      decoded,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("gmail webhook error", error);
    return NextResponse.json({ error: "Webhook failed" }, { status: 500 });
  }
}
