# UI redesign — September 2026

Authorized: implement the complete UI proposal and push incremental commits to
main. Preserve deterministic simulation, legacy careers and multiplayer.

## Delivery

- [x] Persistent viewport shell, four main destinations, desktop rail and mobile tabs.
- [x] Task-specific workspaces; map camera and mounted list state survive navigation.
- [x] Persistent cash/profit/objective status and a quarter review with a cash bridge.
- [x] Settings leave the main header; fleet ownership, orders and market are separate.
- [x] Compact actionable desk with entity-specific destinations and timeline.
- [x] Route list/inspector, explicit periods, not-flown states and immediate forecasts.
- [x] Aircraft list/inspector with assignment, maintenance, replacement and artwork.
- [x] Denser responsive tables, mobile essentials and coherent visual tokens.
- [x] One map lens control; coordinated route selection and quiet background networks.
- [x] Viewport contracts for desktop, tablet, mobile, mature airlines and larger text.
- [x] Hosted Chromium/WebKit release gates and saved screenshots for visual review.

## Acceptance

Navigation, airline status and the quarter action must stay inside the viewport.
Lists own scrolling; the application shell does not require page scrolling.
An inspector returns to the same filtered list and scroll position. Mobile forms
fit at 360px, including larger text, and the keyboard cannot hide the focused
field or leave the primary action unreachable. Reports and review dialogs trap
focus and restore it on close. Every forecast labels its period and assumptions.

Test 1366×768, 1440×900, 1920×1080, 768×1024, 1024×768, 360×740,
390×844 and 430×932, including long names and populated late-game networks.
Run `npm run ci` before every code commit. Local browser executables were
unavailable in the prior environment; GitHub's browser job is authoritative.
