import { createHmac } from 'node:crypto';
import { type Database, eq, fakeRefunds, fakeTransactions, sql } from '@paybox/db';
import type {
  Initialization,
  InitializeInput,
  PaystackClient,
  ProviderRefund,
  RefundInput,
  VerifiedTransaction,
} from './client';
import { ProviderError } from './client';

const identifier = (uuid: string) => BigInt(`0x${uuid.replaceAll('-', '').slice(-15)}`).toString();
export class FakePaystackClient implements PaystackClient {
  constructor(
    readonly db: Database,
    readonly publicUrl: string,
    readonly webhookSecret: string,
  ) {}
  async initialize(input: InitializeInput): Promise<Initialization> {
    await this.db
      .insert(fakeTransactions)
      .values({ reference: input.reference, amount: input.amount, currency: input.currency })
      .onConflictDoNothing();
    return {
      reference: input.reference,
      authorization_url: `${this.publicUrl}/fake/checkout/${encodeURIComponent(input.reference)}`,
      access_code: `fake_${input.reference}`,
    };
  }
  async verify(reference: string): Promise<VerifiedTransaction> {
    const [payment] = await this.db
      .select()
      .from(fakeTransactions)
      .where(eq(fakeTransactions.reference, reference));
    if (!payment) throw new ProviderError('Transaction not found', 404);
    if (payment.delayMs)
      await new Promise((resolve) => setTimeout(resolve, Math.min(payment.delayMs, 10_100)));
    if (payment.delayMs > 10_000) throw new ProviderError('Processor request timed out', 408);
    if (payment.failuresRemaining > 0) {
      await this.db
        .update(fakeTransactions)
        .set({ failuresRemaining: sql`greatest(0, ${fakeTransactions.failuresRemaining}-1)` })
        .where(eq(fakeTransactions.reference, reference));
      throw new ProviderError('Simulated processor outage', 500);
    }
    return {
      id: identifier(payment.id),
      reference,
      status: payment.status,
      amount: payment.amount + payment.drift,
      currency: payment.currency,
      fees: payment.fees,
      paid_at: payment.status === 'success' ? payment.createdAt.toISOString() : null,
      channel: 'card',
      gateway_response: payment.status === 'success' ? 'Successful' : 'Awaiting payment',
    };
  }
  async createRefund(input: RefundInput): Promise<ProviderRefund> {
    const payment = await this.verify(input.transaction);
    if (payment.status !== 'success') throw new ProviderError('Transaction has not succeeded', 400);
    await this.db
      .insert(fakeRefunds)
      .values({
        transaction: input.transaction,
        reference: input.reference.toLowerCase(),
        amount: input.amount,
      })
      .onConflictDoNothing();
    return this.fetchRefundByReference(input.reference);
  }
  async fetchRefundByReference(reference: string): Promise<ProviderRefund> {
    const [refund] = await this.db
      .select()
      .from(fakeRefunds)
      .where(eq(fakeRefunds.reference, reference.toLowerCase()));
    if (!refund) throw new ProviderError('Refund not found', 404);
    const status =
      refund.status === 'pending' && Date.now() - refund.createdAt.getTime() > 250
        ? 'processed'
        : refund.status;
    return {
      id: identifier(refund.id),
      reference: refund.reference,
      transaction: refund.transaction,
      amount: refund.amount,
      status,
    };
  }
  async settle(reference: string, status: 'success' | 'failed' = 'success') {
    const [row] = await this.db
      .update(fakeTransactions)
      .set({ status })
      .where(eq(fakeTransactions.reference, reference))
      .returning();
    if (!row) throw new ProviderError('Transaction not found', 404);
    return { event: 'charge.success', data: await this.verify(reference) };
  }
  sign(body: string, timestamp = Math.floor(Date.now() / 1000)): string {
    return `t=${timestamp},v1=whk_fake:${createHmac('sha512', this.webhookSecret).update(`${timestamp}.${body}`).digest('hex')}`;
  }
}
