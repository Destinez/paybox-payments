import { type Database, desc, eq, jobAttempts, outboxJobs } from '@paybox/db';
import { z } from 'zod';
import { type App, register } from './app';
import { requireRole } from './auth';
import { JobRunner } from './jobs';
export function operationRoutes(app: App, db: Database) {
  register(app, { method: 'get', path: '/v1/admin/dlq', summary: 'List dead-letter jobs' }, async (c) => {
    requireRole(c, ['admin', 'ops', 'viewer']);
    const rows = await db
      .select()
      .from(outboxJobs)
      .where(eq(outboxJobs.status, 'dead'))
      .orderBy(desc(outboxJobs.createdAt))
      .limit(100);
    return c.json({
      data: await Promise.all(
        rows.map(async (row) => ({
          ...row,
          history: await db
            .select()
            .from(jobAttempts)
            .where(eq(jobAttempts.jobId, row.id))
            .orderBy(jobAttempts.attemptNo),
        })),
      ),
    });
  });
  register(
    app,
    { method: 'post', path: '/v1/admin/dlq/{jobId}/replay', summary: 'Replay a dead job', status: 202 },
    async (c) => {
      const actor = requireRole(c, ['admin', 'ops']);
      return c.json(
        await new JobRunner(db, {}).replay(z.string().uuid().parse(c.req.param('jobId')), actor.actor),
        202,
      );
    },
  );
}
