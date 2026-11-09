// Guard: the page must run the tested module, not a hand-copied core.
const assert = require("node:assert");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");

test("index.html loads keepintouch.js, fixtures.js and app.js, in that order", () => {
  const srcs = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
  assert.deepStrictEqual(srcs, ["keepintouch.js", "fixtures.js", "app.js"]);
});

test("index.html carries no inline copy of the core", () => {
  assert.ok(!/function dueContacts|function weeklyPlan|const CADENCES/.test(html));
});

test("the page never uses innerHTML with data, and never sends a message", () => {
  const app = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
  assert.ok(!/innerHTML/.test(app), "app.js renders with textContent only");
  assert.ok(!/fetch\(|XMLHttpRequest|sendBeacon|mailto:|sms:/.test(app), "app.js makes no network calls and opens no send links");
});
