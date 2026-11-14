import { createHmac, randomBytes } from 'node:crypto';
import { getConnInfo } from '@hono/node-server/conninfo';
import { hash, verify } from '@node-rs/argon2';
import {
  apiKeys,
  auditLog,
  type Database,
  dashboardUsers,
  desc,
  eq,
  jobAttempts,
  merchants,
  outboxJobs,
  paymentEvents,
  reconciliationRuns,
  sessions,
  sql,
  webhookDeliveries,
  webhookEvents,
} from '@paybox/db';
import { listPaymentsInput, paymentInput, refundInput } from '@paybox/shared';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import { type App, problem, register } from './app';
import { requireRole } from './auth';
import type { Config } from './config';
import { sha256 } from './crypto';
import { AppError } from './errors';
import { consumeToken } from './limits';
import { Payments } from './payments';
import type { PaystackClient } from './provider/client';
import { Refunds } from './refunds';
import { requestVerification } from './settlement';
import { annotate } from './telemetry';

const csrf = (token: string, secret: string) =>
  createHmac('sha256', secret).update(`csrf:${token}`).digest('hex');
const dummyHash = hash(randomBytes(32).toString('hex'));
export function dashboardRoutes(app: App, db: Database, client: PaystackClient, config: Config) {
  const paymentService = new Payments(db, client, config),
    refundService = new Refunds(db, client);
  register(
    app,
    {
      method: 'post',
      path: '/v1/session/login',
      summary: 'Sign in to the operations dashboard',
      public: true,
      body: z.object({ email: z.string().email(), password: z.string().min(1).max(256) }).strict(),
    },
    async (c) => {
      const input = z.object({ email: z.string().email(), password: z.string() }).parse(await c.req.json());
      let ip = 'unknown';
      try {
        ip = getConnInfo(c).remote.address ?? 'unknown';
      } catch {}
      const wait = await consumeToken(
        db,
        `login:${sha256(`${ip}:${input.email.toLowerCase()}`)}`,
        10,
        900000,
      );
      if (wait)
        throw new AppError('rate_limited', 429, 'Login attempt limit exceeded', Math.ceil(wait / 1000));
      const [user] = await db
        .select()
        .from(dashboardUsers)
        .where(sql`lower(${dashboardUsers.email})=${input.email.toLowerCase()}`);
      const valid = await verify(user?.passwordHash ?? (await dummyHash), input.password).catch(() => false);
      if (!valid || !user) throw new AppError('invalid_credentials', 401, 'Email or password is incorrect');
      const token = randomBytes(32).toString('hex'),
        csrfToken = csrf(token, config.SESSION_SECRET);
      await db.transaction(async (tx) => {
        await tx.insert(sessions).values({
          userId: user.id,
          tokenHash: sha256(`${config.SESSION_SECRET}:${token}`),
          csrfHash: sha256(csrfToken),
          expiresAt: new Date(Date.now() + 8 * 3600000),
        });
        await tx
          .insert(auditLog)
          .values({ actor: user.email, action: 'session.created', targetType: 'user', targetId: user.id });
      });
      setCookie(c, 'paybox_session', token, {
        httpOnly: true,
        sameSite: 'Lax',
        secure: config.WEB_URL.startsWith('https:'),
        path: '/',
        maxAge: 8 * 3600,
      });
      return c.json({
        user: { id: user.id, email: user.email, role: user.role },
        csrf_token: csrfToken,
        mode: config.PAYSTACK_MODE,
      });
    },
  );
  register(
    app,
    { method: 'get', path: '/v1/session', summary: 'Read the current dashboard session' },
    (c) => {
      const user = requireRole(c, ['admin', 'ops', 'viewer']);
      return c.json({
        user: { id: user.userId, email: user.actor, role: user.role },
        csrf_token: csrf(getCookie(c, 'paybox_session')!, config.SESSION_SECRET),
        mode: config.PAYSTACK_MODE,
      });
    },
  );
  register(
    app,
    { method: 'post', path: '/v1/session/logout', summary: 'End the current session' },
    async (c) => {
      const user = requireRole(c, ['admin', 'ops', 'viewer']);
      await db.transaction(async (tx) => {
        await tx
          .delete(sessions)
          .where(
            eq(sessions.tokenHash, sha256(`${config.SESSION_SECRET}:${getCookie(c, 'paybox_session')}`)),
          );
        await tx
          .insert(auditLog)
          .values({ actor: user.actor, action: 'session.ended', targetType: 'user', targetId: user.userId! });
      });
      deleteCookie(c, 'paybox_session', { path: '/' });
      return c.json({ signed_out: true });
    },
  );
  register(
    app,
    { method: 'get', path: '/v1/admin/summary', summary: 'Operations KPIs and daily volume' },
    async (c) => {
      requireRole(c, ['admin', 'ops', 'viewer']);
      const [stats, dlq, runs, series] = await Promise.all([
        db.execute<{ volume: string; total: string; successful: string }>(
          sql`SELECT coalesce(sum(amount) FILTER (WHERE status IN ('succeeded','partially_refunded','refunded') AND created_at >= (date_trunc('day',now() AT TIME ZONE 'Africa/Lagos') AT TIME ZONE 'Africa/Lagos')),0)::text AS volume,count(*)::text AS total,count(*) FILTER (WHERE status IN ('succeeded','partially_refunded','refunded'))::text AS successful FROM payments`,
        ),
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(outboxJobs)
          .where(eq(outboxJobs.status, 'dead')),
        db.select().from(reconciliationRuns).orderBy(desc(reconciliationRuns.createdAt)).limit(1),
        db.execute<{ day: string; volume: string; count: number }>(
          sql`SELECT to_char(days.day,'YYYY-MM-DD') AS day,coalesce(sum(p.amount),0)::text AS volume,count(p.id)::int AS count FROM generate_series(date_trunc('day',now() AT TIME ZONE 'Africa/Lagos')-interval '13 days',date_trunc('day',now() AT TIME ZONE 'Africa/Lagos'),interval '1 day') days(day) LEFT JOIN payments p ON (p.created_at AT TIME ZONE 'Africa/Lagos')::date=days.day::date AND p.status IN ('succeeded','partially_refunded','refunded') GROUP BY days.day ORDER BY days.day`,
        ),
      ]);
      const stat = stats.rows[0]!;
      return c.json({
        volume_today: stat.volume,
        total: Number(stat.total),
        successful: Number(stat.successful),
        success_rate: Number(stat.total) ? (Number(stat.successful) / Number(stat.total)) * 100 : 0,
        dlq_depth: dlq[0]?.count ?? 0,
        last_reconciliation: runs[0] ?? null,
        series: series.rows,
        mode: config.PAYSTACK_MODE,
      });
    },
  );
  register(app, { method: 'get', path: '/v1/admin/merchants', summary: 'List merchants' }, async (c) => {
    requireRole(c, ['admin', 'ops', 'viewer']);
    return c.json({
      data: await db
        .select({ id: merchants.id, name: merchants.name, webhook_url: merchants.webhookUrl })
        .from(merchants),
    });
  });
  register(
    app,
    {
      method: 'get',
      path: '/v1/admin/payments',
      summary: 'Search payments across merchants',
      query: listPaymentsInput,
    },
    async (c) => {
      requireRole(c, ['admin', 'ops', 'viewer']);
      return c.json(await paymentService.list(c.req.query()));
    },
  );
  register(
    app,
    {
      method: 'post',
      path: '/v1/admin/payments',
      summary: 'Initialize a payment for a merchant',
      body: paymentInput.extend({ merchant_id: z.string().uuid() }),
      status: 201,
    },
    async (c) => {
      const actor = requireRole(c, ['admin', 'ops']);
      const { merchant_id, ...body } = (await c.req.json()) as {
        merchant_id: string;
        [key: string]: unknown;
      };
      const result = await paymentService.create(merchant_id, c.req.header('Idempotency-Key'), body);
      if (result.body.correlation_id)
        annotate({
          correlation_id: String(result.body.correlation_id),
          payment_id: String(result.body.id),
          merchant_id,
        });
      if (result.replayed) c.header('Idempotent-Replayed', 'true');
      if (result.status >= 400)
        return problem(
          c,
          new AppError(String(result.body.code), result.status as 409, String(result.body.detail)),
        );
      if (!result.replayed)
        await db.insert(auditLog).values({
          actor: actor.actor,
          action: 'payment.created',
          targetType: 'payment',
          targetId: String(result.body.id),
        });
      return c.json(result.body, 201);
    },
  );
  register(
    app,
    { method: 'get', path: '/v1/admin/payments/{id}', summary: 'Read a payment operations timeline' },
    async (c) => {
      const actor = requireRole(c, ['admin', 'ops', 'viewer']),
        id = z.string().uuid().parse(c.req.param('id'));
      const detail = await paymentService.detail(id, undefined, actor.role !== 'viewer');
      const [events, attempts, deliveries] = await Promise.all([
        db
          .select({
            id: paymentEvents.id,
            created_at: paymentEvents.createdAt,
            type: paymentEvents.type,
            source: paymentEvents.source,
            detail: paymentEvents.detail,
            correlation_id: paymentEvents.correlationId,
          })
          .from(paymentEvents)
          .where(eq(paymentEvents.paymentId, id)),
        db
          .select({
            id: jobAttempts.id,
            created_at: jobAttempts.startedAt,
            type: outboxJobs.type,
            outcome: jobAttempts.outcome,
            attempt: jobAttempts.attemptNo,
            error: jobAttempts.error,
            job_id: outboxJobs.id,
          })
          .from(jobAttempts)
          .innerJoin(outboxJobs, eq(jobAttempts.jobId, outboxJobs.id))
          .where(eq(outboxJobs.aggregateId, id)),
        db
          .select({
            id: webhookDeliveries.id,
            created_at: webhookDeliveries.createdAt,
            type: webhookEvents.eventType,
            outcome: webhookDeliveries.outcome,
            status: webhookEvents.status,
          })
          .from(webhookDeliveries)
          .innerJoin(webhookEvents, eq(webhookDeliveries.eventId, webhookEvents.id))
          .where(eq(webhookEvents.paymentId, id)),
      ]);
      const timeline = [
        ...events,
        ...attempts.map((row) => ({
          ...row,
          source: 'worker',
          detail: { attempt: row.attempt, outcome: row.outcome, error: row.error },
          correlation_id: detail.correlation_id,
        })),
        ...deliveries.map((row) => ({
          ...row,
          source: 'webhook',
          detail: { outcome: row.outcome, status: row.status },
          correlation_id: detail.correlation_id,
        })),
        ...detail.ledger_entries.map((row) => ({
          ...row,
          type: `ledger.${row.kind}`,
          source: 'ledger',
          detail: { account: row.account, direction: row.direction, amount: row.amount },
          correlation_id: detail.correlation_id,
        })),
      ].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      return c.json({ ...detail, timeline });
    },
  );
  register(
    app,
    { method: 'post', path: '/v1/admin/payments/{id}/verify', summary: 'Verify a payment as an operator' },
    async (c) => {
      const actor = requireRole(c, ['admin', 'ops']);
      const payment = await paymentService.find(z.string().uuid().parse(c.req.param('id')));
      await db.insert(auditLog).values({
        actor: actor.actor,
        action: 'payment.verify_requested',
        targetType: 'payment',
        targetId: payment.id,
      });
      await requestVerification(db, payment.id, payment.correlationId);
      return c.json(await paymentService.detail(payment.id));
    },
  );
  register(
    app,
    {
      method: 'post',
      path: '/v1/admin/payments/{id}/refunds',
      summary: 'Request a refund as an operator',
      body: refundInput,
      status: 202,
    },
    async (c) => {
      const actor = requireRole(c, ['admin', 'ops']);
      const payment = await paymentService.find(z.string().uuid().parse(c.req.param('id')));
      const result = await refundService.request(
        payment.merchantId,
        payment.id,
        c.req.header('Idempotency-Key'),
        await c.req.json(),
        actor.actor,
      );
      if (result.replayed) c.header('Idempotent-Replayed', 'true');
      if (result.status >= 400)
        return problem(
          c,
          new AppError(String(result.body.code), result.status as 422, String(result.body.detail)),
        );
      if (!result.replayed)
        await db.insert(auditLog).values({
          actor: actor.actor,
          action: 'refund.requested',
          targetType: 'refund',
          targetId: String(result.body.id),
        });
      return c.json(result.body, 202);
    },
  );
  register(app, { method: 'get', path: '/v1/admin/users', summary: 'List dashboard users' }, async (c) => {
    requireRole(c, ['admin']);
    return c.json({
      data: await db
        .select({
          id: dashboardUsers.id,
          email: dashboardUsers.email,
          role: dashboardUsers.role,
          created_at: dashboardUsers.createdAt,
        })
        .from(dashboardUsers),
    });
  });
  register(
    app,
    {
      method: 'post',
      path: '/v1/admin/users',
      summary: 'Create a dashboard user',
      body: z
        .object({
          email: z.string().email(),
          password: z.string().min(12).max(256),
          role: z.enum(['admin', 'ops', 'viewer']),
        })
        .strict(),
      status: 201,
    },
    async (c) => {
      const actor = requireRole(c, ['admin']);
      const input = z
        .object({
          email: z.string().email(),
          password: z.string().min(12).max(256),
          role: z.enum(['admin', 'ops', 'viewer']),
        })
        .parse(await c.req.json());
      const passwordHash = await hash(input.password);
      const result = await db.transaction(async (tx) => {
        const [user] = await tx
          .insert(dashboardUsers)
          .values({ email: input.email.toLowerCase(), passwordHash, role: input.role })
          .onConflictDoNothing()
          .returning();
        if (!user) throw new AppError('email_taken', 409, 'This email is already in use');
        await tx
          .insert(auditLog)
          .values({ actor: actor.actor, action: 'user.created', targetType: 'user', targetId: user.id });
        return { id: user.id, email: user.email, role: user.role };
      });
      return c.json(result, 201);
    },
  );
  register(app, { method: 'get', path: '/v1/admin/keys', summary: 'List API key prefixes' }, async (c) => {
    requireRole(c, ['admin']);
    return c.json({
      data: await db
        .select({
          id: apiKeys.id,
          merchant_id: apiKeys.merchantId,
          prefix: apiKeys.prefix,
          revoked_at: apiKeys.revokedAt,
          created_at: apiKeys.createdAt,
        })
        .from(apiKeys),
    });
  });
  register(
    app,
    {
      method: 'post',
      path: '/v1/admin/keys',
      summary: 'Issue a merchant API key, shown once',
      body: z.object({ merchant_id: z.string().uuid() }).strict(),
      status: 201,
    },
    async (c) => {
      const actor = requireRole(c, ['admin']);
      const { merchant_id } = z.object({ merchant_id: z.string().uuid() }).parse(await c.req.json());
      const key = `pbx_test_sk_${randomBytes(24).toString('hex')}`;
      const record = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(apiKeys)
          .values({ merchantId: merchant_id, prefix: key.slice(0, 24), keyHash: sha256(key) })
          .returning();
        await tx.insert(auditLog).values({
          actor: actor.actor,
          action: 'api_key.created',
          targetType: 'api_key',
          targetId: row!.id,
        });
        return row!;
      });
      return c.json({ id: record.id, key }, 201);
    },
  );
  register(
    app,
    { method: 'delete', path: '/v1/admin/keys/{id}', summary: 'Revoke a merchant API key' },
    async (c) => {
      const actor = requireRole(c, ['admin']),
        id = z.string().uuid().parse(c.req.param('id'));
      await db.transaction(async (tx) => {
        const [key] = await tx
          .update(apiKeys)
          .set({ revokedAt: new Date() })
          .where(eq(apiKeys.id, id))
          .returning();
        if (!key) throw new AppError('not_found', 404, 'API key not found');
        await tx
          .insert(auditLog)
          .values({ actor: actor.actor, action: 'api_key.revoked', targetType: 'api_key', targetId: id });
      });
      return c.json({ revoked: true });
    },
  );
}
