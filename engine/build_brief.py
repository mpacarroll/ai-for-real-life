#!/usr/bin/env python3
"""Build the daily brief from a dated input file and the durable item ledger.

Usage:
    python3 engine/build_brief.py $ENGINE_DATA_DIR/inputs/2026-10-26.json [--out DIR] [--dry-run]

Reads:
    $ENGINE_DATA_DIR/inputs/<date>.json   the facts gathered this beat (see gather.md)
    $ENGINE_DATA_DIR/state.json           the item ledger that survives between beats
    (ENGINE_DATA_DIR is a private checkout; it defaults to ../personal-hq/engine)
    engine/template.html        the page shell
    engine/config.json          thresholds, optional titles, people rules

Writes:
    <out>/brief-MMDD.html       the page to publish
    <out>/report-MMDD.json      what was rendered, what was dropped and why
    $ENGINE_DATA_DIR/state.json           updated ledger (unless --dry-run)

The renderer is deliberately strict. Nothing reaches the page unless it is in
the input file for this date, carries a basis tag, and is not closed, parked
or snoozed in the ledger. The page is rebuilt from scratch every run; nothing
is copied forward from yesterday's HTML.
"""

import argparse
import base64
import copy
import hashlib
import html
import json
import os
import re
import sys
from datetime import date, datetime, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
# Personal data (the ledger and the dated inputs) lives outside this public
# repo, in a private checkout named by ENGINE_DATA_DIR. The code stays here.
DATA_DIR = os.environ.get("ENGINE_DATA_DIR", os.path.join(HERE, "..", "..", "personal-hq", "engine"))
STATE_PATH = os.path.join(DATA_DIR, "state.json")
CONFIG_PATH = os.path.join(HERE, "config.json")
TEMPLATE_PATH = os.path.join(HERE, "template.html")
FONT_PATH = os.path.join(HERE, "assets", "fraunces-latin-600.woff2")

BASIS_RE = re.compile(r"^(confirmed: .+|per Otto.*|per Penny.*|unclear.*|unknown)$")


# ---------------------------------------------------------------- helpers


def load_json(path, default=None):
    if not os.path.exists(path):
        if default is not None:
            return copy.deepcopy(default)
        raise SystemExit(f"missing {path}")
    with open(path) as f:
        return json.load(f)


def save_json(path, data):
    with open(path, "w") as f:
        json.dump(data, f, indent=2, ensure_ascii=False, sort_keys=True)
        f.write("\n")


def parse_date(s):
    return datetime.strptime(s[:10], "%Y-%m-%d").date()


def esc(s):
    return html.escape(s or "", quote=False)


def ordinal_day(d):
    return f"{d:%A} &middot; {d:%B} {d.day} {d.year}"


def hour_of(ts):
    """Return a float hour from an ISO timestamp with offset, in that offset."""
    t = datetime.fromisoformat(ts)
    return t.hour + t.minute / 60.0


def fmt_time(ts):
    t = datetime.fromisoformat(ts)
    h = t.hour % 12 or 12
    suffix = "AM" if t.hour < 12 else "PM"
    if t.minute:
        return f"{h}:{t.minute:02d} {suffix}"
    return f"{h} {suffix}"


def fmt_time_short(ts):
    """Time without AM/PM for inside a sentence, e.g. '2:30'."""
    t = datetime.fromisoformat(ts)
    h = t.hour % 12 or 12
    return f"{h}:{t.minute:02d}" if t.minute else f"{h}"


# ---------------------------------------------------------------- ledger


def item_id(raw):
    if raw.get("id"):
        return raw["id"]
    key = (raw.get("source", "") + "|" + raw.get("title", "")).lower()
    return "auto:" + hashlib.sha1(key.encode()).hexdigest()[:10]


