import { createHmac, timingSafeEqual } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { Config } from '../config';
import { destination } from '../notifications';
import { ProviderError } from '../provider/client';
export function signUpstream(
  data: Record<string, unknown>,
  secret: string,
  timestamp = Math.floor(Date.now() / 1000),
) {
  const serialized = JSON.stringify(data);
  return `t=${timestamp},v1=${createHmac('sha512', secret).update(`${timestamp}.${serialized}`).digest('hex')},data=${Buffer.from(serialized).toString('base64url')}`;
}
export function verifyUpstream(header: string, secret: string): Record<string, unknown> | null {
  const match = /^t=(\d+),v1=([a-f0-9]{128}),data=([A-Za-z0-9_-]+)$/.exec(header);
  if (!match || Math.abs(Date.now() / 1000 - Number(match[1])) > 300) return null;
  const raw = Buffer.from(match[3]!, 'base64url');
  if (raw.toString('base64url') !== match[3]) return null;
  const digest = createHmac('sha512', secret).update(`${match[1]}.`).update(raw).digest();
  if (!timingSafeEqual(digest, Buffer.from(match[2]!, 'hex'))) return null;
  try {
    return JSON.parse(raw.toString());
  } catch {
    return null;
  }
}
export async function proxyUpstream(
  value: string,
  method: string,
  body: Buffer,
  headers: Record<string, string>,
  config: Config,
): Promise<{ status: number; body: Buffer; contentType: string }> {
  const { url, address } = await destination(value, config);
  return new Promise((resolve, reject) => {
    const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(
      url,
      {
        method,
        headers: { ...headers, 'Content-Length': body.length },
        lookup: (_hostname, options, callback) =>
          options.all ? callback(null, [address]) : callback(null, address.address, address.family),
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > 1048576) request.destroy(new Error('Upstream response exceeded 1 MB'));
          else chunks.push(chunk);
        });
        response.on('end', () => {
          clearTimeout(timeout);
          resolve({
            status: response.statusCode ?? 502,
            body: Buffer.concat(chunks),
            contentType: response.headers['content-type']?.includes('application/json')
              ? 'application/json'
              : 'text/plain; charset=utf-8',
          });
        });
        response.on('error', () => {
          clearTimeout(timeout);
          reject(new ProviderError('Upstream response was interrupted', 502));
        });
      },
    );
    const timeout = setTimeout(() => request.destroy(new Error('Upstream timeout')), 10000);
    request.on('error', () => {
      clearTimeout(timeout);
      reject(new ProviderError('Merchant upstream could not complete the request', 502));
    });
    request.end(body);
  });
}
