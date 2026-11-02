# The brief engine

The morning brief and evening close were wrong almost every day. This folder
holds the audit of why, and the pipeline that replaces the old way of building
the page.

## The audit, 2026-10-26

Fourteen briefs (Oct 13 to 26) were compared line by line against the sources
they claim to read. Seventy-three distinct items appeared. The findings:

**1. The page was copied forward, never rebuilt.** Each brief was yesterday's
HTML with regex edits. Items survived by default and left only when a session
remembered to delete them. Sean and Jake Y ran 14 days straight. The pork claim
ran 12. Seven stray `</div>` tags accumulated in the file. Nothing in the
process ever asked "does this still earn its place?"

**2. No state survived between sessions.** The only record of what Mick had
closed was chat context, which is summarized away every day or two. So Gumroad
was closed on his word on Oct 21, reopened on a misread the same day, closed
again, then reopened on Oct 23. Each session re-derived the world from Notion
and Otto, and anything Mick had said in between was lost.

**3. The Open Loops tracker is a graveyard, not a queue.** Thirteen rows sit at
"Follow up now", the oldest from Aug 5; seven at "Waiting". Eleven have no
date. Nearly all are owned by Mick, so no sweep can ever close them, and the
old prompt said never to resolve them on silence. They were restated every
day, which is the staleness he sees.

**4. Recurring calendar reminders were read as the day's plan.** The Service
calendar carries `Type: Reminder` rows (Make Calls, Pick Sponsor Reading),
`Type: Optional` rows, and leisure recurrences he has marked optional (Dan,
Chelsea and Westminster, tennis). The acts were built from all of them. On
Oct 25 the page said Chelsea and Westminster, tennis and the BQ Flea; his day
was F1, laundry and the bathroom floor.

**5. Too many sources, most of them lagging and some of them ours.**
`personal-hq/CTAS.md` is 81 rows maintained by another Claude routine and runs
two to ten days behind Otto. `hq/revenue/QUEUE.md` is older still. Otto's own
email repeats every open item until it clears, by its spec on hq#391, so "per
Otto" lines inherit Otto's staleness (the Chase iPhone sign-in of Oct 20 is
still in his Oct 25 list). The old prompt stacked all of these and asked the
model to reconcile them in its head.

**6. The prompts had become 4,000-word rule piles.** Each beat re-read a
history of corrections with no mechanism behind any of them. A rule like
"rotate the Keep in Touch picks" has no effect on a process that copies
yesterday's file.

**7. Connectors flap and the sweeps went quiet about it.** GitHub, Notion,
Gmail, Messages and Timeline each disconnected mid-run at least once in the
last week. A sweep that silently skips a source reports the same page as one
that read it.

## What changed

The page is now generated, not edited. `build_brief.py` takes one dated input
file and the durable ledger and writes the HTML from a template every run.

- **`state.json` is the memory.** Every item has `first_seen`,
  `surfaced_days`, `status` and who closed it. Mick's words close an item for
  good; a source repeating it does not bring it back. Only his word or a
  first-party confirmation reopens it.
- **Items earn their place.** Ranking: a clock inside three days, then seven,
  then first-party confirmation, then Otto, then everything else. Five lines
  maximum. A Mick-only item with no clock and no first-party basis is demoted
  after three days and parked after six, into one line: "Only you know these".
  It comes back the day it gets a date.
- **Acts come from commitments.** Reminders and the Optional calendar are
  dropped. Titles in `config.json` render as "if you're up for it". What Mick
  says about his day leads the block.
- **People rotate.** Placeholders and do-not-initiate notes never surface. A
  name surfaced in the last five days is skipped. Birthdays lead. The pick is
  seeded by the date so two different names appear each day.
- **Every line carries a basis tag or the build fails.**
- **The report says what happened.** `report-MMDD.json` lists what rendered,
  what parked, what dropped and why, and which lines are stale.

## Files

| File | What |
|---|---|
| `build_brief.py` | the renderer |
| `template.html` | the page shell, tokens on `:root` |
| `config.json` | caps, thresholds, optional titles |
| `$ENGINE_DATA_DIR/state.json` | the ledger, in the private repo, committed after every beat |
| `$ENGINE_DATA_DIR/inputs/<date>.json` | the facts for one day, private, committed after every beat |
| `gather.md` | the checklist each beat follows to write the input |
| `shot.js` | screenshot for the render check |
| `calendar_import.py` | raw calendar output to input rows |
| `carry.py` | start tomorrow's input from today's |
| `tests/` | `python3 -m unittest discover engine/tests` |
| `assets/` | the one font the headline uses |

## Running it

```
export ENGINE_DATA_DIR=/path/to/personal-hq/engine
python3 engine/build_brief.py $ENGINE_DATA_DIR/inputs/2026-10-26.json --out /tmp/eng
node engine/shot.js /tmp/eng/brief-1026.html
```

`--dry-run` builds without touching the ledger.

## Where the data lives

This repo is public. The code, template, config and tests are here. The
ledger, the dated inputs, the reports and the built pages carry names,
appointments and account references, so they live in `personal-hq/engine/`
(private) and are ignored here by `engine/.gitignore`. The builder reads
`ENGINE_DATA_DIR` and defaults to a sibling `personal-hq` checkout.
