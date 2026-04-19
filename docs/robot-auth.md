# Robot Authentication – Architecture & Flow

> **Reference:** Audit finding B-SEC-02

## Overview

Robot hardware clients authenticate to BotParty using a two-phase mechanism:

1. **Claim Token** – a static 64-hex-character secret stored in `config.yaml`. Used only for the initial `/robots/claim` handshake to obtain a device-bound JWT.
2. **Robot Auth JWT** – a short-lived (default: 30 days) JWT signed with `ROBOT_JWT_SECRET`. Used for all subsequent API calls (heartbeat) and WebSocket identity (`robot:identify` event).

These are not competing auth systems — they are complementary stages in the same flow. The claim token is a long-lived secret provisioned by the robot owner; the JWT is derived from it and bound to a specific hardware device.

---

## Auth Flow

```
Robot boots
    │
    ▼
POST /api/v1/robots/claim
  Body: { claimToken, deviceKey, publishCameraIds? }
    │
    ├── 1. robots.service.findByClaimToken(claimToken)
    │       verifies token exists and is not expired (ROBOT_CLAIM_TOKEN_MAX_AGE_DAYS)
    │
    ├── 2. robots.service.validateOrBindRobotDevice(robotId, deviceKey)
    │       - if no device is bound: SHA-256 hashes the deviceKey and stores it in metadata
    │       - if a device is already bound: verifies deviceKey hash matches
    │       - rejects if deviceKey < 32 characters
    │
    └── 3. jwtService.sign({ sub: robotId, scope: 'robot', deviceHash }, ROBOT_JWT_SECRET)
            returns robotAuthToken (JWT, default expiry 30d)
            also returns: livekitToken, publishTokens, livekitUrl, ingress, stream policy

    ▼
Robot stores robotAuthToken in memory
    │
    ├── Heartbeat  → POST /api/v1/robots/heartbeat
    │                  Authorization: Bearer <robotAuthToken>
    │
    └── WebSocket  → connects to BotParty gateway, sends:
                     { event: "robot:identify", data: { robotAuthToken } }
                     gateway validates via resolveRobotSocketIdentity()
```

---

## Token Details

### Claim Token

| Property | Value |
|---|---|
| Format | 64-char hex string (`randomBytes(32).toString('hex')`) |
| Storage | `robots.claimToken` column (plain text in DB) |
| Rotation | Via dashboard or staff API (generates new token, updates `claimTokenIssuedAt` in metadata) |
| Expiry | Configurable via `ROBOT_CLAIM_TOKEN_MAX_AGE_DAYS` (default: 90 days). Checked on each claim attempt. |
| Risk | If leaked, an attacker with the claim token can bind to the same device hash and obtain a JWT. Mitigate by rotating via dashboard. |

### Robot Auth JWT

| Property | Value |
|---|---|
| Algorithm | HS256 (NestJS `JwtService` default) |
| Secret | `ROBOT_JWT_SECRET` env var |
| Payload | `{ sub: robotId, scope: 'robot', deviceHash: <sha256hex> }` |
| Expiry | Default: `30d`. Override with `ROBOT_JWT_EXPIRES_IN` env var. |
| Validation | `resolveRobotSocketIdentity()` in `bot.gateway.runtime.ts` verifies secret, checks `scope === 'robot'`, validates `deviceHash` format |
| Risk | If `ROBOT_JWT_SECRET` is leaked, all robot JWTs can be forged. Use a ≥32 byte random secret. |

---

## Device Binding

On first claim, the robot sends a `deviceKey` (generated locally by the Python client and stored in `.botparty-device-key`). The API hashes it with SHA-256 and stores it in the robot's metadata as `boundDeviceHash`. Subsequent claim attempts with a different device key are rejected with `403 Forbidden`. This prevents claim token reuse across different hardware.

To move a robot to new hardware, the owner must reset the device binding from the dashboard (clears `boundDeviceHash` from metadata).

---

## Security Notes

- The `claimToken` in `config.yaml` should be treated as a password: `chmod 600 config.yaml`.
- The `robotAuthToken` is sent as a JSON payload field in the WebSocket `robot:identify` event (not as an HTTP header). Debug-level logging should never log raw WebSocket payloads.
- `ROBOT_JWT_SECRET` must be set to a strong random value (≥32 bytes) and must differ from `JWT_SECRET` (used for user auth).
- Swagger docs expose the `/robots/claim` endpoint schema. Keep Swagger disabled in production (`SWAGGER_DOCS=true` is opt-in).

---

## Long-term Roadmap

The current flow is stable and secure for the current scale. Future hardening options:

- **Shorter JWT expiry** with automatic re-claim on expiry (Python client already retries failed claims).
- **Refresh endpoint for robot JWTs** — avoids full re-claim on expiry without requiring the claim token to be in memory.
- **Audit log** for claim events (token use, device binding changes, expiry rejections).
