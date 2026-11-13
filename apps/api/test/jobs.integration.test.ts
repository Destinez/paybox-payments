import { auditLog, eq, jobAttempts, outboxJobs, sql } from '@paybox/db';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { enqueue, JobRunner } from '../src/jobs';
import { ProviderError } from '../src/provider/client';
import { db, pool, resetDatabase, setupDatabase } from './database';

beforeAll(setupDatabase);
beforeEach(resetDatabase);
afterAll(() => pool.end());
it('a failing handler reaches dead after eight attempts; replay preserves history and actor', async () => {
  const job = await enqueue(db, 'test', null, {}, 'test');
  let fail = true;
  const runner = new JobRunner(
    db,
    {
      test: async () => {
        if (fail) throw new ProviderError('Receiver returned HTTP 500', 500);
      },
    },
    true,
  );
  for (let i = 0; i < 8; i++) {
    await db.update(outboxJobs).set({ runAfter: new Date(0) });
    await runner.tick();
  }
  expect((await db.select().from(outboxJobs))[0]?.status).toBe('dead');
  expect(await db.select().from(jobAttempts)).toHaveLength(8);
  await runner.replay(job!.id, 'ops@example.com');
  fail = false;
  await runner.tick();
  expect((await db.select().from(outboxJobs))[0]).toMatchObject({
    status: 'succeeded',
    attempts: 1,
    totalAttempts: 9,
  });
  expect(await db.select().from(jobAttempts)).toHaveLength(9);
  expect((await db.select().from(auditLog))[0]?.actor).toBe('ops@example.com');
  await expect(runner.replay(job!.id, 'ops@example.com')).rejects.toMatchObject({ status: 409 });
});
it('crash recovery re-leases expired work and fences a stale worker completion', async () => {
  await enqueue(db, 'test', null, {}, 'crash');
  const runner = new JobRunner(db, { test: async () => {} });
  const [old] = await runner.claim();
  expect(old?.attempts).toBe(1);
  expect(await runner.claim()).toHaveLength(0);
  await db.update(outboxJobs).set({ leasedUntil: new Date(0) });
  const [recovered] = await runner.claim();
  expect(recovered?.totalAttempts).toBe(2);
  await runner.run(old!);
  expect((await db.select().from(outboxJobs))[0]?.status).toBe('in_flight');
  await runner.run(recovered!);
  expect((await db.select().from(outboxJobs))[0]?.status).toBe('succeeded');
  expect((await db.select().from(jobAttempts).where(eq(jobAttempts.attemptNo, 1)))[0]?.outcome).toBe(
    'lease_expired',
  );
});
it('concurrent workers claim each job once and non-retryable 4xx goes straight to dead', async () => {
  for (let i = 0; i < 20; i++) await enqueue(db, 'test', null, {}, String(i));
  const runner = new JobRunner(db, {
    test: async () => {
      throw new ProviderError('Rejected', 400);
    },
  });
  const claims = await Promise.all([runner.claim(), runner.claim(), runner.claim()]);
  expect(new Set(claims.flat().map((j) => j.id)).size).toBe(20);
  await Promise.all(claims.flat().map((j) => runner.run(j)));
  const count = await db.execute<{ count: string }>(
    sql`SELECT count(*)::text FROM outbox_jobs WHERE status='dead' AND attempts=1`,
  );
  expect(count.rows[0]?.count).toBe('20');
});

it('DLQ API requires an operator role and valid CSRF token', async () => {
  const { fixture, operatorFixture } = await import('./fixtures');
  const f = await fixture(db);
  const ops = await operatorFixture(db, f.config),
    viewer = await operatorFixture(db, f.config, 'viewer');
  const job = await enqueue(db, 'test', null, {}, 'api-dlq');
  await db.update(outboxJobs).set({ status: 'dead' });
  expect((await f.app.request('/v1/admin/dlq', { headers: f.headers })).status).toBe(403);
  expect((await f.app.request('/v1/admin/dlq', { headers: ops.headers })).status).toBe(200);
  const path = `/v1/admin/dlq/${job!.id}/replay`;
  expect((await f.app.request(path, { method: 'POST', headers: viewer.headers })).status).toBe(403);
  expect(
    (await f.app.request(path, { method: 'POST', headers: { Cookie: ops.headers.Cookie } })).status,
  ).toBe(403);
  expect((await f.app.request(path, { method: 'POST', headers: ops.headers })).status).toBe(202);
  expect((await db.select().from(auditLog))[0]?.actor).toBe(ops.user.email);
});
