import { randomBytes } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { auditLog, type Database, eq, merchants, payments, refunds, x402Payments } from '@paybox/db';
import { signMerchant } from '@paybox/shared';
import { z } from 'zod';
import { type App, register } from './app';
import type { Config } from './config';
import { decrypt, encrypt } from './crypto';
import { AppError } from './errors';
import type { Job } from './jobs';
import { ProviderError } from './provider/client';
export function publicAddress(address: string): boolean {
  if (address.includes(':')) return !/^(::|fc|fd|fe8|fe9|fea|feb|ff|2001:db8)/i.test(address);
  const parts = address.split('.').map(Number);
  const a = parts[0] ?? 0,
    b = parts[1] ?? 0;
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || b === 0)) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && (b === 18 || b === 19))
  );
}
export async function destination(value: string, config: Config) {
  const url = new URL(value);
  if (url.username || url.password || url.hash)
    throw new AppError('validation_error', 400, 'Webhook URLs cannot contain credentials or fragments');
  const demo =
    config.PAYSTACK_MODE === 'fake' &&
    config.DEMO_MODE === 'true' &&
    url.protocol === 'http:' &&
    url.port === '4100' &&
    ['localhost', '127.0.0.1', 'merchant-receiver'].includes(url.hostname);
  if (!demo && (url.protocol !== 'https:' || (url.port && url.port !== '443')))
    throw new AppError('validation_error', 400, 'Webhook endpoints must use HTTPS on port 443');
  const addresses = await lookup(url.hostname, { all: true });
  if (!addresses.length || (!demo && addresses.some((row) => !publicAddress(row.address))))
    throw new AppError('validation_error', 400, 'Webhook endpoints must resolve to public addresses');
  return { url, address: addresses[0]! };
}
export async function deliver(
  value: string,
  body: string,
  headers: Record<string, string>,
  config: Config,
): Promise<number> {
  const { url, address } = await destination(value, config);
  return new Promise((resolve, reject) => {
    const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(
      url,
      {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
        lookup: (_hostname, options, callback) =>
          options.all ? callback(null, [address]) : callback(null, address.address, address.family),
        timeout: 10000,
      },
      (response) => {
        response.resume();
        const status = response.statusCode ?? 503;
        if (status >= 200 && status < 300) resolve(status);
        else {
          const value = response.headers['retry-after'];
          const raw = Array.isArray(value) ? value[0] : value;
          const delay = raw
            ? /^\d+$/.test(raw)
              ? Number(raw) * 1000
              : Math.max(0, Date.parse(raw) - Date.now())
            : 0;
          reject(
            new ProviderError(
              `Merchant endpoint returned HTTP ${status}`,
              status,
              Number.isFinite(delay) ? delay : 0,
            ),
          );
        }
      },
    );
    request.on('timeout', () => request.destroy(new Error('timeout')));
    request.on('error', () => reject(new ProviderError('Merchant endpoint timed out or could not connect')));
    request.end(body);
  });
}
export async function notifyMerchant(db: Database, config: Config, job: Job) {
  const [merchant] = await db
    .select()
    .from(merchants)
    .where(eq(merchants.id, String(job.payload.merchant_id)));
  if (!merchant?.webhookUrl || !merchant.webhookSecretEnc) return;
  let data: Record<string, unknown>;
  if (job.payload.x402_payment_id) {
    const [payment] = await db
      .select()
      .from(x402Payments)
      .where(eq(x402Payments.id, String(job.payload.x402_payment_id)));
    if (payment?.status !== 'settled') throw new AppError('not_found', 404, 'Settled payment not found');
    data = {
      payment_id: payment.id,
      route_id: payment.routeId,
      payer: payment.payer,
      amount: String(payment.amount),
      asset: 'USDC',
      network: payment.network,
      transaction: payment.transactionHash,
    };
  } else {
    const [payment] = await db
      .select()
      .from(payments)
      .where(eq(payments.id, String(job.payload.payment_id)));
    if (!payment) throw new AppError('not_found', 404, 'Notification payment not found');
    const [refund] = job.payload.refund_id
      ? await db
          .select()
          .from(refunds)
          .where(eq(refunds.id, String(job.payload.refund_id)))
      : [];
    data = {
      payment_id: payment.id,
      reference: payment.reference,
      amount: refund?.amount ?? payment.amount,
      currency: payment.currency,
      ...(refund ? { refund_id: refund.id, refund_reference: refund.reference } : {}),
    };
  }
  const body = JSON.stringify({
    id: `evt_${job.id}`,
    type: job.payload.event,
    created_at: job.createdAt.toISOString(),
    data,
  });
  await deliver(
    merchant.webhookUrl,
    body,
    {
      'Paybox-Signature': signMerchant(body, decrypt(merchant.webhookSecretEnc, config.DATA_KEY)),
      'Paybox-Correlation-Id': String(job.payload.correlation_id),
    },
    config,
  );
}
export function notificationRoutes(app: App, db: Database, config: Config) {
  register(
    app,
    {
      method: 'put',
      path: '/v1/webhook-endpoint',
      summary: 'Set merchant webhook endpoint and rotate its signing secret',
      body: z.object({ url: z.string().url().max(2048) }).strict(),
    },
    async (c) => {
      const merchantId = c.get('principal').merchantId;
      if (!merchantId)
        throw new AppError('forbidden', 403, 'Use a merchant API key to configure its endpoint');
      const { url } = z.object({ url: z.string().url() }).parse(await c.req.json());
      await destination(url, config);
      const secret = `pbx_whsec_${randomBytes(32).toString('hex')}`;
      await db.transaction(async (tx) => {
        await tx
          .update(merchants)
          .set({ webhookUrl: url, webhookSecretEnc: encrypt(secret, config.DATA_KEY) })
          .where(eq(merchants.id, merchantId));
        await tx.insert(auditLog).values({
          actor: c.get('principal').actor,
          action: 'webhook_endpoint.updated',
          targetType: 'merchant',
          targetId: merchantId,
          detail: { url },
        });
      });
      return c.json({ url, secret });
    },
  );
}
