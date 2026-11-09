// Keep in Touch: the brain. Pure, dependency-free, deterministic.
// Every function takes "today" as an ISO date (YYYY-MM-DD) and never reads the
// clock, so the browser UI and the Node tests get identical answers.
//
// Data model (state v2):
//   { version: 2, settings: { weeklyCapacity }, people: [Person] }
//   Person = { id, name, cadence, cadenceDays?, lastContacted?, notes, topics[],
//              dates[{ id, label, kind, date }], log[{ date, note }],
//              snoozedUntil?, paused, demo?, createdAt }
// cadence is a CADENCES key, "custom" (uses cadenceDays) or "none" (notes only,
// no reminders). dates[].date is "MM-DD" or "YYYY-MM-DD" and recurs yearly.

(function (root) {
  "use strict";

  const CADENCES = {
    weekly: 7,
    biweekly: 14,
    monthly: 30,
    quarterly: 91,
    semiannually: 182,
    annually: 365,
  };
  const CADENCE_LABELS = {
    weekly: "every week",
    biweekly: "every 2 weeks",
    monthly: "every month",
    quarterly: "every 3 months",
    semiannually: "every 6 months",
    annually: "every year",
    none: "no reminders",
  };
  const DATE_KINDS = ["birthday", "anniversary", "other"];
  const STATE_VERSION = 2;
  const EXPORT_FORMAT = "keepintouch-export";
  const DEFAULT_CAPACITY = 3;
  const PLAN_DAYS = 7;
  const DATE_HEADS_UP_DAYS = 7;
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  // ---------- dates (all UTC arithmetic on calendar dates) ----------

  const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
  const MD_RE = /^(\d{2})-(\d{2})$/;

  function isISODate(s) {
    if (typeof s !== "string") return false;
    const m = ISO_RE.exec(s);
    if (!m) return false;
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
  }

  function toUTC(iso) {
    const m = ISO_RE.exec(iso);
    if (!m) throw new Error(`Not a date: "${iso}". Use YYYY-MM-DD.`);
    return Date.UTC(+m[1], +m[2] - 1, +m[3]);
  }

  function fromUTC(ms) {
    return new Date(ms).toISOString().slice(0, 10);
  }

  function addDays(iso, n) {
    return fromUTC(toUTC(iso) + n * 86400000);
  }

  // Signed difference b - a in days.
  function diffDays(a, b) {
    return Math.round((toUTC(b) - toUTC(a)) / 86400000);
  }

  // Kept from v1: unsigned distance.
  function daysBetween(a, b) {
    return Math.abs(diffDays(a, b));
  }

  function formatDate(iso) {
    const m = ISO_RE.exec(iso);
    return `${MONTHS[+m[2] - 1]} ${+m[3]}`;
  }

  function weekday(iso) {
    return WEEKDAYS[new Date(toUTC(iso)).getUTCDay()];
  }

  function isLeap(y) {
    return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  }

  function isValidRecurringDate(s) {
    if (isISODate(s)) return true;
    const m = MD_RE.exec(s || "");
    if (!m) return false;
    return isISODate(`2024-${m[1]}-${m[2]}`); // 2024 is a leap year, so 02-29 is allowed
  }

  // Next yearly occurrence on or after today. Feb 29 falls on Feb 28 in other years.
  function nextOccurrence(dateStr, today) {
    let year = null, month, day;
    if (isISODate(dateStr)) {
      const m = ISO_RE.exec(dateStr);
      year = +m[1]; month = +m[2]; day = +m[3];
    } else {
      const m = MD_RE.exec(dateStr || "");
      if (!m || !isValidRecurringDate(dateStr)) throw new Error(`Not a date: "${dateStr}". Use YYYY-MM-DD or MM-DD.`);
      month = +m[1]; day = +m[2];
    }
    // A full date in a future year (a planned wedding) has no occurrence
    // before that year, so the search starts there.
    const ty = Math.max(+today.slice(0, 4), year || 0);
    for (let y = ty; y <= ty + 1; y++) {
      const d = month === 2 && day === 29 && !isLeap(y) ? 28 : day;
      const iso = `${y}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      if (diffDays(today, iso) >= 0) {
        return { date: iso, daysAway: diffDays(today, iso), years: year ? y - year : null };
      }
    }
    throw new Error("unreachable");
  }

  // ---------- people ----------

  function cadenceDays(p) {
    if (p.cadence === "none") return null;
    if (p.cadence === "custom") return p.cadenceDays;
    return CADENCES[p.cadence];
  }

  function cadenceLabel(p) {
    if (p.cadence === "custom") return p.cadenceDays === 1 ? "every day" : `every ${p.cadenceDays} days`;
    return CADENCE_LABELS[p.cadence] || p.cadence;
  }

  function cleanText(v, max) {
    return typeof v === "string" ? v.trim().slice(0, max) : "";
  }

  // Validate and normalize one person. Throws an Error with a plain message.
  function normalizePerson(raw, genId) {
    if (!raw || typeof raw !== "object") throw new Error("Each person must be an object.");
    const name = cleanText(raw.name, 120);
    if (!name) throw new Error("Every person needs a name.");
    const cadence = raw.cadence == null || raw.cadence === "" ? "monthly" : String(raw.cadence).trim().toLowerCase();
    let cd;
    if (cadence === "custom") {
      cd = Number(raw.cadenceDays);
      if (!Number.isInteger(cd) || cd < 1 || cd > 730) {
        throw new Error(`${name}: a custom rhythm needs a whole number of days from 1 to 730.`);
      }
    } else if (cadence !== "none" && !CADENCES[cadence]) {
      throw new Error(
        `Unknown cadence "${raw.cadence}" for ${name}. Use one of: ${Object.keys(CADENCES).join(", ")}, custom, none.`
      );
    }
    const last = raw.lastContacted || null;
    if (last && !isISODate(last)) throw new Error(`${name}: last talked "${last}" is not a date (YYYY-MM-DD).`);
    const snoozed = raw.snoozedUntil || null;
    if (snoozed && !isISODate(snoozed)) throw new Error(`${name}: snooze "${snoozed}" is not a date (YYYY-MM-DD).`);
    const dates = (Array.isArray(raw.dates) ? raw.dates : []).map((d, i) => {
      const date = d && String(d.date || "").trim();
      if (!isValidRecurringDate(date)) throw new Error(`${name}: date "${date}" is not YYYY-MM-DD or MM-DD.`);
      const kind = DATE_KINDS.includes(d.kind) ? d.kind : "other";
      const label = cleanText(d.label, 80) || (kind === "other" ? "Date" : kind[0].toUpperCase() + kind.slice(1));
      return { id: cleanText(d.id, 64) || `d${i + 1}`, label, kind, date };
    });
    const log = (Array.isArray(raw.log) ? raw.log : [])
      .filter((e) => e && isISODate(e.date))
      .map((e) => ({ date: e.date, note: cleanText(e.note, 2000) }))
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    const topics = (Array.isArray(raw.topics) ? raw.topics : [])
      .map((t) => cleanText(t, 200))
      .filter(Boolean);
    const out = {
      id: cleanText(raw.id, 64) || genId(),
      name,
      cadence,
      lastContacted: last,
      notes: cleanText(raw.notes, 5000),
      topics,
      dates,
      log,
      snoozedUntil: snoozed,
      paused: !!raw.paused,
      createdAt: isISODate(raw.createdAt) ? raw.createdAt : null,
    };
    if (cadence === "custom") out.cadenceDays = cd;
    if (raw.demo) out.demo = true;
    return out;
  }

  // ---------- v1 behavior, kept for compatibility ----------

  function dueContacts(people, today) {
    const scored = (people || []).map((p) => {
      const interval = CADENCES[p.cadence];
      if (!interval) {
        throw new Error(
          `Unknown cadence "${p.cadence}" for ${p.name}. Use one of: ${Object.keys(CADENCES).join(", ")}.`
        );
      }
      if (!p.lastContacted) return { ...p, status: "new", overdueBy: 0, _sort: Infinity };
      const since = daysBetween(p.lastContacted, today);
      const overdueBy = Math.max(0, since - interval);
      const status = overdueBy > 0 ? "overdue" : "ok";
      return { ...p, status, overdueBy, _sort: since - interval };
    });
    scored.sort((a, b) => b._sort - a._sort);
    return scored.map(({ _sort, ...rest }) => rest);
  }

  // ---------- reminders: what is due, and why ----------

  function daysAgoText(n) {
    // A future date can arrive through import or a clock change; say so plainly.
    if (n < 0) return "a date that has not happened yet";
    return n === 0 ? "today" : n === 1 ? "yesterday" : `${n} days ago`;
  }

  function dateEventText(ev) {
    const when = ev.daysAway === 0 ? "today" : ev.daysAway === 1 ? "tomorrow" : `in ${ev.daysAway} days`;
    const turning = ev.kind === "birthday" && ev.years ? ` (turning ${ev.years})`
      : ev.kind === "anniversary" && ev.years ? ` (${ev.years} years)` : "";
    return `${ev.label} ${when}, ${weekday(ev.date)} ${formatDate(ev.date)}${turning}.`;
  }

  function dateEvents(p, today, windowDays) {
    return p.dates
      .map((d) => ({ ...d, ...nextOccurrence(d.date, today) }))
      .filter((ev) => ev.daysAway <= windowDays)
      .sort((a, b) => a.daysAway - b.daysAway);
  }

  // The cadence reminder for one person: when it comes due and the plain reason.
  // Returns null when the person has no cadence reminder (paused or "none").
  function cadenceReminder(p, today) {
    const interval = cadenceDays(p);
    if (p.paused || !interval) return null;
    let dueOn, reason, kind;
    if (!p.lastContacted) {
      dueOn = today;
      kind = "new";
      reason = `No conversation logged yet. You chose ${cadenceLabel(p)}.`;
    } else {
      dueOn = addDays(p.lastContacted, interval);
      const since = diffDays(p.lastContacted, today);
      kind = "cadence";
      reason = `You chose ${cadenceLabel(p)}. Last talked ${formatDate(p.lastContacted)}, ${daysAgoText(since)}.`;
    }
    let snoozeNote = null;
    if (p.snoozedUntil && diffDays(dueOn, p.snoozedUntil) > 0) {
      if (diffDays(today, p.snoozedUntil) > 0) {
        snoozeNote = `Snoozed until ${formatDate(p.snoozedUntil)}.`;
      } else {
        snoozeNote = `Back from snooze (ended ${formatDate(p.snoozedUntil)}).`;
      }
      dueOn = p.snoozedUntil;
    }
    // Lateness relative to the person's own rhythm, so a weekly call and a
    // yearly one compare fairly. "New" sorts like one full rhythm late.
    const lateness = kind === "new" ? 1 : diffDays(dueOn, today) / interval;
    return { kind, dueOn, reason, snoozeNote, lateness, interval };
  }

  // One person's status today, with every reason it would show up.
  function reminderFor(p, today, opts) {
    const headsUp = (opts && opts.headsUpDays) || DATE_HEADS_UP_DAYS;
    const c = cadenceReminder(p, today);
    const events = p.paused ? [] : dateEvents(p, today, headsUp);
    const reasons = [];
    const cadenceDue = !!c && diffDays(c.dueOn, today) >= 0;
    if (c && cadenceDue) {
      reasons.push({ kind: c.kind, text: c.reason });
      if (c.snoozeNote) reasons.push({ kind: "snooze", text: c.snoozeNote });
    }
    for (const ev of events) reasons.push({ kind: "date", text: dateEventText(ev), date: ev.date });
    const topic = p.topics[0];
    if (reasons.length && topic) reasons.push({ kind: "topic", text: `Something to ask about: ${lowerFirst(trimPeriod(topic))}.` });
    return {
      id: p.id,
      name: p.name,
      due: reasons.length > 0,
      cadenceDue,
      paused: p.paused,
      snoozed: !!(p.snoozedUntil && diffDays(today, p.snoozedUntil) > 0),
      nextDue: c ? c.dueOn : null,
      events,
      reasons,
    };
  }

  // ---------- the weekly plan ----------

  // Rolling seven days from today. Dated moments (birthdays and the like) land
  // on their day and are always shown. Cadence reminders fill the room the
  // person chose (capacity), most-late-for-their-rhythm first, spread across
  // the week. Anything that does not fit "can wait", with that reason shown.
  function weeklyPlan(people, today, opts) {
    const capacity = Math.max(1, Math.min(14, Number((opts && opts.capacity) || DEFAULT_CAPACITY)));
    const end = addDays(today, PLAN_DAYS - 1);
    const days = [];
    for (let i = 0; i < PLAN_DAYS; i++) {
      const date = addDays(today, i);
      days.push({ date, label: i === 0 ? "Today" : i === 1 ? "Tomorrow" : `${weekday(date)} ${formatDate(date)}`, items: [] });
    }
    const dayIndex = (iso) => diffDays(today, iso);
    const dated = [];
    const cadenceOnly = [];
    const snoozed = [];

    for (const p of people) {
      if (p.paused) continue;
      const c = cadenceReminder(p, today);
      const events = dateEvents(p, today, PLAN_DAYS - 1);
      const cadenceInWeek = !!c && diffDays(c.dueOn, end) >= 0;
      const reasons = [];
      if (c && cadenceInWeek) {
        const upcoming = diffDays(today, c.dueOn) > 0;
        reasons.push({
          kind: c.kind,
          text: upcoming ? `${c.reason} Comes due ${weekday(c.dueOn)} ${formatDate(c.dueOn)}.` : c.reason,
        });
        if (c.snoozeNote) reasons.push({ kind: "snooze", text: c.snoozeNote });
      } else if (c && c.snoozeNote && diffDays(today, p.snoozedUntil) > 0) {
        snoozed.push({ id: p.id, name: p.name, until: p.snoozedUntil, reasons: [{ kind: "snooze", text: c.snoozeNote }] });
      }
      for (const ev of events) reasons.push({ kind: "date", text: dateEventText(ev), date: ev.date });
      if (!reasons.length) continue;
      if (p.topics[0]) reasons.push({ kind: "topic", text: `Something to ask about: ${lowerFirst(trimPeriod(p.topics[0]))}.` });
      const item = { id: p.id, name: p.name, reasons };
      if (events.length) {
        item.kind = "date";
        item.day = dayIndex(events[0].date);
        dated.push(item);
      } else {
        item.kind = c.kind;
        item.earliest = Math.max(0, dayIndex(c.dueOn));
        item.lateness = c.lateness;
        cadenceOnly.push(item);
      }
    }

    for (const item of dated) {
    const { day, ...clean } = item;
    days[day].items.push(clean);
  }

    cadenceOnly.sort((a, b) => b.lateness - a.lateness || a.earliest - b.earliest || (a.name < b.name ? -1 : 1));
    const room = Math.max(0, capacity - dated.length);
    const fits = cadenceOnly.slice(0, room);
    const later = cadenceOnly.slice(room).map((item) => ({
      id: item.id,
      name: item.name,
      kind: item.kind,
      reasons: [
        ...item.reasons,
        { kind: "capacity", text: `Can wait. You set room for ${capacity} a week, so this one can roll to next week.` },
      ],
    }));
    for (const item of fits) {
      let best = item.earliest;
      for (let d = item.earliest; d < PLAN_DAYS; d++) {
        if (days[d].items.length < days[best].items.length) best = d;
      }
      const { earliest, lateness, ...clean } = item;
      days[best].items.push(clean);
    }
    const planned = days.reduce((n, d) => n + d.items.length, 0);
    return { start: today, end, capacity, days, later, snoozed, planned };
  }

  // ---------- important dates ----------

  function upcomingDates(people, today, windowDays) {
    const w = windowDays == null ? 60 : windowDays;
    const out = [];
    for (const p of people) {
      for (const ev of dateEvents(p, today, w)) {
        out.push({ personId: p.id, name: p.name, label: ev.label, kind: ev.kind, date: ev.date,
          daysAway: ev.daysAway, years: ev.years, text: dateEventText(ev) });
      }
    }
    return out.sort((a, b) => a.daysAway - b.daysAway || (a.name < b.name ? -1 : 1));
  }

  // ---------- conversation prep and draft openers ----------

  // Deterministic, template-based draft openers. Nothing here is sent; the UI
  // labels these as drafts to edit. No model calls.
  function draftOpeners(p, today) {
    const first = p.name.split(/[\s,]+/)[0];
    const out = [];
    const ev = dateEvents(p, today, 14)[0];
    if (ev && ev.kind === "birthday") {
      out.push(ev.daysAway === 0
        ? `Happy birthday, ${first}. Hope today is a good one.`
        : `Your birthday is coming up ${weekday(ev.date)}. Any plans?`);
    } else if (ev && ev.kind === "anniversary") {
      out.push(`${ev.label} is coming up ${weekday(ev.date)}. Thinking of you both.`);
    } else if (ev) {
      out.push(`${ev.label} is coming up ${weekday(ev.date)}. How are you feeling about it?`);
    }
    for (const t of p.topics.slice(0, 2)) {
      out.push(`I was thinking about ${lowerFirst(t)}. How is that going?`);
    }
    const lastNote = p.log.find((e) => e.note);
    if (lastNote && !p.topics.length) {
      out.push(`Last time we talked about ${lowerFirst(trimPeriod(lastNote.note))}. Any news since?`);
    }
    if (out.length < 3) out.push(`Hi ${first}, you came to mind today. No need to reply fast, just saying hello.`);
    if (out.length < 3) out.push(`Hi ${first}, want to catch up this week? A short call or a walk, whatever is easy.`);
    return out.slice(0, 3);
  }

  function lowerFirst(s) {
    return s && /^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s;
  }

  function trimPeriod(s) {
    return s.replace(/[.\s]+$/, "");
  }

  function prepFor(p, today) {
    const since = p.lastContacted ? diffDays(p.lastContacted, today) : null;
    return {
      id: p.id,
      name: p.name,
      lastTalked: p.lastContacted
        ? `Last talked ${formatDate(p.lastContacted)} (${daysAgoText(since)}).`
        : "No conversation logged yet.",
      rhythm: p.paused ? "Reminders paused." : `Rhythm: ${cadenceLabel(p)}.`,
      recent: p.log.slice(0, 3),
      topics: p.topics.slice(),
      notes: p.notes,
      dates: dateEvents(p, today, 30).map(dateEventText),
      openers: draftOpeners(p, today),
    };
  }

  // ---------- state changes (all return new objects) ----------

  function createState() {
    return { version: STATE_VERSION, settings: { weeklyCapacity: DEFAULT_CAPACITY }, people: [] };
  }

  function mapPerson(state, id, fn) {
    let found = false;
    const people = state.people.map((p) => (p.id === id ? ((found = true), fn(p)) : p));
    if (!found) throw new Error("That person is no longer in your list.");
    return { ...state, people };
  }

  function addPerson(state, raw, genId) {
    const p = normalizePerson(raw, genId);
    if (state.people.some((x) => x.id === p.id)) throw new Error("That id is already used.");
    return { ...state, people: [...state.people, p] };
  }

  function updatePerson(state, id, patch) {
    return mapPerson(state, id, (p) => normalizePerson({ ...p, ...patch, id: p.id }, () => p.id));
  }

  function removePerson(state, id) {
    const removed = state.people.find((p) => p.id === id);
    if (!removed) throw new Error("That person is no longer in your list.");
    return { state: { ...state, people: state.people.filter((p) => p.id !== id) }, removed };
  }

  // Log a conversation. lastContacted only moves forward, so back-filling an
  // older chat never makes someone look more recently contacted than they were.
  // Logging clears any snooze; resolved topics are removed.
  function logConversation(state, id, entry) {
    const date = entry && entry.date;
    if (!isISODate(date)) throw new Error("Pick the date you talked.");
    return mapPerson(state, id, (p) => {
      const resolved = new Set((entry.resolvedTopics || []).map(String));
      return {
        ...p,
        lastContacted: !p.lastContacted || date > p.lastContacted ? date : p.lastContacted,
        log: [{ date, note: cleanText(entry.note, 2000) }, ...p.log]
          .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)),
        topics: p.topics.filter((t) => !resolved.has(t)),
        snoozedUntil: null,
      };
    });
  }

  function snooze(state, id, today, days) {
    const n = Number(days);
    if (!Number.isInteger(n) || n < 1 || n > 365) throw new Error("Snooze for 1 to 365 days.");
    return mapPerson(state, id, (p) => ({ ...p, snoozedUntil: addDays(today, n) }));
  }

  function unsnooze(state, id) {
    return mapPerson(state, id, (p) => ({ ...p, snoozedUntil: null }));
  }

  function setPaused(state, id, paused) {
    return mapPerson(state, id, (p) => ({ ...p, paused: !!paused }));
  }

  function setCapacity(state, n) {
    const c = Number(n);
    if (!Number.isInteger(c) || c < 1 || c > 14) throw new Error("Room for 1 to 14 a week.");
    return { ...state, settings: { ...state.settings, weeklyCapacity: c } };
  }

  // ---------- migration, import, export ----------

  // Accepts v1 (a bare array of { name, cadence, lastContacted }) or v2.
  function migrate(raw, genId) {
    if (raw == null) return createState();
    if (Array.isArray(raw)) {
      const s = createState();
      s.people = raw.map((p) => normalizePerson(p, genId));
      return s;
    }
    if (typeof raw === "object" && Array.isArray(raw.people)) {
      if (raw.version > STATE_VERSION) {
        throw new Error(`This data is from a newer version (${raw.version}) of the tool.`);
      }
      const s = createState();
      const cap = raw.settings && Number(raw.settings.weeklyCapacity);
      if (Number.isInteger(cap) && cap >= 1 && cap <= 14) s.settings.weeklyCapacity = cap;
      s.people = raw.people.map((p) => normalizePerson(p, genId));
      return s;
    }
    throw new Error("This does not look like Keep in Touch data.");
  }

  function exportState(state, exportedOn) {
    return JSON.stringify(
      {
        format: EXPORT_FORMAT,
        version: STATE_VERSION,
        exportedOn,
        settings: state.settings,
        people: state.people.filter((p) => !p.demo),
      },
      null,
      2
    );
  }

  // Minimal RFC 4180 CSV reader: quoted fields, doubled quotes, CRLF.
  function parseCSV(text) {
    const rows = [];
    let row = [], field = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
        else if (ch === '"') q = false;
        else field += ch;
      } else if (ch === '"') q = true;
      else if (ch === ",") { row.push(field); field = ""; }
      else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        row.push(field); rows.push(row); row = []; field = "";
      } else field += ch;
    }
    if (field || row.length) { row.push(field); rows.push(row); }
    return rows.filter((r) => r.some((c) => c.trim()));
  }

  // CSV columns (header row, any order, case-insensitive):
  // name (required), cadence, cadenceDays, lastContacted, birthday, notes, topics (split on ";").
  function csvToPeople(text) {
    const rows = parseCSV(text);
    if (!rows.length) return [];
    const head = rows[0].map((h) => h.trim().toLowerCase().replace(/[\s_]/g, ""));
    if (!head.includes("name")) throw new Error('The CSV needs a header row with a "name" column.');
    const col = (r, k) => {
      const i = head.indexOf(k.toLowerCase());
      return i < 0 ? "" : (r[i] || "").trim();
    };
    return rows.slice(1).map((r) => {
      const bday = col(r, "birthday");
      return {
        name: col(r, "name"),
        cadence: col(r, "cadence") || undefined,
        cadenceDays: col(r, "cadencedays") || undefined,
        lastContacted: col(r, "lastcontacted") || undefined,
        notes: col(r, "notes"),
        topics: col(r, "topics") ? col(r, "topics").split(";").map((t) => t.trim()) : [],
        dates: bday ? [{ kind: "birthday", label: "Birthday", date: bday }] : [],
      };
    });
  }

  // Import JSON (export file, v2 state or v1 array) or CSV.
  // mode "merge": people whose id already exists are updated; people with no
  // matching id but the exact same full name are skipped as likely duplicates
  // (never merged, since two people can share a name). mode "replace": the
  // imported people replace everyone. Bad rows are skipped with a reason,
  // good rows still import.
  function importText(text, state, mode, genId) {
    const src = String(text || "").trim();
    if (!src) throw new Error("The file is empty.");
    let rawPeople, settings = null;
    if (src[0] === "{" || src[0] === "[") {
      let parsed;
      try { parsed = JSON.parse(src); } catch (e) { throw new Error("The file is not valid JSON."); }
      if (Array.isArray(parsed)) rawPeople = parsed;
      else if (parsed && Array.isArray(parsed.people)) {
        if (parsed.version > STATE_VERSION) throw new Error(`This file is from a newer version (${parsed.version}) of the tool.`);
        rawPeople = parsed.people;
        settings = parsed.settings || null;
      } else throw new Error("This does not look like a Keep in Touch export.");
    } else {
      rawPeople = csvToPeople(src);
    }
    const base = mode === "replace" ? { ...createState(), settings: { ...state.settings } } : state;
    const people = base.people.slice();
    const skipped = [];
    let added = 0, updated = 0;
    rawPeople.forEach((raw, i) => {
      let p;
      try { p = normalizePerson(raw, genId); delete p.demo; }
      catch (e) { skipped.push({ row: i + 1, name: (raw && raw.name) || "", reason: e.message }); return; }
      const byId = raw && raw.id ? people.findIndex((x) => x.id === p.id) : -1;
      if (byId >= 0) { people[byId] = p; updated++; return; }
      if (people.some((x) => x.id === p.id)) p.id = genId();
      const key = p.name.toLowerCase();
      if (people.some((x) => x.name.toLowerCase() === key)) {
        skipped.push({ row: i + 1, name: p.name, reason: "Someone with this exact name is already in your list." });
        return;
      }
      people.push(p);
      added++;
    });
    const next = { ...base, people };
    const cap = settings && Number(settings.weeklyCapacity);
    if (mode === "replace" && Number.isInteger(cap) && cap >= 1 && cap <= 14) {
      next.settings = { ...next.settings, weeklyCapacity: cap };
    }
    return { state: next, added, updated, skipped };
  }

  const api = {
    CADENCES, CADENCE_LABELS, DATE_KINDS, STATE_VERSION, EXPORT_FORMAT, DEFAULT_CAPACITY,
    isISODate, addDays, diffDays, daysBetween, formatDate, weekday, nextOccurrence, isValidRecurringDate,
    cadenceDays, cadenceLabel, normalizePerson, dueContacts,
    reminderFor, weeklyPlan, upcomingDates, draftOpeners, prepFor,
    createState, addPerson, updatePerson, removePerson, logConversation,
    snooze, unsnooze, setPaused, setCapacity,
    migrate, exportState, parseCSV, csvToPeople, importText,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.KIT = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
