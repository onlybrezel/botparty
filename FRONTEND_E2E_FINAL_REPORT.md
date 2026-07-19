# Frontend E2E final report

Audit date: 2026-07-19

## Tested system

The final test target uses fresh Docker volumes and production images behind Nginx:

`Nginx → web-1/web-2 → API-1/API-2 → PostgreSQL, Redis, MinIO, LiveKit/Ingress and Mailpit`.

Migrations and deterministic fixtures run before Playwright. The browser never uses an internal
application port. The smoke probe confirmed requests were distributed 10/10 across the two API
instances.

## Roles, states and data

| Browser account                  | Product role/state         | Main workflows                                                       |
| -------------------------------- | -------------------------- | -------------------------------------------------------------------- |
| `owner@botparty.test`            | Active `USER`, robot owner | Robot CRUD, configuration, files, access, wallet, settings, sessions |
| `viewer@botparty.test`           | Active `USER`, no robot    | Empty account, navigation, negative owner/staff access               |
| `moderator@botparty.test`        | Active `MOD`               | Moderation and negative administrator access                         |
| `admin@botparty.test`            | Active `ADMIN`             | Moderation, user administration, analytics, billing and payouts      |
| `disabled@botparty.test`         | Disabled `USER`            | Rejected visible login state                                         |
| UI-created `@example.test` users | Independent active users   | Registration and private-owner isolation                             |

The seeded states include an empty viewer account, normal owner data, 24 fleet robots for the large
state and 55 owner session records. The repository has no authorization groups or tenants.

## Executed browser coverage

- 31 declared frontend routes plus the unknown-route error page.
- 216 functional/accessibility cases: 72 each in Chromium, Firefox and WebKit.
- 27 Axe checks per browser, covering every public/auth route and representative stateful pages and
  dialogs for every role.
- 15 responsive/reflow cases: 11 viewports from 320×568 through 2560×1440 and four zoom-equivalent
  layouts from 100% through 200%.
- 14 Chromium reference screenshots across public, authentication, owner, administrator, empty,
  mobile, desktop, light and dark states.
- 53 declared test workflows in 21 spec files. Their source contains 126 visible clicks, 84 form,
  key, selection and file interactions, and 86 browser navigations; parameterized route and viewport
  loops expand these actions during execution.
- One live Docker failover workflow: active login, API-1 stop, profile update through API-2,
  API-1 restart/readiness, reload and session verification.

This represents 45 distinct functional browser cases repeated in three engines, 27 accessibility
cases repeated in three engines, 15 responsive cases, four visual workflows and one failover
workflow. One complete robot entity CRUD lifecycle was executed; user state/role administration,
profile/avatar, access rules, controls, files, tokens, ingress, webhooks and account deletion were
executed as separate state-changing workflows rather than counted as additional CRUD entities.

## Workflows exercised through the UI

- Authentication: registration, valid/invalid login, disabled account, password recovery, reset and
  verification errors, throttling, Enter submission, logout and logout propagation.
- Navigation: every public route, footer and documentation links, mobile navigation, staff
  navigation, deep links, browser history, reload and branded 404.
- Robot ownership: create, open, edit, configure and delete; double-submit protection; independent
  owners; private-room denial; control builder; thumbnail; allowlist; token; ingress and webhook
  operations.
- Account: profile/avatar/theme, notification preferences, analytics consent, data export, account
  deletion, session filtering/detail/revocation, wallet CSV/JSON downloads.
- Staff: moderator restrictions, user search and administrator role/active-state changes; live
  permission removal/addition in a second browser context; admin-only analytics/billing/payouts.
- Error handling: visible 401, 403, 404, 409, 422, 429, 500, 502, 503, 504, offline, failed upload,
  failed export and retry behavior without losing form input.

The product has no import UI, so no import result is claimed.

## Problems found and corrected

- Dense navigation and dashboard action areas competed visually. Navigation breakpoints, hierarchy,
  page sections and secondary-action grouping were simplified without removing functions.
- Phone/tablet overflow, clipped labels, oversized offline previews and viewport-escaping dialogs
  were corrected.
- Missing labels, dialog names, live regions, focus restoration, touch targets and contrast failures
  were corrected and covered by Axe/keyboard tests.
- Ambiguous, technical and assistant-like visible copy was replaced with short product language.
- Loading, empty, no-result, validation and recoverable error states were made explicit.
- Role changes and private ownership states previously left inconsistent navigation or denial
  behavior; UI state now refreshes safely and no protected data flashes before authorization.
- Public room/embed CSRF requests could race between API client instances. Anonymous viewer-token
  requests now avoid refresh entirely and all modules share one client.
- Opening another tab could rotate the shared CSRF cookie while the first tab still displayed a
  valid login form. The API now reuses a valid cookie token and replaces only malformed tokens.
- A legacy room redirect could make Firefox or WebKit lose the readable CSRF bootstrap response.
  Mutating authentication requests now fail closed before transmission unless a valid token was
  obtained; same-origin requests use an explicit same-origin transport mode and session restoration
  retries without producing an invalid request.
- The pre-hydration theme bootstrap briefly changed a root attribute and could overlap Firefox
  hydration on a constrained container. The bootstrap now applies only the stable theme state;
  post-hydration theme transitions remain in the theme controller.
- Background polling now pauses while the browser is offline and resumes on the `online` event.
  Sign-out and error-state flows also wait for completed navigation before continuing, which
  prevents aborted WebKit prefetches from leaking into the next user action.
- Staff account updates previously waited for unrelated runtime and Docker telemetry reloads. The
  confirmed API response now updates the affected row immediately while keeping all operator
  controls and follow-up refresh paths intact.
- Host onboarding left its created robot behind, coupling later visual tests to suite order. The
  workflow now deletes the robot through the visible dashboard before it completes.
- Nginx could hold a request to a stopped API for roughly a minute. Its upstream connect timeout is
  now two seconds, allowing the surviving instance to serve the next user action promptly.
- The visual threshold previously allowed a small stale badge to escape detection. The threshold is
  now 0.02% and snapshot updates require an explicit all-snapshot update mode.

Regression coverage was added beside each corrected area in the functional, responsive, visual,
accessibility and multi-instance suites, with focused unit tests for API request authentication,
dashboard token behavior, moderation header semantics, toast status output and visibility polling.

## Final verification

| Check                                        | Result                                                         |
| -------------------------------------------- | -------------------------------------------------------------- |
| Production Docker image build and start      | Passed                                                         |
| Fresh migration and deterministic fixtures   | Passed                                                         |
| Cross-browser functional/accessibility suite | 216/216 passed                                                 |
| Responsive and zoom suite                    | 15/15 passed                                                   |
| Visual regression suite                      | 4/4 workflows and 14/14 images passed at 0.02% tolerance       |
| Two-API distribution probe                   | 20/20; 10 requests per API instance                            |
| API failover during active UI session        | Passed                                                         |
| Lint                                         | Passed with zero warnings                                      |
| Typecheck                                    | Passed                                                         |
| Web unit tests                               | 121/121 passed                                                 |
| API unit/integration tests                   | 626/626 passed, including real PostgreSQL and Redis containers |
| Production dependency audit                  | No known vulnerabilities                                       |
| `git diff --check`                           | Passed                                                         |

## Remaining external blockers

No reproducible software blocker remains in the tested Docker scope. Physical robot/video hardware,
real HTTPS push delivery and a human desktop-screen-reader pass require external equipment or
credentials and were not represented as successful tests.
