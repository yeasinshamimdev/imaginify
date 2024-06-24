"use server";

import { redirect } from 'next/navigation';
import { handleError } from '../utils';
import { connectToDatabase } from '../database/mongoose';
import Transaction from '../database/models/transaction.model';
import { updateCredits } from './user.actions';

interface CheckoutTransactionParams {
  plan: string;
  amount: number;
  credits: number;
  buyerId: string;
  promoCode?: string;
}

interface CreateTransactionParams extends CheckoutTransactionParams {
  transactionId: string;
}

export async function checkoutCredits(transaction: CheckoutTransactionParams) {
  // Placeholder for the actual PayPal transaction logic
  const successUrl = `${process.env.NEXT_PUBLIC_SERVER_URL}/profile`;
  const cancelUrl = `${process.env.NEXT_PUBLIC_SERVER_URL}/`;

  // Simulate a successful PayPal transaction by redirecting to the success URL
  redirect(successUrl);
}

export async function createTransaction(transaction: CreateTransactionParams) {
  try {
    await connectToDatabase();

    // Create a new transaction with a buyerId and promoCode
    const newTransaction = await Transaction.create({
      ...transaction, buyer: transaction.buyerId
    });

    await updateCredits(transaction.buyerId, transaction.credits);

    return JSON.parse(JSON.stringify(newTransaction));
  } catch (error) {
    handleError(error);
  }
}
