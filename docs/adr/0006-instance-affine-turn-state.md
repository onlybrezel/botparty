# ADR-0006: Redis-Leased Active Turn State

- Date: 2026-07-17
- Status: Accepted; supersedes the original instance-affine design

## Context

Queue entries and sessions are durable in PostgreSQL, while room fan-out and short-lived coordination use Redis. Process-local turn ownership allowed two replicas to advance the same robot after a crash or reconnect.

## Decision

Each active turn is represented by a Redis lease containing its absolute deadline and a monotonically increasing fencing token. Only the current lease holder can advance or end the turn. The durable session row records the corresponding fence. A replacement replica acquires the next fence and reconstructs the remaining timeout from the stored deadline.

Robot disconnects use a bounded grace lease. Queue entries remain intact during that window and are advanced only after the grace period expires.

## Consequences

1. API replicas do not need sticky routing for correctness.
2. A delayed callback from a former owner cannot mutate a newer turn.
3. Redis persistence and `noeviction` are required because leases are correctness-critical.
4. Graceful connection draining remains useful during rollout, but replica loss no longer creates concurrent turn owners.
