import { expect, it } from 'vitest';
import { readEnvironment } from '../src/config';
import { signUpstream, verifyUpstream } from '../src/x402/upstream';

it.each(['eip155:1', 'eip155:8453', 'eip155:137', 'solana:mainnet'])(
  'rejects network %s at configuration load',
  (network) => {
    expect(() => readEnvironment({ X402_NETWORK: network })).toThrow('network_not_allowed');
  },
);
it('accepts Base Sepolia only', () => {
  expect(readEnvironment({ X402_MODE: 'testnet' }).X402_NETWORK).toBe('eip155:84532');
});
it('upstream signatures reject tampering, wrong secrets, and stale timestamps', () => {
  const header = signUpstream({ amount: '10000' }, 'test-secret');
  expect(verifyUpstream(header, 'test-secret')).toEqual({ amount: '10000' });
  expect(verifyUpstream(header, 'wrong-secret')).toBeNull();
  expect(verifyUpstream(`${header}x`, 'test-secret')).toBeNull();
  expect(verifyUpstream(signUpstream({}, 'test-secret', 1), 'test-secret')).toBeNull();
});
