// Contacts in (.vcf) and calendar out (.ics). Deterministic: today is injected.
const assert = require("node:assert");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const K = require("./keepintouch.js");
const IO = require("./interop.js");

const TODAY = "2026-11-09";
let n = 0;
const gen = () => `id${++n}`;
const VCF = fs.readFileSync(path.join(__dirname, "fixtures", "sample-contacts.vcf"), "utf8");

test("vCard dates: full, compact, no-year, Apple omit-year, and invalid", () => {
  assert.strictEqual(IO.parseVDate("1990-04-12"), "1990-04-12");
  assert.strictEqual(IO.parseVDate("19900412"), "1990-04-12");
  assert.strictEqual(IO.parseVDate("1990-04-12T00:00:00Z"), "1990-04-12");
  assert.strictEqual(IO.parseVDate("--0412"), "04-12");
  assert.strictEqual(IO.parseVDate("--04-12"), "04-12");
  assert.strictEqual(IO.parseVDate("1604-07-02", { "X-APPLE-OMIT-YEAR": "1604" }), "07-02");
  assert.strictEqual(IO.parseVDate("1990-02-30"), null);
  assert.strictEqual(IO.parseVDate("April 12"), null);
});

test("parseVCards reads names and dates from Apple, 4.0 and 2.1 cards", () => {
  const { contacts, skipped } = IO.parseVCards(VCF);
  const by = Object.fromEntries(contacts.map((c) => [c.name, c]));
  assert.deepStrictEqual(Object.keys(by), ["Elsa Lindqvist", "Tomas Ferreira", "Grace Whitaker-Nnamdi", "Lucía Baños", "Dev Patel-Ruiz", "Mom"]);
  assert.deepStrictEqual(by["Elsa Lindqvist"].dates, [
    { kind: "birthday", label: "Birthday", date: "1987-03-14" },
    { kind: "anniversary", label: "Anniversary", date: "2015-09-19" },
  ]);
  assert.deepStrictEqual(by["Tomas Ferreira"].dates.map((d) => [d.kind, d.label, d.date]),
    [["birthday", "Birthday", "07-02"], ["other", "Started new job", "2024-01-08"]]);
  assert.deepStrictEqual(by["Grace Whitaker-Nnamdi"].dates.map((d) => d.date), ["11-21", "2010-11-06"]);
  assert.strictEqual(by["Lucía Baños"].dates[0].date, "1992-02-29");
  assert.deepStrictEqual(by["Dev Patel-Ruiz"].dates, []);
  assert.deepStrictEqual(skipped, [{ index: 6, reason: "This contact has no name." }]);
});

test("parseVCards never carries phone numbers, emails, addresses or notes", () => {
  const json = JSON.stringify(IO.parseVCards(VCF));
  for (const leak of ["555", "example.com", "Example St", "Do not import"]) assert.ok(!json.includes(leak), leak);
});

test("parseVCards: folded lines, escapes, N fallback, and a file with no cards", () => {
  const card = "BEGIN:VCARD\r\nVERSION:3.0\r\nN:O'Brien;Ann\\, Marie;;Dr.;\r\nBDAY:19\r\n 800101\r\nEND:VCARD\r\n";
  const { contacts } = IO.parseVCards(card);
  assert.strictEqual(contacts[0].name, "Dr. Ann, Marie O'Brien");
  assert.strictEqual(contacts[0].dates[0].date, "1980-01-01");
  assert.throws(() => IO.parseVCards("name,cadence\nA,weekly"), /No contacts found/);
});

test("matchContacts flags people already in the list and only their new dates", () => {
  const people = [K.normalizePerson({ name: "mom", dates: [{ kind: "birthday", date: "11-12" }] }, gen),
    K.normalizePerson({ name: "Elsa Lindqvist" }, gen)];
  const m = IO.matchContacts(IO.parseVCards(VCF).contacts, people);
  const mom = m.find((c) => c.name === "Mom");
  assert.strictEqual(mom.existingId, people[0].id);
  assert.deepStrictEqual(mom.newDates, [], "same yearly day, with or without a year, is not new");
  assert.strictEqual(m.find((c) => c.name === "Elsa Lindqvist").newDates.length, 2);
  assert.strictEqual(m.find((c) => c.name === "Tomas Ferreira").existingId, null);
});

test("applyContacts adds new people with the chosen rhythm and only adds dates to existing ones", () => {
  let state = { ...K.createState(), people: [K.normalizePerson({ name: "Elsa Lindqvist", cadence: "weekly", notes: "keep me",
    lastContacted: "2026-11-01", dates: [{ kind: "birthday", date: "03-14" }] }, gen)] };
  const { contacts } = IO.parseVCards(VCF);
  const pick = contacts.filter((c) => ["Elsa Lindqvist", "Tomas Ferreira", "Dev Patel-Ruiz"].includes(c.name));
  const r = IO.applyContacts(state, pick, { cadence: "quarterly" }, gen, TODAY);
  assert.deepStrictEqual([r.added, r.datesAdded, r.unchanged], [2, 1, 0]);
  const elsa = r.state.people.find((p) => p.name === "Elsa Lindqvist");
  assert.strictEqual(elsa.cadence, "weekly");
  assert.strictEqual(elsa.notes, "keep me");
  assert.strictEqual(elsa.lastContacted, "2026-11-01");
  assert.deepStrictEqual(elsa.dates.map((d) => d.kind), ["birthday", "anniversary"]);
  const tomas = r.state.people.find((p) => p.name === "Tomas Ferreira");
  assert.strictEqual(tomas.cadence, "quarterly");
  assert.strictEqual(tomas.createdAt, TODAY);
  assert.strictEqual(tomas.lastContacted, null);
  // a second run changes nothing
  const again = IO.applyContacts(r.state, pick, { cadence: "quarterly" }, gen, TODAY);
  assert.deepStrictEqual([again.added, again.datesAdded, again.unchanged], [0, 0, 3]);
});

