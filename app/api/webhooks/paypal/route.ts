import { createTransaction } from "@/lib/actions/transaction.action";
import { updateCredits } from "@/lib/actions/user.actions";
import { connectToDatabase } from "@/lib/database/mongoose";
import crypto from "crypto";
import { headers } from "next/headers";
import { NextResponse } from "next/server";

const webhookId = process.env.NEXT_PUBLIC_PAYPAL_WEBHOOK_ID!;

export async function POST(req: Request) {
  try {
    console.log("PayPal webhook received");
    const headersList = headers();
    const paypalSignature = headersList.get("paypal-transmission-sig");
    const paypalCertUrl = headersList.get("paypal-cert-url");
    const paypalTransmissionId = headersList.get("paypal-transmission-id");
    const paypalTransmissionTime = headersList.get("paypal-transmission-time");

    const body = await req.text();
    console.log("Webhook body:", body);

    // Verify the PayPal signature
    const verifiedSignature = crypto
      .createHmac("sha256", webhookId)
      .update(
        `${paypalTransmissionId}|${paypalTransmissionTime}|${webhookId}|${body}`
      )
      .digest("base64");

    if (verifiedSignature !== paypalSignature) {
      console.log("Invalid signature");
      return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
    }

    console.log("Signature verified");

    const event = JSON.parse(body);
    console.log("Event type:", event.event_type);

    if (
      event.event_type === "PAYMENT.SALE.COMPLETED" ||
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
        // Assuming you stored the custom_id in the custom field
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
      try {
        const updatedUser = await updateCredits(buyerId, parseInt(credits));
        console.log("Credits updated:", updatedUser);
      } catch (error) {
        console.error("Error updating credits:", error);
      }

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
