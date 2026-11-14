import { and, type Database, eq, merchants, x402Payments, x402Routes } from '@paybox/db';
import { canonicalJson } from '@paybox/shared';
import {
  decodePaymentSignatureHeader,
  encodePaymentRequiredHeader,
  encodePaymentResponseHeader,
} from '@x402/core/http';
import { PaymentPayloadV2Schema } from '@x402/core/schemas';
import { type FacilitatorClient, HTTPFacilitatorClient, x402ResourceServer } from '@x402/core/server';
import type { PaymentPayload, PaymentRequirements, SettleResponse } from '@x402/core/types';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import { HonoAdapter } from '@x402/hono';
import type { Context } from 'hono';
import type { Env } from '../app';
import type { Config } from '../config';
import { decrypt, sha256 } from '../crypto';
import { AppError } from '../errors';
import { enqueue } from '../jobs';
import { finalizeX402 } from './accounting';
import { FakeFacilitator } from './facilitator';
import { nonceKey, signedPayloadSchema, X402_NETWORK } from './protocol';
import { proxyUpstream, signUpstream } from './upstream';
export class X402Gateway {
  readonly facilitator: FacilitatorClient;
  readonly server: x402ResourceServer;
  private initialized?: Promise<void>;
  constructor(
    readonly db: Database,
    readonly config: Config,
    facilitator?: FacilitatorClient,
  ) {
    this.facilitator =
      facilitator ??
      (config.X402_MODE === 'fake'
        ? new FakeFacilitator(db)
        : new HTTPFacilitatorClient({ url: config.X402_FACILITATOR_URL, timeoutMs: 10000 }));
    this.server = new x402ResourceServer(this.facilitator).register(X402_NETWORK, new ExactEvmScheme());
  }
  private async ready() {
    this.initialized ??= this.server.initialize().catch((error) => {
      this.initialized = undefined;
      throw error;
    });
    await this.initialized;
  }
  async handle(c: Context<Env>) {
    const slug = c.req.param('merchantSlug'),
      prefix = `/x402/m/${slug}`,
      path = c.req.path.slice(prefix.length);
    const [row] = await this.db
      .select({ route: x402Routes, merchant: merchants })
      .from(x402Routes)
      .innerJoin(merchants, eq(x402Routes.merchantId, merchants.id))
      .where(
        and(
          eq(merchants.slug, slug!),
          eq(x402Routes.path, path),
          eq(x402Routes.method, c.req.method),
          eq(x402Routes.active, true),
        ),
      );
    if (!row) throw new AppError('route_not_found', 404, 'No active priced route matches this request');
    const { route, merchant } = row;
    if (route.network !== X402_NETWORK)
      throw new AppError('network_not_allowed', 400, 'Only Base Sepolia is supported');
    await this.ready();
    const [requirements] = await this.server.buildPaymentRequirements({
      scheme: 'exact',
      network: X402_NETWORK,
      price: {
        amount: String(route.price),
        asset: route.asset,
        extra: { name: 'USDC', version: '2', assetTransferMethod: 'eip3009', paymentFlow: 'authorization' },
      },
      payTo: route.payTo,
      maxTimeoutSeconds: 300,
    });
    const resource = {
      url: new URL(c.req.path, this.config.API_PUBLIC_URL).href,
      description: route.description,
      mimeType: 'application/json',
    };
    const challenge = await this.server.createPaymentRequiredResponse([requirements!], resource);
    const adapter = new HonoAdapter(c),
      header = adapter.getHeader('PAYMENT-SIGNATURE');
    c.header('Cache-Control', 'no-store');
    const paymentError = (code: string, detail: string) => {
      c.header('PAYMENT-REQUIRED', encodePaymentRequiredHeader({ ...challenge, error: code }));
      c.header('Content-Type', 'application/problem+json');
      return c.body(
        JSON.stringify({
          ...challenge,
          error: code,
          type: `https://paybox.dev/errors/${code}`,
          title: detail,
          status: 402,
          code,
          detail,
          request_id: c.get('requestId'),
        }),
        402,
      );
    };
    if (!header) return paymentError('payment_required', 'This endpoint requires a test USDC payment');
    let payload: PaymentPayload;
    try {
      if (header.length > 16384) throw new Error('Payload too large');
      const parsed = PaymentPayloadV2Schema.parse(decodePaymentSignatureHeader(header));
      payload = {
        ...parsed,
        accepted: {
          ...parsed.accepted,
          network: parsed.accepted.network as PaymentRequirements['network'],
          extra: parsed.accepted.extra ?? {},
        },
        extensions: parsed.extensions ?? undefined,
      };
      if (
        canonicalJson(payload.accepted) !== canonicalJson(requirements) ||
        payload.resource?.url !== resource.url
      )
        throw new Error('Requirements do not match');
      signedPayloadSchema.parse(payload.payload);
    } catch {
      return paymentError('payment_invalid', 'Payment does not match the priced resource');
    }
    const key = nonceKey(payload, requirements!),
      signed = signedPayloadSchema.parse(payload.payload);
    const [used] = await this.db
      .select({ id: x402Payments.id })
      .from(x402Payments)
      .where(eq(x402Payments.nonceKey, key));
    if (used) return paymentError('payment_already_used', 'This payment authorization has already been used');
    let valid = false;
    try {
      valid = (await this.server.verifyPayment(payload, requirements!, undefined, { adapter })).isValid;
    } catch {
      return paymentError('payment_invalid', 'The facilitator could not verify this payment');
    }
    if (!valid) return paymentError('payment_invalid', 'Payment verification failed');
    const body = Buffer.from(await c.req.arrayBuffer());
    const requestHash = sha256(
      `${c.req.method}:${c.req.path}:${c.req.url.split('?')[1] ?? ''}:${sha256(body)}`,
    );
    const [payment] = await this.db
      .insert(x402Payments)
      .values({
        merchantId: merchant.id,
        routeId: route.id,
        nonceKey: key,
        payer: signed.authorization.from,
        amount: route.price,
        asset: route.asset,
        network: route.network,
        payTo: route.payTo,
        requestHash,
        correlationId: c.get('requestId'),
      })
      .onConflictDoNothing({ target: x402Payments.nonceKey })
      .returning();
    if (!payment)
      return paymentError('payment_already_used', 'This payment authorization has already been used');
    if (!merchant.webhookSecretEnc) {
      await this.db
        .update(x402Payments)
        .set({ status: 'upstream_failed', lastError: 'Merchant signing secret is not configured' })
        .where(eq(x402Payments.id, payment.id));
      throw new AppError('processor_unavailable', 502, 'Merchant signing secret is not configured');
    }
    const url = new URL(route.upstreamUrl);
    for (const [name, value] of new URL(c.req.url).searchParams) url.searchParams.append(name, value);
    let upstream: Awaited<ReturnType<typeof proxyUpstream>>;
    try {
      upstream = await proxyUpstream(
        url.href,
        c.req.method,
        body,
        {
          'Content-Type': c.req.header('Content-Type') ?? 'application/json',
          'Paybox-Correlation-Id': payment.correlationId,
          'Paybox-X402-Payment': signUpstream(
            {
              id: payment.id,
              payer: payment.payer,
              route_id: route.id,
              amount: String(payment.amount),
              asset: 'USDC',
              status: 'verified',
              network: route.network,
              request_hash: requestHash,
            },
            decrypt(merchant.webhookSecretEnc, this.config.DATA_KEY),
          ),
        },
        this.config,
      );
    } catch {
      await this.db
        .update(x402Payments)
        .set({ status: 'upstream_failed', lastError: 'Merchant upstream request failed' })
        .where(eq(x402Payments.id, payment.id));
      throw new AppError(
        'processor_unavailable',
        502,
        'Merchant upstream request failed; no settlement was attempted',
      );
    }
    if (upstream.status < 200 || upstream.status >= 300) {
      await this.db
        .update(x402Payments)
        .set({ status: 'upstream_failed', lastError: `Upstream returned HTTP ${upstream.status}` })
        .where(eq(x402Payments.id, payment.id));
      return new Response(new Uint8Array(upstream.body), {
        status: upstream.status,
        headers: { 'Content-Type': upstream.contentType, 'Cache-Control': 'no-store' },
      });
    }
    await this.db
      .update(x402Payments)
      .set({ status: 'settling', settlementStartedAt: new Date() })
      .where(eq(x402Payments.id, payment.id));
    let receipt: SettleResponse;
    try {
      receipt = await this.server.settlePayment(payload, requirements!, undefined, { adapter });
      if (
        !receipt.success ||
        receipt.network !== X402_NETWORK ||
        !/^0x[0-9a-fA-F]{64}$/.test(receipt.transaction)
      )
        throw new Error('Settlement did not succeed');
    } catch {
      await this.db
        .update(x402Payments)
        .set({
          status: 'settlement_failed',
          lastError: 'Settlement failed or its outcome is unknown; inspect the facilitator before retrying',
        })
        .where(eq(x402Payments.id, payment.id));
      throw new AppError(
        'settlement_failed',
        502,
        'Settlement failed or could not be confirmed. No ledger entry was posted.',
      );
    }
    await this.db.transaction(async (tx) => {
      await tx
        .update(x402Payments)
        .set({ status: 'confirmed', receipt: { ...receipt }, transactionHash: receipt.transaction })
        .where(eq(x402Payments.id, payment.id));
      await enqueue(
        tx,
        'finalize_x402',
        payment.id,
        { x402_payment_id: payment.id, correlation_id: payment.correlationId },
        `finalize_x402:${payment.id}`,
      );
    });
    await finalizeX402(this.db, payment.id);
    c.header('PAYMENT-RESPONSE', encodePaymentResponseHeader(receipt));
    c.header('Content-Type', upstream.contentType);
    c.header('Content-Security-Policy', "sandbox; default-src 'none'");
    return c.body(new Uint8Array(upstream.body), 200);
  }
}
