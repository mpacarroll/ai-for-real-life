// The planner core: model, reasons, weekly plan, dates, prep, snooze, import/export.
// Deterministic: today is injected, never read from the clock.
const assert = require("node:assert");
const test = require("node:test");
const K = require("./keepintouch.js");
const { demoPeople } = require("./fixtures.js");

const TODAY = "2026-11-09"; // a Monday
let n = 0;
const gen = () => `id${++n}`;
const person = (raw) => K.normalizePerson(raw, gen);
const stateOf = (people) => ({ ...K.createState(), people: people.map(person) });

test("dates: add, diff, leap-day birthdays recur on Feb 28", () => {
  assert.strictEqual(K.addDays("2026-12-30", 3), "2027-01-02");
  assert.strictEqual(K.diffDays("2026-11-09", "2026-11-02"), -7);
  assert.strictEqual(K.weekday(TODAY), "Mon");
  assert.ok(!K.isISODate("2026-02-30"));
  assert.deepStrictEqual(K.nextOccurrence("2000-02-29", "2027-02-01"), { date: "2027-02-28", daysAway: 27, years: 27 });
  assert.strictEqual(K.nextOccurrence("2000-02-29", "2028-02-01").date, "2028-02-29");
  assert.strictEqual(K.nextOccurrence("01-05", TODAY).date, "2027-01-05");
  assert.strictEqual(K.nextOccurrence("11-09", TODAY).daysAway, 0);
});

test("normalizePerson validates with plain messages", () => {
  assert.throws(() => person({ name: "" }), /needs a name/);
  assert.throws(() => person({ name: "X", cadence: "fortnightly" }), /Unknown cadence/);
  assert.throws(() => person({ name: "X", cadence: "custom", cadenceDays: 0 }), /custom rhythm/);
  assert.throws(() => person({ name: "X", lastContacted: "11/02/2026" }), /not a date/);
  assert.throws(() => person({ name: "X", dates: [{ date: "13-01" }] }), /not YYYY-MM-DD or MM-DD/);
  const p = person({ name: "  Ana ", cadence: "custom", cadenceDays: "10" });
  assert.strictEqual(p.name, "Ana");
  assert.strictEqual(p.cadenceDays, 10);
  assert.strictEqual(K.cadenceLabel(p), "every 10 days");
  assert.strictEqual(person({ name: "B" }).cadence, "monthly");
});

test("reminderFor explains why someone is due", () => {
  const r = K.reminderFor(person({ name: "Sam", cadence: "monthly", lastContacted: "2026-10-01" }), TODAY);
  assert.ok(r.due && r.cadenceDue);
  assert.strictEqual(r.reasons[0].text, "You chose every month. Last talked Oct 1, 39 days ago.");
  const fresh = K.reminderFor(person({ name: "New", cadence: "weekly" }), TODAY);
  assert.strictEqual(fresh.reasons[0].kind, "new");
  const ok = K.reminderFor(person({ name: "Ok", cadence: "monthly", lastContacted: "2026-11-01" }), TODAY);
  assert.ok(!ok.due);
  assert.strictEqual(ok.nextDue, "2026-12-01");
});

test("birthdays inside a week show as a reason even when the rhythm is fine", () => {
  const p = person({ name: "Mom", cadence: "weekly", lastContacted: "2026-11-08",
    dates: [{ kind: "birthday", label: "Birthday", date: "1958-11-12" }] });
  const r = K.reminderFor(p, TODAY);
  assert.ok(r.due && !r.cadenceDue);
  assert.strictEqual(r.reasons[0].text, "Birthday in 3 days, Thu Nov 12 (turning 68).");
});

test("snooze hides the cadence reminder until it ends, then says so", () => {
  let s = stateOf([{ id: "t", name: "Tom", cadence: "weekly", lastContacted: "2026-10-01" }]);
  s = K.snooze(s, "t", TODAY, 7);
  assert.strictEqual(s.people[0].snoozedUntil, "2026-11-16");
  assert.ok(!K.reminderFor(s.people[0], TODAY).due);
  assert.ok(K.reminderFor(s.people[0], TODAY).snoozed);
  const after = K.reminderFor(s.people[0], "2026-11-16");
  assert.ok(after.due);
  assert.ok(after.reasons.some((x) => x.text === "Back from snooze (ended Nov 16)."));
  assert.ok(!K.reminderFor(K.unsnooze(s, "t").people[0], TODAY).snoozed);
  assert.throws(() => K.snooze(s, "t", TODAY, 0), /1 to 365/);
});

