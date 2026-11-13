import { createHmac, timingSafeEqual } from 'node:crypto';
export type SignatureOptions = {
  current?: string;
  legacy?: string;
  secrets: string[];
  legacySecret: string;
  acceptLegacy: boolean;
  now?: number;
};
export function authenticatePaystack(raw: Uint8Array, options: SignatureOptions): string | null {
  if (options.current !== undefined) {
    const parts = options.current.split(',').map((value) => value.trim());
    const timestamps = parts.filter((value) => value.startsWith('t='));
    if (timestamps.length !== 1 || !/^t=\d+$/.test(timestamps[0]!)) return null;
    const timestamp = timestamps[0]!.slice(2);
    if (Math.abs((options.now ?? Math.floor(Date.now() / 1000)) - Number(timestamp)) > 300) return null;
    const signatures = parts.filter((value) => value.startsWith('v1=')).map((value) => value.slice(3));
    let matched: string | null = null;
    for (const secret of options.secrets) {
      const expected = createHmac('sha512', secret).update(`${timestamp}.`).update(raw).digest();
      for (const candidate of signatures) {
        const match = /^([A-Za-z0-9_-]+):([a-fA-F0-9]{128})$/.exec(candidate);
        if (match && timingSafeEqual(expected, Buffer.from(match[2]!, 'hex'))) matched = match[1]!;
      }
    }
    return matched;
  }
  if (
    !options.acceptLegacy ||
    !options.legacy ||
    !/^[a-fA-F0-9]{128}$/.test(options.legacy) ||
    !options.legacySecret
  )
    return null;
  const digest = createHmac('sha512', options.legacySecret).update(raw).digest();
  return timingSafeEqual(digest, Buffer.from(options.legacy, 'hex')) ? 'legacy' : null;
}
export function signMerchant(
  body: string,
  secret: string,
  timestamp = Math.floor(Date.now() / 1000),
): string {
  return `t=${timestamp},v1=${createHmac('sha512', secret).update(`${timestamp}.${body}`).digest('hex')}`;
}
