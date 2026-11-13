import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { authenticatePaystack, type SignatureOptions, signMerchant } from './signatures';

const raw = Buffer.from('{ "event": "charge.success", "data": {"id": 1} }');
const now = 1_800_000_000;
const secret = 'whsec_fixture';
const signed = (t = now, key = secret) =>
  `t=${t},v1=whk_test:${createHmac('sha512', key).update(`${t}.`).update(raw).digest('hex')}`;
const options: SignatureOptions = {
  current: signed(),
  secrets: [secret],
  legacySecret: 'legacy-fixture',
  acceptLegacy: false,
  now,
};
describe('current and legacy signature verification', () => {
  it('verifies exact raw bytes and rotated secrets across multiple v1 candidates', () => {
    expect(authenticatePaystack(raw, options)).toBe('whk_test');
    expect(authenticatePaystack(Buffer.from('{}'), options)).toBeNull();
    expect(
      authenticatePaystack(raw, {
        ...options,
        secrets: ['wrong', secret],
        current: `${signed()},v1=whk_other:${'f'.repeat(128)}`,
      }),
    ).toBe('whk_test');
  });
  it.each([-301, 301])('rejects stale or future timestamps at %s seconds', (delta) =>
    expect(authenticatePaystack(raw, { ...options, current: signed(now + delta) })).toBeNull(),
  );
  it.each(['', 't=x,v1=x', 't=1800000000,t=1800000000', 't=1800000000,v1=k:zz'])(
    'rejects malformed headers %s',
    (current) => expect(authenticatePaystack(raw, { ...options, current })).toBeNull(),
  );
  it('accepts legacy only behind the explicit flag and never downgrades a current signature', () => {
    const legacy = createHmac('sha512', options.legacySecret).update(raw).digest('hex');
    expect(authenticatePaystack(raw, { ...options, current: undefined, legacy })).toBeNull();
    expect(authenticatePaystack(raw, { ...options, current: undefined, legacy, acceptLegacy: true })).toBe(
      'legacy',
    );
    expect(
      authenticatePaystack(raw, { ...options, current: 'invalid', legacy, acceptLegacy: true }),
    ).toBeNull();
    expect(
      authenticatePaystack(raw, { ...options, current: undefined, legacy: 'ff', acceptLegacy: true }),
    ).toBeNull();
  });
  it('signs outbound merchant notifications over timestamp and body', () => {
    expect(signMerchant('{}', secret, now)).toBe(
      `t=${now},v1=${createHmac('sha512', secret).update(`${now}.{}`).digest('hex')}`,
    );
  });
});
