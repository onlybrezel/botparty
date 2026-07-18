# Robot Authentication – Architecture & Flow

## Overview

Robot hardware clients authenticate to BotParty using a two-phase mechanism:

1. **Claim Token** – a 64-hex-character secret stored by the robot client. The API stores only its SHA-256 digest. It is used for the initial `/robots/claim` handshake.
2. **Robot Auth JWT** – a short-lived (default: 15 minutes) JWT signed with `ROBOT_JWT_SECRET`. It is used for subsequent API calls and the WebSocket `robot:claim` event.

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
    │       hashes the submitted token and verifies the digest and maximum age
    │
    ├── 2. robots.service.validateOrBindRobotDevice(robotId, deviceKey)
    │       - if no device is bound: SHA-256 hashes the deviceKey and stores it in metadata
    │       - if a device is already bound: verifies deviceKey hash matches
    │       - rejects if deviceKey < 32 characters
    │
    └── 3. jwtService.sign({ sub, scope, deviceHash, tokenVersion }, ROBOT_JWT_SECRET)
            returns robotAuthToken (JWT, default expiry 15m)
            also returns: livekitToken, publishTokens, livekitUrl, ingress, stream policy

    ▼
Robot stores robotAuthToken in memory
    │
    ├── Heartbeat  → POST /api/v1/robots/heartbeat
    │                  Authorization: Bearer <robotAuthToken>
    │
    └── WebSocket  → connects to BotParty gateway, sends:
                     { event: "robot:claim", data: { robotAuthToken } }
                     gateway validates via resolveRobotSocketIdentity()
```

---

## Token Details

### Claim Token

| Property | Value |
|---|---|
| Format | 64-char hex string (`randomBytes(32).toString('hex')`) |
| Storage | SHA-256 digest in `robots.claimTokenHash`; the plaintext is shown only when generated |
| Rotation | Via dashboard or staff API; rotation also increments `deviceTokenVersion` and clears the previous device binding |
| Expiry | Configurable via `ROBOT_CLAIM_TOKEN_MAX_AGE_DAYS` (default: 90 days). Checked on each claim attempt. |
| Risk | If leaked, an attacker with the claim token can bind to the same device hash and obtain a JWT. Mitigate by rotating via dashboard. |

### Robot Auth JWT

| Property | Value |
|---|---|
| Algorithm | HS256 (NestJS `JwtService` default) |
| Secret | `ROBOT_JWT_SECRET` env var |
| Payload | `{ sub: robotId, scope: 'robot', deviceHash: <sha256hex>, tokenVersion }` |
| Expiry | Default: `15m`. Override with `ROBOT_JWT_EXPIRES_IN`. |
| Validation | Signature, expiry, scope, device hash, current device binding, and the database token version are checked for REST and WebSocket use |
| Risk | If `ROBOT_JWT_SECRET` is leaked, all robot JWTs can be forged. Use a ≥32 byte random secret. |

---

## Device Binding

On first claim, the robot sends a `deviceKey` (generated locally by the Python client and stored in `.botparty-device-key`). The API hashes it with SHA-256 and stores it in the robot's metadata as `boundDeviceHash`. Subsequent claim attempts with a different device key are rejected with `403 Forbidden`. This prevents claim token reuse across different hardware.

To move a robot to new hardware, the owner must reset the device binding from the dashboard (clears `boundDeviceHash` from metadata).

---

## Security Notes

- The `claimToken` in `config.yaml` should be treated as a password: `chmod 600 config.yaml`.
- The `robotAuthToken` is sent as a JSON payload field in the WebSocket `robot:claim` event. Application logging redacts credentials and does not log raw event payloads.
- `ROBOT_JWT_SECRET` must be set to a strong random value (≥32 bytes) and must differ from `JWT_SECRET` (used for user auth).
- Swagger docs expose the `/robots/claim` endpoint schema. Keep Swagger disabled in production (`SWAGGER_DOCS=true` is opt-in).

---

## Rotation and recovery

Rotating a claim token revokes existing robot JWTs immediately through the token-version check. Moving a robot to different hardware therefore requires one explicit rotation in the owner dashboard followed by a new claim on the target device.
