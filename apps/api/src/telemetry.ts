import { AsyncLocalStorage } from 'node:async_hooks';
import { type Database, sql } from '@paybox/db';
import pino from 'pino';
import { Counter, Histogram, Registry } from 'prom-client';

export type LogContext = {
  request_id?: string;
  correlation_id?: string;
  merchant_id?: string;
  payment_id?: string;
  job_id?: string;
  event_type?: string;
};
export const requestContext = new AsyncLocalStorage<LogContext>();
export const log = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  timestamp: () => `,"ts":"${new Date().toISOString()}"`,
  base: undefined,
  mixin: () => requestContext.getStore() ?? {},
  redact: ['authorization', 'password', 'secret', 'api_key', 'headers.authorization', 'headers.cookie'],
});
export function annotate(fields: LogContext) {
  const context = requestContext.getStore();
  if (context) Object.assign(context, fields);
}
export function telemetry(db: Database) {
  const registry = new Registry();
  const requests = new Counter({
    name: 'http_requests_total',
    help: 'Completed HTTP requests',
    labelNames: ['route', 'status'],
    registers: [registry],
  });
  const duration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration',
    labelNames: ['route'],
    registers: [registry],
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 5, 10],
  });
  const replays = new Counter({
    name: 'idempotency_replays_total',
    help: 'Stored idempotent responses returned',
    registers: [registry],
  });
  const labelValue = (value: unknown) =>
    String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n');
  async function metrics() {
    const [jobs, dlq, webhooks, recon, latency] = await Promise.all([
      db.execute<{ type: string; outcome: string; count: string }>(
        sql`SELECT j.type,a.outcome,count(*)::text FROM job_attempts a JOIN outbox_jobs j ON j.id=a.job_id WHERE a.finished_at IS NOT NULL GROUP BY j.type,a.outcome`,
      ),
      db.execute<{ count: string }>(sql`SELECT count(*)::text FROM outbox_jobs WHERE status='dead'`),
      db.execute<{ type: string; outcome: string; count: string }>(
        sql`SELECT CASE WHEN e.event_type IN ('charge.success','refund.pending','refund.processing','refund.needs-attention','refund.failed','refund.processed') THEN e.event_type ELSE 'other' END AS type,d.outcome,count(*)::text FROM webhook_deliveries d JOIN webhook_events e ON e.id=d.event_id GROUP BY 1,d.outcome`,
      ),
      db.execute<{ kind: string; count: string }>(
        sql`SELECT kind,count(*)::text FROM reconciliation_items GROUP BY kind`,
      ),
      db.execute<{ count: string; sum: string }>(
        sql`SELECT count(*)::text,coalesce(sum(greatest(0,extract(epoch FROM (a.finished_at-j.created_at)))),0)::text AS sum FROM job_attempts a JOIN outbox_jobs j ON j.id=a.job_id WHERE a.outcome='succeeded'`,
      ),
    ]);
    const lines = [await registry.metrics()];
    const family = (name: string, help: string, type: string) =>
      lines.push(`# HELP ${name} ${help}\n# TYPE ${name} ${type}`);
    family('outbox_jobs_total', 'Durable worker attempt outcomes across processes', 'counter');
    for (const row of jobs.rows)
      lines.push(
        `outbox_jobs_total{type="${labelValue(row.type)}",outcome="${labelValue(row.outcome)}"} ${row.count}`,
      );
    family('outbox_dlq_depth', 'Jobs awaiting manual replay', 'gauge');
    lines.push(`outbox_dlq_depth ${dlq.rows[0]!.count}`);
    family('webhooks_received_total', 'Durable authenticated webhook delivery outcomes', 'counter');
    for (const row of webhooks.rows)
      lines.push(
        `webhooks_received_total{type="${labelValue(row.type)}",outcome="${labelValue(row.outcome)}"} ${row.count}`,
      );
    family('recon_mismatches_total', 'Durable reconciliation findings', 'counter');
    for (const row of recon.rows)
      lines.push(`recon_mismatches_total{kind="${labelValue(row.kind)}"} ${row.count}`);
    family(
      'outbox_job_latency_seconds',
      'Time from job creation to successful attempt completion',
      'summary',
    );
    lines.push(
      `outbox_job_latency_seconds_count ${latency.rows[0]!.count}`,
      `outbox_job_latency_seconds_sum ${latency.rows[0]!.sum}`,
    );
    return `${lines.join('\n')}\n`;
  }
  return { requests, duration, replays, metrics };
}