def merge_into_ledger(state, inputs, today, cfg, report):
    """Bring every candidate from this beat's input into the ledger.

    Returns the list of candidate ids present in today's input.
    """
    items = state.setdefault("items", {})
    seen = []
    for raw in inputs.get("candidates", []):
        iid = item_id(raw)
        seen.append(iid)
        basis = raw.get("basis", "")
        if not BASIS_RE.match(basis):
            raise SystemExit(f"candidate {iid!r} has no valid basis tag: {basis!r}")
        entry = items.get(iid)
        if entry is None:
            entry = {
                "first_seen": today.isoformat(),
                "surfaced_days": 0,
                "status": "open",
            }
            items[iid] = entry
        for k in ("title", "sentence", "basis", "source", "due", "owner", "kind"):
            if raw.get(k) is not None:
                entry[k] = raw[k]
        entry["last_seen"] = today.isoformat()

    # Mick's words close, snooze or revive items immediately, before ranking.
    for said in inputs.get("mick_said", []):
        for iid in said.get("closes", []):
            e = items.get(iid)
            if e is not None:
                e["status"] = "done"
                e["closed_on"] = said.get("date", today.isoformat())
                e["closed_by"] = "Mick: " + said.get("text", "")
                report["closed_by_mick"].append(iid)
        for iid in said.get("kills", []):
            e = items.get(iid)
            if e is not None:
                e["status"] = "dead"
                e["closed_on"] = said.get("date", today.isoformat())
                e["closed_by"] = "Mick: " + said.get("text", "")
                report["closed_by_mick"].append(iid)
        for iid, until in said.get("snoozes", {}).items():
            e = items.get(iid)
            if e is not None:
                e["status"] = "snoozed"
                e["snooze_until"] = until
                e["closed_by"] = "Mick: " + said.get("text", "")
        for iid in said.get("reopens", []):
            e = items.get(iid)
            if e is not None:
                e["status"] = "open"
                e.pop("snooze_until", None)
                e["reopened_on"] = today.isoformat()
                e["reopened_by"] = "Mick: " + said.get("text", "")

    # A first-party confirmation in the input can close an item too.
    for conf in inputs.get("confirmations", []):
        e = items.get(conf.get("closes", ""))
        if e is not None and e.get("status") not in ("done", "dead"):
            e["status"] = "done"
            e["closed_on"] = conf.get("date", today.isoformat())
            e["closed_by"] = "confirmed: " + conf.get("source", "")
            report["closed_by_confirmation"].append(conf.get("closes"))
    return seen


def days_until(due, today):
    if not due:
        return None
    return (parse_date(due) - today).days


def rank(entry, today, cfg):
    """Higher is more worth a reader's attention today."""
    score = 0
    d = days_until(entry.get("due"), today)
    if d is not None:
        # Inside a week the nearer clock always wins over a better source:
        # each day closer is worth more than the gap between basis tags.
        if d <= 7:
            score += 200 - 20 * max(d, 0)
        elif d <= 14:
            score += 40
    basis = entry.get("basis", "")
    if basis.startswith("confirmed:"):
        score += 60
    elif basis.startswith("per Otto"):
        score += 45
    elif basis.startswith("per Penny"):
        score += 35
    elif basis.startswith("unclear"):
        score += 30
    if entry.get("kind") == "security":
        # An account someone else is trying to get into outranks any clock.
        score += 200
    if entry.get("owner") == "mick" and d is None:
        score -= 20
    # Repetition penalty: a line the reader has already seen for days is noise
    # unless a clock is close.
    sd = entry.get("surfaced_days", 0)
    if d is None or d > 7:
        if sd >= cfg["demote_after_days"]:
            score -= 30
    return score


