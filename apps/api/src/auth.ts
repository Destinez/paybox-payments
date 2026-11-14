import { and, apiKeys, type Database, dashboardUsers, eq, isNull, sessions, sql } from '@paybox/db';
import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';
import type { Env } from './app';
import type { Config } from './config';
import { safeEqual, sha256 } from './crypto';
import { AppError } from './errors';
import { consumeToken } from './limits';
import { annotate } from './telemetry';
export function requireRole(c: Context<Env>, allowed: ('admin' | 'ops' | 'viewer')[]) {
  const principal = c.get('principal');
  if (!principal.role || !allowed.includes(principal.role))
    throw new AppError('forbidden', 403, 'Your role cannot perform this action');
  return principal;
}
export async function authenticate(c: Context<Env>, db: Database, config: Config) {
  const cookie = getCookie(c, 'paybox_session');
  if (cookie) {
    const [row] = await db
      .select({ session: sessions, user: dashboardUsers })
      .from(sessions)
      .innerJoin(dashboardUsers, eq(sessions.userId, dashboardUsers.id))
      .where(
        and(
          eq(sessions.tokenHash, sha256(`${config.SESSION_SECRET}:${cookie}`)),
          sql`${sessions.expiresAt}>now()`,
        ),
      );
    if (!row) throw new AppError('unauthorized', 401, 'Your session has expired');
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(c.req.method) &&
      !safeEqual(row.session.csrfHash, sha256(c.req.header('X-CSRF-Token') ?? ''))
    )
      throw new AppError('csrf_invalid', 403, 'A valid CSRF token is required');
    if (
      row.user.role === 'viewer' &&
      !['GET', 'HEAD', 'OPTIONS'].includes(c.req.method) &&
      c.req.path !== '/v1/session/logout'
    )
      throw new AppError('forbidden', 403, 'Viewers have read-only access');
    c.set('principal', { actor: row.user.email, userId: row.user.id, role: row.user.role });
    return;
  }
  const token = c.req.header('Authorization')?.replace(/^Bearer /, '');
  if (!token?.startsWith('pbx_test_sk_'))
    throw new AppError('unauthorized', 401, 'A valid merchant API key or session is required');
  const [key] = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.prefix, token.slice(0, 24)), isNull(apiKeys.revokedAt)));
  if (!key || !safeEqual(key.keyHash, sha256(token)))
    throw new AppError('unauthorized', 401, 'A valid merchant API key is required');
  const wait = await consumeToken(db, `api:${key.id}`, 120, 60000);
  if (wait) throw new AppError('rate_limited', 429, 'API key request limit exceeded', Math.ceil(wait / 1000));
  annotate({ merchant_id: key.merchantId });
  c.set('principal', { merchantId: key.merchantId, actor: `api_key:${key.id}` });
}
