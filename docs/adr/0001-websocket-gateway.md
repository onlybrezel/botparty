# ADR 0001: WebSocket Gateway Architecture (ws vs Socket.IO)

**Status:** Accepted
**Date:** 2026-04-16
**Participants:** Engineering Team

## Context

BotParty required a real-time control channel for robot teleoperation with support for:
- Bi-directional message routing (client → robot, robot → client, broadcast)
- Presence tracking (online viewers, active sessions)
- Queue state updates
- Low-latency control commands

Two primary options were available:
1. **WS library (native WebSocket)** – Lightweight, standard protocol
2. **Socket.IO** – Higher-level abstraction with auto-reconnect, binary support, fallbacks

## Decision

We chose **WS library** for the following reasons:

1. **Simplicity** – Native WebSocket is a stable standard; no abstraction overhead
2. **Control** – Direct access to WebSocket lifecycle, message framing, binary handling
3. **Performance** – Minimal overhead; critical for hundreds of concurrent control streams
4. **Deployment** – No Socket.IO namespace complexity; standard ws:// protocol
5. **Team fit** – NestJS `@nestjs/websockets` + `@nestjs/platform-ws` are battle-tested

## Consequences

### Positive
- Lightweight message format (JSON text framing)
- Clear protocol semantics for control commands
- Native browser support (no library download)

### Negative
- Manual reconnection logic required (uses exponential backoff + jitter)
- No built-in binary protocol (use MessagePack if needed)
- Fallback handling (TCP alternate) must be implemented separately

## Alternatives Considered

- **Socket.IO:** Would add ~100KB to client bundle, unnecessary for our use case
- **gRPC/Protobuf:** Overkill for control channel; requires proxy complexity

## References

- WebSocket RFC: https://tools.ietf.org/html/rfc6455
- NestJS WebSocket guide: https://docs.nestjs.com/websockets/gateways
