import { readFile } from 'node:fs/promises';
import { decodePaymentRequiredHeader, decodePaymentResponseHeader } from '@x402/core/http';
import { ExactEvmScheme } from '@x402/evm/exact/client';
import { wrapFetchWithPayment, x402Client } from '@x402/fetch';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { z } from 'zod';
import { X402_NETWORK } from './protocol';

export async function demonstrateX402(
  options: { base?: string; path?: string; mode?: string; privateKey?: string } = {},
) {
  const base = options.base ?? process.env.API_PUBLIC_URL ?? 'http://localhost:4000';
  const path = options.path ?? process.env.X402_DEMO_PATH ?? '/x402/m/demo-store/v1/stock';
  const mode = options.mode ?? process.env.X402_MODE ?? 'fake';
  const key = options.privateKey ?? process.env.X402_DEMO_PRIVATE_KEY;
  if (mode !== 'fake' && !key)
    throw new Error('Set X402_DEMO_PRIVATE_KEY to a throwaway Base Sepolia key funded with test USDC');
  const account = privateKeyToAccount(key ? (key as `0x${string}`) : generatePrivateKey());
  const url = new URL(path, base);
  const unpaid = await fetch(url);
  if (unpaid.status !== 402) throw new Error(`Expected a 402 challenge, received ${unpaid.status}`);
  const challenge = decodePaymentRequiredHeader(unpaid.headers.get('PAYMENT-REQUIRED')!);
  if (challenge.accepts.some((r) => r.network !== X402_NETWORK)) throw new Error('network_not_allowed');
  let signature = '';
  const trackedFetch: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    signature = request.headers.get('PAYMENT-SIGNATURE') ?? signature;
    return fetch(request);
  };
  const client = new x402Client().register(X402_NETWORK, new ExactEvmScheme(account));
  const paid = await wrapFetchWithPayment(trackedFetch, client)(url);
  if (paid.status !== 200) throw new Error(`Paid request failed: ${paid.status} ${await paid.text()}`);
  const receipt = decodePaymentResponseHeader(paid.headers.get('PAYMENT-RESPONSE')!);
  if (!receipt.success) throw new Error('Settlement receipt was not successful');
  const replay = await fetch(url, { headers: { 'PAYMENT-SIGNATURE': signature } });
  if (
    replay.status !== 402 ||
    z.object({ code: z.string() }).parse(await replay.json()).code !== 'payment_already_used'
  )
    throw new Error('Replay protection failed');
  console.info('x402: unpaid 402 → paid 200 with receipt → replay 402 payment_already_used');
  return { payer: account.address, transaction: receipt.transaction, data: await paid.json() };
}

export async function prepareX402Demo() {
  if ((process.env.X402_MODE ?? 'fake') !== 'fake') return;
  const credentials = JSON.parse(await readFile('.local/demo.json', 'utf8'));
  const base = process.env.API_PUBLIC_URL ?? 'http://localhost:4000';
  const receiver = process.env.DEMO_RECEIVER_URL ?? 'http://127.0.0.1:4100';
  const endpoint = await fetch(`${base}/v1/webhook-endpoint`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${credentials.api_key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: `${receiver}/webhook` }),
  });
  if (!endpoint.ok) throw new Error('Could not configure the demo merchant endpoint');
  const { secret } = z.object({ secret: z.string() }).parse(await endpoint.json());
  const configured = await fetch(`${receiver}/control`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret, fail: false }),
  });
  if (!configured.ok) throw new Error('Start the local merchant receiver before running the demo');
}
