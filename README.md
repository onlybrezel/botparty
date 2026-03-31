# 🤖 BotParty

**The modern real-time robot teleoperation platform.**
Connect your robot. Share it with the world. Let anyone drive it live.

> The fully open-source successor to LetsRobot.tv, Remo.tv, and Vigibot — built with state-of-the-art 2026 technology for ultra-low latency, massive scalability, and an incredible user experience.

---

## ✨ Features

- **Ultra-Low Latency**: <150ms video, <50ms control via WebRTC DataChannel
- **LiveKit SFU**: State-of-the-art media server for scalable video streaming
- **Queue System**: First-come-first-serve, voting, or priority (with credits)
- **Virtual Currency**: Credits system for priority queue, featured robots, battles
- **RBAC**: Admin, Moderator, Creator, User roles
- **Robot Dashboard**: Full control panel for robot hosts (visibility, access, schedule, analytics)
- **Emergency Stop**: Auto-E-STOP at >300ms latency, latency warnings at >200ms
- **Session Recording**: Record and replay sessions via LiveKit
- **Chat**: In-session messaging between controller and viewers
- **Mobile/PWA**: Touch controls, responsive design
- **Swarm Control**: Multi-robot coordinated commands
- **AI Assistance**: Placeholder for vision, auto-stop, suggest-move
- **ROS2 Support**: For advanced robotics setups
- **Analytics**: Viewer counts, command heatmaps, session stats
- **Community**: Featured robots, leaderboard, battles

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
│   (Video + DataChannel)          │
│   < 150ms video latency          │
│   < 50ms control latency         │
└──────────────┬───────────────────┘
               │
               ▼
┌──────────────────────────┐
│   Python Robot Client    │
│   (Raspberry Pi/Jetson)  │
│   Camera → LiveKit       │
│   DataChannel → Motors   │
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
│   └── robot-client/       # Python robot client
│       └── botparty_robot/
│           ├── client.py   # Main LiveKit client
│           ├── config.py   # Configuration models
│           └── handlers/   # Command handlers
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

## 🚀 Quick Start (Local Development)

### Prerequisites
- **Node.js 24** (LTS)
- **pnpm 9.15+**
- **Docker** & **Docker Compose**
- **Python 3.11+** (for robot client only)

### 1. Clone & Install

```bash
git clone https://github.com/your-org/botparty.git
cd botparty

# Install dependencies
pnpm install
```

### 2. Start Infrastructure (Postgres, Redis, LiveKit)

```bash
# Start database, cache, and LiveKit
docker compose up -d postgres redis livekit
```

### 3. Setup Environment

```bash
cp .env.example .env
# Edit .env if needed (defaults work for local dev)
```

### 4. Setup Database

```bash
# Generate Prisma client
pnpm db:generate

# Push schema to database
pnpm db:push

# (Optional) Seed with demo data
pnpm --filter @botparty/prisma db:seed
```

### 5. Start Development Servers

```bash
# Start all services (API + Web) with hot reload
pnpm dev
```

- **Frontend**: http://localhost:3000
- **API**: http://localhost:4000
- **API Docs (Swagger)**: http://localhost:4000/docs
- **LiveKit**: ws://localhost:7880

---

## 🤖 Robot Client Setup (Raspberry Pi)

### On your Raspberry Pi:

```bash
# 1. Clone the robot client
git clone https://github.com/your-org/botparty.git
cd botparty/apps/robot-client

# 2. Create virtual environment
python3 -m venv venv
source venv/bin/activate

# 3. Install dependencies
pip install -r requirements.txt

# 4. Configure
cp config.example.yaml config.yaml
nano config.yaml
# Set your claim_token from the BotParty dashboard
# Set api_url and livekit_url to your server address

# 5. Run
python -m botparty_robot
```

### Camera Setup

**USB Camera**: Works out of the box (`device: "/dev/video0"`)

**Raspberry Pi Camera Module**:
```bash
# Enable camera in raspi-config
sudo raspi-config  # Interface Options → Camera → Enable

# For picamera2 (Pi Camera v2/v3):
pip install picamera2
# Set device: "picamera2" in config.yaml
```

### Custom Robot Hardware

Create a custom handler for your specific robot:

```python
# my_handler.py
from botparty_robot.handlers import BaseHandler

class MyRobotHandler(BaseHandler):
    def on_command(self, command, value=None):
        if command == "forward":
            # Your motor control code
            pass
        elif command == "stop":
            self.emergency_stop()

    def emergency_stop(self):
        # Stop all motors immediately
        pass
```

---

## 🐳 Production Deployment

### Full Docker Deployment

```bash
# 1. Configure production environment
cp .env.example .env
# Edit .env with production secrets (CHANGE ALL SECRETS!)

# 2. Build and start everything
docker compose up -d --build

# 3. Run database migrations
docker compose exec api npx prisma migrate deploy

# 4. (Optional) Seed database
docker compose exec api npx prisma db seed
```

### Scaling

```bash
# Scale API horizontally
docker compose up -d --scale api=3

# LiveKit scales via its own cluster mode
# See: https://docs.livekit.io/deploy/distributed/
```

### SSL/TLS

Place your certificates in `docker/nginx/ssl/`:
- `fullchain.pem`
- `privkey.pem`

Then enable HTTPS in `docker/nginx/nginx.conf`.

---

## 🔒 Security

- **Authentication**: JWT access tokens (15min) + refresh tokens (7d) with Argon2id hashing
- **Authorization**: Full RBAC (Admin, Moderator, Creator, User)
- **Rate Limiting**: NGINX + NestJS Throttler (auth endpoints: 5/min, API: 30/s)
- **CORS**: Strict origin whitelist
- **Headers**: Helmet security headers (X-Frame-Options, CSP, etc.)
- **Input Validation**: Zod schemas on all inputs
- **Emergency Stop**: Automatic at >300ms latency

---

## 🗄 Database Schema

Key models:
- **User**: Roles, credits/balance, auth tokens
- **Robot**: All settings (visibility, access, queue, schedule, streaming)
- **Session**: Active/ended sessions with recording support
- **Transaction**: Virtual currency ledger
- **QueueEntry**: Control queue with priority + voting
- **ChatMessage**: In-session messages
- **SwarmGroup**: Multi-robot coordination
- **AnalyticsEvent**: Flexible event tracking

---

## 🛣 Roadmap

- [x] Core platform (auth, robots, streaming, controls)
- [x] Queue system (FCFS, voting)
- [x] Chat system
- [x] Docker deployment
- [ ] Session recording & replay
- [ ] AI assistance (object detection, auto-stop)
- [ ] Full ROS2 integration
- [ ] Analytics dashboard for creators
- [ ] Mobile app (React Native)
- [ ] Swarm control UI
- [ ] Community features (battles, leaderboard)
- [ ] Payment integration for credits

---

## 🤝 Contributing

1. Fork the repo
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit changes: `git commit -m 'Add amazing feature'`
4. Push: `git push origin feature/amazing-feature`
5. Open a Pull Request

---

## 📄 License

MIT © BotParty Contributors

---

<p align="center">
  Built with ❤️ for the maker community<br>
  <strong>🤖 Let the robots party! 🎉</strong>
</p>
