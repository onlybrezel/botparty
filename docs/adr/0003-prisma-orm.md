# ADR 0003: Prisma for PostgreSQL access

**Status:** Accepted
**Date:** 2026-04-16

## Context

The API needs typed PostgreSQL access, committed schema migrations, relations, and transactions.
Correctness-critical paths also need row locks, conditional updates, and database-specific queries.

## Decision

Use Prisma Client for normal reads, writes, relations, and transactions. Keep migrations as reviewed
SQL under `packages/prisma/prisma/migrations`. Use parameterized raw SQL through Prisma only where
the generated API cannot express an invariant, such as `FOR UPDATE`, guarded balance updates, and
operational PostgreSQL metrics.

## Consequences

- Generated types keep schema access consistent across services.
- Raw SQL remains visible at the business operation that requires it and must stay parameterized.
- A dedicated migration container runs migrations once; API replicas never migrate on startup.
- Prisma is an infrastructure dependency, not a repository abstraction. Services call it directly
  unless a helper owns a real cross-cutting invariant.
