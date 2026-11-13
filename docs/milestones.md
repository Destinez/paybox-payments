# Delivery milestones

SPEC.md is the source of truth. Milestones M0–M12 are committed in its order, with their acceptance checks recorded in commit-sized validation work. The foundation predates the spec and is being conformed to it.

- M0: pnpm workspace, strict TypeScript, Biome, Vitest, four-service compose and CI.
- M1: merchant model and ledger core. PostgreSQL checks cover balanced journals, exactly-once posting, immutable lines/events/audit and UUIDv7 IDs. The pre-spec bootstrap was replaced before any application data existed.
- M2: HTTP and persistent fake clients, checkout and fault surface. Shared contract suite supports an optional real test key. Refund 409 recovery and full-width provider IDs are covered.
