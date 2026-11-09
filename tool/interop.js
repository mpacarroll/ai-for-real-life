// Keep in Touch: files in and out of other apps. Pure and deterministic, like
// keepintouch.js: today is always passed in and the clock is never read.
//
// - Contacts in: a .vcf file the person exported from their own phone or mail
//   app. Only names and dates (birthday, anniversary, other labeled dates) are
//   read. Phone numbers, emails, addresses, photos and notes in the file are
//   ignored and never stored. Nothing is fetched or synced.
// - Calendar out: an .ics file of important dates (repeating yearly) or of this
//   week's plan, for the person to add to their own calendar.
//
// Browser global: KIT_IO. Node: module.exports.

(function (root) {
  "use strict";
  const K = typeof module !== "undefined" && module.exports ? require("./keepintouch.js") : root.KIT;

  // ---------- vCard reading (2.1, 3.0, 4.0) ----------

  // Lines that start with a space or tab continue the previous line (RFC 6350
  // 3.2). vCard 2.1 quoted-printable values continue with a trailing "=".
  function unfold(text) {
    const raw = String(text || "").replace(/\r\n?/g, "\n").split("\n");
    const out = [];
    for (const line of raw) {
      const prev = out.length ? out[out.length - 1] : null;
      if (prev != null && /^[ \t]/.test(line)) out[out.length - 1] = prev + line.slice(1);
      else if (prev != null && /ENCODING=QUOTED-PRINTABLE/i.test(prev.split(":")[0]) && /=$/.test(prev)) {
        out[out.length - 1] = prev.slice(0, -1) + line;
      } else out.push(line);
    }
    return out;
  }

  function decodeQP(s) {
    const bytes = [];
    for (let i = 0; i < s.length; i++) {
      if (s[i] === "=" && /^[0-9A-Fa-f]{2}$/.test(s.slice(i + 1, i + 3))) {
        bytes.push(parseInt(s.slice(i + 1, i + 3), 16));
        i += 2;
      } else bytes.push(s.charCodeAt(i) & 0xff);
    }
    try { return decodeURIComponent(bytes.map((b) => "%" + b.toString(16).padStart(2, "0")).join("")); }
    catch (e) { return String.fromCharCode(...bytes); } // not UTF-8: keep it readable as Latin-1
  }

  function unescapeText(s) {
    return s.replace(/\\([nN,;\\])/g, (m, c) => (c === "n" || c === "N" ? " " : c));
  }

  // "item1.X-ABDATE;type=pref:2012-06-02" -> { group, name, params, value }
  function parseLine(line) {
    let i = 0, inQuote = false;
    for (; i < line.length; i++) {
      if (line[i] === '"') inQuote = !inQuote;
      else if (line[i] === ":" && !inQuote) break;
    }
    if (i >= line.length) return null;
    const head = line.slice(0, i);
    let value = line.slice(i + 1);
    const parts = head.split(";");
    let name = parts[0].toUpperCase();
    let group = null;
    const dot = name.indexOf(".");
    if (dot >= 0) { group = name.slice(0, dot); name = name.slice(dot + 1); }
    const params = {};
    for (const p of parts.slice(1)) {
      const eq = p.indexOf("=");
      if (eq < 0) params.TYPE = (params.TYPE ? params.TYPE + "," : "") + p.toUpperCase(); // 2.1 bare types
      else params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, "");
    }
    if (/^QUOTED-PRINTABLE$/i.test(params.ENCODING || "")) value = decodeQP(value);
    return { group, name, params, value };
  }

  // vCard date forms -> "YYYY-MM-DD" or "MM-DD" (year unknown), or null.
  //   1990-04-12, 19900412, 1990-04-12T00:00:00Z, --0412, --04-12,
  //   and Apple's "omit year" convention (year 1604 or X-APPLE-OMIT-YEAR).
  function parseVDate(value, params) {
    const v = String(value || "").trim();
    let y = null, m, d, mm;
    if ((mm = /^(\d{4})-?(\d{2})-?(\d{2})(?:T.*)?$/.exec(v))) { y = mm[1]; m = mm[2]; d = mm[3]; }
    else if ((mm = /^--(\d{2})-?(\d{2})$/.exec(v))) { m = mm[1]; d = mm[2]; }
    else return null;
    const omit = params && params["X-APPLE-OMIT-YEAR"];
    if (y && (y === "1604" || (omit && omit === y) || y === "0000")) y = null;
    const out = y ? `${y}-${m}-${d}` : `${m}-${d}`;
    return K.isValidRecurringDate(out) ? out : null;
  }

  function cleanLabel(s) {
    // Apple wraps built-in labels: _$!<Anniversary>!$_
    const m = /^_\$!<(.+)>!\$_$/.exec(s || "");
    return (m ? m[1] : s || "").trim().slice(0, 80);
  }

  function nameFrom(props) {
    const fn = props.find((p) => p.name === "FN");
    if (fn && unescapeText(fn.value).trim()) return unescapeText(fn.value).trim();
    const n = props.find((p) => p.name === "N");
    if (n) {
      // N:Family;Given;Additional;Prefix;Suffix
      const parts = n.value.split(/(?<!\\);/).map((x) => unescapeText(x).trim());
      const full = [parts[3], parts[1], parts[2], parts[0], parts[4]].filter(Boolean).join(" ");
      if (full) return full;
    }
    const org = props.find((p) => p.name === "ORG");
    return org ? unescapeText(org.value.split(/(?<!\\);/)[0]).trim() : "";
  }

  // Parse a .vcf file into candidates for the pick list. Never throws for a
  // bad card: it is reported in `skipped` and the rest still parse.
  // Returns { contacts: [{ key, name, dates: [{ kind, label, date }] }], skipped: [{ index, reason }] }
  function parseVCards(text) {
    const lines = unfold(text);
    const cards = [];
    let cur = null;
    for (const line of lines) {
      if (/^BEGIN:VCARD$/i.test(line.trim())) { cur = []; continue; }
      if (/^END:VCARD$/i.test(line.trim())) { if (cur) cards.push(cur); cur = null; continue; }
      if (cur && line.trim()) { const p = parseLine(line); if (p) cur.push(p); }
    }
    if (!cards.length) throw new Error("No contacts found. Choose a .vcf file exported from your contacts app.");
    const contacts = [];
    const skipped = [];
    cards.forEach((props, i) => {
      const name = nameFrom(props).slice(0, 120);
      if (!name) { skipped.push({ index: i + 1, reason: "This contact has no name." }); return; }
      const dates = [];
      const seen = new Set();
      const push = (kind, label, date) => {
        const k = kind + "|" + date;
        if (seen.has(k)) return;
        seen.add(k);
        dates.push({ kind, label, date });
      };
      for (const p of props) {
        if (p.name === "BDAY") {
          const d = parseVDate(p.value, p.params);
          if (d) push("birthday", "Birthday", d);
        } else if (p.name === "ANNIVERSARY" || p.name === "X-ANNIVERSARY") {
          const d = parseVDate(p.value, p.params);
          if (d) push("anniversary", "Anniversary", d);
        } else if (p.name === "X-ABDATE") {
          const d = parseVDate(p.value, p.params);
          if (!d) continue;
          const lab = p.group && props.find((q) => q.group === p.group && q.name === "X-ABLABEL");
          const label = cleanLabel(lab ? unescapeText(lab.value) : "") || "Date";
          const kind = /anniversary/i.test(label) ? "anniversary" : /birthday/i.test(label) ? "birthday" : "other";
          push(kind, kind === "other" ? label : label[0].toUpperCase() + label.slice(1), d);
        }
      }
      const uid = props.find((p) => p.name === "UID");
      contacts.push({ key: (uid && uid.value.trim()) || `card-${i + 1}`, name, dates });
    });
    return { contacts, skipped };
  }

  // Mark which candidates match someone already in the list (same full name,
  // ignoring case), and which of their dates would be new.
  function matchContacts(contacts, people) {
    const byName = new Map();
    for (const p of people) {
      const k = p.name.toLowerCase();
      if (!byName.has(k)) byName.set(k, p);
    }
    return contacts.map((c) => {
      const existing = byName.get(c.name.toLowerCase()) || null;
      const newDates = existing
        ? c.dates.filter((d) => !existing.dates.some((x) => x.kind === d.kind && sameDay(x.date, d.date)))
        : c.dates;
      return { ...c, existingId: existing ? existing.id : null, newDates };
    });
  }

  // 1990-04-12 and 04-12 are the same yearly day.
  function sameDay(a, b) {
    return a.slice(-5) === b.slice(-5);
  }

  // Apply the picked contacts. New names become people with the chosen
  // rhythm; names already in the list only gain their missing dates (notes,
  // rhythm and history are never touched). Returns a new state and counts.
  function applyContacts(state, picked, rhythm, genId, today) {
    const cadence = (rhythm && rhythm.cadence) || "monthly";
    const cadenceDays = rhythm && rhythm.cadenceDays;
    let next = state;
    let added = 0, datesAdded = 0, unchanged = 0;
    for (const pick of picked) {
      // Match against the list as it grows, so two picked cards with the same
      // name become one person, not two.
      const c = matchContacts([pick], next.people)[0];
      if (c.existingId) {
        if (!c.newDates.length) { unchanged++; continue; }
        const p = next.people.find((x) => x.id === c.existingId);
        const dates = [...p.dates, ...c.newDates].map((d, i) => ({ ...d, id: "d" + (i + 1) }));
        next = K.updatePerson(next, p.id, { dates });
        datesAdded += c.newDates.length;
      } else {
        next = K.addPerson(next, { name: c.name, cadence, cadenceDays, dates: c.dates, createdAt: today }, genId);
        added++;
      }
    }
    return { state: next, added, datesAdded, unchanged };
  }

  // ---------- iCalendar writing (RFC 5545) ----------

  function icsText(s) {
    return String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
  }

  // Fold to 75 octets per line, never splitting a UTF-8 character.
  function fold(line) {
    const enc = (ch) => { const c = ch.codePointAt(0); return c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4; };
    const out = [];
    let cur = "", n = 0, limit = 75;
    for (const ch of line) {
      const b = enc(ch);
      if (n + b > limit) { out.push(cur); cur = " "; n = 1; limit = 75; }
      cur += ch; n += b;
    }
    out.push(cur);
    return out.join("\r\n");
  }

  const compact = (iso) => iso.replace(/-/g, "");

  function calendar(name, events, today) {
    const lines = [
      "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//AI for Real Life//Keep in Touch//EN",
      "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:" + icsText(name),
    ];
    for (const ev of events) {
      lines.push("BEGIN:VEVENT", "UID:" + ev.uid, `DTSTAMP:${compact(today)}T000000Z`,
        "DTSTART;VALUE=DATE:" + compact(ev.start), "DTEND;VALUE=DATE:" + compact(K.addDays(ev.start, 1)));
      if (ev.rrule) lines.push("RRULE:" + ev.rrule);
      lines.push("SUMMARY:" + icsText(ev.summary));
      if (ev.description) lines.push("DESCRIPTION:" + icsText(ev.description));
      lines.push("TRANSP:TRANSPARENT", "END:VEVENT");
    }
    lines.push("END:VCALENDAR");
    return lines.map(fold).join("\r\n") + "\r\n";
  }

  const uidPart = (s) => String(s).replace(/[^A-Za-z0-9_-]/g, "");

  // Every important date as a yearly all-day event. Sample people are left
  // out, like the JSON export. Only names and date labels go in: private
  // notes stay out of calendars, which often sync to a cloud account.
  function datesToICS(people, today) {
    const events = [];
    for (const p of people) {
      if (p.demo) continue;
      for (const d of p.dates) {
        const md = d.date.slice(-5);
        const known = K.isISODate(d.date) ? +d.date.slice(0, 4) : null;
        // Start on the real date when the year is known, so calendars can count
        // years; otherwise on the next occurrence.
        let start = known ? d.date : K.nextOccurrence(d.date, today).date;
        let rrule = "FREQ=YEARLY";
        if (md === "02-29") {
          // Last day of February every year: Feb 29 in leap years, Feb 28 otherwise.
          rrule = "FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=-1";
          if (!known) start = `${today.slice(0, 4)}-02-${K.isISODate(`${today.slice(0, 4)}-02-29`) ? "29" : "28"}`;
        }
        events.push({
          uid: `${uidPart(p.id)}-${uidPart(d.id)}@keepintouch.local`,
          start, rrule,
          summary: `${p.name}: ${d.label}`,
          sortKey: K.nextOccurrence(d.date, today).date,
        });
      }
    }
    events.sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0));
    return { text: calendar("Keep in Touch dates", events, today), count: events.length };
  }

  // This week's plan as one all-day event per hello, on the day the plan put
  // it, with the reasons it showed up. Uses the same weeklyPlan as the page.
  function planToICS(people, today, capacity) {
    const plan = K.weeklyPlan(people.filter((p) => !p.demo), today, { capacity });
    const events = [];
    for (const day of plan.days) {
      for (const it of day.items) {
        events.push({
          uid: `plan-${compact(plan.start)}-${uidPart(it.id)}@keepintouch.local`,
          start: day.date,
          summary: `Say hello to ${it.name}`,
          description: "Why this showed up:\n" + it.reasons.map((r) => "- " + r.text).join("\n") +
            "\n\nA suggestion from Keep in Touch. Skip it freely.",
        });
      }
    }
    return { text: calendar("Keep in Touch week", events, today), count: events.length, plan };
  }

  const api = { parseVCards, parseVDate, matchContacts, applyContacts, datesToICS, planToICS, fold, icsText };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.KIT_IO = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
