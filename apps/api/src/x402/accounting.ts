import { type Database, eq, postEntry, x402Payments } from '@paybox/db';
import { AppError } from '../errors';
import { enqueue } from '../jobs';

// A persisted facilitator receipt can be booked repeatedly without another settlement.
export async function finalizeX402(db: Database, id: string) {
  await db.transaction(async (tx) => {
    const [payment] = await tx.select().from(x402Payments).where(eq(x402Payments.id, id)).for('update');
    if (!payment) throw new AppError('not_found', 404, 'Payment not found');
    if (payment.status === 'settled') return;
    if (!payment.receipt?.success || !payment.transactionHash)
      throw new AppError('settlement_failed', 422, 'No confirmed settlement receipt is available');
    await postEntry(tx, {
      currency: 'USDC',
      kind: 'x402_settlement',
      x402PaymentId: id,
      idempotencyRef: `x402:${id}:settled`,
      lines: [
        { code: 'usdc_clearing', type: 'asset', direction: 'debit', amount: payment.amount },
        {
          code: `usdc_merchant_payable:${payment.merchantId}`,
          type: 'liability',
          merchantId: payment.merchantId,
          direction: 'credit',
          amount: payment.amount,
        },
      ],
    });
    await tx
      .update(x402Payments)
      .set({ status: 'settled', settledAt: new Date(), lastError: null })
      .where(eq(x402Payments.id, id));
    await enqueue(
      tx,
      'notify_merchant',
      id,
      {
        event: 'x402.payment.settled',
        merchant_id: payment.merchantId,
        x402_payment_id: id,
        correlation_id: payment.correlationId,
      },
      `notify_merchant:${id}:x402.payment.settled`,
    );
  });
}
