# Frontend cross-browser report

Audit date: 2026-07-19

## Environment

The browser suite ran in the pinned Playwright Docker image against the production Next.js and
NestJS images through the unprivileged Nginx reverse proxy. PostgreSQL, Redis, MinIO, LiveKit,
LiveKit Ingress and Mailpit were isolated in the same disposable Compose project. Two API and two
web containers were active behind Nginx.

## Browser result

| Engine   | Functional and accessibility cases | Result |
| -------- | ---------------------------------: | ------ |
| Chromium |                                 72 | Passed |
| Firefox  |                                 72 | Passed |
| WebKit   |                                 72 | Passed |
| Total    |                                216 | Passed |

Each engine executed the same 45 behavioral cases and 27 Axe page/dialog checks. Tests use the
visible login form, navigation, forms, dialogs, file inputs and downloads. Unexpected browser
errors, warnings, failed requests and HTTP error responses fail the test at the shared fixture
boundary.

## Browser-specific findings

- WebKit exposed an authentication bootstrap race: the server-rendered login form was interactive
  before controlled fields had hydrated. The login helper now waits for the visible form and the
  initial authentication bootstrap before typing. The production registration redirect also uses a
  hydration-safe fragment value.
- Firefox reports its documented development warning for an HTTP password form and its CSP
  `strict-dynamic` fallback warning in the isolated non-TLS proxy. Only these exact messages are
  allowlisted; other warnings still fail the suite. Production HTTPS avoids the password warning.
- Public room and embed pages previously created independent API clients. Concurrent CSRF cookie
  issuance could make Firefox send a stale token during background refresh. Public viewer-token
  requests are now explicitly anonymous and all frontend modules share one API client.
- The server now reuses an existing valid CSRF cookie across tabs and replaces only malformed
  values, so opening a second login form cannot invalidate the first one.
- A canonical room redirect exposed a second CSRF edge case: Firefox and WebKit can abort reading
  the bootstrap body while the document changes. The API client now refuses to transmit any
  mutating authentication request without a parsed token, uses explicit same-origin mode for local
  requests and retries session restoration after the redirect.
- The theme bootstrap no longer writes a transient transition marker before React hydration.
  This removed the reproducible Firefox hydration mismatch without changing the selected theme.
- Visibility polling pauses offline and restarts on reconnect. Completed-navigation waits prevent
  WebKit from carrying cancelled login-page prefetches into the next role workflow.
- Vertical control sliders now use the standardized CSS `writing-mode` path, avoiding deprecated
  browser-specific appearance behavior.

No unresolved Chromium, Firefox or WebKit behavior difference was observed in the tested routes.

## Responsive and zoom coverage

Chromium reflow checks cover 320×568, 360×800, 390×844, 430×932, 844×390, 768×1024, 1024×768,
1280×800, 1440×900, 1920×1080 and 2560×1440. Separate 100%, 125%, 150% and 200% zoom-equivalent
checks verify that the primary navigation, owner dashboard and forms remain reachable without page
level horizontal overflow.

## Remaining external checks

Physical iOS/Android devices and desktop screen readers are outside the headless Docker environment.
The automated engines, viewport reflow, keyboard paths and accessibility trees are covered; no
claim is made for a manual hardware certification.
