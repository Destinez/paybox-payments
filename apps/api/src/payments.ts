import {
  and,
  type Database,
  desc,
  eq,
  idempotencyKeys,
  journalEntries,
  ledgerAccounts,
  ledgerLines,
  newId,
  paymentEvents,
  payments,
  refunds,
  sql,
} from '@paybox/db';
import { listPaymentsInput, paymentInput } from '@paybox/shared';
import type { Config } from './config';
import { AppError } from './errors';
import { Idempotency, type StoredResponse } from './idempotency';
import { type PaystackClient, ProviderError } from './provider/client';

export const maskEmail = (email: string) => `${email.slice(0, 1)}***@${email.split('@')[1]}`;
export function paymentView(
  payment: typeof payments.$inferSelect,
  fullEmail = false,
): Record<string, unknown> {
  return {
    id: payment.id,
    merchant_id: payment.merchantId,
    reference: payment.reference,
    status: payment.status,
    amount: payment.amount,
    currency: payment.currency,
    customer: { email: fullEmail ? payment.customerEmail : maskEmail(payment.customerEmail) },
    authorization_url: payment.authorizationUrl,
    access_code: payment.accessCode,
    fees: payment.fees,
    channel: payment.channel,
    paid_at: payment.paidAt?.toISOString() ?? null,
    refunded_amount: payment.refundedAmount,
    created_at: payment.createdAt.toISOString(),
    correlation_id: payment.correlationId,
  };
}
export class Payments {
  readonly idempotency: Idempotency;
  constructor(
    readonly db: Database,
    readonly client: PaystackClient,
    readonly config: Config,
  ) {
    this.idempotency = new Idempotency(db);
  }
  async create(merchantId: string, key: string | undefined, raw: unknown): Promise<StoredResponse> {
    return this.idempotency.execute(merchantId, key, 'POST', '/v1/payments', raw, async (claim) => {
      const input = paymentInput.parse(raw);
      let payment = claim.paymentId ? await this.find(claim.paymentId, merchantId) : undefined;
      if (!payment) {
        payment = await this.db.transaction(async (tx) => {
          const [inserted] = await tx
            .insert(payments)
            .values({
              merchantId,
              amount: input.amount,
              currency: input.currency,
              reference: input.reference ?? `pb-${newId()}`,
              customerEmail: input.customer.email,
              metadata: input.metadata,
              callbackUrl: input.callback_url,
              correlationId: `req_${newId()}`,
            })
            .onConflictDoNothing({ target: payments.reference })
            .returning();
          if (!inserted) throw new AppError('reference_taken', 409, 'This reference is already in use');
          await tx
            .update(idempotencyKeys)
            .set({ paymentId: inserted.id })
            .where(eq(idempotencyKeys.id, claim.id));
          await tx.insert(paymentEvents).values({
            paymentId: inserted.id,
            type: 'created',
            toStatus: 'created',
            source: 'api',
            correlationId: inserted.correlationId,
          });
          return inserted;
        });
      }
      if (payment.authorizationUrl) return { status: 201, body: paymentView(payment) };
      try {
        const initialized = await this.client.initialize({
          email: payment.customerEmail,
          amount: payment.amount,
          currency: 'NGN',
          reference: payment.reference,
          callback_url: payment.callbackUrl ?? `${this.config.WEB_URL}/payments/${payment.id}`,
          metadata: { ...payment.metadata, paybox_payment_id: payment.id },
        });
        if (initialized.reference !== payment.reference)
          throw new ProviderError('Processor reference mismatch');
        return this.db.transaction(async (tx) => {
          const [updated] = await tx
            .update(payments)
            .set({
              status: 'pending',
              authorizationUrl: initialized.authorization_url,
              accessCode: initialized.access_code,
              version: sql`${payments.version}+1`,
            })
            .where(
              and(
                eq(payments.id, payment.id),
                eq(payments.status, 'created'),
                eq(payments.version, payment.version),
              ),
            )
            .returning();
          if (!updated) throw new AppError('invalid_state', 409, 'Payment changed while initializing');
          await tx.insert(paymentEvents).values({
            paymentId: updated.id,
            type: 'initialized',
            fromStatus: 'created',
            toStatus: 'pending',
            source: 'api',
            correlationId: updated.correlationId,
          });
          const result = { status: 201, body: paymentView(updated) };
          await this.idempotency.complete(tx, claim.id, result);
          return result;
        });
      } catch (error) {
        if (error instanceof AppError) throw error;
        throw new AppError(
          'processor_unavailable',
          502,
          'The processor could not initialize the transaction. Retry with the same idempotency key.',
        );
      }
    });
  }
  async find(id: string, merchantId?: string) {
    const [payment] = await this.db
      .select()
      .from(payments)
      .where(and(eq(payments.id, id), merchantId ? eq(payments.merchantId, merchantId) : undefined));
    if (!payment) throw new AppError('not_found', 404, 'Payment not found');
    return payment;
  }
  async list(query: unknown, merchantId?: string) {
    const filter = listPaymentsInput.parse(query);
    let cursor: { created_at: string; id: string } | undefined;
    if (filter.page_token) {
      try {
        cursor = JSON.parse(Buffer.from(filter.page_token, 'base64url').toString());
        if (!cursor || !/^[\da-f-]{36}$/.test(cursor.id) || !Number.isFinite(Date.parse(cursor.created_at)))
          throw new Error();
      } catch {
        throw new AppError('validation_error', 400, 'Invalid page token');
      }
    }
    const search = filter.q?.replace(/[\\%_]/g, '\\$&');
    const rows = await this.db
      .select()
      .from(payments)
      .where(
        and(
          merchantId ? eq(payments.merchantId, merchantId) : undefined,
          filter.status ? eq(payments.status, filter.status) : undefined,
          filter.from ? sql`${payments.createdAt}>=${new Date(filter.from)}` : undefined,
          filter.to ? sql`${payments.createdAt}<=${new Date(filter.to)}` : undefined,
          search
            ? sql`(${payments.reference} ILIKE ${`%${search}%`} OR ${payments.customerEmail} ILIKE ${`%${search}%`})`
            : undefined,
          cursor
            ? sql`(${payments.createdAt},${payments.id})<(${new Date(cursor.created_at)},${cursor.id}::uuid)`
            : undefined,
        ),
      )
      .orderBy(desc(payments.createdAt), desc(payments.id))
      .limit(filter.limit + 1);
    const page = rows.slice(0, filter.limit);
    const last = page.at(-1);
    return {
      data: page.map((row) => paymentView(row)),
      next_page_token:
        rows.length > filter.limit && last
          ? Buffer.from(JSON.stringify({ created_at: last.createdAt.toISOString(), id: last.id })).toString(
              'base64url',
            )
          : null,
    };
  }
  async detail(id: string, merchantId?: string, fullEmail = true) {
    const payment = await this.find(id, merchantId);
    const [timeline, refundRows, lines] = await Promise.all([
      this.db
        .select()
        .from(paymentEvents)
        .where(eq(paymentEvents.paymentId, id))
        .orderBy(paymentEvents.createdAt),
      this.db.select().from(refunds).where(eq(refunds.paymentId, id)).orderBy(refunds.createdAt),
      this.db
        .select({
          id: ledgerLines.id,
          entry_id: journalEntries.id,
          kind: journalEntries.kind,
          account: ledgerAccounts.code,
          direction: ledgerLines.direction,
          amount: ledgerLines.amount,
          created_at: journalEntries.createdAt,
        })
        .from(ledgerLines)
        .innerJoin(journalEntries, eq(ledgerLines.entryId, journalEntries.id))
        .innerJoin(ledgerAccounts, eq(ledgerLines.accountId, ledgerAccounts.id))
        .where(eq(journalEntries.paymentId, id)),
    ]);
    return { ...paymentView(payment, fullEmail), timeline, refunds: refundRows, ledger_entries: lines };
  }
}
