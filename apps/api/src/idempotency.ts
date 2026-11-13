import { and, type Database, eq, idempotencyKeys, sql, type Transaction } from '@paybox/db';
import { canonicalJson } from '@paybox/shared';
import { sha256 } from './crypto';
import { AppError } from './errors';
export type StoredResponse = { status: number; body: Record<string, unknown>; replayed?: boolean };
export type Claim = { id: string; paymentId: string | null };
export class Idempotency {
  constructor(private db: Database) {}
  async execute(
    merchantId: string,
    key: string | undefined,
    method: string,
    path: string,
    body: unknown,
    operation: (claim: Claim) => Promise<StoredResponse>,
  ): Promise<StoredResponse> {
    if (!key || !/^[\x20-\x7E]{1,255}$/.test(key))
      throw new AppError(
        'validation_error',
        400,
        'Idempotency-Key must contain 1–255 printable ASCII characters',
      );
    const hash = sha256(`${method}${path}${canonicalJson(body)}`);
    const claim = await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${merchantId}:${key}`}, 0))`);
      const where = and(eq(idempotencyKeys.merchantId, merchantId), eq(idempotencyKeys.key, key));
      let [row] = await tx.select().from(idempotencyKeys).where(where).for('update');
      const now = new Date();
      if (row && row.expiresAt <= now && row.lockedUntil <= now) {
        await tx.delete(idempotencyKeys).where(where);
        row = undefined;
      }
      if (row) {
        if (row.requestHash !== hash)
          throw new AppError(
            'idempotency_key_reuse',
            409,
            'This key was first used with a different request',
          );
        if (row.state === 'completed')
          return { response: { status: row.responseStatus!, body: row.responseBody!, replayed: true } };
        if (row.lockedUntil > now)
          throw new AppError('idempotency_in_progress', 409, 'The first request is still in progress', 1);
        await tx
          .update(idempotencyKeys)
          .set({ lockedUntil: new Date(Date.now() + 30_000) })
          .where(where);
        return { id: row.id, paymentId: row.paymentId };
      }
      const [inserted] = await tx
        .insert(idempotencyKeys)
        .values({
          merchantId,
          key,
          method,
          path,
          requestHash: hash,
          state: 'in_progress',
          lockedUntil: new Date(Date.now() + 30_000),
          expiresAt: new Date(Date.now() + 86_400_000),
        })
        .returning();
      return { id: inserted!.id, paymentId: null };
    });
    if ('response' in claim) return claim.response!;
    try {
      const result = await operation(claim);
      await this.complete(this.db, claim.id, result);
      return result;
    } catch (error) {
      if (error instanceof AppError && error.status < 500) {
        await this.complete(this.db, claim.id, {
          status: error.status,
          body: { code: error.code, detail: error.message },
        });
      } else {
        // Keep the recovery link, release the lease, and never cache an infrastructure failure.
        await this.db
          .update(idempotencyKeys)
          .set({ lockedUntil: new Date(0) })
          .where(eq(idempotencyKeys.id, claim.id));
      }
      throw error;
    }
  }
  async complete(tx: Database | Transaction, id: string, response: StoredResponse) {
    await tx
      .update(idempotencyKeys)
      .set({
        state: 'completed',
        responseStatus: response.status,
        responseBody: response.body,
        lockedUntil: new Date(0),
      })
      .where(eq(idempotencyKeys.id, id));
  }
}
