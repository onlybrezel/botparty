# @botparty/shared

Shared TypeScript types, Zod validation schemas, and runtime constants used by both `apps/api` and `apps/web`.

## Structure

```
src/
  constants/index.ts   — Enums, LIMITS, WS_EVENTS
  schemas/index.ts     — Zod validation schemas
  types/index.ts       — TypeScript interfaces and inferred types
  index.ts             — Re-exports everything
```

## Exports

### Constants (`@botparty/shared/constants`)

| Export | Description |
|--------|-------------|
| `Role` | User role enum: `USER`, `MOD`, `ADMIN` |
| `RobotVisibility` | `PUBLIC`, `UNLISTED`, `PRIVATE` |
| `RobotAccessMode` | `OPEN`, `PASSWORD`, `INVITE_ONLY`, `ALLOWLIST` |
| `QueueMode` | `FIFO`, `VOTE`, `DISABLED` |
| `RobotStatus` | `ONLINE`, `OFFLINE`, `BUSY` |
| `WS_EVENTS` | All WebSocket event name constants |
| `LIMITS` | Runtime limits (turn time, chat length, rate limits, etc.) |

Key `LIMITS` values:

| Constant | Value | Description |
|----------|-------|-------------|
| `MAX_TURN_TIME_MS` | 300 000 | Max controller turn duration |
| `DEFAULT_TURN_TIME_MS` | 60 000 | Default turn duration |
| `MAX_CHAT_MESSAGE_LENGTH` | 300 | Max chat message characters |
| `CHAT_RATE_LIMIT_MS` | 900 | Min ms between chat messages (users) |
| `CHAT_RATE_LIMIT_ADMIN_MS` | 250 | Min ms between chat messages (staff) |
| `WS_EVENT_RATE_LIMIT` | 30 | Max WS events per second (users) |
| `WS_EVENT_RATE_LIMIT_ADMIN` | 60 | Max WS events per second (staff/robot) |
| `MAX_CONTROL_BUTTONS` | 24 | Max custom control buttons per robot |
| `LATENCY_EMERGENCY_STOP_MS` | 300 | Latency threshold that triggers E-STOP |

### Schemas (`@botparty/shared/schemas`)

Zod schemas for request validation:

- `loginSchema`, `registerSchema`
- `forgotPasswordSchema`, `resetPasswordSchema`
- `createRobotSchema`, `updateRobotSchema`
- `controlCommandSchema`, `chatMessageSchema`
- `queueJoinSchema`

### Types (`@botparty/shared`)

All types are exported from the root entry point:

- `LoginInput`, `RegisterInput`, `ForgotPasswordInput`, `ResetPasswordInput`
- `CreateRobotInput`, `UpdateRobotInput`
- `ControlCommand`, `ChatMessage`, `QueueJoinInput`
- `ApiResponse<T>` — standard API response envelope
- `UserPublic` — public user profile
- `RobotStreamCameraConfig` — camera configuration for streaming
- `JwtPayload` — decoded JWT access token shape
- `ControlButtonAccess` — button access config shape

## Usage

```typescript
// API (NestJS)
import { LIMITS, WS_EVENTS, Role } from '@botparty/shared';
import type { JwtPayload, CreateRobotInput } from '@botparty/shared';
import { createRobotSchema } from '@botparty/shared/schemas';

// Web (Next.js)
import { LIMITS, WS_EVENTS } from '@botparty/shared';
import type { UserPublic, RobotStreamCameraConfig } from '@botparty/shared';
```

## Building

```bash
pnpm --filter @botparty/shared build
```

TypeScript is compiled to `dist/` before the consuming apps can use it.
Turbo handles the build order automatically via the `^build` dependency.
