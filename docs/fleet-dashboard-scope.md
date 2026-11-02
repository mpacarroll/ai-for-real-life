# Fleet dashboard: scope

A game-style view of every running Claude session, so the blocked ones are
obvious at a glance. Scoped 2026-11-02. Nothing is built yet.

## The idea

- Each project is a hexagon tile.
- Each session is a small character on its tile.
- A character that needs a human visibly flags (pulse, speech bubble) and
  shows the one-line ask. Clicking it opens that session.
- Tiles group onto "planets" (work, game apps, personal, ops) to keep
  contexts apart.

## Data source (already exists)

The session list returns, per session: `status_bucket` (working, blocked,
review_ready, completed, failed), `post_turn_summary.needs_action` (the open
question, in words) or `recent_action`, `unread`, `origin`, `environment_kind`,
`tags`, `updated_at`. That is enough for v1 with no new plumbing. Grouping
into projects and planets comes from session tags plus a small mapping file
(repo name or title keyword to planet).

## v1 (one afternoon)

1. Single static HTML artifact, no framework, light and dark themes.
2. Input is a JSON snapshot of the session list, refreshed by a scheduled
   task and republished at the same URL (same pattern as the daily brief).
3. Hex grid, one tile per project, characters by status:
   - blocked: flagged, shows `needs_action`
   - review_ready: soft glow
   - working: animated
   - completed: resting
   - failed: red
4. Blocked sessions sort to the top and also appear in a plain list below for
   phone use.
5. Each character links to its session.

## Later

- Live refresh while the page is open.
- Sound or push on a new blocked state.
- Planet mapping edited from the page.
- Fold the blocked count into the daily brief as one line.

## Decisions for Mick

1. Privacy: the snapshot holds session titles and summaries, so the built page
   and its JSON live in the private personal-hq repo and the artifact stays
   private. Only code and this note live in the public repo.
2. Art direction: flat hexagons with simple round characters (quick) or a
   richer pixel-art look (slower, more fun). Default is flat for v1.
3. Refresh cadence: hourly on the same schedule as the fleet sweep, or only
   with the morning and evening beats.
