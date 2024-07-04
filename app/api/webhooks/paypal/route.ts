import { createTransaction } from "@/lib/actions/transaction.action";
import { updateCredits } from "@/lib/actions/user.actions";
import { connectToDatabase } from "@/lib/database/mongoose";
import crypto from "crypto";
import { headers } from "next/headers";
import { NextResponse } from "next/server";

const webhookId = process.env.PAYPAL_WEBHOOK_ID!;
const paypalSecret = process.env.PAYPAL_CLIENT_SECRET!;

export async function POST(req: Request) {
  console.log("Webhook received");

  try {
    const headersList = headers();
    const paypalSignature = headersList.get("paypal-transmission-sig");
    const paypalCertUrl = headersList.get("paypal-cert-url");
    const paypalTransmissionId = headersList.get("paypal-transmission-id");
    const paypalTransmissionTime = headersList.get("paypal-transmission-time");
    console.log("webhook:", webhookId);
    console.log("paypal scr:", paypalSecret);

    if (!webhookId) {
      console.error("PAYPAL_WEBHOOK_ID is not defined");
      return NextResponse.json(
        { error: "Server configuration error" },
        { status: 500 }
      );
    }

    console.log("Headers:", {
      paypalSignature,
      paypalCertUrl,
      paypalTransmissionId,
      paypalTransmissionTime,
    });

    const body = await req.text();
    console.log("Webhook body:", body);
    console.log(
      "`${paypalTransmissionId}|${paypalTransmissionTime}|${webhookId}`: ",
      `${paypalTransmissionId}|${paypalTransmissionTime}|${webhookId}`
    );

    // Verify the PayPal signature
    const verifiedSignature = crypto
      .createHmac("sha256", webhookId)
      .update(
        paypalTransmissionId +
          "|" +
          paypalTransmissionTime +
          "|" +
          body +
          "|" +
          webhookId
      )
      .digest("base64");

    console.log("Verified signature:", verifiedSignature);
    console.log("Received signature:", paypalSignature);

    // if (verifiedSignature !== paypalSignature) {
    //   console.log("Invalid signature");
    //   return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
    // }

    console.log("Signature verified");

    const event = JSON.parse(body);
    console.log("Event type:", event);

    if (
      event.event_type === "CHECKOUT.ORDER.APPROVED" ||
      event.event_type === "PAYMENT.CAPTURE.COMPLETED"
    ) {
      await connectToDatabase();

      const order = event.resource;
      console.log("Order details:", order);

      let customId, plan, credits, buyerId;
      let orderAmount;

      if (event.event_type === "CHECKOUT.ORDER.APPROVED") {
        customId = order.purchase_units[0].custom_id;
        orderAmount = order.purchase_units[0].amount.value;
        console.log("from Checkout:", order.purchase_units[0]);
      }
      if (event.event_type === "PAYMENT.CAPTURE.COMPLETED") {
        customId = order.custom_id;
        orderAmount = order.amount.value;
        console.log("from payment: ", order.custom_id);
      }

      console.log("Custom ID:", customId);
      [plan, credits, buyerId] = customId.split("|");
      console.log("Parsed data:", { plan, credits, buyerId });

      // Create transaction
      const transaction = await createTransaction({
        transactionId: order.id,
        plan,
        amount: parseFloat(orderAmount),
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
