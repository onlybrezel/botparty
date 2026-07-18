# ADR 0001: Plain WebSocket gateway

**Status:** Accepted
**Date:** 2026-04-16

## Context

The browser, API, and external robot clients share a realtime control protocol. Video travels through
LiveKit; the application WebSocket carries JSON control, queue, presence, chat, and status messages.

## Decision

Use the standard WebSocket protocol through `@nestjs/platform-ws` and `ws`. Protocol schemas and
event names live in `@botparty/shared`; Redis carries cross-instance fan-out and leases. Socket.IO
is not used because the application does not need its additional framing, namespaces, or room API.

## Consequences

- Browser and robot clients use one standard protocol without a Socket.IO client library.
- Reconnect, keepalive, validation, room membership, and backpressure remain application concerns.
- Redis is required for correctness across API replicas; process-local state is not authoritative.
- Binary media does not pass through this gateway.
