"""Tests for the brief builder. Run: python3 -m unittest discover engine/tests"""

import copy
import json
import os
import sys
import unittest
from datetime import date

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

import build_brief as bb  # noqa: E402

CFG = json.load(open(os.path.join(os.path.dirname(HERE), "config.json")))
TODAY = date(2026, 10, 26)


def report():
    return {k: [] for k in ("rendered", "dropped", "parked", "closed_by_mick", "closed_by_confirmation", "people", "people_skipped")}


def cand(iid, **kw):
    d = {"id": iid, "title": iid, "sentence": "s", "basis": "per Otto", "owner": "mick", "kind": "loop"}
    d.update(kw)
    return d


class LedgerTests(unittest.TestCase):
    def test_basis_tag_is_required(self):
        state = {"items": {}}
        with self.assertRaises(SystemExit):
            bb.merge_into_ledger(state, {"candidates": [cand("a", basis="Otto said so")]}, TODAY, CFG, report())

    def test_mick_closes_item_before_ranking(self):
        state = {"items": {}}
        inputs = {"candidates": [cand("a")], "mick_said": [{"date": "2026-10-26", "text": "done", "closes": ["a"]}]}
        r = report()
        seen = bb.merge_into_ledger(state, inputs, TODAY, CFG, r)
        chosen = bb.select_loops(state, seen, TODAY, CFG, r)
        self.assertEqual(chosen, [])
        self.assertEqual(state["items"]["a"]["status"], "done")
        self.assertIn("Mick: done", state["items"]["a"]["closed_by"])

    def test_closed_item_stays_closed_when_source_repeats_it(self):
        state = {"items": {"a": {"status": "done", "closed_on": "2026-10-20", "surfaced_days": 2}}}
        r = report()
        seen = bb.merge_into_ledger(state, {"candidates": [cand("a")]}, TODAY, CFG, r)
        self.assertEqual(bb.select_loops(state, seen, TODAY, CFG, r), [])
        self.assertEqual(r["dropped"][0]["why"], "done")

    def test_reopen_on_mick_word(self):
        state = {"items": {"a": {"status": "done", "surfaced_days": 2}}}
        inputs = {"candidates": [cand("a")], "mick_said": [{"text": "it is back", "reopens": ["a"]}]}
        r = report()
        seen = bb.merge_into_ledger(state, inputs, TODAY, CFG, r)
        self.assertEqual(bb.select_loops(state, seen, TODAY, CFG, r), ["a"])

    def test_snooze_expires(self):
        state = {"items": {"a": {"status": "snoozed", "snooze_until": "2026-10-25", "surfaced_days": 1},
                           "b": {"status": "snoozed", "snooze_until": "2026-11-01", "surfaced_days": 1}}}
        r = report()
        seen = bb.merge_into_ledger(state, {"candidates": [cand("a"), cand("b")]}, TODAY, CFG, r)
        self.assertEqual(bb.select_loops(state, seen, TODAY, CFG, r), ["a"])


class RankingTests(unittest.TestCase):
    def test_cap_and_order(self):
        state = {"items": {}}
        cands = [cand(f"c{i}") for i in range(8)]
        cands[6]["due"] = "2026-10-27"
        cands[7]["basis"] = "confirmed: Gmail"
        r = report()
        seen = bb.merge_into_ledger(state, {"candidates": cands}, TODAY, CFG, r)
        chosen = bb.select_loops(state, seen, TODAY, CFG, r)
        self.assertEqual(len(chosen), CFG["max_open_loops"])
        self.assertEqual(chosen[0], "c6")
        self.assertEqual(chosen[1], "c7")
        self.assertEqual(len(r["dropped"]), 3)

    def test_old_mick_only_item_parks_into_one_line(self):
        state = {"items": {"a": {"status": "open", "surfaced_days": CFG["park_after_days"], "owner": "mick"}}}
        r = report()
        seen = bb.merge_into_ledger(state, {"candidates": [cand("a", basis="unknown")]}, TODAY, CFG, r)
        self.assertEqual(bb.select_loops(state, seen, TODAY, CFG, r), [])
        self.assertEqual(r["parked"], ["a"])
        self.assertEqual(state["items"]["a"]["status"], "parked")

    def test_confirmed_or_security_items_never_park(self):
        state = {"items": {"a": {"status": "open", "surfaced_days": 20, "owner": "mick"},
                           "b": {"status": "open", "surfaced_days": 20, "owner": "mick"}}}
        r = report()
        seen = bb.merge_into_ledger(state, {"candidates": [cand("a", basis="confirmed: Gmail"), cand("b", kind="security")]}, TODAY, CFG, r)
        self.assertEqual(sorted(bb.select_loops(state, seen, TODAY, CFG, r)), ["a", "b"])

    def test_parked_item_returns_when_a_clock_appears(self):
        state = {"items": {"a": {"status": "parked", "surfaced_days": 9, "owner": "mick"}}}
        r = report()
        seen = bb.merge_into_ledger(state, {"candidates": [cand("a", due="2026-10-28")]}, TODAY, CFG, r)
        self.assertEqual(bb.select_loops(state, seen, TODAY, CFG, r), ["a"])

    def test_surfaced_days_counts_once_per_day(self):
        state = {"items": {}}
        r = report()
        seen = bb.merge_into_ledger(state, {"candidates": [cand("a")]}, TODAY, CFG, r)
        bb.select_loops(state, seen, TODAY, CFG, r)
        bb.select_loops(state, seen, TODAY, CFG, r)
        self.assertEqual(state["items"]["a"]["surfaced_days"], 1)


