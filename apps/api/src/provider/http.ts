import { parse } from 'lossless-json';
import { z } from 'zod';
import type {
  Initialization,
  InitializeInput,
  PaystackClient,
  ProviderRefund,
  RefundInput,
  VerifiedTransaction,
} from './client';
import { ProviderError } from './client';

export function parseProviderJson(body: string): unknown {
  return parse(body, undefined, (value) =>
    /^-?\d+$/.test(value) && !Number.isSafeInteger(Number(value)) ? value : Number(value),
  );
}
const money = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const identifier = z.union([z.string(), z.number().int().safe()]).transform(String);
const verified = z.object({
  id: identifier,
  reference: z.string(),
  status: z.string(),
  amount: money,
  currency: z.string(),
  fees: money.nullish().transform((value) => value ?? 0),
  paid_at: z
    .string()
    .nullish()
    .transform((value) => value ?? null),
  channel: z.string().default('unknown'),
  gateway_response: z.string().default(''),
});
const initialized = z.object({
  authorization_url: z
    .string()
    .url()
    .refine((url) => new URL(url).hostname === 'checkout.paystack.com' && new URL(url).protocol === 'https:'),
  access_code: z.string(),
  reference: z.string(),
});
const refundSchema = z.object({
  id: identifier,
  reference: z.string().optional(),
  refund_reference: z.string().optional(),
  amount: money,
  status: z.string(),
  transaction: z.union([z.string(), z.number(), z.object({ reference: z.string() }).passthrough()]),
});
export class HttpPaystackClient implements PaystackClient {
  constructor(
    private key: string,
    private request: typeof fetch = fetch,
  ) {
    if (!key.startsWith('sk_test_')) throw new Error('Only Paystack test keys are accepted');
  }
  private async call(path: string, body?: unknown): Promise<unknown> {
    let response: Response;
    try {
      response = await this.request(`https://api.paystack.co${path}`, {
        method: body ? 'POST' : 'GET',
        headers: { Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(10_000),
        redirect: 'error',
      });
    } catch {
      throw new ProviderError('Processor request timed out or could not connect');
    }
    if (!response.ok) {
      const retry = response.headers.get('retry-after');
      const retryAfter = retry
        ? /^\d+$/.test(retry)
          ? Number(retry) * 1000
          : Math.max(0, Date.parse(retry) - Date.now())
        : 0;
      throw new ProviderError(
        `Processor returned HTTP ${response.status}`,
        response.status,
        Number.isFinite(retryAfter) ? retryAfter : 0,
      );
    }
    try {
      const envelope = z
        .object({ status: z.boolean(), data: z.unknown() })
        .parse(parseProviderJson(await response.text()));
      if (!envelope.status) throw new ProviderError('Processor rejected the request', 400);
      return envelope.data;
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError('Processor returned an invalid response');
    }
  }
  async initialize(input: InitializeInput): Promise<Initialization> {
    return initialized.parse(
      await this.call('/transaction/initialize', {
        ...input,
        metadata: JSON.stringify(input.metadata),
        channels: ['card', 'bank', 'bank_transfer'],
      }),
    );
  }
  async verify(reference: string): Promise<VerifiedTransaction> {
    return verified.parse(await this.call(`/transaction/verify/${encodeURIComponent(reference)}`));
  }
  private refund(value: unknown, reference: string): ProviderRefund {
    const result = refundSchema.parse(value);
    return {
      id: result.id,
      amount: result.amount,
      reference: result.reference ?? result.refund_reference ?? reference,
      status: result.status,
      transaction:
        typeof result.transaction === 'object' ? result.transaction.reference : String(result.transaction),
    };
  }
  async createRefund(input: RefundInput): Promise<ProviderRefund> {
    try {
      return this.refund(await this.call('/refund', input), input.reference);
    } catch (error) {
      if (error instanceof ProviderError && error.status === 409)
        return this.fetchRefundByReference(input.reference);
      throw error;
    }
  }
  async fetchRefundByReference(reference: string): Promise<ProviderRefund> {
    const data = await this.call(`/refund?reference=${encodeURIComponent(reference)}`);
    const candidate = Array.isArray(data) ? data[0] : data;
    if (!candidate) throw new ProviderError('Refund not found', 404);
    const result = this.refund(candidate, reference);
    if (result.reference.toLowerCase() !== reference.toLowerCase())
      throw new ProviderError('Processor refund reference mismatch');
    return result;
  }
}