test("paused people and 'no reminders' people never show up, and keep their notes", () => {
  const s = stateOf([
    { id: "a", name: "Paused", cadence: "weekly", paused: true, notes: "kept",
      dates: [{ kind: "birthday", date: "11-10" }] },
    { id: "b", name: "Notes only", cadence: "none" },
  ]);
  for (const p of s.people) assert.ok(!K.reminderFor(p, TODAY).due);
  assert.strictEqual(K.weeklyPlan(s.people, TODAY).planned, 0);
  assert.strictEqual(K.setPaused(s, "a", false).people[0].notes, "kept");
});

test("weeklyPlan: dated moments land on their day and always show", () => {
  const s = stateOf([
    { id: "m", name: "Mom", cadence: "weekly", lastContacted: "2026-11-08",
      dates: [{ kind: "birthday", label: "Birthday", date: "11-12" }] },
  ]);
  const plan = K.weeklyPlan(s.people, TODAY, { capacity: 1 });
  assert.strictEqual(plan.days.length, 7);
  assert.strictEqual(plan.days[0].label, "Today");
  assert.strictEqual(plan.days[3].date, "2026-11-12");
  assert.deepStrictEqual(plan.days[3].items.map((i) => i.name), ["Mom"]);
});

test("weeklyPlan respects capacity, ranks by lateness for the person's rhythm, explains overflow", () => {
  const s = stateOf([
    { id: "w", name: "Weekly late", cadence: "weekly", lastContacted: "2026-10-26" },     // 7 days late of 7: 1.0
    { id: "y", name: "Yearly late", cadence: "annually", lastContacted: "2025-10-01" },  // 39 late of 365: 0.11
    { id: "q", name: "Quarterly late", cadence: "quarterly", lastContacted: "2026-06-01" }, // 70 late of 91: 0.77
  ]);
  const plan = K.weeklyPlan(s.people, TODAY, { capacity: 2 });
  const planned = plan.days.flatMap((d) => d.items.map((i) => i.name));
  assert.deepStrictEqual(planned.sort(), ["Quarterly late", "Weekly late"]);
  assert.strictEqual(plan.later.length, 1);
  assert.strictEqual(plan.later[0].name, "Yearly late");
  assert.match(plan.later[0].reasons.at(-1).text, /Can wait\. You set room for 2 a week, so this one can roll to next week/);
});

test("weeklyPlan spreads people across the week instead of stacking today", () => {
  const s = stateOf(["A", "B", "C"].map((name) => ({ name, cadence: "weekly", lastContacted: "2026-10-01" })));
  const plan = K.weeklyPlan(s.people, TODAY, { capacity: 3 });
  const used = plan.days.filter((d) => d.items.length).map((d) => d.items.length);
  assert.deepStrictEqual(used, [1, 1, 1]);
});

test("weeklyPlan puts someone coming due later in the week no earlier than their due day", () => {
  const s = stateOf([{ name: "Soon", cadence: "weekly", lastContacted: "2026-11-05" }]); // due Nov 12
  const plan = K.weeklyPlan(s.people, TODAY);
  const day = plan.days.findIndex((d) => d.items.length);
  assert.strictEqual(plan.days[day].date, "2026-11-12");
  assert.match(plan.days[day].items[0].reasons[0].text, /Comes due Thu Nov 12/);
});

test("weeklyPlan lists active snoozes separately", () => {
  const s = stateOf([{ id: "t", name: "Tom", cadence: "weekly", lastContacted: "2026-10-01", snoozedUntil: "2026-11-30" }]);
  const plan = K.weeklyPlan(s.people, TODAY);
  assert.strictEqual(plan.planned, 0);
  assert.strictEqual(plan.snoozed[0].name, "Tom");
});

