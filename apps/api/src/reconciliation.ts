import {
  and,
  auditLog,
  type Database,
  desc,
  eq,
  journalEntries,
  ledgerAccounts,
  ledgerLines,
  newId,
  outboxJobs,
  payments,
  reconciliationChecks,
  reconciliationItems,
  reconciliationRuns,
  refunds,
  sql,
  webhookEvents,
} from '@paybox/db';
import { z } from 'zod';
import { type App, register } from './app';
import { requireRole } from './auth';
import { AppError } from './errors';
import { enqueue } from './jobs';
import { consumeToken } from './limits';
import { type PaystackClient, ProviderError, type VerifiedTransaction } from './provider/client';
import { parseProviderJson } from './provider/http';
import { applyVerification } from './settlement';
import { webhookPayload } from './webhooks';
export class Reconciliation {
  constructor(
    readonly db: Database,
    readonly client: PaystackClient,
  ) {}
  async start(actor: string, key = `manual:${newId()}`) {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`recon:${key}`},0))`);
      const [existing] = await tx
        .select()
        .from(outboxJobs)
        .where(eq(outboxJobs.dedupeKey, `reconcile_window:${key}`));
      if (existing) return { id: String(existing.payload.run_id), status: 'pending' };
      const [run] = await tx
        .insert(reconciliationRuns)
        .values({ windowFrom: new Date(Date.now() - 48 * 3600000), windowTo: new Date() })
        .returning();
      await enqueue(
        tx,
        'reconcile_window',
        run!.id,
        { run_id: run!.id, correlation_id: run!.id },
        `reconcile_window:${key}`,
      );
      await tx.insert(auditLog).values({
        actor,
        action: 'reconciliation.started',
        targetType: 'reconciliation_run',
        targetId: run!.id,
      });
      return { id: run!.id, status: 'pending' };
    });
  }
  async run(id: string) {
    const [run] = await this.db.select().from(reconciliationRuns).where(eq(reconciliationRuns.id, id));
    if (!run) throw new AppError('not_found', 404, 'Reconciliation run not found');
    if (run.status === 'completed') return;
    await this.db.update(reconciliationRuns).set({ status: 'running' }).where(eq(reconciliationRuns.id, id));
    const candidates = await this.db
      .select()
      .from(payments)
      .where(
        sql`(${payments.createdAt} BETWEEN ${run.windowFrom} AND ${run.windowTo}) OR (${payments.status}='pending' AND ${payments.createdAt}<${new Date(run.windowTo.getTime() - 15 * 60000)})`,
      )
      .orderBy(payments.id);
    for (const candidate of candidates) {
      const [checked] = await this.db
        .select()
        .from(reconciliationChecks)
        .where(
          and(eq(reconciliationChecks.runId, id), eq(reconciliationChecks.reference, candidate.reference)),
        );
      if (checked) continue;
      let wait = await consumeToken(this.db, 'reconciliation:provider', 5, 1000);
      while (wait) {
        await new Promise((resolve) => setTimeout(resolve, wait));
        wait = await consumeToken(this.db, 'reconciliation:provider', 5, 1000);
      }
      let remote: VerifiedTransaction | null = null;
      try {
        remote = await this.client.verify(candidate.reference);
      } catch (error) {
        if (!(error instanceof ProviderError) || error.status !== 404) throw error;
      }
      await this.db.transaction(async (tx) => {
        const [claim] = await tx
          .insert(reconciliationChecks)
          .values({ runId: id, reference: candidate.reference })
          .onConflictDoNothing()
          .returning();
        if (!claim) return;
        let [payment] = await tx.select().from(payments).where(eq(payments.id, candidate.id)).for('update');
        if (!payment) return;
        const items: {
          kind: string;
          resolution: string;
          local: Record<string, unknown>;
          remote: Record<string, unknown>;
        }[] = [];
        const local = {
          reference: payment.reference,
          amount: payment.amount,
          currency: payment.currency,
          status: payment.status,
        };
        const evidence = remote ? { ...remote } : { status: 'not_found' };
        if (remote && (remote.amount !== payment.amount || remote.currency !== payment.currency))
          items.push({ kind: 'amount_mismatch', resolution: 'open', local, remote: evidence });
        else if (remote?.status === 'success' && payment.status === 'pending') {
          payment = await applyVerification(tx, payment, remote, 'recon');
          items.push({ kind: 'missing_webhook', resolution: 'auto_healed', local, remote: evidence });
        } else {
          const expected = ['succeeded', 'partially_refunded', 'refunded'].includes(payment.status)
            ? 'success'
            : payment.status === 'created'
              ? 'pending'
              : payment.status;
          if (!remote || remote.status !== expected)
            items.push({ kind: 'status_mismatch', resolution: 'open', local, remote: evidence });
        }
        const [posted] = await tx
          .select({
            net: sql<string>`coalesce(sum(CASE WHEN ${ledgerLines.direction}='debit' THEN ${ledgerLines.amount} ELSE -${ledgerLines.amount} END),0)::text`,
          })
          .from(ledgerLines)
          .innerJoin(journalEntries, eq(ledgerLines.entryId, journalEntries.id))
          .innerJoin(ledgerAccounts, eq(ledgerLines.accountId, ledgerAccounts.id))
          .where(and(eq(journalEntries.paymentId, payment.id), eq(ledgerAccounts.code, 'paystack_clearing')));
        const successful = ['succeeded', 'partially_refunded', 'refunded'].includes(payment.status);
        const expectedNet = successful ? payment.amount - (payment.fees ?? 0) - payment.refundedAmount : 0;
        if (BigInt(posted?.net ?? 0) !== BigInt(expectedNet))
          items.push({
            kind: 'ledger_imbalance',
            resolution: 'open',
            local: { ...local, clearing_balance: posted?.net ?? '0', expected: expectedNet },
            remote: evidence,
          });
        const refundRows = await tx
          .select()
          .from(refunds)
          .where(and(eq(refunds.paymentId, payment.id), eq(refunds.status, 'processed')));
        if (
          refundRows.reduce((n, row) => n + row.amount, 0) !== payment.refundedAmount &&
          !items.some((item) => item.kind === 'ledger_imbalance')
        )
          items.push({
            kind: 'ledger_imbalance',
            resolution: 'open',
            local: { ...local, refunded_amount: payment.refundedAmount },
            remote: evidence,
          });
        for (const item of items)
          await tx
            .insert(reconciliationItems)
            .values({ ...item, runId: id, paymentId: payment.id })
            .onConflictDoNothing();
        const mismatch = items.some((item) => item.resolution === 'open');
        await tx
          .update(reconciliationRuns)
          .set({
            checked: sql`${reconciliationRuns.checked}+1`,
            matched: sql`${reconciliationRuns.matched}+${mismatch ? 0 : 1}`,
            mismatched: sql`${reconciliationRuns.mismatched}+${mismatch ? 1 : 0}`,
          })
          .where(eq(reconciliationRuns.id, id));
      });
    }
    const unknowns = await this.db
      .select()
      .from(webhookEvents)
      .where(
        and(
          sql`${webhookEvents.paymentId} IS NULL`,
          eq(webhookEvents.eventType, 'charge.success'),
          sql`${webhookEvents.receivedAt} BETWEEN ${run.windowFrom} AND ${run.windowTo}`,
        ),
      );
    for (const event of unknowns) {
      const payload = webhookPayload.parse(parseProviderJson(event.rawBody.toString()));
      const reference = payload.data.reference;
      if (!reference) continue;
      const [local] = await this.db.select().from(payments).where(eq(payments.reference, reference));
      if (local) continue;
      await this.db.transaction(async (tx) => {
        const [claim] = await tx
          .insert(reconciliationChecks)
          .values({ runId: id, reference })
          .onConflictDoNothing()
          .returning();
        if (!claim) return;
        await tx.insert(reconciliationItems).values({
          runId: id,
          kind: 'unknown_remote',
          local: { reference },
          remote: { event_id: event.id, source: 'authenticated_webhook' },
          resolution: 'open',
        });
        await tx
          .update(reconciliationRuns)
          .set({
            checked: sql`${reconciliationRuns.checked}+1`,
            mismatched: sql`${reconciliationRuns.mismatched}+1`,
          })
          .where(eq(reconciliationRuns.id, id));
      });
    }
    await this.db
      .update(reconciliationRuns)
      .set({ status: 'completed', finishedAt: new Date() })
      .where(eq(reconciliationRuns.id, id));
  }
  async detail(id: string) {
    const [run] = await this.db.select().from(reconciliationRuns).where(eq(reconciliationRuns.id, id));
    if (!run) throw new AppError('not_found', 404, 'Reconciliation run not found');
    return {
      ...run,
      items: await this.db
        .select()
        .from(reconciliationItems)
        .where(eq(reconciliationItems.runId, id))
        .orderBy(reconciliationItems.createdAt),
    };
  }
}
export function reconciliationRoutes(app: App, db: Database, client: PaystackClient) {
  const service = new Reconciliation(db, client);
  register(
    app,
    { method: 'post', path: '/v1/admin/reconciliation/runs', summary: 'Start reconciliation', status: 202 },
    async (c) => c.json(await service.start(requireRole(c, ['admin', 'ops']).actor), 202),
  );
  register(
    app,
    { method: 'get', path: '/v1/admin/reconciliation/runs', summary: 'List reconciliation runs' },
    async (c) => {
      requireRole(c, ['admin', 'ops', 'viewer']);
      return c.json({
        data: await db
          .select()
          .from(reconciliationRuns)
          .orderBy(desc(reconciliationRuns.createdAt))
          .limit(50),
      });
    },
  );
  register(
    app,
    { method: 'get', path: '/v1/admin/reconciliation/runs/{id}', summary: 'Read a reconciliation report' },
    async (c) => {
      requireRole(c, ['admin', 'ops', 'viewer']);
      return c.json(await service.detail(z.string().uuid().parse(c.req.param('id'))));
    },
  );
  register(
    app,
    {
      method: 'post',
      path: '/v1/admin/reconciliation/items/{id}/resolve',
      summary: 'Resolve a reconciliation finding with an audit note',
      body: z
        .object({
          note: z.string().trim().min(5).max(1000),
          resolution: z.enum(['resolved', 'ignored']).default('resolved'),
        })
        .strict(),
    },
    async (c) => {
      const actor = requireRole(c, ['admin', 'ops']).actor,
        id = z.string().uuid().parse(c.req.param('id'));
      const input = z
        .object({
          note: z.string().trim().min(5).max(1000),
          resolution: z.enum(['resolved', 'ignored']).default('resolved'),
        })
        .parse(await c.req.json());
      const result = await db.transaction(async (tx) => {
        const [item] = await tx
          .select()
          .from(reconciliationItems)
          .where(eq(reconciliationItems.id, id))
          .for('update');
        if (!item) throw new AppError('not_found', 404, 'Finding not found');
        if (item.resolution !== 'open') throw new AppError('invalid_state', 409, 'Finding is already closed');
        const [updated] = await tx
          .update(reconciliationItems)
          .set({ ...input, resolvedBy: actor })
          .where(eq(reconciliationItems.id, id))
          .returning();
        await tx.insert(auditLog).values({
          actor,
          action: 'reconciliation.resolved',
          targetType: 'reconciliation_item',
          targetId: id,
          detail: input,
        });
        return updated!;
      });
      return c.json(result);
    },
  );
}
