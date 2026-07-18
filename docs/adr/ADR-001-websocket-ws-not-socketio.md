# ADR-001: WebSocket via `ws` instead of Socket.IO

**Date:** 2024  
**Status:** Accepted

## Context

The realtime control layer needs low-latency bidirectional messaging between the browser, the BotParty API, and robot clients. Two mainstream options were evaluated: Socket.IO and the native `ws` library.

## Decision

Use the raw `ws` library (via `@nestjs/platform-ws`) instead of Socket.IO.

## Rationale

- **Protocol control:** Native WebSocket frames avoid a second event protocol and let BotParty define command identifiers, acknowledgements, and compatibility rules in the shared package.
- **Protocol compatibility:** The Python robot client (`botparty-client`) and the Go streamer (`botparty-streamer`) connect over plain WebSocket. Adding a Socket.IO dependency to both external runtimes would be painful and unnecessary.
- **Simplicity:** The custom `ws`-based gateway in `apps/api/src/gateway/` fully handles connection lifecycle, room membership, rate limiting, and Redis pub/sub fan-out. No Socket.IO features (namespaces, rooms, auto-reconnect) are needed because these are implemented at the application layer.
- **Bundle size:** Removing Socket.IO from the client bundle saves ~30 KB gzipped.

## Consequences

- Manual connection management (ping/keepalive, reconnect) in the frontend and robot client.
- No built-in binary frame support — all messages are JSON strings. Acceptable for control and metadata traffic; video uses LiveKit/WebRTC.
