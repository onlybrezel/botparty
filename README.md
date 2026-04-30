# BotParty

Self-hosted robot teleoperation platform. Plug in a Raspberry Pi (or anything that runs Python), register it, and people can drive it from a browser.

Spiritually inspired by LetsRobot.tv and Remo.tv. Built from scratch with a modern stack because it was time.

---

## What works right now

- **Live video** via LiveKit SFU (WebRTC) — ~150ms end-to-end on a decent connection
- **Control commands** over the BotParty gateway WebSocket — ~50ms round-trip locally
- **Queue system** — first-come-first-serve, configurable turn time
- **Chat** — in-room messaging between the driver and viewers
- **Crowd echo** — everyone sees button presses as they happen
- **Configurable control buttons** — label, hotkey, icon, cooldown, per-robot
- **RBAC** — Admin, Mod, User roles
- **Emergency stop** — ESC key or automatic at >300ms latency
- **Robot dashboard** — visibility, access mode, queue settings
- **Python robot client** — runs on Pi, Jetson, anything with a camera and serial port
- **Password reset via email** — expiring reset links over SMTP
- **Docker deployment** — single `docker compose up -d`

---

## Security

- Responsible disclosure policy: [SECURITY.md](SECURITY.md)

---

## 🏗 Architecture

```
┌─────────────┐     ┌──────────────┐     ┌──────────────────┐
│   Next.js   │────▶│  NestJS API  │────▶│   PostgreSQL 16  │
│  Frontend   │     │  (Fastify 5) │     └──────────────────┘
│  (React 19) │     │              │────▶│   Redis 7        │
└──────┬──────┘     └──────┬───────┘     └──────────────────┘
       │                   │
       │    WebSocket      │  LiveKit Token
       │    (Signaling)    │  Generation
       │                   │
       ▼                   ▼
┌──────────────────────────────────┐
│         LiveKit SFU              │
│         (Video only)             │
│   < 150ms video latency          │
│   < 50ms control latency         │
└──────────────┬───────────────────┘
               │
               ▼
┌──────────────────────────┐
│   Python Robot Client    │
│   (Raspberry Pi/Jetson)  │
│   Camera -> LiveKit      │
│   Gateway -> Motors      │
└──────────────────────────┘
```

---

## 📁 Project Structure

```
botparty/
├── apps/
│   ├── api/                # NestJS 11 backend (Fastify 5)
│   │   └── src/
│   │       ├── auth/       # JWT + Passport + Argon2
│   │       ├── robots/     # Robot CRUD + settings
│   │       ├── sessions/   # Session management
│   │       ├── queue/      # Queue system (FCFS, voting)
│   │       ├── livekit/    # LiveKit token generation
│   │       ├── gateway/    # WebSocket gateway (ws)
│   │       ├── users/      # User management
│   │       ├── health/     # Health checks
│   │       ├── prisma/     # Prisma service
│   │       └── redis/      # Redis service
│   ├── web/                # Next.js 15+ frontend
│   │   └── src/
│   │       ├── app/        # App Router pages
│   │       └── lib/        # API client, utils
│   └── robot-client/       # Python robot client (moved to botparty-client repo)
├── packages/
│   ├── shared/             # Shared types, Zod schemas, constants
│   ├── prisma/             # Prisma schema + client
│   ├── tsconfig/           # Shared TypeScript configs
│   └── eslint-config/      # Shared ESLint config
├── docker/
│   ├── api/Dockerfile      # Multi-stage API build
│   ├── web/Dockerfile      # Multi-stage Web build
│   ├── nginx/nginx.conf    # Reverse proxy + security
│   └── livekit/livekit.yaml
├── docker-compose.yml
├── turbo.json
├── pnpm-workspace.yaml
└── package.json
```

---

## Quick Start

### Prerequisites
- Node.js 24, pnpm 9.15+
- Docker & Docker Compose
- Python 3.10+ (robot client only)

Use `nvm use`, `asdf`, or `mise` before installing dependencies. This repository enforces the Node version from `.nvmrc` / `.node-version` and will fail installs on unsupported runtimes.

### Local development

```bash
git clone https://github.com/your-org/botparty.git
cd botparty
nvm use
pnpm install
```

Start the database, cache, and LiveKit:

```bash
docker compose up -d postgres redis livekit
```

Set up the environment (defaults work for local dev):

```bash
cp .env.example .env
```

