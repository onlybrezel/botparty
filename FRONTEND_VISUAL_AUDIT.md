# Frontend visual audit

Audit date: 2026-07-18

## Design direction

The frontend now uses a restrained product layout: one clear page heading, one primary action per
workflow, compact secondary actions, consistent cards and borders, and predictable spacing. Robot
operation remains feature-rich without placing every function in the first visual layer. The owner
dashboard keeps fleet selection and section shortcuts separate from the working form.

## Reviewed states

- Public home, Explore, search, login, password recovery, docs, legal, pricing, status and 404 pages.
- Owner fleet, selected robot, empty dashboard, settings, large session history and wallet.
- Moderator and administrator consoles including empty billing/payout states.
- Public/private/offline robot rooms and embeds.
- Notification, OBS help, account deletion and other confirmation dialogs.
- Light and dark appearance.
- Empty, normal and seeded large-list states.

## Corrections made

- Reworked the home page into two focused sections with short, concrete copy.
- Reduced visual competition between primary and secondary navigation and actions.
- Changed tablet widths to the compact menu so the header does not crowd or overflow.
- Kept offline robot previews compact; live video retains its full aspect ratio.
- Added fleet summary hierarchy and clearer section labels to the owner dashboard.
- Normalized control rows, settings groups, status badges, tables and form spacing.
- Constrained notification and help dialogs to the viewport.
- Added explicit no-result and empty states instead of blank tables.
- Corrected clipped mobile content, long labels, select controls and horizontal page overflow.
- Replaced assistant-like explanatory copy with short product language.

## Visual regression set

Chromium reference images cover home and login in desktop/mobile states, mobile navigation, Explore,
password-reset error state, owner fleet and selected dashboard at desktop/mobile widths, settings,
notifications, large session history, empty viewer dashboard and administrator moderation. Animations
are disabled and reduced motion is requested. The accepted pixel-difference ceiling is 0.02 percent;
reference updates require the explicit all-snapshot update mode and are reviewed before the normal
comparison run.

The final generated images and comparison result are recorded in `FRONTEND_E2E_FINAL_REPORT.md`.

All 14 current reference images were inspected after generation. No clipped primary action,
overlapping navigation, page-level horizontal overflow, viewport-escaping dialog or stale Alpha
badge remains in the reviewed set. Long Explore and session-history states preserve a stable grid
and readable repeated actions rather than expanding the global navigation.
