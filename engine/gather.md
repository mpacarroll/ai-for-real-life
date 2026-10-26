# Gather: the beat checklist

Every morning beat and evening close follows this list in order and fills one
file, `$ENGINE_DATA_DIR/inputs/<date>.json` (the private personal-hq checkout, never
this public repo), where `<date>` is the day the brief is for.
Then it runs the builder, looks at the screenshot, and publishes. Nothing goes
on the page that is not in the input file. Nothing in the input file goes on
the page without a basis tag.

The clock first: `TZ=America/New_York date`. The evening close builds
tomorrow's file; the morning beat refreshes today's.

## 1. Mick's own words (two minutes)

Read the conversation since the last beat. Anything he said closes, kills,
snoozes or reopens an item goes in `mick_said` with the item ids. His plan for
the day goes in `plan` as `{"morning": ..., "afternoon": ..., "evening": ...}`,
only the blocks he described. If the evening close has not asked him for
tomorrow's plan yet, ask: "What does tomorrow actually look like?"

## 2. Calendar (one call per calendar)

Primary and Service for the day, 00:00 to 24:00 New York. Each event becomes
one row: `start`, `end`, `title`, `calendar`, `type` (the `Type:` line in the
description: Commitment, Appointment, Reminder, Travel, Optional), and a short
`location_short` when the location matters (a neighborhood, or "remote").
Reminders and the Optional calendar are not commitments; the builder drops them.
Titles in `config.json` `optional_titles` render as suggestions. F1 and
Holidays: only when something lands on the day, as a `quiet_lines` entry or a
`plan` fragment.

## 3. Otto's latest CFO email (one Gmail search, one get_thread)

Search `from:michael@michaelcarroll.studio subject:"Revenue and CTAs"` and read
the newest. Take:
- the top of section 3 "UNBLOCKS REVENUE" as `revenue_move`;
- the "CLOCK / NEAR-TERM" items that name Mick as the actor, with their dates,
  as candidates tagged `per Otto, <date> <am|pm>`;
- anything in sections 5 to 7 with a date inside 14 days.
Otto repeats every open item until it clears, so a line being in the email is
not news. New since the last beat is what matters; an item Mick already
closed stays closed in the ledger whatever the email says.

## 4. First-party Gmail (one search)

`after:<yesterday> -category:promotions` and read what is a receipt, a
"payment received", a vendor notice, a security alert or a reply from an Open
Loops contact. Each becomes a candidate tagged `confirmed: <sender> <date>`, or
a `confirmations` entry that closes an existing item id.

## 5. Notion Open Loops (one query)

Status "Follow up now" or "Waiting". Each row becomes a candidate with
`id: notion:<page id>`, a `due` when "Follow up by" is set, `owner: mick` when
Who starts with "Mick", and a basis: `confirmed:` only when a first-party
source backs it, `per Otto` when Otto's email does, otherwise `unknown`.
Do not rewrite Notion Notes from the brief. Write to Notion only when Mick's
words or a first-party confirmation close or change a row, and cite it.

## 6. Keep in Touch (one query)

All rows with Name, cadence, Interval, Last Contacted, Birthday, Source and
Notes into `people`. The builder skips placeholders and do-not-initiate notes,
applies the cooldown and rotates. Write an `opener` only for the two or three
you expect it to pick; a plain template covers the rest.

## 7. Build, look, publish

```
ENGINE_DATA_DIR=<personal-hq>/engine python3 engine/build_brief.py $ENGINE_DATA_DIR/inputs/<date>.json --out <scratch>
node engine/shot.js <scratch>/brief-MMDD.html
```

Read the png. Then publish `brief-MMDD.html` with the Artifact tool at the same
file path the evening close used, so the URL holds. Update the Engine Index.
Commit `inputs/<date>.json` and `state.json` in personal-hq so the next session
starts from the ledger, not from memory. Nothing personal is committed here.

## 8. The recap line

From `report-MMDD.json`: "Rendered N, parked P, closed by you C, dropped D."
Name the parked titles once. Name which of steps 2 to 6 could not be read and
why. Never claim a check that did not run.

## What is deliberately not read

- `personal-hq/CTAS.md`: 81 rows, maintained by another routine, two to ten
  days behind Otto. Otto already reads it into section 5 of his email.
- `hq/revenue/QUEUE.md` and old `otto` issues: the ledger of what was once
  open, not what is open now.
- Yesterday's brief HTML: never a source. The page is rebuilt every run.