Generate the Prisma client, push the schema and seed demo data:

```bash
pnpm db:generate
pnpm db:push
pnpm --filter @botparty/prisma db:seed
```

Start everything with hot reload:

```bash
pnpm dev
```

- Frontend: http://localhost:3000
- API: http://localhost:4000
- Swagger: http://localhost:4000/docs (dev only)
- Generated API client docs: `pnpm docs:api-client` -> `docs/api-client.md`
- Generated TypeScript client: `pnpm generate:ts-api-client` -> `apps/web/src/lib/generated/openapi-client`
- LiveKit: ws://localhost:7880

---

## Robot client (Raspberry Pi)

The robot client lives in its own repository: **botparty-client**.
If you are working in this workspace, the current local checkout is:

`/home/julien/workspace/botparty-client`

```bash
cd /home/julien/workspace/botparty-client
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp config.example.yaml config.yaml
python -m botparty_robot
```

Important config values:

- `claim_token` → copy from the robot dashboard
- `api_url` → same base URL as `APP_URL` in `.env`
- `livekit_url` → same value as `NEXT_PUBLIC_LIVEKIT_URL`

**USB camera**: works out of the box (`device: "/dev/video0"`)

**Pi Camera Module**:
- use the `ffmpeg_libcamera` video profile from the `botparty-client` docs
- on current Raspberry Pi OS that is the supported camera-module path, not `device: "picamera2"`

**Custom hardware**:
- copy `botparty_robot/hardware/hardware_custom_example.py` to `hardware_custom.py`
- then set `hardware.type: "custom"` in `config.yaml`
- current custom adapters subclass `BaseHardware`, not `BaseHandler`

For the current robot-client setup and config examples, use the docs in the `botparty-client` repo:
- `/home/julien/workspace/botparty-client/README.md`
- `/home/julien/workspace/botparty-client/docs/installation.md`
- `/home/julien/workspace/botparty-client/docs/hardware/custom.md`

---

## Production Deployment

Run the setup wizard first — it generates `.env`, sets up URLs and secrets, and optionally configures HTTPS:

```bash
bash setup-env.sh
```

Then:

```bash
docker compose up -d --build
```

The API container runs `prisma db push` and seeds the database on first start. Check logs with `docker compose logs -f api`.

For faster iteration you can build or start only the parts you changed:

```bash
pnpm docker:build:api
pnpm docker:build:web
pnpm docker:build:app
pnpm docker:up:core
pnpm docker:up:app
```

### SSL with Let's Encrypt

The setup wizard walks through this, but the short version:

1. Point your domain's A record, e.g. `botparty.live`, at the server.
2. Run `bash setup-env.sh` and choose "Let's Encrypt" when asked.
3. The script sets up the nginx config and tells you the certbot command to run.
4. Certificates go in `docker/nginx/ssl/` — nginx picks them up automatically.

### SSL with your own certs

Copy `fullchain.pem` and `privkey.pem` into `docker/nginx/ssl/`, then run `bash setup-env.sh` and choose "Own certificates".

---

## Security notes

- JWT access tokens (15 min) + refresh tokens (7d), Argon2id password hashing
- Password reset tokens are one-time, expire by TTL, and invalidate older reset emails
- RBAC: Admin → Mod → User
- Rate limiting on both nginx and NestJS sides (auth tighter than general API)
- Strict CORS origin list
- Security headers via nginx (X-Frame-Options, CSP, etc.)
- Zod validation on all API inputs
- Emergency stop fires automatically at >300ms latency

---

## Database models

- **User** — roles, credits, refresh tokens
- **Robot** — all settings: visibility, access, queue mode, streaming config
- **Session** — active/ended control sessions
- **QueueEntry** — control queue
- **ChatMessage** — in-room messages
- **ControlButton** — per-robot configurable controls
- **RobotModerationEntry** — bans and timeouts per robot
- **Transaction** — credit ledger (for future priority queue / features)

---

## What's missing / planned

- [ ] Voting queue balancing and ranking improvements
- [ ] Full ROS2 integration
- [ ] Community extensions beyond the current leaderboard
- [ ] Credit/priority system beyond the schema

---

## Contributing

PRs welcome. Open an issue first if it's a bigger change.

- Contribution guide: [CONTRIBUTING.md](CONTRIBUTING.md)
- Current release notes: [CHANGELOG.md](CHANGELOG.md)

---

## License

MIT
