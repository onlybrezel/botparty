# BotParty WebSocket Protocol

This document describes the BotParty realtime protocol used on the API gateway websocket endpoint.

## Endpoint

- Path: `/ws`
- Transport: WebSocket (JSON messages)
- Message envelope:

```json
{
  "event": "room:join",
  "data": { "robotId": "uuid" }
}
```

## Authentication

- Browser viewers can join as authenticated users (JWT) or guests.
- Robots authenticate via `robot:claim` with a `robotAuthToken`.
- Access and moderation checks are enforced server-side per event.

## Rate Limits

- Global window: 1000 ms
- Generic limit: 30 events/window (normal), 60 (staff/robot)
- Event buckets:
  - `room:join`: 5 normal, 10 privileged
  - `room:ping`: 8 normal, 16 privileged
  - `robot:claim`: 2 normal, 4 privileged
  - `robot:heartbeat`: 6 normal, 12 privileged
  - `robot:telemetry`: 4 normal, 8 privileged
  - `robot:actions:pull`: 4 normal, 8 privileged
  - `control` bucket (`control:command`): 30 normal, 45 privileged
  - `estop` bucket (`control:emergency-stop`): 4 normal, 8 privileged
  - `chat` bucket (`chat:message`): 6 normal, 12 privileged

## Client to Server Events

| Event | Payload (shape) | Auth | Notes |
|---|---|---|---|
| `room:join` | `{ robotId, accessToken?, guestSessionId?, roomAccessToken? }` | Optional | Joins watcher room, returns presence/queue/chat state. |
| `room:ping` | `{ robotId }` | Optional | Keepalive and room liveness signal. |
| `robot:claim` | `{ robotAuthToken }` | Robot token | Robot realtime identity binding. |
| `robot:heartbeat` | `{}` | Robot token | Robot liveness update path. |
| `robot:telemetry` | `{ clientVersion?, gitBranch?, gitCommit?, gitDirty?, botpartyStreamerVersion?, streamerVersion?, pythonVersion?, cpuPercent?, memoryPercent?, temperatureC?, uptimeSec?, controlConnected?, livekitConnected?, commandsReceived?, cameraFrames? }` | Robot token | Runtime telemetry payload (all fields optional). |
| `robot:actions` | `{}` | Robot token | Pulls pending robot actions from server queue. |
| `control:command` | `{ robotId, command, value?, timestamp? }` | Depends on robot policy | Queue turn, button access, moderation, cooldown enforced server-side. |
| `control:emergency-stop` | `{ robotId }` | Depends on robot policy | Immediate stop path with stricter checks. |
| `queue:join` | `{ robotId }` | User token required | Adds user to control queue. |
| `queue:leave` | `{ robotId }` | User token required | Removes user from control queue. |
| `queue:vote` | `{ robotId, targetUserId, voteType }` | User token required | Queue moderation/feedback event. |
| `chat:message` | `{ robotId, content, clientMessageId? }` | Depends on robot policy | Content sanitized/moderated before broadcast + persistence queueing. |
| `mod:timeout` | `{ robotId, userId, seconds, reason? }` | Staff/moderator | Applies timeout restriction. |
| `mod:kick` | `{ robotId, userId, reason? }` | Staff/moderator | Removes user from active room/queue. |
| `mod:ban` | `{ robotId, userId, reason? }` | Staff/moderator | Applies ban restriction. |
| `mod:unban` | `{ robotId, userId }` | Staff/moderator | Removes restriction. |
| `signal:offer` | `{ robotId, sdp, target? }` | Contextual | Signaling passthrough event. |
| `signal:answer` | `{ robotId, sdp, target? }` | Contextual | Signaling passthrough event. |
| `signal:ice` | `{ robotId, candidate, target? }` | Contextual | Signaling passthrough event. |

## Server to Client Events

| Event | Payload (shape) | Notes |
|---|---|---|
| `error` | `{ message, ... }` | Generic error channel for validation/auth/moderation failures. |
| `presence:join` | `{ userId, username, role? }` | User entered room. |
| `presence:leave` | `{ userId }` | User left room. |
| `presence:update` | `{ viewers: [...] }` | Full presence snapshot. |
| `crowd:input` | `{ userId?, username?, command }` | Control press echo to room watchers. |
| `queue:update` | `{ robotId, entries, currentControllerUserId?, queueMode }` | Queue state snapshot. |
| `queue:turn-start` | `{ robotId, userId, startedAt, endsAt }` | Turn lifecycle event. |
| `queue:turn-end` | `{ robotId, userId?, reason }` | Turn ended/interrupted. |
| `chat:message` | `{ userId?, username?, content, timestamp, clientMessageId? }` | Normal chat message broadcast. |
| `chat:system` | `{ message, timestamp }` | Server/system message. |
| `robot:status` | `{ status }` | Robot online/offline/busy state change. |
| `robot:controls-updated` | `{ robotId, controlsVersion }` | Control layout/permissions changed. |
| `control:latency-warning` | `{ latencyMs }` | Client clock skew/latency warning. |
| `mod:action` | `{ action, actorUserId, targetUserId, reason?, expiresAt? }` | Moderation action broadcast. |
| `server:shutdown` | `{ reason, retryAfterMs, message }` | Planned restart/maintenance notice. |
| `session:start` | `{ robotId, userId, startedAt }` | Session lifecycle event. |
| `session:end` | `{ robotId, userId, startedAt, endedAt, durationMs }` | Session lifecycle event. |
| `signal:offer` / `signal:answer` / `signal:ice` | Relay payload | Signaling relay responses. |

## Internal Server-Only Events

The following constants are used only on internal pub/sub channels and are not part of the public websocket API:

- `internal:mod-action`
- `internal:alert`

## Compatibility Notes

- Event names are defined in `packages/shared/src/constants/index.ts`.
- Unknown events are ignored or answered with `error`.
- Clients should tolerate additional fields in server payloads for forward compatibility.
