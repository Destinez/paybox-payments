import { expect, it } from 'vitest';
import { backoff } from './retry';

it('retry jitter stays in the exponential window, caps at ten minutes and honours Retry-After', () => {
  expect(backoff(1, { random: () => 0.5 })).toBe(1000);
  expect(backoff(4, { random: () => 1 })).toBe(16000);
  expect(backoff(50, { random: () => 1 })).toBe(600000);
  expect(backoff(2, { random: () => 0, retryAfterMs: 9000 })).toBe(9000);
  expect(backoff(8, { demo: true, random: () => 1 })).toBe(2000);
  expect(() => backoff(0)).toThrow();
});
