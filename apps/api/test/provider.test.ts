import { expect, it, vi } from 'vitest';
import { readEnvironment } from '../src/config';
import { HttpPaystackClient, parseProviderJson } from '../src/provider/http';

it('live-key guard refuses boot even in fake mode', () => {
  expect(() => readEnvironment({ PAYSTACK_SECRET_KEY: ['sk', 'live', 'fixture'].join('_') })).toThrow(
    'Live keys',
  );
  expect(() => new HttpPaystackClient('invalid')).toThrow();
});
it('provider identifiers preserve unsigned 64-bit precision', () => {
  expect(parseProviderJson('{"id":18446744073709551615,"amount":1500000}')).toEqual({
    id: '18446744073709551615',
    amount: 1500000,
  });
});
it('refund 409 fetches the existing refund by reference', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response('', { status: 409 }))
    .mockResolvedValueOnce(
      Response.json({
        status: true,
        data: [
          {
            id: 42,
            reference: 'rf_test',
            amount: 100,
            status: 'pending',
            transaction: { reference: 'pay-test' },
          },
        ],
      }),
    );
  const client = new HttpPaystackClient('sk_test_fixture', fetcher);
  const result = await client.createRefund({
    transaction: 'pay-test',
    reference: 'rf_test',
    amount: 100,
    currency: 'NGN',
    merchant_note: 'Test',
  });
  expect(result.id).toBe('42');
  expect(fetcher.mock.calls[1]?.[0]).toBe('https://api.paystack.co/refund?reference=rf_test');
});
it('retryable HTTP errors preserve Retry-After', async () => {
  const client = new HttpPaystackClient(
    'sk_test_fixture',
    vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('', { status: 429, headers: { 'retry-after': '3' } })),
  );
  await expect(client.verify('test')).rejects.toMatchObject({
    status: 429,
    retryAfterMs: 3000,
    retryable: true,
  });
});
