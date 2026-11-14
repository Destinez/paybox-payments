import {
  type Database,
  eq,
  outboxJobs,
  payments,
  refunds,
  webhookDeliveries,
  webhookEvents,
} from '@paybox/db';
import { authenticatePaystack } from '@paybox/shared';
import { z } from 'zod';
import type { Config } from './config';
import { sha256 } from './crypto';
import { AppError } from './errors';
import { parseProviderJson } from './provider/http';
import { annotate } from './telemetry';

export const webhookPayload = z
  .object({
    event: z.string().min(1).max(100),
    data: z
      .object({
        id: z.union([z.string(), z.number().int().safe()]).optional(),
        reference: z.string().optional(),
        refund_reference: z.string().optional(),
        status: z.string().optional(),
      })
      .passthrough(),
  })
  .passthrough();
const supported = new Set([
  'charge.success',
  'refund.pending',
  'refund.processing',
  'refund.needs-attention',
  'refund.failed',
  'refund.processed',
]);
export async function ingestWebhook(
  db: Database,
  config: Config,
  raw: Buffer,
  headers: { current?: string; legacy?: string },
) {
  const kid = authenticatePaystack(raw, {
    ...headers,
    secrets: config.PAYSTACK_WEBHOOK_SECRETS.split(','),
    legacySecret: config.PAYSTACK_SECRET_KEY,
    acceptLegacy: config.PAYSTACK_ACCEPT_LEGACY_SIGNATURE === 'true',
  });
  if (!kid) throw new AppError('invalid_signature', 401, 'Webhook signature is invalid or expired');
  const payload = webhookPayload.parse(parseProviderJson(raw.toString('utf8')));
  const eventKey = sha256(
    `${payload.event}:${payload.data.id ?? payload.data.reference ?? payload.data.refund_reference ?? sha256(raw)}:${payload.data.status ?? ''}`,
  );
  const isRefund = payload.event.startsWith('refund.');
  const reference = payload.data.refund_reference ?? payload.data.reference;
  return db.transaction(async (tx) => {
    const [refund] =
      reference && isRefund
        ? await tx.select().from(refunds).where(eq(refunds.reference, reference.toLowerCase()))
        : [];
    const [payment] = refund
      ? await tx.select().from(payments).where(eq(payments.id, refund.paymentId))
      : reference && !isRefund
        ? await tx.select().from(payments).where(eq(payments.reference, reference))
        : [];
    annotate({
      event_type: supported.has(payload.event) ? payload.event : 'other',
      correlation_id: payment?.correlationId,
      payment_id: payment?.id,
      merchant_id: payment?.merchantId,
    });
    const [event] = await tx
      .insert(webhookEvents)
      .values({
        eventKey,
        eventType: payload.event,
        bodySha256: sha256(raw),
        rawBody: raw,
        signatureKid: kid,
        paymentId: payment?.id,
        refundId: refund?.id,
        status: supported.has(payload.event) ? 'received' : 'ignored',
      })
      .onConflictDoNothing({ target: webhookEvents.eventKey })
      .returning();
    if (!event) {
      const [existing] = await tx.select().from(webhookEvents).where(eq(webhookEvents.eventKey, eventKey));
      await tx.insert(webhookDeliveries).values({ eventId: existing!.id, outcome: 'duplicate' });
      return { received: true, duplicate: true };
    }
    await tx.insert(webhookDeliveries).values({ eventId: event.id, outcome: 'received' });
    if (supported.has(payload.event))
      await tx.insert(outboxJobs).values({
        type: 'process_webhook_event',
        aggregateId: payment?.id,
        payload: { event_id: event.id, correlation_id: payment?.correlationId ?? event.id },
        dedupeKey: `process_webhook:${event.id}`,
      });
    return { received: true, duplicate: false };
  });
}
