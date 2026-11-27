#!/usr/bin/env python3
"""Turn Google Calendar list_events output into engine calendar rows.

Usage:
    python3 engine/calendar_import.py primary.json service.json [--date 2026-10-27]

Each argument is the raw JSON a list_events call returned (save the tool
result to a file). Prints a JSON array of rows for the input file's
"calendar" key. Reads the "Type:" line in each description; falls back to
transparency, so a free event with no Type line counts as a Reminder.
"""

import argparse
import json
import re
import sys

TYPE_RE = re.compile(r"^Type:\s*(\w+)", re.M)


def calendar_name(doc, path):
    summary = (doc.get("summary") or "").lower()
    if summary == "service":
        return "service"
    if "optional" in summary or "optional" in path.lower():
        return "optional"
    return "primary"


def row(ev, cal):
    start = ev.get("start", {}).get("dateTime")
    end = ev.get("end", {}).get("dateTime")
    if not start or ev.get("status") == "cancelled":
        return None
    desc = ev.get("description") or ""
    m = TYPE_RE.search(desc)
    if m:
        typ = m.group(1).capitalize()
    elif ev.get("transparency") == "transparent":
        typ = "Reminder"
    else:
        typ = "Commitment"
    out = {"start": start, "end": end, "title": (ev.get("summary") or "").strip(), "calendar": cal, "type": typ}
    if "Travel: None, remote" in desc or "Zoom" in (ev.get("location") or "") or "Travel: Zoom" in desc:
        out["location_short"] = "remote"
    return out


def convert(docs, day=None):
    rows = []
    for path, doc in docs:
        cal = calendar_name(doc, path)
        for ev in doc.get("events", []):
            r = row(ev, cal)
            if r and (day is None or r["start"].startswith(day)):
                rows.append(r)
    rows.sort(key=lambda r: r["start"])
    return rows


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="+")
    ap.add_argument("--date", help="keep only events starting on this YYYY-MM-DD")
    args = ap.parse_args(argv)
    docs = [(p, json.load(open(p))) for p in args.files]
    json.dump(convert(docs, args.date), sys.stdout, indent=1, ensure_ascii=False)
    print()


if __name__ == "__main__":
    main()
