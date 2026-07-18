# ADR-0004: Realtime Cache and Chat History

- Date: 2026-04-17
- Status: Accepted

## Context

Realtime control and chat handlers were repeatedly hitting PostgreSQL for the same robot metadata. Chat messages were delivered over websocket only, so reconnecting clients had no server-backed history.

## Decision

1. Add a short-lived cache-first lookup for robot rows used by realtime handlers.
2. Persist accepted websocket chat messages with a stable `clientMessageId` in `chat_messages`.
3. Replay recent chat history on room join.
4. Keep cache TTL short (30s) to reduce stale data risk while removing hot-path database load.

## Consequences

- Lower read pressure on database during high-frequency control traffic.
- New joiners receive recent chat context from server state.
- Guest messages keep their guest identity without requiring a user row.
- Robot writes publish cache invalidations across replicas; the short TTL remains a recovery bound.

## Operations

Chat persistence failures and cache/pub-sub health are part of the API metrics and alert set.
