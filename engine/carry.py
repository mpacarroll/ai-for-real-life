#!/usr/bin/env python3
"""Start tomorrow's input file from today's.

Usage:
    python3 engine/carry.py $ENGINE_DATA_DIR/inputs/2026-10-26.json [--to 2026-10-27]

Carries forward what persists (candidates, people, revenue_move) and clears
what belongs to one day (calendar, plan, headline, quiet_lines, mick_said,
confirmations, sources). Candidates the ledger already closed are dropped so
they do not ride along. The evening close then refreshes the result from
the sources; this only saves retyping and stops yesterday's day-specific
lines from leaking into tomorrow.
"""

import argparse
import json
import os
import sys
from datetime import datetime, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.environ.get("ENGINE_DATA_DIR", os.path.join(HERE, "..", "..", "personal-hq", "engine"))


def carry(today, state, to_date):
    closed = {k for k, v in state.get("items", {}).items() if v.get("status") in ("done", "dead")}
    return {
        "date": to_date,
        "headline": None,
        "plan": None,
        "calendar": [],
        "revenue_move": today.get("revenue_move"),
        "candidates": [c for c in today.get("candidates", []) if c.get("id") not in closed],
        "mick_said": [],
        "confirmations": [],
        "quiet_lines": [],
        "people": today.get("people", []),
        "sources": {},
    }


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("input")
    ap.add_argument("--to", help="target date, default the day after the input's date")
    ap.add_argument("--state", default=os.path.join(DATA_DIR, "state.json"))
    args = ap.parse_args(argv)
    today = json.load(open(args.input))
    to = args.to or (datetime.strptime(today["date"], "%Y-%m-%d") + timedelta(days=1)).strftime("%Y-%m-%d")
    state = json.load(open(args.state)) if os.path.exists(args.state) else {}
    out = os.path.join(os.path.dirname(os.path.abspath(args.input)), f"{to}.json")
    if os.path.exists(out):
        sys.exit(f"{out} exists; refresh it instead of overwriting")
    with open(out, "w") as f:
        json.dump(carry(today, state, to), f, indent=1, ensure_ascii=False)
        f.write("\n")
    print(out)


if __name__ == "__main__":
    main()
