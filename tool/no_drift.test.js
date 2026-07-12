// Guard: the core inlined in index.html must behave like the tested module.
const assert = require("node:assert");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const mod = require("./keepintouch.js");

function inlineCore() {
  const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
  const m = html.match(/---8<--- keepintouch core([\s\S]*?)--->8--- keepintouch core/);
  assert.ok(m, "could not find fenced core in index.html");
  const sandbox = {};
  vm.runInNewContext(m[1] + "\nthis.dueContacts = dueContacts; this.CADENCES = CADENCES;", sandbox);
  return sandbox;
}

test("inline core matches the module across statuses and sorting", () => {
  const inline = inlineCore();
  const today = "2026-07-11";
  const people = [
    { name: "A", cadence: "monthly", lastContacted: "2026-07-05" },
    { name: "B", cadence: "weekly", lastContacted: "2026-06-01" },
    { name: "C", cadence: "weekly" },
  ];
  // Compare by serialized value: the inline core runs in a separate vm realm,
  // so deepStrictEqual would reject its objects on prototype identity alone.
  const J = (x) => JSON.stringify(x);
  assert.strictEqual(J(inline.dueContacts(people, today)), J(mod.dueContacts(people, today)));
  assert.strictEqual(J(inline.CADENCES), J(mod.CADENCES));
});

test("inline core rejects unknown cadence like the module", () => {
  assert.throws(() => inlineCore().dueContacts([{ name: "X", cadence: "fortnightly" }], "2026-07-11"), /cadence/i);
});
