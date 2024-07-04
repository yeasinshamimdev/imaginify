import { createTransaction } from "@/lib/actions/transaction.action";
import { updateCredits } from "@/lib/actions/user.actions";
import { connectToDatabase } from "@/lib/database/mongoose";
import crypto from "crypto";
import https from "https";
import { headers } from "next/headers";
import { NextResponse } from "next/server";

const webhookId = process.env.PAYPAL_WEBHOOK_ID!;

async function verifyPayPalSignature(
  transmissionId: string,
  transmissionTime: string,
  webhookId: string,
  eventBody: string,
  actualSignature: string,
  certUrl: string
): Promise<boolean> {
  const verificationString = `${transmissionId}|${transmissionTime}|${webhookId}|${crypto
    .createHash("sha256")
    .update(eventBody)
    .digest("hex")}`;

  return new Promise((resolve, reject) => {
    https
      .get(certUrl, (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          const verify = crypto.createVerify("sha256");
          verify.update(verificationString);
          const isVerified = verify.verify(data, actualSignature, "base64");
          resolve(isVerified);
        });
      })
      .on("error", reject);
  });
}

export async function POST(req: Request) {
  console.log("PayPal webhook received");
  try {
    const headersList = headers();
    const paypalSignature = headersList.get("paypal-transmission-sig");
    const paypalCertUrl = headersList.get("paypal-cert-url");
    const paypalTransmissionId = headersList.get("paypal-transmission-id");
    const paypalTransmissionTime = headersList.get("paypal-transmission-time");

    if (
      !paypalSignature ||
      !paypalCertUrl ||
      !paypalTransmissionId ||
      !paypalTransmissionTime
    ) {
      console.error("Missing required PayPal headers");
      return NextResponse.json(
        { error: "Missing required headers" },
        { status: 400 }
      );
    }

    const body = await req.text();
    console.log("Webhook body:", body);

    const isVerified = await verifyPayPalSignature(
      paypalTransmissionId,
      paypalTransmissionTime,
      webhookId,
      body,
      paypalSignature,
      paypalCertUrl
    );

    if (!isVerified) {
      console.error("Invalid signature");
      return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
    }

    console.log("Signature verified");

    const event = JSON.parse(body);
    console.log("Event type:", event.event_type);

    if (event.event_type === "CHECKOUT.ORDER.APPROVED") {
      await connectToDatabase();

      const order = event.resource;
      console.log("Order details:", order);

      const customId = order.purchase_units[0].custom_id;
      console.log("Custom ID:", customId);
      const [plan, credits, buyerId] = customId.split("|");
      console.log("Parsed data:", { plan, credits, buyerId });

      // Create transaction
      const transaction = await createTransaction({
        transactionId: order.id,
        plan,
        amount: parseFloat(order.purchase_units[0].amount.value),
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