def select_loops(state, seen_ids, today, cfg, report):
    items = state["items"]
    pool = []
    for iid in seen_ids:
        e = items[iid]
        st = e.get("status", "open")
        if st in ("done", "dead"):
            report["dropped"].append({"id": iid, "why": st})
            continue
        if st == "snoozed":
            until = e.get("snooze_until")
            if until and parse_date(until) > today:
                report["dropped"].append({"id": iid, "why": f"snoozed until {until}"})
                continue
            e["status"] = "open"
        d = days_until(e.get("due"), today)
        sd = e.get("surfaced_days", 0)
        # Auto-park: on the page for park_after_days with no clock inside a week.
        parkable = (
            e.get("owner") == "mick"
            and e.get("kind") != "security"
            and not e.get("basis", "").startswith("confirmed:")
        )
        if (d is None or d > 7) and sd >= cfg["park_after_days"] and parkable:
            e["status"] = "parked"
            e["parked_on"] = today.isoformat()
        if e.get("status") == "parked":
            if d is not None and d <= 7:
                e["status"] = "open"
            else:
                report["parked"].append(iid)
                continue
        pool.append((rank(e, today, cfg), e.get("due") or "9999-12-31", iid))
    pool.sort(key=lambda x: (-x[0], x[1], x[2]))
    chosen = [iid for _, _, iid in pool[: cfg["max_open_loops"]]]
    for _, _, iid in pool[cfg["max_open_loops"]:]:
        report["dropped"].append({"id": iid, "why": "below the cap"})
    for iid in chosen:
        e = items[iid]
        if e.get("last_surfaced") != today.isoformat():
            e["surfaced_days"] = e.get("surfaced_days", 0) + 1
            e["last_surfaced"] = today.isoformat()
    return chosen


# ---------------------------------------------------------------- calendar


def classify_events(events, cfg):
    """Keep only real commitments. Returns list sorted by start."""
    keep = []
    optional = {t.lower() for t in cfg["optional_titles"]}
    for ev in events:
        title = ev.get("title", "").strip()
        typ = (ev.get("type") or "").lower()
        if typ in ("reminder", "optional"):
            continue
        if title.lower() in optional:
            ev = dict(ev, optional=True)
        if ev.get("calendar") == "optional":
            continue
        keep.append(ev)
    keep.sort(key=lambda e: e["start"])
    return keep


def build_acts(events, plan, cfg):
    """Three columns: morning, afternoon, evening."""
    blocks = {"morning": [], "afternoon": [], "evening": []}
    for ev in events:
        h = hour_of(ev["start"])
        if h < 12:
            blocks["morning"].append(ev)
        elif h < 17:
            blocks["afternoon"].append(ev)
        else:
            blocks["evening"].append(ev)
    acts = []
    for name in ("morning", "afternoon", "evening"):
        evs = [e for e in blocks[name] if not e.get("optional") and (e.get("type") or "").lower() != "travel"]
        opts = [e for e in blocks[name] if e.get("optional")]
        label = {"morning": "Morning", "afternoon": "Afternoon", "evening": "Evening"}[name]
        if evs:
            label = fmt_time(evs[0]["start"]) + (" onward" if name == "evening" else " &ndash; " + fmt_time(evs[-1]["end"]))
        parts = []
        said = (plan or {}).get(name)
        if said:
            parts.append(said.rstrip("."))
        for e in evs:
            loc = e.get("location_short")
            if loc and loc.lower() == "remote":
                parts.append(f"{e['title']} at {fmt_time_short(e['start'])}, remote")
            elif loc and loc.lower().startswith(("in ", "on ", "at ")):
                parts.append(f"{e['title']} {loc} at {fmt_time_short(e['start'])}")
            elif loc:
                parts.append(f"{e['title']} in {loc} at {fmt_time_short(e['start'])}")
            else:
                parts.append(f"{e['title']} at {fmt_time_short(e['start'])}")
        sentence = ""
        if parts:
            sentence = ", then ".join(parts) + "."
            sentence = sentence[0].upper() + sentence[1:]
        elif not said:
            sentence = "Open."
        if opts:
            names = ", ".join(f"{e['title']} at {fmt_time_short(e['start'])}" for e in opts)
            sentence += f" {names} if you're up for it."
        acts.append((label, sentence.strip()))
    return acts


