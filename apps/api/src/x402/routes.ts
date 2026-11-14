import { randomBytes } from 'node:crypto';
import {
  and,
  auditLog,
  type Database,
  desc,
  eq,
  fakeSettings,
  merchants,
  x402Routes as routes,
  sql,
  x402Payments,
} from '@paybox/db';
import type { Context } from 'hono';
import { z } from 'zod';
import { type App, type Env, register } from '../app';
import { requireRole } from '../auth';
import type { Config } from '../config';
import { encrypt } from '../crypto';
import { AppError } from '../errors';
import { destination } from '../notifications';
import { X402Gateway } from './gateway';
import { routeInput } from './protocol';

const present = (row: typeof routes.$inferSelect, slug: string) => ({
  id: row.id,
  merchant_id: row.merchantId,
  merchant_slug: slug,
  method: row.method,
  path: row.path,
  upstream_url: row.upstreamUrl,
  price: String(row.price),
  asset: row.asset,
  network: row.network,
  pay_to: row.payTo,
  description: row.description,
  active: row.active,
  gateway_path: `/x402/m/${slug}${row.path}`,
});
export function x402Routes(app: App, db: Database, config: Config) {
  const gateway = new X402Gateway(db, config);
  app.all('/x402/m/:merchantSlug/*', (c) => gateway.handle(c));
  for (const method of ['get', 'post', 'put', 'patch', 'delete', 'head'] as const)
    app.openAPIRegistry.registerPath({
      method,
      path: '/x402/m/{merchantSlug}/{path}',
      summary: 'Request a merchant paid endpoint',
      description:
        'The path parameter is the remaining endpoint path, for example v1/stock. Base Sepolia test USDC only. An authorization is consumed once, even after an upstream or settlement failure.',
      security: [],
      request: {
        params: z.object({ merchantSlug: z.string(), path: z.string() }),
        headers: z.object({ 'PAYMENT-SIGNATURE': z.string().optional() }),
      },
      responses: {
        200: {
          description: 'Successful upstream response after confirmed settlement',
          headers: {
            'PAYMENT-RESPONSE': { schema: { type: 'string' }, description: 'Base64 v2 settlement receipt' },
          },
        },
        402: {
          description: 'Payment challenge or invalid/reused authorization',
          headers: {
            'PAYMENT-REQUIRED': {
              schema: { type: 'string' },
              description: 'Base64 v2 PaymentRequired challenge',
            },
          },
          content: { 'application/problem+json': { schema: z.record(z.unknown()) } },
        },
        404: { description: 'No active priced route' },
        502: { description: 'Upstream unavailable or settlement could not be confirmed' },
      },
    });

  for (const admin of [false, true]) {
    const base = admin ? '/v1/admin/x402' : '/v1/x402';
    function access(c: Context<Env>, write = false) {
      if (admin) requireRole(c, write ? ['admin'] : ['admin', 'ops', 'viewer']);
      return admin ? undefined : c.get('principal').merchantId!;
    }
    register(app, { method: 'get', path: `${base}/routes`, summary: 'List priced routes' }, async (c) => {
      const merchantId = access(c);
      const rows = await db
        .select({ route: routes, slug: merchants.slug })
        .from(routes)
        .innerJoin(merchants, eq(routes.merchantId, merchants.id))
        .where(merchantId ? eq(routes.merchantId, merchantId) : undefined)
        .orderBy(desc(routes.createdAt));
      return c.json({ data: rows.map((row) => present(row.route, row.slug)) });
    });
    for (const update of [false, true]) {
      register(
        app,
        {
          method: update ? 'put' : 'post',
          path: `${base}/routes${update ? '/{id}' : ''}`,
          summary: update ? 'Update a priced route' : 'Register a priced route',
          body: admin && !update ? routeInput.extend({ merchant_id: z.string().uuid() }) : routeInput,
        },
        async (c) => {
          const scopedMerchant = access(c, true);
          const raw = await c.req.json();
          const { merchant_id, ...body } = raw;
          const input = routeInput.parse(body);
          await destination(input.upstream_url, config);
          const result = await db.transaction(async (tx) => {
            const id = update ? z.string().uuid().parse(c.req.param('id')) : undefined;
            const [existing] = id
              ? await tx
                  .select()
                  .from(routes)
                  .where(
                    and(
                      eq(routes.id, id),
                      scopedMerchant ? eq(routes.merchantId, scopedMerchant) : undefined,
                    ),
                  )
                  .for('update')
              : [];
            if (update && !existing) throw new AppError('route_not_found', 404, 'Priced route not found');
            const owner = existing?.merchantId ?? scopedMerchant ?? z.string().uuid().parse(merchant_id);
            const [merchant] = await tx.select().from(merchants).where(eq(merchants.id, owner)).for('update');
            if (!merchant) throw new AppError('not_found', 404, 'Merchant not found');
            const secret = merchant.webhookSecretEnc
              ? undefined
              : `pbx_whsec_${randomBytes(32).toString('hex')}`;
            if (secret)
              await tx
                .update(merchants)
                .set({ webhookSecretEnc: encrypt(secret, config.DATA_KEY) })
                .where(eq(merchants.id, owner));
            const values = {
              merchantId: owner,
              method: input.method,
              path: input.path,
              upstreamUrl: input.upstream_url,
              price: Number(input.price),
              asset: input.asset,
              network: input.network,
              payTo: input.pay_to,
              description: input.description,
              active: input.active,
            };
            const [conflict] = await tx
              .select()
              .from(routes)
              .where(
                and(
                  eq(routes.merchantId, owner),
                  eq(routes.method, input.method),
                  eq(routes.path, input.path),
                ),
              );
            if (conflict && conflict.id !== id)
              throw new AppError('route_exists', 409, 'This method and path are already priced');
            const [row] = id
              ? await tx.update(routes).set(values).where(eq(routes.id, id)).returning()
              : await tx.insert(routes).values(values).returning();
            await tx.insert(auditLog).values({
              actor: c.get('principal').actor,
              action: update ? 'x402_route.updated' : 'x402_route.created',
              targetType: 'x402_route',
              targetId: row!.id,
            });
            return { ...present(row!, merchant.slug), ...(secret ? { signing_secret: secret } : {}) };
          });
          return c.json(result, update ? 200 : 201);
        },
      );
    }
    register(
      app,
      {
        method: 'delete',
        path: `${base}/routes/{id}`,
        summary: 'Deactivate a priced route, preserving payment history',
      },
      async (c) => {
        const merchantId = access(c, true),
          id = z.string().uuid().parse(c.req.param('id'));
        await db.transaction(async (tx) => {
          const [row] = await tx
            .update(routes)
            .set({ active: false })
            .where(and(eq(routes.id, id), merchantId ? eq(routes.merchantId, merchantId) : undefined))
            .returning();
          if (!row) throw new AppError('route_not_found', 404, 'Priced route not found');
          await tx.insert(auditLog).values({
            actor: c.get('principal').actor,
            action: 'x402_route.deactivated',
            targetType: 'x402_route',
            targetId: id,
          });
        });
        return c.json({ id, active: false });
      },
    );
    register(
      app,
      {
        method: 'get',
        path: `${base}/payments`,
        summary: 'List recent x402 payments and separate ledger books',
      },
      async (c) => {
        const merchantId = access(c);
        const rows = await db
          .select({ payment: x402Payments, path: routes.path, method: routes.method })
          .from(x402Payments)
          .innerJoin(routes, eq(x402Payments.routeId, routes.id))
          .where(merchantId ? eq(x402Payments.merchantId, merchantId) : undefined)
          .orderBy(desc(x402Payments.createdAt))
          .limit(100);
        const balances = await db.execute<{ currency: string; amount: string }>(
          sql`SELECT a.currency,coalesce(sum(CASE WHEN l.direction='credit' THEN l.amount ELSE -l.amount END),0)::text AS amount FROM ledger_accounts a JOIN ledger_lines l ON l.account_id=a.id WHERE a.type='liability' AND a.code LIKE '%merchant_payable:%' ${merchantId ? sql`AND a.merchant_id=${merchantId}` : sql``} GROUP BY a.currency`,
        );
        return c.json({
          data: rows.map(({ payment: p, path, method }) => ({
            id: p.id,
            payer: p.payer,
            amount: String(p.amount),
            asset: 'USDC',
            network: p.network,
            status: p.status,
            transaction: p.transactionHash,
            route: `${method} ${path}`,
            created_at: p.createdAt,
            last_error: p.lastError,
          })),
          books: {
            NGN: balances.rows.find((r) => r.currency === 'NGN')?.amount ?? '0',
            USDC: balances.rows.find((r) => r.currency === 'USDC')?.amount ?? '0',
          },
          mode: config.X402_MODE,
        });
      },
    );
  }
  if (config.X402_MODE === 'fake') {
    const controls = z
      .object({
        verify_fail: z.boolean().default(false),
        settle_fail: z.boolean().default(false),
        settle_delay_ms: z.number().int().min(0).max(10000).default(0),
      })
      .strict();
    register(
      app,
      {
        method: 'put',
        path: '/v1/admin/x402/control',
        summary: 'Configure offline facilitator faults',
        body: controls,
      },
      async (c) => {
        const actor = requireRole(c, ['admin']);
        const value = controls.parse(await c.req.json());
        await db.transaction(async (tx) => {
          await tx
            .insert(fakeSettings)
            .values({ id: 'x402_controls', value })
            .onConflictDoUpdate({ target: fakeSettings.id, set: { value } });
          await tx.insert(auditLog).values({
            actor: actor.actor,
            action: 'x402_fake.configured',
            targetType: 'fake_setting',
            targetId: 'x402_controls',
            detail: value,
          });
        });
        return c.json(value);
      },
    );
  }
}
