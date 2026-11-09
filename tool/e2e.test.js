// End to end in a real browser (Playwright + Chromium, preinstalled in the dev
// container). Skips cleanly when Playwright is not available.
// Today is pinned with ?today= so the run is deterministic.
const test = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

let chromium;
try { ({ chromium } = require("playwright")); } catch (e) { chromium = null; }

const ROOT = path.join(__dirname, "..");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".woff2": "font/woff2", ".png": "image/png", ".css": "text/css" };
const TODAY = "2026-11-09";

function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
      if (p.endsWith("/")) p += "index.html";
      const f = path.join(ROOT, p);
      if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream" });
      fs.createReadStream(f).pipe(res);
    }).listen(0, "127.0.0.1", () => resolve(srv));
  });
}

test("planner works end to end in a browser", { skip: !chromium && "playwright not installed" }, async (t) => {
  const srv = await serve();
  const base = `http://127.0.0.1:${srv.address().port}/tool/?today=${TODAY}`;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ acceptDownloads: true, permissions: ["clipboard-read", "clipboard-write"] });
  const page = await ctx.newPage();
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  // block the newsletter endpoint so nothing leaves the machine
  await page.route(/micksfairdinkumai/, (r) => r.abort());
  const shots = process.env.KIT_SHOTS;
  let exported;

  try {
    await t.test("first visit shows an example week, not an empty page", async () => {
      await page.goto(base);
      await page.waitForSelector("#week-example:not([hidden])");
      const names = await page.locator("#week-body .item b").allTextContents();
      assert.ok(names.includes("Mom"));
      assert.strictEqual(await page.locator("#week-body .acts").count(), 0, "examples have no action buttons");
      if (shots) await page.screenshot({ path: path.join(shots, "1-first-visit.png"), fullPage: true });
    });

    await t.test("migrates v1 data saved by the old tool", async () => {
      await page.evaluate(() => localStorage.setItem("keepintouch.people.v1",
        JSON.stringify([{ name: "Legacy Lou", cadence: "weekly", lastContacted: "2026-10-01" }])));
      await page.reload();
      assert.deepStrictEqual(await page.locator("#week-body .item b").allTextContents(), ["Legacy Lou"]);
      const v2 = await page.evaluate(() => JSON.parse(localStorage.getItem("keepintouch.v2")));
      assert.strictEqual(v2.version, 2);
      await page.evaluate(() => localStorage.clear());
      await page.reload();
    });

    await t.test("load sample people, see reasons, snooze one, undo", async () => {
      await page.click("#start-demo");
      await page.waitForSelector("#week-demo:not([hidden])");
      const mom = page.locator("#week-body .item", { hasText: "Mom" });
      assert.match(await mom.textContent(), /Birthday in 3 days, Thu Nov 12 \(turning 68\)/);
      assert.match(await page.locator("details.later summary").first().textContent(), /Can wait until next week/);
      if (shots) await page.screenshot({ path: path.join(shots, "2-this-week.png"), fullPage: true });
      const priya = page.locator("#week-body .item", { hasText: "Priya Raman" });
      await priya.locator("select").selectOption("7");
      await page.waitForSelector("#notice.on");
      assert.match(await page.textContent("#notice"), /Priya Raman is snoozed until Nov 16/);
      assert.strictEqual(await page.locator("#week-body > section .item", { hasText: "Priya Raman" }).count(), 0);
      await page.click("#notice button:text('Undo')");
      assert.strictEqual(await page.locator("#week-body > section .item", { hasText: "Priya Raman" }).count(), 1);
    });

    await t.test("capacity changes the plan and persists", async () => {
      await page.selectOption("#capacity", "5");
      await page.reload();
      assert.strictEqual(await page.inputValue("#capacity"), "5");
      await page.selectOption("#capacity", "3");
    });

    await t.test("add a person, open prep, log a conversation that resolves a topic", async () => {
      await page.click("#tab-people");
      await page.fill("#add-name", "Rosa Diaz");
      await page.selectOption("#add-cadence", "custom");
      await page.fill("#add-days", "10");
      await page.fill("#add-bday", "11-11");
      await page.click("#add button[type=submit]");
      await page.click(".person-open:has-text('Rosa Diaz')");
      await page.fill("#ed-topics", "Her pottery class");
      await page.fill("#ed-notes", "Prefers texts. <b>not html</b>");
      await page.click("#edit-form button[type=submit]");
      const openers = await page.locator("ul.openers li span").allTextContents();
      assert.strictEqual(openers[0], "Your birthday is coming up Wed. Any plans?");
      assert.ok(openers.includes("I was thinking about her pottery class. How is that going?"));
      assert.strictEqual(await page.locator(".notes-view").textContent(), "Prefers texts. <b>not html</b>");
      if (shots) await page.screenshot({ path: path.join(shots, "3-prepare.png"), fullPage: true });
      await page.fill("#log-note", "Called. The class ends in December.");
      await page.check("#rt-0");
      await page.click("#log-form button[type=submit]");
      assert.match(await page.textContent(".prep"), /Last talked Nov 9 \(today\)/);
      assert.match(await page.textContent(".prep"), /The class ends in December/);
      assert.strictEqual(await page.inputValue("#ed-topics"), "");
    });

    await t.test("pause keeps notes; remove offers undo", async () => {
      await page.click("button:text('Pause reminders')");
      assert.match(await page.textContent(".controls"), /Reminders paused\. Notes kept\./);
      await page.click("button.danger");
      assert.match(await page.textContent("#notice"), /Removed Rosa Diaz/);
      await page.click("#notice button:text('Undo')");
      assert.strictEqual(await page.locator(".person-open:has-text('Rosa Diaz')").count(), 1);
    });

    await t.test("dates tab lists upcoming dates", async () => {
      await page.click("#tab-dates");
      const text = await page.textContent("#dates-list");
      assert.match(text, /Rosa Diaz.*Birthday in 2 days, Wed Nov 11/); // paused people keep their dates here
      assert.match(text, /Mom/);
    });


    await t.test("export downloads real people only", async () => {
      await page.click("#tab-data");
      if (shots) await page.screenshot({ path: path.join(shots, "4-your-data.png"), fullPage: true });
      const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#export")]);
      exported = path.join(os.tmpdir(), `kit-export-${process.pid}.json`);
      await dl.saveAs(exported);
      const data = JSON.parse(fs.readFileSync(exported, "utf8"));
      assert.strictEqual(data.format, "keepintouch-export");
      assert.deepStrictEqual(data.people.map((p) => p.name), ["Rosa Diaz"]);
    });

    await t.test("delete everything needs DELETE typed, then wipes", async () => {
      await page.fill("#delete-confirm", "nope");
      await page.click("#delete-form button[type=submit]");
      assert.match(await page.textContent("#notice"), /Type DELETE/);
      await page.fill("#delete-confirm", "DELETE");
      await page.click("#delete-form button[type=submit]");
      assert.strictEqual(await page.evaluate(() => localStorage.length), 0);
    });

    await t.test("import the export back, and a CSV with a bad row", async () => {
      await page.setInputFiles("#import-file", exported);
      await page.click("#import-form button[type=submit]");
      await page.waitForSelector("#import-report:not([hidden])");
      assert.match(await page.textContent("#import-report"), /1 added, 0 updated, 0 skipped/);
      const csv = path.join(os.tmpdir(), `kit-import-${process.pid}.csv`);
      fs.writeFileSync(csv, "name,cadence\nNew Nora,weekly\nBad Bo,sometimes\n");
      await page.setInputFiles("#import-file", csv);
      await page.click("#import-form button[type=submit]");
      await page.waitForFunction(() => /1 added/.test(document.querySelector("#import-report").textContent) &&
        /Unknown cadence/.test(document.querySelector("#import-report").textContent));
      fs.unlinkSync(csv);
    });

    await t.test("corrupt saved data is kept for recovery, not thrown away", async () => {
      await page.evaluate(() => localStorage.setItem("keepintouch.v2", "{broken"));
      await page.reload();
      assert.match(await page.textContent("#notice"), /could not be read/);
      assert.strictEqual(await page.evaluate(() => localStorage.getItem("keepintouch.recovery")), "{broken");
      await page.click("#tab-data");
      assert.ok(await page.isVisible("#recovery"));
    });

    await t.test("a second tab's save is picked up, not overwritten", async () => {
      await page.evaluate(() => localStorage.clear());
      await page.reload();
      const other = await ctx.newPage();
      await other.goto(base);
      await other.click("#tab-people");
      await other.fill("#add-name", "Tab Bea");
      await other.click("#add button[type=submit]");
      await page.waitForFunction(() => /another tab/.test(document.querySelector("#notice").textContent));
      await page.click("#tab-people");
      await page.fill("#add-name", "Tab Al");
      await page.click("#add button[type=submit]");
      const names = await page.evaluate(() => JSON.parse(localStorage.getItem("keepintouch.v2")).people.map((p) => p.name).sort());
      assert.deepStrictEqual(names, ["Tab Al", "Tab Bea"]);
      await other.close();
    });

    await t.test("phone width has no horizontal scroll", async () => {
      await page.evaluate(() => localStorage.clear());
      await page.setViewportSize({ width: 375, height: 800 });
      await page.reload();
      await page.click("#start-demo");
      const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(over <= 0, `page overflows by ${over}px`);
      if (shots) await page.screenshot({ path: path.join(shots, "5-phone.png"), fullPage: true });
    });

    assert.deepStrictEqual(errors.filter((e) => !/micksfairdinkumai|ERR_FAILED/.test(e)), []);
  } finally {
    if (exported && fs.existsSync(exported)) fs.unlinkSync(exported);
    await browser.close();
    srv.closeAllConnections();
    srv.close();
  }
});
