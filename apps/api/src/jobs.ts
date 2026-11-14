import {
  and,
  auditLog,
  type Database,
  eq,
  jobAttempts,
  newId,
  or,
  outboxJobs,
  sql,
  type Transaction,
} from '@paybox/db';
import { backoff } from '@paybox/shared';
import { z } from 'zod';
import { AppError } from './errors';
import { ProviderError } from './provider/client';
import { log, requestContext } from './telemetry';
export type Job = typeof outboxJobs.$inferSelect;
export type JobHandler = (job: Job) => Promise<void>;
export async function enqueue(
  tx: Database | Transaction,
  type: string,
  aggregateId: string | null,
  payload: Record<string, unknown>,
  dedupeKey: string,
  runAfter?: Date,
) {
  const [job] = await tx
    .insert(outboxJobs)
    .values({ type, aggregateId, payload, dedupeKey, runAfter })
    .onConflictDoNothing({ target: outboxJobs.dedupeKey })
    .returning();
  return job;
}
export class JobRunner {
  constructor(
    readonly db: Database,
    readonly handlers: Record<string, JobHandler>,
    readonly demo = false,
  ) {}
  async claim(limit = 10): Promise<Job[]> {
    return this.db.transaction(async (tx) => {
      const candidates = await tx
        .select()
        .from(outboxJobs)
        .where(
          or(
            and(eq(outboxJobs.status, 'pending'), sql`${outboxJobs.runAfter}<=now()`),
            and(eq(outboxJobs.status, 'in_flight'), sql`${outboxJobs.leasedUntil}<now()`),
          ),
        )
        .orderBy(outboxJobs.runAfter)
        .limit(limit)
        .for('update', { skipLocked: true });
      const claimed: Job[] = [];
      for (const row of candidates) {
        if (row.status === 'in_flight')
          await tx
            .update(jobAttempts)
            .set({
              outcome: 'lease_expired',
              finishedAt: new Date(),
              error: 'Worker lease expired before completion',
            })
            .where(and(eq(jobAttempts.jobId, row.id), eq(jobAttempts.attemptNo, row.totalAttempts)));
        if (row.attempts >= row.maxAttempts) {
          await tx
            .update(outboxJobs)
            .set({
              status: 'dead',
              lastError: 'Attempt budget exhausted after lease expiry',
              leasedUntil: null,
              leaseOwner: null,
            })
            .where(eq(outboxJobs.id, row.id));
          continue;
        }
        const [job] = await tx
          .update(outboxJobs)
          .set({
            status: 'in_flight',
            leaseOwner: newId(),
            leasedUntil: sql`now() + interval '30 seconds'`,
            attempts: row.attempts + 1,
            totalAttempts: row.totalAttempts + 1,
          })
          .where(eq(outboxJobs.id, row.id))
          .returning();
        await tx.insert(jobAttempts).values({ jobId: row.id, attemptNo: job!.totalAttempts });
        claimed.push(job!);
      }
      return claimed;
    });
  }
  async run(job: Job) {
    const ownership = and(eq(outboxJobs.id, job.id), eq(outboxJobs.leaseOwner, job.leaseOwner!));
    const heartbeat = setInterval(() => {
      void this.db
        .update(outboxJobs)
        .set({ leasedUntil: sql`now() + interval '30 seconds'` })
        .where(ownership)
        .catch(() => {});
    }, 10000);
    heartbeat.unref();
    let failure: unknown;
    try {
      const handler = this.handlers[job.type];
      if (!handler) throw new AppError('unsupported_job', 422, 'No handler is registered for this job type');
      await requestContext.run(
        {
          job_id: job.id,
          correlation_id: String(job.payload.correlation_id ?? job.id),
          merchant_id: job.payload.merchant_id ? String(job.payload.merchant_id) : undefined,
          payment_id: job.payload.payment_id ? String(job.payload.payment_id) : undefined,
          event_type: job.payload.event ? String(job.payload.event) : undefined,
        },
        async () => {
          log.info({ type: job.type, attempt: job.totalAttempts }, 'Job started');
          await handler(job);
          log.info({ type: job.type }, 'Job completed');
        },
      );
    } catch (error) {
      failure = error;
      log.warn(
        {
          job_id: job.id,
          correlation_id: String(job.payload.correlation_id ?? job.id),
          error_type: error instanceof Error ? error.name : 'UnknownError',
        },
        'Job attempt failed',
      );
    } finally {
      clearInterval(heartbeat);
    }
    await this.db.transaction(async (tx) => {
      const [owned] = await tx.select().from(outboxJobs).where(ownership).for('update');
      if (!owned) return;
      const retryable =
        failure instanceof ProviderError
          ? failure.retryable
          : failure instanceof AppError
            ? failure.status >= 500
            : !(failure instanceof z.ZodError);
      const error =
        failure instanceof ProviderError || failure instanceof AppError
          ? failure.message
          : failure
            ? 'Handler failed; inspect the correlated service log'
            : null;
      const dead = Boolean(failure) && (!retryable || job.attempts >= job.maxAttempts);
      const status = failure ? (dead ? 'dead' : 'pending') : 'succeeded';
      const retryAfterMs = failure instanceof ProviderError ? failure.retryAfterMs : 0;
      await tx
        .update(outboxJobs)
        .set({
          status,
          lastError: error,
          leasedUntil: null,
          leaseOwner: null,
          runAfter: failure
            ? sql`now() + ${backoff(job.attempts, { demo: this.demo, retryAfterMs })} * interval '1 millisecond'`
            : owned.runAfter,
        })
        .where(ownership);
      await tx
        .update(jobAttempts)
        .set({
          outcome: failure ? (dead ? 'dead' : 'retry') : 'succeeded',
          error,
          httpStatus: failure instanceof ProviderError ? failure.status : null,
          finishedAt: new Date(),
        })
        .where(and(eq(jobAttempts.jobId, job.id), eq(jobAttempts.attemptNo, job.totalAttempts)));
    });
  }
  async tick() {
    const jobs = await this.claim();
    await Promise.all(jobs.map((job) => this.run(job)));
    return jobs.length;
  }
  async replay(id: string, actor: string, ip?: string) {
    return this.db.transaction(async (tx) => {
      const [job] = await tx.select().from(outboxJobs).where(eq(outboxJobs.id, id)).for('update');
      if (!job) throw new AppError('not_found', 404, 'Job not found');
      if (job.status !== 'dead') throw new AppError('invalid_state', 409, 'Only dead jobs can be replayed');
      await tx
        .update(outboxJobs)
        .set({
          status: 'pending',
          attempts: 0,
          runAfter: sql`now()`,
          leasedUntil: null,
          leaseOwner: null,
          lastError: null,
        })
        .where(eq(outboxJobs.id, id));
      await tx.insert(auditLog).values({
        actor,
        action: 'job.replayed',
        targetType: 'outbox_job',
        targetId: id,
        detail: { previous_attempts: job.totalAttempts },
        ip,
      });
      return { id, status: 'pending' };
    });
  }
}
