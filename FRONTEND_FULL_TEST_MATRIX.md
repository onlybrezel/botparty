# Frontend full test matrix

Audit date: 2026-07-18

Status values in this matrix are updated only from browser runs against the Docker reverse proxy.
All listed rows passed in the final Chromium, Firefox and WebKit run unless a capability is marked as
absent below.

| Route                   | Access             | Main visible behavior covered                                                                          | Automated browser coverage                                                  |
| ----------------------- | ------------------ | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| `/`                     | Public             | Primary navigation, calls to action, mobile menu, light/dark layout                                    | accessibility, public flows, responsive, visual                             |
| `/login`                | Public             | Sign in, registration, validation, disabled account, rate limit, keyboard submit                       | auth flow, error states, accessibility, responsive, visual                  |
| `/forgot-password`      | Public             | Request form, invalid and accepted addresses, mail-safe confirmation                                   | auth flow, accessibility                                                    |
| `/reset-password`       | Public token flow  | Missing token, invalid token and form state                                                            | special routes, accessibility                                               |
| `/verify-email`         | Public token flow  | Missing and invalid token states                                                                       | special routes, accessibility                                               |
| `/explore`              | Public             | Robot cards, empty/normal/large lists, search entry, pagination links                                  | public flows, smoke, responsive, visual                                     |
| `/explore/search`       | Public             | Query, filters, sorting, reset, URL state, no-result state                                             | public flows, accessibility                                                 |
| `/leaderboard`          | Public             | Ranked list and large seeded fleet                                                                     | public flows, accessibility                                                 |
| `/pricing`              | Public             | Package presentation and navigation                                                                    | public flows, accessibility                                                 |
| `/status`               | Public             | Service status presentation                                                                            | accessibility, smoke                                                        |
| `/docs`                 | Public             | Documentation index and links                                                                          | public flows, accessibility                                                 |
| `/docs/getting-started` | Public             | Setup documentation                                                                                    | public flows, accessibility                                                 |
| `/docs/multi-camera`    | Public             | Camera documentation                                                                                   | public flows, accessibility                                                 |
| `/docs/obs-whip`        | Public             | OBS/WHIP documentation                                                                                 | public flows, accessibility                                                 |
| `/docs/robot-setup`     | Public             | Robot client setup documentation                                                                       | public flows, accessibility                                                 |
| `/cookies`              | Public             | Cookie notice and footer navigation                                                                    | public flows, accessibility                                                 |
| `/privacy`              | Public             | Privacy text and footer navigation                                                                     | public flows, accessibility                                                 |
| `/terms`                | Public             | Terms text and footer navigation                                                                       | public flows, accessibility                                                 |
| `/imprint`              | Public             | Imprint and footer navigation                                                                          | public flows, accessibility                                                 |
| `/robot/[owner]/[slug]` | Access dependent   | Public room, private-room denial, owner access, offline state                                          | smoke, private isolation, accessibility                                     |
| `/embed/[owner]/[slug]` | Access dependent   | Embed route, missing robot and accessible room state                                                   | smoke, accessibility                                                        |
| `/dashboard`            | Signed in          | Empty, fleet and selected robot states; CRUD; controls; access; thumbnail; ingress; webhooks; tokens   | owner CRUD/features, roles, error states, accessibility, responsive, visual |
| `/dashboard/robots/new` | Signed in          | Onboarding route and return to dashboard                                                               | host onboarding, responsive                                                 |
| `/wallet`               | Signed in          | Balance, empty transactions, CSV and JSON download                                                     | account tools, accessibility                                                |
| `/settings`             | Signed in          | Profile, avatar, theme, local options, notifications, analytics consent, export, delete and logout-all | account lifecycle/tools, error states, responsive, accessibility            |
| `/sessions`             | Signed in          | 55-row history, filter, no-result state, detail navigation                                             | account tools, responsive, accessibility                                    |
| `/sessions/[id]`        | Signed in          | Session details and browser history                                                                    | account tools, accessibility                                                |
| `/mod`                  | `MOD`, `ADMIN`     | User search, moderation actions, role and active-state changes                                         | staff console, live role change, role navigation, accessibility, visual     |
| `/mod/analytics`        | `ADMIN`            | Product analytics page and role denial                                                                 | staff console, role navigation, accessibility                               |
| `/mod/billing`          | `ADMIN`            | Billing administration and role denial                                                                 | staff console, role navigation, accessibility                               |
| `/mod/payouts`          | `ADMIN`            | Payout administration and role denial                                                                  | staff console, role navigation, accessibility                               |
| unknown route           | Public error state | Branded 404, navigation and accessibility                                                              | special routes, accessibility                                               |

## State and interaction coverage

- Empty: viewer dashboard, notifications, wallet activity, searches without matches.
- Normal: owner robot, profile, wallet, room and staff workflows.
- Large: 24 admin robots and 55 owner sessions with filtering and navigation.
- Forms: registration, sign-in, profile, robot create/edit, controls, ingress, webhooks, allowlist,
  file inputs, password recovery and destructive confirmations.
- Files: thumbnail upload/remove, avatar upload/remove, account export, wallet CSV/JSON download.
- Errors: offline request, 401/403/404, 409, 422, 429, 500, 502, 503 and 504 visible states.
- Concurrency/security: two independent owners, live role changes in a second browser context,
  double-click submission protection, logout propagation and two API instances.

The executable source of truth is `apps/web/tests/e2e/`. Console errors, page exceptions,
unexpected HTTP errors and unexpected request failures fail every functional test.