test("logConversation moves last talked forward only, clears snooze, resolves topics", () => {
  let s = stateOf([{ id: "s", name: "Sam", cadence: "monthly", lastContacted: "2026-11-01",
    snoozedUntil: "2026-12-01", topics: ["New job", "Her dog"] }]);
  s = K.logConversation(s, "s", { date: "2026-10-15", note: "Older chat" });
  assert.strictEqual(s.people[0].lastContacted, "2026-11-01");
  s = K.logConversation(s, "s", { date: TODAY, note: "Called. Job is great.", resolvedTopics: ["New job"] });
  const p = s.people[0];
  assert.strictEqual(p.lastContacted, TODAY);
  assert.strictEqual(p.snoozedUntil, null);
  assert.deepStrictEqual(p.topics, ["Her dog"]);
  assert.deepStrictEqual(p.log.map((e) => e.date), [TODAY, "2026-10-15"]);
  assert.throws(() => K.logConversation(s, "s", { date: "" }), /date you talked/);
  assert.throws(() => K.logConversation(s, "nope", { date: TODAY }), /no longer in your list/);
});

test("prepFor gathers context and draft openers without sending anything", () => {
  const p = person({ name: "Sam Okafor", cadence: "quarterly", lastContacted: "2026-07-12",
    topics: ["How the new job at the hospital is going"], notes: "Roommate",
    log: [{ date: "2026-07-12", note: "Started nights." }] });
  const prep = K.prepFor(p, TODAY);
  assert.strictEqual(prep.lastTalked, "Last talked Jul 12 (120 days ago).");
  assert.strictEqual(prep.recent[0].note, "Started nights.");
  assert.strictEqual(prep.openers[0], "I was thinking about how the new job at the hospital is going. How is that going?");
  assert.strictEqual(prep.openers.length, 3);
  const bday = person({ name: "Mom", dates: [{ kind: "birthday", date: "11-09" }] });
  assert.strictEqual(K.draftOpeners(bday, TODAY)[0], "Happy birthday, Mom. Hope today is a good one.");
});

test("upcomingDates sorts across people", () => {
  const s = stateOf([
    { name: "B", dates: [{ kind: "birthday", label: "Birthday", date: "12-01" }] },
    { name: "A", dates: [{ kind: "anniversary", label: "Anniversary", date: "2010-11-20" }] },
  ]);
  const out = K.upcomingDates(s.people, TODAY, 60);
  assert.deepStrictEqual(out.map((x) => x.name), ["A", "B"]);
  assert.strictEqual(out[0].text, "Anniversary in 11 days, Fri Nov 20 (16 years).");
  assert.strictEqual(K.upcomingDates(s.people, TODAY, 10).length, 0);
});

test("migrate upgrades v1 arrays and refuses newer or foreign data", () => {
  const s = K.migrate([{ name: "Mom", cadence: "weekly", lastContacted: "2026-11-01" }], gen);
  assert.strictEqual(s.version, 2);
  assert.strictEqual(s.people[0].name, "Mom");
  assert.ok(s.people[0].id);
  assert.deepStrictEqual(K.migrate(null, gen).people, []);
  assert.throws(() => K.migrate({ version: 9, people: [] }, gen), /newer version/);
  assert.throws(() => K.migrate({ foo: 1 }, gen), /does not look like/);
});

test("export then import round-trips, and demo people are never exported", () => {
  const s = stateOf([
    { id: "a", name: "Ana", cadence: "custom", cadenceDays: 20, notes: "n", topics: ["t"],
      dates: [{ kind: "birthday", date: "03-04" }], log: [{ date: "2026-11-01", note: "x" }] },
    { id: "z", name: "Demo", demo: true },
  ]);
  const json = K.exportState(s, TODAY);
  const parsed = JSON.parse(json);
  assert.strictEqual(parsed.format, K.EXPORT_FORMAT);
  assert.strictEqual(parsed.people.length, 1);
  const back = K.importText(json, K.createState(), "merge", gen);
  assert.strictEqual(back.added, 1);
  assert.deepStrictEqual(back.state.people[0], s.people[0]);
});