class CalendarTests(unittest.TestCase):
    def ev(self, title, start, end, **kw):
        d = {"title": title, "start": f"2026-10-26T{start}:00-04:00", "end": f"2026-10-26T{end}:00-04:00", "calendar": "service"}
        d.update(kw)
        return d

    def test_reminders_and_optional_calendar_are_dropped(self):
        evs = [self.ev("Make Calls", "08:00", "08:15", type="Reminder"),
               self.ev("SMART", "19:00", "20:00", calendar="optional"),
               self.ev("Al Anon", "18:00", "19:00", type="Commitment")]
        kept = bb.classify_events(evs, CFG)
        self.assertEqual([e["title"] for e in kept], ["Al Anon"])

    def test_leisure_titles_become_suggestions(self):
        evs = [self.ev("Dan", "10:30", "11:30", type="Commitment"), self.ev("Sober Sunday", "08:00", "09:00", type="Commitment")]
        acts = bb.build_acts(bb.classify_events(evs, CFG), None, CFG)
        self.assertIn("Sober Sunday at 8", acts[0][1])
        self.assertIn("Dan at 10:30 if you're up for it", acts[0][1])

    def test_mick_plan_leads_the_block(self):
        evs = [self.ev("Al Anon", "18:00", "19:00", type="Commitment")]
        acts = bb.build_acts(bb.classify_events(evs, CFG), {"afternoon": "F1 at 4, then the sheets"}, CFG)
        self.assertEqual(acts[1][1], "F1 at 4, then the sheets.")
        self.assertEqual(acts[0][1], "Open.")

    def test_terrain_has_one_stroke_and_one_clay_dot(self):
        evs = [self.ev("Al Anon", "18:00", "19:00", type="Commitment")]
        svg = bb.build_terrain(bb.classify_events(evs, CFG))
        self.assertEqual(svg.count("<path"), 1)
        self.assertEqual(svg.count("#C6613F"), 1)


class PeopleTests(unittest.TestCase):
    def person(self, name, last, interval=7, **kw):
        d = {"name": name, "last_contacted": last, "interval_days": interval, "source": "Phone history", "notes": ""}
        d.update(kw)
        return d

    def test_do_not_initiate_and_placeholders_are_skipped(self):
        inputs = {"people": [self.person("Harv", "2026-06-28", 365, notes="Sent a 9th-step amends letter"),
                             self.person("Jim", "2025-05-25", 3, source="Placeholder — needs ID"),
                             self.person("Sean", "2026-06-21", 7)]}
        r = report()
        picks = bb.pick_people(inputs, {"kit": {}}, TODAY, CFG, r)
        self.assertEqual([p[0] for p in picks], ["Sean"])

    def test_cooldown_rotates_names(self):
        people = [self.person(n, "2026-06-01", 7) for n in ("A", "B", "C", "D")]
        state = {"kit": {}}
        day1 = [p[0] for p in bb.pick_people({"people": people}, state, TODAY, CFG, report())]
        day2 = [p[0] for p in bb.pick_people({"people": people}, state, date(2026, 10, 27), CFG, report())]
        self.assertFalse(set(day1) & set(day2))

    def test_birthday_leads(self):
        people = [self.person("A", "2026-06-01", 7), self.person("B", "2026-10-01", 365, birthday="2000-10-28")]
        picks = bb.pick_people({"people": people}, {"kit": {}}, TODAY, CFG, report())
        self.assertEqual(picks[0][0], "B")
        self.assertTrue(picks[0][2])


class RenderTests(unittest.TestCase):
    def test_full_render_from_sample_input(self):
        inp = json.load(open(os.path.join(os.path.dirname(HERE), "inputs", "2026-10-26.json")))
        state = {"items": {}, "kit": {}}
        r = report()
        page = bb.render(inp, state, CFG, TODAY, r)
        self.assertIn("<title>Monday 26 October, morning brief</title>", page)
        self.assertEqual(page.count('class="act"'), 3)
        self.assertNotIn("{{", page)
        self.assertEqual(page.count("<div"), page.count("</div>"))
        self.assertIn("Pork claim", page)
        self.assertLessEqual(len(r["rendered"]), CFG["max_open_loops"])


if __name__ == "__main__":
    unittest.main()
