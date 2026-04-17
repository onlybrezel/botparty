# ADR-0004: Realtime Cache and Chat History

- Date: 2026-04-17
- Status: Accepted

## Context

Realtime control and chat handlers were repeatedly hitting PostgreSQL for the same robot metadata. Chat messages were delivered over websocket only, so reconnecting clients had no server-backed history.

## Decision

1. Add a short-lived cache-first lookup for robot rows used by realtime handlers.
2. Persist authenticated websocket chat messages into `chat_messages`.
3. Replay recent chat history on room join.
4. Keep cache TTL short (30s) to reduce stale data risk while removing hot-path database load.

## Consequences

- Lower read pressure on database during high-frequency control traffic.
- New joiners receive recent chat context from server state.
- Guest chat messages remain ephemeral because the current schema requires `userId`.
- Eventual consistency window up to cache TTL for robot metadata.

## Follow-up

- Consider explicit cache invalidation on every robot write path.
- Monitor chat queue throughput and add queue-depth alerting if burst load increases.
