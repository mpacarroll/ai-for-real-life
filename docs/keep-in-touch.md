# Keep in Touch: how the planner works

The tool at [`tool/`](../tool/index.html) is a private, local relationship planner. It runs in the browser, keeps everything in that browser's `localStorage`, and never sends anything: no account, no server, no contact syncing, no messages sent for you.

## What you can do

| Area | What it does |
|---|---|
| **This week** | A rolling seven-day plan. Birthdays and other dates land on their day. People due on their rhythm fill the room you set ("Room for 3 hellos this week"), spread across the days. Every card says why it showed up. Anything that does not fit sits under "Can wait until next week", with that reason. |
| **People** | Add someone with a rhythm (week, 2 weeks, month, 3 months, 6 months, year, a custom number of days, or no reminders at all). Each person has private notes, things to ask about next time, important dates, and a conversation log. |
| **Prepare to talk** | On a person's page: when you last talked, recent conversation notes, what to ask about, dates coming up, and three draft openers built from your own notes. Drafts are templates, not AI, and are only ever copied, never sent. |
| **Snooze, pause, remove** | Snooze for 3 days to a month. Pause keeps the notes and stops all reminders. Remove has an Undo. There are no streaks, no red "overdue" badges, no counts of missed weeks. |
| **Dates** | Every birthday, anniversary or other date in the next 60 days. Dates without a year (`MM-DD`) are fine. Feb 29 falls on Feb 28 in other years. |
| **Your data** | Export everything as JSON. Import a JSON export or a CSV (merge or replace). Delete everything (type DELETE to confirm). Load or remove nine invented sample people. |

## Try it

```sh
cd tool
python3 -m http.server 8000   # or open tool/index.html directly
# http://localhost:8000/?today=2026-11-09   (?today= pins the date for demos)
```

On a first visit the week shows an example. Choose **Explore with sample people** to load the synthetic fixture, or **Add your first person**. To try import, use [`tool/fixtures/sample-import.csv`](../tool/fixtures/sample-import.csv): three rows import and one is skipped on purpose so you can see the report.

## Why each reminder appears

Reasons come from `reminderFor` and `weeklyPlan` in [`tool/keepintouch.js`](../tool/keepintouch.js):

- **Rhythm:** "You chose every month. Last talked Oct 1, 39 days ago." A person comes due on `lastContacted + rhythm`.
- **New:** "No conversation logged yet." New people count as one full rhythm late.
- **Date:** "Birthday in 3 days, Thu Nov 12 (turning 68)." Dates within the week always show, and land on their day.
- **Topic:** "Something to ask about: the new tomato beds." Added when someone is already on the plan.
- **Snooze:** "Back from snooze (ended Nov 16)."
- **Capacity:** "Can wait. You set room for 3 a week, so this one can roll to next week."

Ranking is lateness relative to each person's own rhythm (days past due divided by rhythm), so a weekly call that is a week late outranks a yearly one that is a month late.

## Rules worth knowing

- Snooze quiets the rhythm reminder only. A birthday inside a snooze still shows on its day. Pause quiets everything except the Dates list.
- Logging a conversation only moves "last talked" forward. Back-filling an older chat never makes someone look more recently contacted. Logging clears any snooze, and ticked topics are removed.
- Import merges by id only. A row without a matching id but with the exact same full name is skipped as a likely duplicate, never merged: two people can share a name. Bad rows are skipped with a reason; good rows still import.
- Sample people carry `demo: true` and are never exported.

## Data model (`keepintouch.v2` in localStorage)

```json
{
  "version": 2,
  "settings": { "weeklyCapacity": 3 },
  "people": [{
    "id": "p_...", "name": "Sam Okafor",
    "cadence": "quarterly", "cadenceDays": null,
    "lastContacted": "2026-07-12",
    "notes": "private text", "topics": ["How the new job is going"],
    "dates": [{ "id": "d1", "kind": "birthday", "label": "Birthday", "date": "1990-05-02" }],
    "log": [{ "date": "2026-07-12", "note": "Started nights." }],
    "snoozedUntil": null, "paused": false, "createdAt": "2026-11-09"
  }]
}
```

`cadence` is `weekly`, `biweekly`, `monthly`, `quarterly`, `semiannually`, `annually`, `custom` (uses `cadenceDays`, 1 to 730) or `none`. Exports add `"format": "keepintouch-export"` and `exportedOn`.

CSV import columns (header row, any order, case-insensitive): `name` (required), `cadence`, `cadenceDays`, `lastContacted`, `birthday`, `notes`, `topics` (separate with `;`).

## Failure recovery

- **Old data:** the v1 list (`keepintouch.people.v1`) is migrated on first load. The v1 key is left in place as a backup.
- **Unreadable saved data:** the tool starts fresh, keeps the unreadable text under `keepintouch.recovery`, and offers it as a download on Your data.
- **Storage blocked or full:** a notice says changes last until the tab closes and points to Export.
- **Undo:** snooze, pause, log, remove, import and loading samples all offer Undo for a few seconds.

## Tests

```sh
cd tool && node --test
```

`planner.test.js` covers the core (dates, reasons, plan, prep, import and export). `keepintouch.test.js` keeps the v1 behavior. `no_drift.test.js` checks the page loads the tested module and makes no network calls. `e2e.test.js` drives the real page in Chromium through Playwright, and skips when Playwright is not installed.
