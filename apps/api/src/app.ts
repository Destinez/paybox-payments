import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { type Database, newId, sql } from '@paybox/db';
import { listPaymentsInput, paymentInput, refundInput } from '@paybox/shared';
import type { Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { authenticate } from './auth';
import type { Config } from './config';
import { dashboardRoutes } from './dashboard';
import { AppError } from './errors';
import { notificationRoutes } from './notifications';
import { operationRoutes } from './operations';
import { Payments } from './payments';
import type { PaystackClient } from './provider/client';
import { FakePaystackClient } from './provider/fake';
import { fakeRoutes } from './provider/routes';
import { reconciliationRoutes } from './reconciliation';
import { Refunds } from './refunds';
import { requestVerification } from './settlement';
import { ingestWebhook } from './webhooks';

export type Principal = {
  merchantId?: string;
  actor: string;
  role?: 'admin' | 'ops' | 'viewer';
  userId?: string;
};
export type Env = { Variables: { requestId: string; principal: Principal } };
export type App = OpenAPIHono<Env>;
export function problem(c: Context<Env>, error: AppError) {
  if (error.retryAfter) c.header('Retry-After', String(error.retryAfter));
  c.header('Content-Type', 'application/problem+json');
  return c.body(
    JSON.stringify({
      type: `https://paybox.dev/errors/${error.code}`,
      title: error.message,
      status: error.status,
      code: error.code,
      detail: error.message,
      request_id: c.get('requestId'),
    }),
    error.status,
  );
}
const jsonObject = z.record(z.unknown());
export function register(
  app: App,
  definition: {
    method: 'get' | 'post' | 'put' | 'delete';
    path: string;
    summary: string;
    body?: z.ZodTypeAny;
    query?: z.ZodObject<z.ZodRawShape>;
    response?: z.ZodTypeAny;
    status?: 200 | 201 | 202;
    public?: boolean;
  },
  handler: (c: Context<Env>) => Response | Promise<Response>,
) {
  const response = {
    description: 'Success',
    content: { 'application/json': { schema: definition.response ?? jsonObject } },
  };
  const error = {
    description: 'Problem details',
    content: { 'application/problem+json': { schema: jsonObject } },
  };
  app.openapi(
    createRoute({
      method: definition.method,
      path: definition.path,
      summary: definition.summary,
      security: definition.public ? [] : [{ merchantKey: [] }, { sessionCookie: [] }],
      request: {
        params: z.object(
          Object.fromEntries(
            [...definition.path.matchAll(/\{(\w+)\}/g)].map((match) => [match[1]!, z.string().uuid()]),
          ),
        ),
        ...(definition.body
          ? { body: { required: true, content: { 'application/json': { schema: definition.body } } } }
          : {}),
        ...(definition.query ? { query: definition.query } : {}),
      },
      responses: {
        200: response,
        201: response,
        202: response,
        400: error,
        401: error,
        403: error,
        404: error,
        409: error,
        422: error,
        429: error,
        502: error,
      },
    }),
    handler,
  );
}
export function createApp(db: Database, client: PaystackClient, config: Config) {
  const app = new OpenAPIHono<Env>({
    defaultHook: (result, c) => {
      if (!result.success)
        return problem(
          c,
          new AppError(
            'validation_error',
            400,
            result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(';'),
          ),
        );
    },
  });
  const service = new Payments(db, client, config);
  app.use('*', async (c, next) => {
    c.set('requestId', `req_${newId()}`);
    c.header('X-Request-Id', c.get('requestId'));
    await next();
  });
  app.use('*', secureHeaders());
  app.use(
    '*',
    cors({
      origin: config.WEB_URL,
      credentials: true,
      allowHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-CSRF-Token'],
      exposeHeaders: ['X-Request-Id', 'Idempotent-Replayed', 'Retry-After'],
    }),
  );
  app.use(
    '*',
    bodyLimit({
      maxSize: 262144,
      onError: (c) => problem(c, new AppError('payload_too_large', 413, 'Request body exceeds 256 KB')),
    }),
  );
  app.use('/v1/*', async (c, next) => {
    if (c.req.path === '/v1/openapi.json' || c.req.path === '/v1/session/login') return next();
    await authenticate(c, db, config);
    if (
      !c.req.path.startsWith('/v1/admin') &&
      !c.req.path.startsWith('/v1/session') &&
      !c.get('principal').merchantId
    )
      throw new AppError('forbidden', 403, 'Use a merchant API key for merchant routes');
    await next();
  });
  app.onError((error, c) => {
    if (error instanceof AppError) return problem(c, error);
    if (error instanceof z.ZodError || error instanceof SyntaxError)
      return problem(c, new AppError('validation_error', 400, 'Invalid request body'));
    console.error(
      JSON.stringify({
        level: 'error',
        request_id: c.get('requestId'),
        msg: 'Request failed',
        error_type: error.name,
      }),
    );
    return problem(c, new AppError('internal_error', 500, 'An unexpected error occurred'));
  });
  app.notFound((c) => problem(c, new AppError('not_found', 404, 'Route not found')));
  register(app, { method: 'get', path: '/healthz', summary: 'Process liveness', public: true }, (c) =>
    c.json({ status: 'ok' }),
  );
  register(
    app,
    { method: 'get', path: '/readyz', summary: 'Database readiness', public: true },
    async (c) => {
      await db.execute(sql`SELECT 1`);
      return c.json({ status: 'ready' });
    },
  );
  register(
    app,
    {
      method: 'post',
      path: '/v1/payments',
      summary: 'Initialize a payment',
      body: paymentInput,
      status: 201,
    },
    async (c) => {
      const result = await service.create(
        c.get('principal').merchantId!,
        c.req.header('Idempotency-Key'),
        await c.req.json(),
      );
      if (result.replayed) c.header('Idempotent-Replayed', 'true');
      if (result.status >= 400)
        return problem(
          c,
          new AppError(String(result.body.code), result.status as 409, String(result.body.detail)),
        );
      return c.json(result.body, result.status as ContentfulStatusCode);
    },
  );
  register(
    app,
    { method: 'get', path: '/v1/payments', summary: 'List payments', query: listPaymentsInput },
    async (c) => c.json(await service.list(c.req.query(), c.get('principal').merchantId)),
  );
  register(
    app,
    { method: 'get', path: '/v1/payments/{id}', summary: 'Payment details and accounting timeline' },
    async (c) =>
      c.json(await service.detail(z.string().uuid().parse(c.req.param('id')), c.get('principal').merchantId)),
  );
  register(
    app,
    { method: 'post', path: '/v1/payments/{id}/verify', summary: 'Verify a payment through the outbox' },
    async (c) => {
      const payment = await service.find(
        z.string().uuid().parse(c.req.param('id')),
        c.get('principal').merchantId,
      );
      if (payment.status === 'created')
        throw new AppError('invalid_state', 409, 'Payment has not initialized');
      const job = await requestVerification(db, payment.id, payment.correlationId);
      return c.json({
        ...(await service.detail(payment.id, c.get('principal').merchantId)),
        verification_pending: job?.status !== 'succeeded',
        verification_job_id: job?.id,
      });
    },
  );
  const refundService = new Refunds(db, client);
  register(
    app,
    {
      method: 'post',
      path: '/v1/payments/{id}/refunds',
      summary: 'Request a full or partial refund',
      body: refundInput,
      status: 202,
    },
    async (c) => {
      const payment = await service.find(
        z.string().uuid().parse(c.req.param('id')),
        c.get('principal').merchantId,
      );
      const result = await refundService.request(
        payment.merchantId,
        payment.id,
        c.req.header('Idempotency-Key'),
        await c.req.json(),
        c.get('principal').actor,
      );
      if (result.replayed) c.header('Idempotent-Replayed', 'true');
      if (result.status >= 400)
        return problem(
          c,
          new AppError(String(result.body.code), result.status as 422, String(result.body.detail)),
        );
      return c.json(result.body, 202);
    },
  );
  register(app, { method: 'get', path: '/v1/refunds/{id}', summary: 'Retrieve a refund' }, async (c) =>
    c.json(
      (await refundService.find(z.string().uuid().parse(c.req.param('id')), c.get('principal').merchantId))
        .refund,
    ),
  );
  dashboardRoutes(app, db, client, config);
  reconciliationRoutes(app, db, client);
  notificationRoutes(app, db, config);
  operationRoutes(app, db);
  app.openAPIRegistry.registerComponent('securitySchemes', 'merchantKey', { type: 'http', scheme: 'bearer' });
  app.openAPIRegistry.registerComponent('securitySchemes', 'sessionCookie', {
    type: 'apiKey',
    in: 'cookie',
    name: 'paybox_session',
  });
  app.doc('/v1/openapi.json', {
    openapi: '3.0.3',
    info: {
      title: 'Paybox Payments',
      version: '1.0.0',
      description:
        'Paystack test mode. Amounts are integer kobo. Idempotency-Key is required for payment and refund creation.',
    },
    servers: [{ url: config.API_PUBLIC_URL }],
  });
  app.get('/docs', (c) =>
    c.html(
      '<!doctype html><html lang="en"><title>Paybox API</title><h1>Paybox Payments API</h1><p>Amounts are integer kobo. Authenticate with a merchant test key.</p><a href="/v1/openapi.json">OpenAPI 3.0 specification</a></html>',
    ),
  );
  register(
    app,
    {
      method: 'post',
      path: '/webhooks/paystack',
      summary: 'Receive authenticated Paystack events',
      public: true,
    },
    async (c) => {
      await ingestWebhook(db, config, Buffer.from(await c.req.arrayBuffer()), {
        current: c.req.header('Paystack-Signature'),
        legacy: c.req.header('x-paystack-signature'),
      });
      return c.json({ received: true });
    },
  );
  if (client instanceof FakePaystackClient)
    app.route(
      '/fake',
      fakeRoutes(client, async (body, signature) => {
        await ingestWebhook(db, config, Buffer.from(body), { current: signature });
      }),
    );
  return { app, service };
}
