# Frontend production readiness

Audit date: 2026-07-19

## Verdict

The tested frontend software paths are production-ready in the isolated Docker environment. All 31
declared application routes, all authorization roles, owner/non-owner boundaries, core CRUD paths,
account operations, staff pages, responsive layouts and failure states passed through the reverse
proxy with production images. The limits under **External validation** remain operational checks,
not hidden test passes.

## Page readiness

| Area                                  | Roles                       | Readiness evidence                                                                              | Status |
| ------------------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------- | ------ |
| Public, legal and documentation pages | All                         | Navigation, deep links, 404, light/dark, responsive, Axe                                        | Ready  |
| Authentication and recovery           | Anonymous, disabled state   | Login, registration, recovery, validation, throttling, keyboard submit                          | Ready  |
| Explore, search and leaderboard       | All                         | Search, filter, sort, pagination, empty/normal/large state                                      | Ready  |
| Robot room and embed                  | Public, owner, allowed user | Offline state, private denial, missing robot, anonymous viewer token                            | Ready  |
| Owner dashboard and onboarding        | Signed-in owner             | Create, read, update, delete, double submit, files, controls, access, tokens, ingress, webhooks | Ready  |
| Wallet, settings and sessions         | Signed-in                   | Exports/downloads, profile/avatar, preferences, consent, logout, deletion, large history        | Ready  |
| Moderation                            | `MOD`, `ADMIN`              | Search, moderation, role/state changes, direct-link denial                                      | Ready  |
| Analytics, billing and payouts        | `ADMIN`                     | Navigation, visible states, administrator-only enforcement                                      | Ready  |

## Required behavior checked

- One dominant action and grouped secondary actions on dense owner and staff pages.
- Visible loading, success, empty, validation, denial and recoverable error states.
- Keyboard access, skip link, focus restoration, labelled dialogs and live status output.
- No page-level horizontal scrolling at the tested phone, tablet, desktop and zoom widths.
- Session stability across two API instances and after one API instance stops and returns healthy.
- Fail-closed CSRF bootstrap across canonical redirects and controlled polling recovery after an
  offline interval.
- Browser back/reload/deep links, multi-context role changes, cross-tab login bootstrap and logout behavior.
- Unexpected console warnings, browser exceptions, request failures and HTTP errors fail browser
  tests rather than being ignored.

## Product capabilities not present

There is no user-group, organization or tenant authorization model and no import workflow in the
current product. These were not invented for the audit. `SwarmGroup` is robot coordination data,
not a frontend authorization group.

## External validation

- A physical robot and camera are required to certify a real live video/control session end to end.
- Browser push permission and delivery need a real HTTPS origin and provider credentials.
- A manual NVDA, JAWS or VoiceOver listening pass needs an external desktop/device.

The corresponding UI, validation, unavailable states and integration boundaries were exercised;
the external hardware/provider outcomes are not reported as tested.
