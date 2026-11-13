import {
  and,
  clearing,
  type Database,
  eq,
  newId,
  payable,
  paymentEvents,
  payments,
  postEntry,
  refunds,
  sql,
  type Transaction,
  transit,
} from '@paybox/db';
import type { RefundEvent } from '@paybox/shared';
import { refundInput, transitionPayment, transitionRefund } from '@paybox/shared';
import { AppError } from './errors';
import { Idempotency } from './idempotency';
import { enqueue } from './jobs';
import { type PaystackClient, ProviderError, type ProviderRefund } from './provider/client';

export class Refunds {
  constructor(
    readonly db: Database,
    readonly client: PaystackClient,
  ) {}
  async request(
    merchantId: string,
    paymentId: string,
    key: string | undefined,
    body: unknown,
    actor: string,
  ) {
    const idempotency = new Idempotency(this.db);
    return idempotency.execute(
      merchantId,
      key,
      'POST',
      `/v1/payments/${paymentId}/refunds`,
      body,
      async (claim) => {
        const input = refundInput.parse(body);
        return this.db.transaction(async (tx) => {
          const [payment] = await tx
            .select()
            .from(payments)
            .where(and(eq(payments.id, paymentId), eq(payments.merchantId, merchantId)))
            .for('update');
          if (!payment) throw new AppError('not_found', 404, 'Payment not found');
          if (!['succeeded', 'partially_refunded', 'refunded'].includes(payment.status))
            throw new AppError('invalid_state', 409, 'Only successful payments can be refunded');
          const [totals] = await tx
            .select({ reserved: sql<string>`coalesce(sum(${refunds.amount}),0)::text` })
            .from(refunds)
            .where(and(eq(refunds.paymentId, payment.id), sql`${refunds.status}<>'failed'`));
          const remaining = payment.amount - Number(totals?.reserved ?? 0),
            amount = input.amount ?? remaining;
          if (amount <= 0 || amount > remaining)
            throw new AppError(
              'refund_exceeds_refundable',
              422,
              'Refund exceeds the remaining refundable amount',
            );
          const [refund] = await tx
            .insert(refunds)
            .values({
              paymentId,
              reference: `rf_${newId().replaceAll('-', '').slice(-20)}`,
              amount,
              reason: input.reason,
              requestedBy: actor,
            })
            .returning();
          await tx
            .insert(paymentEvents)
            .values({
              paymentId,
              type: 'refund.requested',
              source: 'api',
              correlationId: payment.correlationId,
              detail: { refund_id: refund!.id, amount, actor },
            });
          await enqueue(
            tx,
            'create_refund',
            paymentId,
            { refund_id: refund!.id, payment_id: paymentId, correlation_id: payment.correlationId },
            `create_refund:${refund!.id}`,
          );
          const result = {
            status: 202,
            body: { id: refund!.id, reference: refund!.reference, status: 'pending', amount },
          };
          await idempotency.complete(tx, claim.id, result);
          return result;
        });
      },
    );
  }
  async find(id: string, merchantId?: string) {
    const [row] = await this.db
      .select({ refund: refunds, payment: payments })
      .from(refunds)
      .innerJoin(payments, eq(refunds.paymentId, payments.id))
      .where(and(eq(refunds.id, id), merchantId ? eq(payments.merchantId, merchantId) : undefined));
    if (!row) throw new AppError('not_found', 404, 'Refund not found');
    return row;
  }
  private async transition(
    tx: Transaction,
    refund: typeof refunds.$inferSelect,
    payment: typeof payments.$inferSelect,
    event: RefundEvent,
    providerId?: string,
  ) {
    const next = transitionRefund(refund.status, event);
    if (next instanceof Error) {
      console.info(
        JSON.stringify({
          msg: 'Illegal refund transition ignored',
          payment_id: payment.id,
          refund_id: refund.id,
          event,
        }),
      );
      return refund;
    }
    const [updated] = await tx
      .update(refunds)
      .set({
        status: next,
        version: refund.version + 1,
        paystackRefundId: providerId ?? refund.paystackRefundId,
      })
      .where(
        and(
          eq(refunds.id, refund.id),
          eq(refunds.status, refund.status),
          eq(refunds.version, refund.version),
        ),
      )
      .returning();
    if (!updated) throw new AppError('invalid_state', 409, 'Refund changed while processing');
    if (next === 'pending')
      await postEntry(tx, {
        kind: 'refund_reserved',
        paymentId: payment.id,
        refundId: refund.id,
        idempotencyRef: `rf:${refund.id}:reserved`,
        lines: [
          payable(payment.merchantId, 'debit', refund.amount),
          transit(payment.merchantId, 'credit', refund.amount),
        ],
      });
    if (next === 'processed') {
      await postEntry(tx, {
        kind: 'refund_settled',
        paymentId: payment.id,
        refundId: refund.id,
        idempotencyRef: `rf:${refund.id}:settled`,
        lines: [transit(payment.merchantId, 'debit', refund.amount), clearing('credit', refund.amount)],
      });
      const refunded = payment.refundedAmount + refund.amount;
      const state = transitionPayment(
        payment.status,
        refunded === payment.amount ? 'full_refund' : 'partial_refund',
      );
      if (state instanceof Error)
        throw new AppError('invalid_state', 409, 'Payment cannot settle this refund');
      await tx
        .update(payments)
        .set({ status: state, refundedAmount: refunded, version: payment.version + 1 })
        .where(
          and(
            eq(payments.id, payment.id),
            eq(payments.version, payment.version),
            eq(payments.status, payment.status),
          ),
        );
    }
    if (next === 'failed' && refund.status !== 'requested')
      await postEntry(tx, {
        kind: 'refund_released',
        paymentId: payment.id,
        refundId: refund.id,
        idempotencyRef: `rf:${refund.id}:released`,
        lines: [
          transit(payment.merchantId, 'debit', refund.amount),
          payable(payment.merchantId, 'credit', refund.amount),
        ],
      });
    await tx
      .insert(paymentEvents)
      .values({
        paymentId: payment.id,
        type: `refund.${next}`,
        source: 'worker',
        fromStatus: refund.status,
        toStatus: next,
        correlationId: payment.correlationId,
        detail: { refund_id: refund.id, amount: refund.amount },
      });
    if (next === 'processed' || next === 'failed')
      await enqueue(
        tx,
        'notify_merchant',
        payment.id,
        {
          event: `refund.${next}`,
          merchant_id: payment.merchantId,
          payment_id: payment.id,
          refund_id: refund.id,
          correlation_id: payment.correlationId,
        },
        `notify_merchant:${refund.id}:refund.${next}`,
      );
    return updated;
  }
  async apply(id: string, remote: ProviderRefund) {
    const initial = await this.find(id);
    return this.db.transaction(async (tx) => {
      const [payment] = await tx
        .select()
        .from(payments)
        .where(eq(payments.id, initial.payment.id))
        .for('update');
      let [refund] = await tx.select().from(refunds).where(eq(refunds.id, id)).for('update');
      if (!refund || !payment) throw new AppError('not_found', 404, 'Refund not found');
      if (
        refund.reference.toLowerCase() !== remote.reference.toLowerCase() ||
        refund.amount !== remote.amount
      )
        throw new AppError('refund_mismatch', 422, 'Processor refund amount or reference does not match');
      if (refund.status === 'processed' || refund.status === 'failed') return refund;
      if (refund.status === 'requested')
        refund = await this.transition(tx, refund, payment, 'accepted', remote.id);
      if (refund.status === 'needs_attention' && remote.status !== 'needs-attention')
        refund = await this.transition(tx, refund, payment, 'resume');
      const event =
        remote.status === 'processed'
          ? 'processed'
          : remote.status === 'failed'
            ? 'failed'
            : remote.status === 'processing'
              ? 'processing'
              : remote.status === 'needs-attention'
                ? 'attention'
                : null;
      if (event && refund.status !== remote.status.replace('-', '_'))
        refund = await this.transition(tx, refund, payment, event);
      return refund;
    });
  }
  async process(id: string) {
    const { refund } = await this.find(id);
    if (refund.status === 'processed' || refund.status === 'failed') return;
    let remote: ProviderRefund;
    try {
      remote =
        refund.status === 'requested'
          ? await this.client.createRefund({
              transaction: (await this.find(id)).payment.reference,
              reference: refund.reference,
              amount: refund.amount,
              currency: 'NGN',
              merchant_note: refund.reason,
            })
          : await this.client.fetchRefundByReference(refund.reference);
    } catch (error) {
      if (error instanceof ProviderError && !error.retryable && refund.status === 'requested') {
        await this.db.transaction(async (tx) => {
          const [payment] = await tx
            .select()
            .from(payments)
            .where(eq(payments.id, refund.paymentId))
            .for('update');
          const [current] = await tx.select().from(refunds).where(eq(refunds.id, id)).for('update');
          if (current?.status === 'requested') await this.transition(tx, current, payment!, 'failed');
        });
      }
      throw error;
    }
    const updated = await this.apply(id, remote);
    if (updated.status === 'needs_attention')
      throw new AppError(
        'refund_needs_attention',
        422,
        'Processor requires an operator to review this refund',
      );
    if (updated.status !== 'processed' && updated.status !== 'failed')
      throw new ProviderError('Refund is awaiting processor completion', 503);
  }
}
