// TDD RED first — the pure "who am I overdue to reach out to?" logic.
// Deterministic: today is injected, never read from the clock.
const assert = require("node:assert");
const test = require("node:test");
const { CADENCES, dueContacts, daysBetween } = require("./keepintouch.js");

const TODAY = "2026-07-11";

test("cadence table maps friendly names to day intervals", () => {
  assert.strictEqual(CADENCES.weekly, 7);
  assert.strictEqual(CADENCES.monthly, 30);
  assert.strictEqual(CADENCES.quarterly, 91);
});

test("daysBetween counts calendar days regardless of order", () => {
  assert.strictEqual(daysBetween("2026-07-01", "2026-07-11"), 10);
  assert.strictEqual(daysBetween("2026-07-11", "2026-07-01"), 10);
});

test("flags a contact as overdue when past its cadence", () => {
  const people = [{ name: "Sam", cadence: "monthly", lastContacted: "2026-06-01" }];
  const out = dueContacts(people, TODAY);
  assert.strictEqual(out[0].status, "overdue");
  assert.strictEqual(out[0].overdueBy, 10); // 40 days since, monthly = 30
});

test("a contact within its cadence is ok and not overdue", () => {
  const people = [{ name: "Dana", cadence: "monthly", lastContacted: "2026-07-01" }];
  const out = dueContacts(people, TODAY);
  assert.strictEqual(out[0].status, "ok");
  assert.strictEqual(out[0].overdueBy, 0);
});

test("never-contacted people are 'new' and sort to the very top", () => {
  const people = [
    { name: "Old", cadence: "weekly", lastContacted: "2026-06-01" }, // very overdue
    { name: "Fresh", cadence: "weekly" },                             // never contacted
  ];
  const out = dueContacts(people, TODAY);
  assert.strictEqual(out[0].name, "Fresh");
  assert.strictEqual(out[0].status, "new");
});

test("results sort by most overdue first", () => {
  const people = [
    { name: "A", cadence: "monthly", lastContacted: "2026-07-05" }, // ok
    { name: "B", cadence: "weekly", lastContacted: "2026-06-01" },  // very overdue
    { name: "C", cadence: "weekly", lastContacted: "2026-07-01" },  // mildly overdue
  ];
  const out = dueContacts(people, TODAY).map((p) => p.name);
  assert.deepStrictEqual(out, ["B", "C", "A"]);
});

test("rejects an unknown cadence with a helpful message", () => {
  assert.throws(
    () => dueContacts([{ name: "X", cadence: "fortnightly" }], TODAY),
    /cadence/i
  );
});