test("applyContacts merges two picked cards with the same name into one person", () => {
  const cards = [{ key: "a", name: "Jo Kim", dates: [{ kind: "birthday", label: "Birthday", date: "05-01" }] },
    { key: "b", name: "jo kim", dates: [{ kind: "anniversary", label: "Anniversary", date: "2019-06-01" }] }];
  const r = IO.applyContacts(K.createState(), cards, { cadence: "custom", cadenceDays: 45 }, gen, TODAY);
  assert.strictEqual(r.state.people.length, 1);
  assert.strictEqual(r.state.people[0].cadenceDays, 45);
  assert.strictEqual(r.state.people[0].dates.length, 2);
});

// Structural RFC 5545 checks, since no validator ships in the repo.
function assertValidICS(text) {
  assert.ok(text.endsWith("\r\n"));
  const lines = text.slice(0, -2).split("\r\n");
  for (const l of lines) {
    assert.ok(Buffer.byteLength(l, "utf8") <= 75, `line over 75 octets: ${l}`);
    assert.ok(!/\n|\r/.test(l));
  }
  const unfolded = text.replace(/\r\n[ \t]/g, "").split("\r\n").filter(Boolean);
  assert.strictEqual(unfolded[0], "BEGIN:VCALENDAR");
  assert.strictEqual(unfolded[unfolded.length - 1], "END:VCALENDAR");
  const begins = unfolded.filter((l) => l === "BEGIN:VEVENT").length;
  assert.strictEqual(begins, unfolded.filter((l) => l === "END:VEVENT").length);
  const events = text.replace(/\r\n[ \t]/g, "").split("BEGIN:VEVENT").slice(1);
  const uids = new Set();
  for (const ev of events) {
    for (const k of ["UID:", "DTSTAMP:", "DTSTART;VALUE=DATE:", "DTEND;VALUE=DATE:", "SUMMARY:"]) assert.ok(ev.includes("\r\n" + k), k);
    const uid = /\r\nUID:(.+)\r\n/.exec(ev)[1];
    assert.ok(!uids.has(uid), "UIDs are unique");
    uids.add(uid);
  }
  return { lines: unfolded, events };
}

test("datesToICS: yearly events, leap birthdays, no notes, no samples", () => {
  const people = [
    K.normalizePerson({ id: "p1", name: "Ana, the \"Great\"; Jr", notes: "secret note", dates: [
      { id: "d1", kind: "birthday", label: "Birthday", date: "1990-04-12" },
      { id: "d2", kind: "anniversary", label: "Anniversary", date: "06-30" }] }, gen),
    K.normalizePerson({ id: "p2", name: "Leap Lee", dates: [{ id: "d1", kind: "birthday", label: "Birthday", date: "02-29" }] }, gen),
    K.normalizePerson({ id: "demo-x", name: "Sample Sue", demo: true, dates: [{ kind: "birthday", date: "01-01" }] }, gen),
  ];
  const { text, count } = IO.datesToICS(people, TODAY);
  assert.strictEqual(count, 3);
  const { lines } = assertValidICS(text);
  const all = lines.join("\n");
  assert.ok(all.includes("DTSTART;VALUE=DATE:19900412"), "known year starts on the real date");
  assert.ok(all.includes("DTSTART;VALUE=DATE:20270630"), "unknown year starts on the next occurrence");
  assert.ok(all.includes("RRULE:FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=-1"));
  assert.ok(all.includes("SUMMARY:Ana\\, the \"Great\"\\; Jr: Birthday"));
  assert.ok(!all.includes("secret note") && !all.includes("Sample Sue"));
  // ordered by next occurrence: Feb (leap), Apr, Jun
  const summaries = lines.filter((l) => l.startsWith("SUMMARY:"));
  assert.deepStrictEqual(summaries.map((s) => s.split(": ").pop()), ["Birthday", "Birthday", "Anniversary"]);
  assert.ok(summaries[0].includes("Leap Lee"));
});

test("planToICS puts each planned hello on its day with the reasons", () => {
  const { demoPeople } = require("./fixtures.js");
  const people = demoPeople(TODAY).map((p) => K.normalizePerson({ ...p, demo: false }, gen));
  const { text, count, plan } = IO.planToICS(people, TODAY, 3);
  assert.strictEqual(count, plan.planned);
  assert.ok(count > 0);
  const { events } = assertValidICS(text);
  const first = plan.days.find((d) => d.items.length);
  assert.ok(events.some((e) => e.includes(`DTSTART;VALUE=DATE:${first.date.replace(/-/g, "")}`) &&
    e.includes(`SUMMARY:Say hello to ${first.items[0].name}`)));
  assert.ok(events.every((e) => /DESCRIPTION:Why this showed up:\\n- /.test(e)));
  assert.ok(events.every((e) => !e.includes("RRULE")), "plan events happen once");
});

test("fold never splits a multibyte character and keeps lines at 75 octets", () => {
  const long = "SUMMARY:" + "é".repeat(100) + "👋".repeat(10);
  const folded = IO.fold(long);
  for (const l of folded.split("\r\n")) assert.ok(Buffer.byteLength(l, "utf8") <= 75);
  assert.strictEqual(folded.replace(/\r\n /g, ""), long);
});
