# ADR-0006: Instance-Affine Turn State Until Redis Arbitration Exists

- Date: 2026-04-19
- Status: Accepted

## Context

BotParty already uses Redis for room broadcasts, presence fan-out, and robot claim locks, but queue turn execution still depends on in-process gateway state:

1. `activeTurns`
2. `turnTimeouts`
3. `controlCooldowns`

That state is fast and simple, but it means turn arbitration is not fully stateless across horizontally scaled API replicas.

## Decision

Keep turn timers and cooldown enforcement instance-affine for now, and document websocket room affinity as an operational requirement.

## Rationale

1. The current in-memory path is low-latency and predictable for hot control traffic.
2. Moving timers and cooldown arbitration into Redis is feasible, but it adds complexity around leases, timer ownership, and failover semantics.
3. The platform already has a safe cross-instance primitive for the most critical invariant: exactly one robot control socket per robot.

## Consequences

1. Horizontal scaling is supported for broadcast and failover, but not for arbitrary room sharding without affinity.
2. Load balancers should keep `/ws` traffic for a hot robot room on the same API instance when possible.
3. A future Redis-backed turn state migration remains the follow-up path for truly stateless websocket scaling.