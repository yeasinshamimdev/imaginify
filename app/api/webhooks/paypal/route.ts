import { createTransaction } from "@/lib/actions/transaction.action";
import { updateCredits } from "@/lib/actions/user.actions";
import { connectToDatabase } from "@/lib/database/mongoose";
import crypto from "crypto";
import { NextResponse } from "next/server";

const webhookId = process.env.PAYPAL_WEBHOOK_ID!;
const paypalSecret = process.env.PAYPAL_CLIENT_SECRET!;

const verifyPaypalSignature = (headers: any, body: any) => {
  const paypalTransmissionId = headers["paypal-transmission-id"];
  const paypalTransmissionTime = headers["paypal-transmission-time"];
  const paypalCertUrl = headers["paypal-cert-url"];
  const paypalAuthAlgo = headers["paypal-auth-algo"];
  const paypalSignature = headers["paypal-transmission-sig"];

  // Construct the string to sign
  const expectedSignature = crypto
    .createHmac("sha256", paypalSecret)
    .update(
      `${paypalTransmissionId}|${paypalTransmissionTime}|${webhookId}|${body}`
    )
    .digest("base64");

  console.log("Verified signature:", expectedSignature);
  console.log("Received signature:", paypalSignature);

  return expectedSignature === paypalSignature;
};

export async function POST(req: Request) {
  try {
    // Extract headers
    const headers = Object.fromEntries(req.headers.entries());
    console.log("All Headers:", headers);

    // Get the raw body
    const rawBody = await req.text(); // Important to capture raw body as text

    // Verify the webhook signature
    const isVerified = verifyPaypalSignature(headers, rawBody);

    if (!isVerified) {
      return new Response("Invalid signature", { status: 400 });
    }

    console.log("Signature verified");

    const event = JSON.parse(rawBody);
    console.log("Event type:", event);

    if (
      event.event_type === "CHECKOUT.ORDER.APPROVED" ||
      event.event_type === "PAYMENT.CAPTURE.COMPLETED"
    ) {
      await connectToDatabase();

      const order = event.resource;
      console.log("Order details:", order);

      let customId, plan, credits, buyerId;

      if (event.event_type === "CHECKOUT.ORDER.APPROVED") {
        customId = order.purchase_units[0].custom_id;
      } else if (event.event_type === "PAYMENT.CAPTURE.COMPLETED") {
        customId = order.custom_id;
      }

      console.log("Custom ID:", customId);
      [plan, credits, buyerId] = customId.split("|");
      console.log("Parsed data:", { plan, credits, buyerId });

      // Create transaction
      const transaction = await createTransaction({
        transactionId: order.id,
        plan,
        amount: parseFloat(order.amount.value),
        credits: parseInt(credits),
        buyerId,
      });
      console.log("Transaction created:", transaction);

      // Update user credits
      const updatedUser = await updateCredits(buyerId, parseInt(credits));
      console.log("Credits updated:", updatedUser);

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
    if (error instanceof Error) {
      console.error("Error message:", error.message);
      console.error("Error stack:", error.stack);
    }
    return NextResponse.json(
      {
        error: "Internal server error",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
