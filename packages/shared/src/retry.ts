export function backoff(
  attempt: number,
  options: { demo?: boolean; random?: () => number; retryAfterMs?: number } = {},
): number {
  if (!Number.isInteger(attempt) || attempt < 1) throw new Error('Attempt must be positive');
  const base = options.demo ? 200 : 2000,
    cap = options.demo ? 2000 : 600000;
  const window = Math.min(cap, base * 2 ** Math.min(attempt - 1, 20));
  return Math.max(
    Math.floor(Math.min(1, Math.max(0, (options.random ?? Math.random)())) * window),
    options.retryAfterMs ?? 0,
  );
}
