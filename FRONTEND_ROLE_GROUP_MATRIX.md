# Frontend role and group matrix

Audit date: 2026-07-18

## Authorization model

BotParty has three user roles: `USER`, `MOD`, and `ADMIN`. The product has no user-group,
tenant, organization, site, or department authorization model. `SwarmGroup` belongs to robot
coordination and is not a user permission group or a current frontend module.

Robot ownership and per-room access rules form the second authorization boundary. A `USER` who
owns a robot can manage that robot, while another `USER` cannot discover or open a private robot.

## Tested users

| Account                             | Role/state                     | Purpose                                                                |
| ----------------------------------- | ------------------------------ | ---------------------------------------------------------------------- |
| `owner@botparty.test`               | `USER`, active, robot owner    | Robot CRUD, dashboard, access rules, files, sessions, wallet, settings |
| `viewer@botparty.test`              | `USER`, active, no owned robot | Guest navigation, account settings, negative staff access              |
| `moderator@botparty.test`           | `MOD`, active                  | Moderation console and negative admin-only access                      |
| `admin@botparty.test`               | `ADMIN`, active                | Full moderation, billing, payouts, analytics, large fleet              |
| `disabled@botparty.test`            | `USER`, disabled               | Rejected sign-in state                                                 |
| UI-created `@example.test` accounts | `USER`, active                 | Registration and private-room isolation between independent owners     |

Passwords are supplied only to the isolated E2E environment and are not recorded in this report.

## Role matrix

| Area/action                                                               | Anonymous                     | `USER`                        | `MOD`                   | `ADMIN`                           |
| ------------------------------------------------------------------------- | ----------------------------- | ----------------------------- | ----------------------- | --------------------------------- |
| Home, Explore, search, leaderboard, pricing, docs, legal and status pages | Yes                           | Yes                           | Yes                     | Yes                               |
| Public robot room and embed                                               | Yes                           | Yes                           | Yes                     | Yes                               |
| Register, sign in, password recovery, email verification                  | Yes                           | Session redirects apply       | Session redirects apply | Session redirects apply           |
| Dashboard, wallet, settings and session history                           | No                            | Yes                           | Yes                     | Yes                               |
| Create and manage owned robots                                            | No                            | Yes, owned robots only        | Yes, owned robots only  | Yes, owned robots and staff tools |
| Private room                                                              | Owner or explicit access only | Owner or explicit access only | Staff policy            | Staff policy                      |
| Moderation console                                                        | No                            | No                            | Yes                     | Yes                               |
| Product analytics                                                         | No                            | No                            | No                      | Yes                               |
| Billing and payout administration                                         | No                            | No                            | No                      | Yes                               |
| Change user roles and active state                                        | No                            | No                            | No                      | Yes                               |

## Navigation expectations

- Anonymous users see Home, Explore, Leaderboard, Pricing, Robot Setup, and Sign in.
- Signed-in users additionally receive Robots, Wallet, Settings, Sessions, Notifications, theme
  selection, and Sign out.
- `MOD` receives Moderation.
- `ADMIN` receives Moderation and Product Analytics; billing and payouts are reached from the staff
  console.
- Staff navigation is absent for `USER`. Direct staff deep links resolve to a safe denied state.
- A live role change is applied after reload. Removed staff access no longer exposes the staff
  navigation or page; newly granted access becomes available.

## User states covered

Active users, a disabled user, an owner, a non-owner, independent newly registered users, large and
empty account data, revoked sessions, and a role changed during a second active browser session are
covered. The repository contains no invitation, user-group, multi-tenant, site, or department flow,
so no such state is listed as tested.
