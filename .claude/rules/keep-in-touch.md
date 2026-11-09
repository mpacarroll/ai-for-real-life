---
paths:
  - "tool/**"
  - "docs/keep-in-touch.md"
---
# Keep in Touch tool

- All decisions live in `tool/keepintouch.js` (browser global `KIT`) and `tool/interop.js` (vCard in, iCalendar out; browser global `KIT_IO`). Both are pure and take `today` as an argument. `tool/app.js` only renders and stores. The page loads them with `<script src>`; there is no inline copy to keep in sync (`no_drift.test.js` enforces this).
- State is `keepintouch.v2` in localStorage; v1 (`keepintouch.people.v1`) migrates on load and is kept as a backup. Bump `STATE_VERSION` and extend `migrate` for any schema change.
- Voice is guilt-free: no streaks, no "overdue" counts, no red badges. Every reminder carries a reason string.
- Draft openers are deterministic templates. No model calls, no send links, no contact scraping.
- Demo data is synthetic only (`tool/fixtures.js`, `demo: true`, never exported).
- `?today=YYYY-MM-DD` pins the date for demos and the Playwright test. Test: `cd tool && node --test`.
- Contacts import reads only names and dates from a user-chosen .vcf. Never read or store phone, email, address, photo or notes. Calendar exports carry names and labels, never notes.
