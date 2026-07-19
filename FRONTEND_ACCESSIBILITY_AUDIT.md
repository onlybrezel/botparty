# Frontend accessibility audit

Audit date: 2026-07-18
Target: WCAG 2.2 AA

## Scope

The browser suite runs `@axe-core/playwright` on every public/authentication route, representative
pages for each role, the selected owner dashboard, the notification and OBS dialogs, the public
robot route, the embed route, the not-found page, and representative light and dark states.

Keyboard browser tests cover:

- skip-link activation and focus transfer to the main landmark;
- desktop and mobile navigation;
- user-menu opening, Escape handling and focus return;
- notification and OBS dialogs, Escape handling and focus return;
- login submission with Enter;
- tab order through primary form actions;
- destructive confirmation dialogs and cancellation.

The responsive suite exercises reflow-equivalent widths up to 200 percent zoom. Touch targets use a
44 px minimum and the mobile navigation prevents background scrolling while open.

## Issues corrected

- Added a keyboard-visible skip link and one stable main landmark.
- Replaced inaccessible ad-hoc overlays with the shared labelled dialog implementation.
- Added dialog names, Escape handling, focus restoration and constrained mobile dialog sizing.
- Added explicit labels and accessible names to controls, token actions, file inputs and icon buttons.
- Added `alert` and `status` semantics to form errors, success messages and toast notifications.
- Corrected light and dark contrast in legal pages, documentation, dashboard status text, staff
  tools, buttons, badges, robot states and the start-page accent.
- Kept focus outlines visible and removed focus loss when menus close.
- Made navigation usable at tablet widths and at 200 percent reflow.
- Preserved readable tables and allowed horizontal scrolling only inside their own containers.

## Automated result

The targeted Chromium WCAG run passed 27 of 27 tests after the contrast corrections. The final
cross-browser run repeated the same 27 checks in Chromium, Firefox and WebKit: 81 of 81 passed. The
combined functional/accessibility result is recorded in `FRONTEND_CROSS_BROWSER_REPORT.md` and
`FRONTEND_E2E_FINAL_REPORT.md`.

## Manual limitation

The browser automation validates the accessibility tree, names, landmarks, focus behavior and
keyboard operation. A human listening test with NVDA, JAWS or VoiceOver requires an external desktop
and was not performed inside the headless Docker environment. No screen-reader certification is
claimed.