def build_terrain(events):
    """One stroke, dots on it, one clay accent. Returns SVG markup."""
    def x_of(ts):
        h = hour_of(ts)
        return 40 + max(0.0, min(1.0, (h - 6) / 17.0)) * 760
    pts = []
    for e in events:
        if (e.get("type") or "").lower() == "travel":
            continue
        pts.append((x_of(e["start"]), e))
    # elevation: a gentle bump around each commitment
    def y_at(x):
        y = 96.0
        for px, e in pts:
            w = 6 if e.get("optional") else 22
            y -= w * max(0.0, 1 - abs(x - px) / 120.0)
        return y
    xs = list(range(0, 841, 20))
    path = "M0,%.0f " % y_at(0) + " ".join("L%d,%.0f" % (x, y_at(x)) for x in xs[1:])
    circles = []
    for px, e in pts:
        if e.get("optional"):
            circles.append(f'<circle cx="{px:.0f}" cy="{y_at(px):.0f}" r="6" fill="#B4B3A8"/>')
        else:
            circles.append(f'<circle cx="{px:.0f}" cy="{y_at(px):.0f}" r="10" fill="#2E2C27"/>')
    # clay accent: a sun over the widest free stretch
    busy = sorted(px for px, e in pts if not e.get("optional"))
    edges = [40] + busy + [800]
    gaps = [(edges[i + 1] - edges[i], edges[i], edges[i + 1]) for i in range(len(edges) - 1)]
    g, a, b = max(gaps) if gaps else (0, 40, 800)
    cx = (a + b) / 2
    circles.append(f'<circle cx="{cx:.0f}" cy="{y_at(cx) - 28:.0f}" r="6" fill="#C6613F"/>')
    return (
        '<svg viewBox="0 0 840 170" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">'
        f'<path d="{path}" fill="none" stroke="#2E2C27" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>'
        + "".join(circles)
        + "</svg>"
    )


# ---------------------------------------------------------------- people


DO_NOT_INITIATE = re.compile(r"amends|do not initiate|don't initiate|stop surfacing|won't reach out|will not reach out|never reach out", re.I)


