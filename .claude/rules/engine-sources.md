# Engine sources of truth

Applies to the life automation engine: the morning beat, the evening close, the weekly outlook and the daily brief.

Added 2026-10-21. The engine was wrong almost daily because it trusted lagging records (open issues, CTAS rows, QUEUE.md) over the streams that now hold live state. Since 2026-10-20 the operations order is Otto, then a Claude session, then Penny, then Michael. Otto is COO for MC AI Studio LLC.

## Order of sources

Check each Open Loop against these in order, and stop at the first one that settles it:

1. Michael's own words in the conversation, or his Gmail Sent.
2. First-party confirmation: a receipt, a "payment received" email, an agency auto-reply or a vendor email in Gmail, or a Calendar event.
3. Otto's latest Portfolio: CFO email (subject "Revenue and CTAs", sent twice daily; standing spec on hq#391), and Otto's comments on hq#391, #390 and #392.
4. Today's Notion "Fleet activity" page (Otto's hourly sweep).
5. hq files:
   - `notes/today.md`, `notes/daily-refresh.md`, `notes/decision-log.md`
   - `legal/address-register.md`, `legal/entities.md`
   - `finance/pnl.md`, `finance/costs.csv`, `finance/team-budget.md`
   - the Notion Planned Purchases database
6. personal-hq `CTAS.md` and `STATUS.md`.
7. The newest comment on the named issue.

## Rules

- An open issue, a QUEUE.md row or an undated CTAS row is not proof that something is still open.
- A pasted screenshot or form is not proof that something is done. Ask.
- When sources disagree, mark the item "unclear", ask once, and assert neither.
- Close a row only on Michael's word or a first-party confirmation, and cite the source and date in Notes.
- Give every brief item a basis tag: "confirmed: source", "per Otto", "per Penny", "unclear" or "unknown".
- Gather the rows only Michael can confirm into one consolidated item. Never restate them one by one each day.
- When a connector is disconnected (Messages showed "needs reconnect" on 2026-10-21), say so and never claim a check through it.