test("import merge updates by id, skips same-name duplicates, keeps good rows past bad ones", () => {
  const s = stateOf([{ id: "a", name: "Ana", cadence: "weekly" }, { id: "b", name: "Ben" }]);
  const text = JSON.stringify({ format: K.EXPORT_FORMAT, version: 2, people: [
    { id: "a", name: "Ana R", cadence: "monthly" },
    { name: "Ben" },
    { name: "Cy", cadence: "sometimes" },
    { name: "Dee" },
  ] });
  const r = K.importText(text, s, "merge", gen);
  assert.strictEqual(r.updated, 1);
  assert.strictEqual(r.added, 1);
  assert.deepStrictEqual(r.skipped.map((x) => x.row), [2, 3]);
  assert.match(r.skipped[0].reason, /exact name/);
  assert.match(r.skipped[1].reason, /Unknown cadence/);
  assert.deepStrictEqual(r.state.people.map((p) => p.name), ["Ana R", "Ben", "Dee"]);
});

test("import replace swaps everyone and keeps settings from the file", () => {
  const s = stateOf([{ name: "Old" }]);
  const text = JSON.stringify({ version: 2, settings: { weeklyCapacity: 5 }, people: [{ name: "New" }] });
  const r = K.importText(text, s, "replace", gen);
  assert.deepStrictEqual(r.state.people.map((p) => p.name), ["New"]);
  assert.strictEqual(r.state.settings.weeklyCapacity, 5);
});

test("import reads CSV with quotes, birthdays and topics", () => {
  const csv = 'Name,Cadence,Last Contacted,Birthday,Notes,Topics\r\n' +
    '"Okafor, Sam",quarterly,2026-07-12,1990-05-02,"Says ""hi""",New job; The dog\r\n' +
    'Lee,,,,,\n';
  const r = K.importText(csv, K.createState(), "merge", gen);
  assert.strictEqual(r.added, 2);
  const sam = r.state.people[0];
  assert.strictEqual(sam.name, "Okafor, Sam");
  assert.strictEqual(sam.notes, 'Says "hi"');
  assert.deepStrictEqual(sam.topics, ["New job", "The dog"]);
  assert.strictEqual(sam.dates[0].date, "1990-05-02");
  assert.strictEqual(r.state.people[1].cadence, "monthly");
  assert.throws(() => K.importText("a,b\n1,2", K.createState(), "merge", gen), /"name" column/);
  assert.throws(() => K.importText("{not json", K.createState(), "merge", gen), /not valid JSON/);
  assert.throws(() => K.importText("", K.createState(), "merge", gen), /empty/);
});

test("removePerson returns the removed person so the UI can offer undo", () => {
  const s = stateOf([{ id: "a", name: "Ana" }, { id: "b", name: "Ben" }]);
  const { state, removed } = K.removePerson(s, "a");
  assert.strictEqual(removed.name, "Ana");
  assert.deepStrictEqual(state.people.map((p) => p.id), ["b"]);
});

test("setCapacity bounds the weekly room", () => {
  assert.strictEqual(K.setCapacity(K.createState(), 5).settings.weeklyCapacity, 5);
  assert.throws(() => K.setCapacity(K.createState(), 0), /1 to 14/);
});

test("the demo fixture is valid and produces a realistic week", () => {
  const s = K.migrate({ version: 2, people: demoPeople(TODAY) }, gen);
  assert.strictEqual(s.people.length, 9);
  assert.ok(s.people.every((p) => p.demo));
  const plan = K.weeklyPlan(s.people, TODAY, { capacity: 3 });
  const names = plan.days.flatMap((d) => d.items.map((i) => i.name));
  assert.ok(names.includes("Mom"), "birthday lands in the week");
  assert.ok(names.includes("Lena and Marco"), "anniversary lands in the week");
  assert.ok(!names.includes("Kim from the climbing gym"), "paused stays out");
  assert.ok(plan.snoozed.some((x) => x.name === "Tom Becker"));
  assert.ok(plan.later.length >= 1, "capacity leaves something for later");
});
