import { createTransaction } from "@/lib/actions/transaction.action";
import { updateCredits } from "@/lib/actions/user.actions";
import { connectToDatabase } from "@/lib/database/mongoose";
import crypto from "crypto";
import { headers } from "next/headers";
import { NextResponse } from "next/server";

const webhookId = process.env.NEXT_PUBLIC_PAYPAL_WEBHOOK_ID!;

export async function POST(req: Request) {
  try {
    const headersList = headers();
    const paypalSignature = headersList.get("paypal-transmission-sig");
    const paypalCertUrl = headersList.get("paypal-cert-url");
    const paypalTransmissionId = headersList.get("paypal-transmission-id");
    const paypalTransmissionTime = headersList.get("paypal-transmission-time");

    const body = await req.text();

    // Verify the PayPal signature
    const verifiedSignature = crypto
      .createHmac("sha256", webhookId)
      .update(
        `${paypalTransmissionId}|${paypalTransmissionTime}|${webhookId}|${body}`
      )
      .digest("base64");

    if (verifiedSignature !== paypalSignature) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
    }

    const event = JSON.parse(body);

    if (event.event_type === "CHECKOUT.ORDER.APPROVED") {
      await connectToDatabase();

      const order = event.resource;
      const customId = order.purchase_units[0].custom_id;
      const [plan, credits, buyerId] = customId.split("|");

      // Create transaction
      await createTransaction({
        transactionId: order.id,
        plan,
        amount: parseFloat(order.purchase_units[0].amount.value),
        credits: parseInt(credits),
        buyerId,
      });

      // Update user credits
      await updateCredits(buyerId, parseInt(credits));

      return NextResponse.json(
        { message: "Webhook processed successfully" },
        { status: 200 }
      );
    }

    return NextResponse.json(
      { message: "Unhandled event type" },
      { status: 200 }
    );
  } catch (error) {
    console.error("PayPal webhook error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