def pick_people(inputs, state, today, cfg, report):
    kit = state.setdefault("kit", {})
    cands = []
    for p in inputs.get("people", []):
        name = p["name"]
        notes = p.get("notes") or ""
        if p.get("source", "").lower().startswith("placeholder"):
            continue
        if DO_NOT_INITIATE.search(notes):
            report["people_skipped"].append({"name": name, "why": "do-not-initiate note"})
            continue
        if not p.get("interval_days") or not p.get("last_contacted"):
            continue
        last = kit.get(name, {}).get("last_surfaced")
        picked_today = last == today.isoformat()
        bday_close = False
        if p.get("birthday"):
            bd = parse_date(p["birthday"]).replace(year=today.year)
            bday_close = 0 <= (bd - today).days <= 1
        if last and not picked_today and not bday_close and (today - parse_date(last)).days < cfg["kit_cooldown_days"]:
            report["people_skipped"].append({"name": name, "why": f"surfaced {last}"})
            continue
        overdue = (today - parse_date(p["last_contacted"])).days / float(p["interval_days"])
        bday = p.get("birthday")
        bday_soon = False
        if bday:
            b = parse_date(bday).replace(year=today.year)
            if 0 <= (b - today).days <= 7:
                bday_soon = True
        if overdue < 1 and not bday_soon:
            continue
        cands.append((bday_soon, min(overdue, 12.0), name, p, picked_today))
    # A rebuild later the same day keeps the names already on the page.
    same_day = [c[:4] for c in cands if c[4]]
    if same_day:
        out = []
        for bday_soon, overdue, name, p in same_day[: cfg["kit_max"]]:
            out.append((name, p, bday_soon))
        return out
    cands = [c[:4] for c in cands]
    # Birthdays first, then a date-seeded pick among the most overdue so the
    # page rotates instead of showing the same two names for a fortnight.
    cands.sort(key=lambda c: (not c[0], -c[1], c[2]))
    birthdays = [c for c in cands if c[0]]
    rest = [c for c in cands if not c[0]]
    seed = int(hashlib.sha1(today.isoformat().encode()).hexdigest(), 16)
    top = rest[: cfg["kit_pool"]]
    picks = birthdays[:1]
    if top:
        i = seed % len(top)
        picks.append(top[i])
        if len(picks) < cfg["kit_max"] and len(top) > 1:
            picks.append(top[(i + 1 + seed // 7) % len(top)])
    picks = picks[: cfg["kit_max"]]
    out = []
    for bday_soon, overdue, name, p in picks:
        kit.setdefault(name, {})["last_surfaced"] = today.isoformat()
        out.append((name, p, bday_soon))
    return out


def person_block(name, p, bday_soon, today):
    full = p.get("full_name") or name
    last = parse_date(p["last_contacted"])
    when = f"{last:%B %Y}"
    if bday_soon:
        b = parse_date(p["birthday"]).replace(year=today.year)
        title = f"{name}: birthday {b:%A}" if b != today else f"{name}: birthday today"
    else:
        title = f"{name}: {p.get('cadence', 'a check-in').lower()} used to be the rhythm"
    hook = p.get("hook")
    sentence = f"{full}; last contact was {when}."
    if hook:
        sentence = f"{full}. {hook} Last contact was {when}."
    opener = p.get("opener") or (f"{name}, it's been a while. How are you doing?")
    return title, sentence, opener


# ---------------------------------------------------------------- render


def li(n, title, sentence, basis=None, quote=None):
    src = f' <span class="src">{esc(basis)}</span>' if basis else ""
    q = f'<p class="q">&ldquo;{esc(quote)}&rdquo;</p>' if quote else ""
    return (
        f'      <li><span class="n">{n:02d}</span><div>\n'
        f'        <p class="ti">{esc(title)}</p>\n'
        f'        <p class="sn">{esc(sentence)}{src}</p>\n{q}'
        f"      </div></li>\n"
    )


def render(inputs, state, cfg, today, report):
    tpl = open(TEMPLATE_PATH).read()
    font = base64.b64encode(open(FONT_PATH, "rb").read()).decode()

    events = classify_events(inputs.get("calendar", []), cfg)
    acts = build_acts(events, inputs.get("plan"), cfg)
    terrain = build_terrain(events)

    seen = merge_into_ledger(state, inputs, today, cfg, report)
    chosen = select_loops(state, seen, today, cfg, report)
    items = state["items"]

    # Revenue move: exactly one, from the input, with a basis.
    rev = inputs.get("revenue_move")
    rev_html = ""
    if rev:
        if not BASIS_RE.match(rev.get("basis", "")):
            raise SystemExit("revenue_move needs a basis tag")
        rev_html = (
            '  <div class="blk">\n    <h2>The revenue move</h2>\n    <ol>\n'
            + li(1, rev["title"], rev["sentence"], rev["basis"])
            + "    </ol>\n  </div>\n"
        )

    loops_html = ""
    if chosen or report["parked"]:
        rows = []
        for i, iid in enumerate(chosen, 1):
            e = items[iid]
            rows.append(li(i, e["title"], e["sentence"], e["basis"]))
            report["rendered"].append({"id": iid, "surfaced_days": e.get("surfaced_days"), "basis": e.get("basis")})
        parked = [items[i]["title"].rstrip("?") for i in report["parked"]]
        if parked:
            names = "; ".join(parked[: cfg["parked_names_max"]])
            more = len(parked) - cfg["parked_names_max"]
            if more > 0:
                names += f"; and {more} more"
            rows.append(li(len(rows) + 1, "Only you know these", f"{names}. Say done, dead or still on, and they come back with a date.", "unknown"))
        loops_html = '  <div class="blk">\n    <h2>Open loops</h2>\n    <ol>\n' + "".join(rows) + "    </ol>\n  </div>\n"

    people = pick_people(inputs, state, today, cfg, report)
    kit_html = ""
    if people:
        rows = []
        for i, (name, p, bday) in enumerate(people, 1):
            t, s, o = person_block(name, p, bday, today)
            rows.append(li(i, t, s, None, o))
            report["people"].append(name)
        kit_html = '  <div class="blk">\n    <h2>Keep in touch</h2>\n    <ol>\n' + "".join(rows) + "    </ol>\n  </div>\n"

    quiet = ""
    for q in inputs.get("quiet_lines", []):
        quiet += f'  <p class="quiet">{esc(q)}</p>\n'

    headline = inputs.get("headline") or default_headline(events, inputs.get("plan"), cfg)
    acts_html = "".join(f'    <div class="act"><b>{a}</b><p>{esc(s)}</p></div>\n' for a, s in acts)

    page = (
        tpl.replace("{{FONT}}", font)
        .replace("{{TITLE}}", f"{today:%A} {today.day} {today:%B}, morning brief")
        .replace("{{DAYDATE}}", ordinal_day(today) + " &middot; " + esc(cfg.get("place", "New York")))
        .replace("{{HEADLINE}}", esc(headline))
        .replace("{{TERRAIN}}", terrain)
        .replace("{{ACTS}}", acts_html)
        .replace("{{REVENUE}}", rev_html)
        .replace("{{LOOPS}}", loops_html)
        .replace("{{KIT}}", kit_html)
        .replace("{{QUIET}}", quiet)
    )
    return page


def default_headline(events, plan, cfg):
    firm = [e for e in events if not e.get("optional") and (e.get("type") or "").lower() != "travel"]
    name = cfg.get("name", "")
    if not firm:
        return f"The whole day is yours, {name}."
    first = firm[0]
    last = firm[-1]
    if len(firm) == 1:
        return f"One thing on the books, {name}: {first['title']} at {fmt_time_short(first['start'])}."
    return f"{first['title']} at {fmt_time_short(first['start'])}, {name}, and {last['title']} to close the day."


# ---------------------------------------------------------------- main


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("input")
    ap.add_argument("--out", default=None, help="directory for the html and report")
    ap.add_argument("--dry-run", action="store_true", help="do not write state.json")
    ap.add_argument("--state", default=STATE_PATH, help="ledger path (default $ENGINE_DATA_DIR/state.json)")
    args = ap.parse_args(argv)

    inputs = load_json(args.input)
    cfg = load_json(CONFIG_PATH)
    state = load_json(args.state, default={"items": {}, "kit": {}})
    today = parse_date(inputs["date"])

    report = {
        "date": today.isoformat(),
        "rendered": [],
        "dropped": [],
        "parked": [],
        "closed_by_mick": [],
        "closed_by_confirmation": [],
        "people": [],
        "people_skipped": [],
    }
    page = render(inputs, state, cfg, today, report)

    out = args.out or os.path.dirname(os.path.abspath(args.input))
    os.makedirs(out, exist_ok=True)
    stem = f"brief-{today:%m%d}"
    html_path = os.path.join(out, stem + ".html")
    with open(html_path, "w") as f:
        f.write(page)
    report["stale"] = [r for r in report["rendered"] if (r.get("surfaced_days") or 0) >= cfg["demote_after_days"]]
    with open(os.path.join(out, f"report-{today:%m%d}.json"), "w") as f:
        json.dump(report, f, indent=2)
    if not args.dry_run:
        os.makedirs(os.path.dirname(os.path.abspath(args.state)), exist_ok=True)
        save_json(args.state, state)
    print(html_path)
    print(f"rendered {len(report['rendered'])} loops, parked {len(report['parked'])}, dropped {len(report['dropped'])}, people {report['people']}")
    if report["stale"]:
        print("stale on the page:", ", ".join(r["id"] for r in report["stale"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
