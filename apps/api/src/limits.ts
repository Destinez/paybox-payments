import { type Database, eq, rateLimits } from '@paybox/db';
export async function consumeToken(
  db: Database,
  key: string,
  capacity: number,
  windowMs: number,
): Promise<number> {
  return db.transaction(async (tx) => {
    await tx
      .insert(rateLimits)
      .values({ id: key, tokens: String(capacity) })
      .onConflictDoNothing();
    const [row] = await tx.select().from(rateLimits).where(eq(rateLimits.id, key)).for('update');
    const now = Date.now(),
      tokens = Math.min(
        capacity,
        Number(row!.tokens) + ((now - row!.updatedAt.getTime()) * capacity) / windowMs,
      );
    if (tokens < 1) return Math.ceil(((1 - tokens) * windowMs) / capacity);
    await tx
      .update(rateLimits)
      .set({ tokens: String(tokens - 1), updatedAt: new Date(now) })
      .where(eq(rateLimits.id, key));
    return 0;
  });
}
