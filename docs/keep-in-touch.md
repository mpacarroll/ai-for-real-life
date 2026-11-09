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
| **Contacts file (.vcf)** | Bring in birthdays and anniversaries from a contacts file you exported yourself. A pick list shows every contact with the dates found; nothing is preselected. Search, show only contacts with dates, select what is shown, and choose the rhythm new people get. A name already in your list only gains its missing dates: notes, rhythm and history are never touched. Phone numbers, emails, addresses, photos and notes in the file are never read into the tool. |
| **Calendar files (.ics)** | Download every important date as yearly all-day events, or this week's plan as one event per hello with the reasons it showed up. Open the file with any calendar app. Names and date labels only; private notes never go into a calendar file. Sample people are left out. Buttons sit on Your data, This week and Dates. |

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

### Contacts files

`tool/interop.js` reads vCard 2.1, 3.0 and 4.0: `FN` (falling back to `N`, then `ORG`), `BDAY`, `ANNIVERSARY`, `X-ANNIVERSARY`, and Apple's grouped `X-ABDATE` with its `X-ABLabel`. Date forms: `1990-04-12`, `19900412`, timestamps, `--0412` (no year), and Apple's omitted year (`1604-..` or `X-APPLE-OMIT-YEAR`). It unfolds continuation lines, decodes quoted-printable 2.1 cards and unescapes `\,` `\;` `\n`. A card with no name is skipped and counted. Two picked cards with the same name become one person. A sample file is at `tool/fixtures/sample-contacts.vcf` (synthetic).

How to get a .vcf: on iPhone, open Contacts, open a contact or a list, and choose Share or Export. On Android, Contacts, Settings, Export. In Google Contacts or Outlook, select contacts and Export as vCard.

### Calendar files

RFC 5545, CRLF line endings, folded at 75 octets without splitting a character. Each date is an all-day `VEVENT` with `RRULE:FREQ=YEARLY`. A known year starts on the real date; a date with no year starts on its next occurrence. Feb 29 uses `BYMONTH=2;BYMONTHDAY=-1`, so it lands on Feb 28 in other years. UIDs are stable per person and date, so importing again updates rather than duplicates in most calendar apps.

## Failure recovery

- **Old data:** the v1 list (`keepintouch.people.v1`) is migrated on first load. The v1 key is left in place as a backup.
- **Unreadable saved data:** the tool starts fresh, keeps the unreadable text under `keepintouch.recovery`, and offers it as a download on Your data.
- **Storage blocked or full:** a notice says changes last until the tab closes and points to Export.
- **Undo:** snooze, pause, log, remove, import, adding from a contacts file and loading samples all offer Undo for a few seconds.
- **Two tabs:** when another tab saves, this tab reloads from storage before your next change, so neither overwrites the other.
- **Contacts file problems:** a file with no cards says so and changes nothing; nameless cards are skipped and counted.

## Tests

```sh
cd tool && node --test
```

`interop.test.js` covers contacts parsing, matching and merging, and calendar output (structural RFC 5545 checks, folding, leap days). `planner.test.js` covers the core (dates, reasons, plan, prep, import and export). `keepintouch.test.js` keeps the v1 behavior. `no_drift.test.js` checks the page loads the tested module and makes no network calls. `e2e.test.js` drives the real page in Chromium through Playwright, and skips when Playwright is not installed.
