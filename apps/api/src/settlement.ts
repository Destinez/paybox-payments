import {
  and,
  clearing,
  type Database,
  eq,
  idempotencyKeys,
  newId,
  outboxJobs,
  payable,
  paymentEvents,
  payments,
  postEntry,
  sql,
  type Transaction,
  webhookEvents,
} from '@paybox/db';
import { transitionPayment } from '@paybox/shared';
import { AppError } from './errors';
import { enqueue, type JobHandler } from './jobs';
import type { PaystackClient, VerifiedTransaction } from './provider/client';
import { parseProviderJson } from './provider/http';
import { Refunds } from './refunds';
import { webhookPayload } from './webhooks';

export async function applyVerification(
  tx: Transaction,
  payment: typeof payments.$inferSelect,
  remote: VerifiedTransaction,
  source = 'worker',
) {
  if (remote.reference !== payment.reference || remote.amount !== payment.amount || remote.currency !== 'NGN')
    throw new AppError(
      'amount_mismatch',
      422,
      'Processor amount, currency or reference does not match the payment',
    );
  if (['succeeded', 'partially_refunded', 'refunded'].includes(payment.status)) return payment;
  const event =
    remote.status === 'success'
      ? 'verified_success'
      : remote.status === 'failed'
        ? 'verified_failed'
        : remote.status === 'abandoned'
          ? 'verified_abandoned'
          : null;
  if (!event) return payment;
  const next = transitionPayment(payment.status, event);
  if (next instanceof Error) {
    console.info(
      JSON.stringify({
        msg: 'Illegal payment transition ignored',
        payment_id: payment.id,
        correlation_id: payment.correlationId,
        from: payment.status,
        event,
      }),
    );
    return payment;
  }
  const [updated] = await tx
    .update(payments)
    .set({
      status: next,
      version: payment.version + 1,
      paystackId: remote.id,
      fees: remote.fees,
      channel: remote.channel,
      paidAt: remote.paid_at ? new Date(remote.paid_at) : null,
    })
    .where(
      and(
        eq(payments.id, payment.id),
        eq(payments.status, payment.status),
        eq(payments.version, payment.version),
      ),
    )
    .returning();
  if (!updated) throw new AppError('invalid_state', 409, 'Payment changed during verification');
  if (next === 'succeeded') {
    await postEntry(tx, {
      kind: 'capture',
      paymentId: payment.id,
      idempotencyRef: `pay:${payment.id}:captured`,
      lines: [clearing('debit', payment.amount), payable(payment.merchantId, 'credit', payment.amount)],
    });
    if (remote.fees > 0)
      await postEntry(tx, {
        kind: 'fee',
        paymentId: payment.id,
        idempotencyRef: `pay:${payment.id}:fee`,
        lines: [payable(payment.merchantId, 'debit', remote.fees), clearing('credit', remote.fees)],
      });
  }
  await tx.insert(paymentEvents).values({
    paymentId: payment.id,
    type: next,
    fromStatus: payment.status,
    toStatus: next,
    source,
    correlationId: payment.correlationId,
    detail: { provider_status: remote.status, fees: remote.fees },
  });
  if (['succeeded', 'failed'].includes(next))
    await enqueue(
      tx,
      'notify_merchant',
      payment.id,
      {
        event: `payment.${next}`,
        merchant_id: payment.merchantId,
        payment_id: payment.id,
        correlation_id: payment.correlationId,
      },
      `notify_merchant:${payment.id}:payment.${next}`,
    );
  return updated;
}
export async function verifyPayment(db: Database, client: PaystackClient, id: string, source = 'worker') {
  const [payment] = await db.select().from(payments).where(eq(payments.id, id));
  if (!payment) throw new AppError('not_found', 404, 'Payment not found');
  const remote = await client.verify(payment.reference);
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(payments).where(eq(payments.id, id)).for('update');
    return applyVerification(tx, current!, remote, source);
  });
}
export function settlementHandlers(db: Database, client: PaystackClient): Record<string, JobHandler> {
  const refundService = new Refunds(db, client);
  return {
    create_refund: async (job) => {
      await refundService.process(String(job.payload.refund_id));
    },
    purge_idempotency_keys: async () => {
      await db
        .delete(idempotencyKeys)
        .where(sql`${idempotencyKeys.expiresAt}<now() AND ${idempotencyKeys.lockedUntil}<now()`);
    },
    process_webhook_event: async (job) => {
      const [event] = await db
        .select()
        .from(webhookEvents)
        .where(eq(webhookEvents.id, String(job.payload.event_id)));
      if (!event || event.status === 'processed' || event.status === 'ignored') return;
      const payload = webhookPayload.parse(parseProviderJson(event.rawBody.toString()));
      if (!event.paymentId)
        throw new AppError(
          'unknown_remote',
          422,
          'Webhook references a transaction that does not exist locally',
        );
      if (payload.event !== 'charge.success') {
        if (!event.refundId)
          throw new AppError('unknown_refund', 422, 'Webhook references an unknown refund');
        await refundService.process(event.refundId);
        await db.update(webhookEvents).set({ status: 'processed' }).where(eq(webhookEvents.id, event.id));
        return;
      }
      await enqueue(
        db,
        'verify_transaction',
        event.paymentId,
        { payment_id: event.paymentId, event_id: event.id, correlation_id: job.payload.correlation_id },
        `verify_webhook:${event.id}`,
      );
    },
    verify_transaction: async (job) => {
      try {
        await verifyPayment(db, client, String(job.payload.payment_id));
        if (job.payload.event_id)
          await db
            .update(webhookEvents)
            .set({ status: 'processed' })
            .where(eq(webhookEvents.id, String(job.payload.event_id)));
      } catch (error) {
        if (error instanceof AppError && error.status < 500 && job.payload.event_id)
          await db
            .update(webhookEvents)
            .set({ status: 'failed' })
            .where(eq(webhookEvents.id, String(job.payload.event_id)));
        throw error;
      }
    },
    // A merchant without an endpoint has no delivery obligation; M8 supplies the HTTP handler.
    notify_merchant: async () => {},
  };
}
export async function requestVerification(db: Database, id: string, correlationId: string) {
  const job = await enqueue(
    db,
    'verify_transaction',
    id,
    { payment_id: id, correlation_id: correlationId },
    `verify_manual:${id}:${newId()}`,
  );
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const [current] = await db.select().from(outboxJobs).where(eq(outboxJobs.id, job!.id));
    if (current?.status === 'succeeded' || current?.status === 'dead') return current;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return job;
}
