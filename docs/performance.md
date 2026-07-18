# Performance and Safety Verification

BotParty does not publish fixed latency, bitrate, or emergency-stop timing claims. Results depend on robot hardware, codecs, camera count, network path, browser, and LiveKit topology.

## Web release budgets

`apps/web/performance-budgets.json` caps the JavaScript chunks used by the landing, explore, robot, login, pricing, dashboard, and moderation routes. `pnpm web:budget` reads the production Next.js manifest and fails on either an absolute cap or growth above 110% of the checked-in baseline.

The unfiltered Explore page and Login are statically rendered. Filtered discovery uses `/explore/search`; legacy filter URLs are redirected there. This keeps the core routes cacheable without changing shared filter links or server-rendered results.

Lighthouse CI runs three mobile-profile samples per public route and enforces:

- performance score at least 0.75;
- accessibility score at least 0.90;
- Largest Contentful Paint at most 3 seconds;
- Total Blocking Time at most 300 ms;
- Cumulative Layout Shift at most 0.1;
- total transfer at most 1.5 MB and scripts at most 800 KB.
- at most 120 initial network requests per route.

Lighthouse's 300 ms Total Blocking Time cap is the repeatable laboratory guard for responsiveness. Consenting signed-in users additionally report CLS, LCP and INP through the first-party analytics endpoint; the admin dashboard calculates p75 over the selected retention window. Release targets are LCP p75 at most 2.5 seconds and INP p75 at most 200 ms. No metric is sent before server consent has been restored into the existing preferences record.

CI collects the full matrix in one isolated job. Local collection waits for other Jest, Vitest, Playwright, Next.js build, or install work and discards a sample if competing work starts during measurement. Only uncontended samples reach the assertion step.

## Polling request budgets

Background tabs make no periodic REST requests. Returning to a visible tab triggers one immediate refresh. While visible, the upper bounds are:

- Explore: no periodic requests; filters and manual page refreshes load fresh server-rendered results.
- Online robot room: 2 control-definition fallback requests per minute; live room, queue, chat and control state use WebSocket events. The 15-second WebSocket ping is transport liveness, not REST polling.
- Offline robot room: 2 lightweight route refreshes per minute so the full live room loads after a reconnect.
- Robot room for an administrator: up to 4 additional recording-status requests per minute while the robot is online.
- Dashboard for one selected robot: at most 12 pending-action, 6 log and 12 telemetry/onboarding requests per minute.
- Notifications: 2 requests per minute for signed-in users.
- Moderation dashboard: 4 consolidated refreshes per minute.

The short timers used while a key, gamepad, queue countdown or video frame is actively in use are local scheduling loops and do not fetch server state.

## Queue benchmark

`pnpm benchmark:queue` creates 1,000 queue entries against isolated PostgreSQL and Redis services, validates position invariants, and measures reads and state transitions. Writes require `QUEUE_BENCHMARK_ALLOW_WRITES=true`; the script refuses to run otherwise. CI runs the same scenario and fails when its checked-in latency budgets are exceeded.

Record the database version, Redis version, CPU allocation, storage type, command, commit, p50, p95, maximum, and invariant result with every release result. Do not compare results collected on materially different hosts as a product regression.

## Four-camera protocol

Use a physical robot with four independent camera sources, the production streamer build, and a clean browser profile:

1. publish all cameras for 30 minutes at the deployment's normal resolution and frame rate;
2. open the robot route on a desktop and a representative mobile device;
3. keep one camera primary and rotate the primary camera every five minutes;
4. record publisher CPU/memory/temperature, browser CPU/memory, per-track bitrate, packet loss, reconnect count, and LiveKit quality changes;
5. background the tab for two minutes and confirm non-primary tracks reduce quality before restoring the tab;
6. fail the release on thermal throttling, unbounded memory growth, repeated reconnects, missing primary video, or failure to reduce non-primary bandwidth.

The UI diagnostics export supplies browser-side samples. LiveKit is configured with adaptive stream and dynacast, and non-primary tracks are subscribed at lower quality until selected.

## Control safety protocol

Every control command carries a UUID and issue timestamp. The API rejects stale input, the robot answers with ACK or NACK, timed-out paid commands are compensated idempotently, and only a verified stop acknowledgement satisfies host go-live checks. Test the visible stop control, Escape key, held-key release, disconnect, command timeout, NACK, duplicate ACK, and robot-local physical stop before public operation.
