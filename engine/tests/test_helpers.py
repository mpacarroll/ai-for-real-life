"""Tests for calendar_import and carry. Run: python3 -m unittest discover engine/tests"""

import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

import calendar_import as ci  # noqa: E402
import carry  # noqa: E402


def ev(summary, start, desc="", transparent=False, **kw):
    e = {"summary": summary, "start": {"dateTime": start}, "end": {"dateTime": start}, "description": desc, "status": "confirmed"}
    if transparent:
        e["transparency"] = "transparent"
    e.update(kw)
    return e


class CalendarImportTests(unittest.TestCase):
    def test_type_line_wins(self):
        doc = {"summary": "Service", "events": [ev("Al Anon", "2026-10-27T18:00:00-04:00", "Type: Commitment\nTravel: Walk 20m")]}
        rows = ci.convert([("service.json", doc)])
        self.assertEqual(rows[0]["type"], "Commitment")
        self.assertEqual(rows[0]["calendar"], "service")

    def test_free_event_without_type_is_a_reminder(self):
        doc = {"summary": "me@example.com", "events": [ev("Stretch", "2026-10-27T21:30:00-04:00", transparent=True)]}
        self.assertEqual(ci.convert([("p.json", doc)])[0]["type"], "Reminder")

    def test_busy_event_without_type_is_a_commitment(self):
        doc = {"summary": "me@example.com", "events": [ev("DMV photo", "2026-10-27T14:30:00-04:00")]}
        self.assertEqual(ci.convert([("p.json", doc)])[0]["type"], "Commitment")

    def test_remote_and_date_filter_and_order(self):
        doc = {"summary": "Service", "events": [
            ev("Therapy", "2026-10-27T15:30:00-04:00", "Type: Appointment\nTravel: None, remote"),
            ev("Lunch", "2026-10-27T12:00:00-04:00", "Type: Commitment"),
            ev("Tomorrow", "2026-10-28T09:00:00-04:00", "Type: Commitment"),
            {"summary": "All day", "start": {"date": "2026-10-27"}, "end": {"date": "2026-10-28"}},
        ]}
        rows = ci.convert([("s.json", doc)], "2026-10-27")
        self.assertEqual([r["title"] for r in rows], ["Lunch", "Therapy"])
        self.assertEqual(rows[1]["location_short"], "remote")


class CarryTests(unittest.TestCase):
    def test_carry_drops_day_fields_and_closed_items(self):
        today = {"date": "2026-10-26", "headline": "x", "plan": {"morning": "work"}, "calendar": [1],
                 "quiet_lines": ["dmv"], "mick_said": [{"text": "done"}],
                 "candidates": [{"id": "a"}, {"id": "b"}], "people": [{"name": "P"}],
                 "revenue_move": {"title": "r"}}
        state = {"items": {"a": {"status": "done"}, "b": {"status": "parked"}}}
        out = carry.carry(today, state, "2026-10-27")
        self.assertEqual(out["date"], "2026-10-27")
        self.assertEqual([c["id"] for c in out["candidates"]], ["b"])
        self.assertEqual(out["calendar"], [])
        self.assertEqual(out["quiet_lines"], [])
        self.assertEqual(out["mick_said"], [])
        self.assertIsNone(out["plan"])
        self.assertEqual(out["people"], [{"name": "P"}])


if __name__ == "__main__":
    unittest.main()
