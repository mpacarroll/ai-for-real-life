// Keep in Touch: the page. Storage, rendering and events. All logic that
// decides anything lives in keepintouch.js (window.KIT); this file only
// wires it to the DOM and to localStorage on this device.
(function () {
  "use strict";
  const K = window.KIT;
  const F = window.KIT_FIXTURES;
  const IO = window.KIT_IO;

  const KEY = "keepintouch.v2";
  const KEY_V1 = "keepintouch.people.v1";
  const KEY_RECOVERY = "keepintouch.recovery";
  const TAB_KEY = "keepintouch.tab";

  // ---------- today (local calendar day; ?today=YYYY-MM-DD for demos) ----------
  const qsToday = new URLSearchParams(location.search).get("today");
  const today = () => {
    if (qsToday && K.isISODate(qsToday)) return qsToday;
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const genId = () => "p_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  // ---------- storage with recovery ----------
  let storageOK = true;
  let state;
  let recoveryRaw = null;

  function storeGet(k) {
    try { return localStorage.getItem(k); } catch (e) { storageOK = false; return null; }
  }
  function storeSet(k, v) {
    try { localStorage.setItem(k, v); return true; } catch (e) { storageOK = false; return false; }
  }
  function storeDel(k) {
    try { localStorage.removeItem(k); } catch (e) { /* nothing to do */ }
  }

  function load() {
    const raw = storeGet(KEY);
    if (raw) {
      try { return K.migrate(JSON.parse(raw), genId); }
      catch (e) {
        recoveryRaw = raw;
        storeSet(KEY_RECOVERY, raw);
        return K.createState();
      }
    }
    const v1 = storeGet(KEY_V1);
    if (v1) {
      try {
        const s = K.migrate(JSON.parse(v1), genId);
        storeSet(KEY, JSON.stringify(s)); // the v1 key is left alone as a backup
        return s;
      } catch (e) {
        recoveryRaw = v1;
        storeSet(KEY_RECOVERY, v1);
      }
    }
    return K.createState();
  }

  function commit(next, message, undo) {
    state = next;
    const ok = storeSet(KEY, JSON.stringify(state));
    render();
    if (!ok) {
      notify("Could not save on this device (storage is full or blocked). Your changes last until you close this tab. Use Your data, Export, to keep a copy.", { kind: "warn", sticky: true });
    } else if (message) {
      notify(message, { undo });
    }
  }

  // Run a state change; show the core's plain error message if it refuses.
  function attempt(fn, message, undo) {
    try { commit(fn(state), message, undo); return true; }
    catch (e) { notify(e.message, { kind: "warn" }); return false; }
  }

  // ---------- tiny DOM helper (text nodes only, no HTML strings) ----------
  const $ = (id) => document.getElementById(id);
  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "class") n.className = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else if (k === "text") n.textContent = v;
      else n.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) n.append(kid.nodeType ? kid : String(kid));
    return n;
  }

  // ---------- notices (with undo) ----------
  let noticeTimer;
  function notify(text, opts) {
    const o = opts || {};
    const box = $("notice");
    box.replaceChildren(el("span", { text }));
    box.className = "notice on" + (o.kind === "warn" ? " warn" : "");
    if (o.undo) {
      box.append(el("button", { class: "small", type: "button", onclick: () => { o.undo(); box.className = "notice"; } }, "Undo"));
    }
    if (o.action) box.append(o.action);
    box.append(el("button", { class: "small x", type: "button", "aria-label": "Dismiss", onclick: () => { box.className = "notice"; } }, "×"));
    clearTimeout(noticeTimer);
    if (!o.sticky) noticeTimer = setTimeout(() => { box.className = "notice"; }, o.undo ? 9000 : 6000);
  }

  // ---------- tabs ----------
  const TABS = ["week", "people", "dates", "data"];
  let tab = "week";
  let openId = null; // person detail open in People tab

  function setTab(t, focus) {
    tab = TABS.includes(t) ? t : "week";
    storeSet(TAB_KEY, tab);
    for (const name of TABS) {
      const b = $("tab-" + name);
      b.setAttribute("aria-selected", String(name === tab));
      b.tabIndex = name === tab ? 0 : -1;
      $("panel-" + name).hidden = name !== tab;
    }
    if (focus) $("tab-" + tab).focus();
    render();
  }

  // ---------- shared bits ----------
  const realPeople = () => state.people;
  const isEmpty = () => state.people.length === 0;
  const hasDemo = () => state.people.some((p) => p.demo);
  const find = (id) => state.people.find((p) => p.id === id);

  function reasonList(reasons) {
    return el("ul", { class: "why" }, reasons.map((r) => el("li", { class: "r-" + r.kind, text: r.text })));
  }

  function snoozeSelect(id, label) {
    const sel = el("select", { class: "small", "aria-label": label || "Snooze" },
      el("option", { value: "" }, "Snooze…"),
      el("option", { value: "3" }, "3 days"),
      el("option", { value: "7" }, "1 week"),
      el("option", { value: "14" }, "2 weeks"),
      el("option", { value: "30" }, "1 month"));
    sel.addEventListener("change", () => {
      if (!sel.value) return;
      const before = state;
      const p = find(id);
      attempt((s) => K.snooze(s, id, today(), +sel.value),
        `${p.name} is snoozed until ${K.formatDate(K.addDays(today(), +sel.value))}. No reminders until then.`,
        () => commit(before));
    });
    return sel;
  }

  function talkedButton(id) {
    return el("button", { class: "small primary", type: "button", onclick: () => {
      const before = state;
      const p = find(id);
      attempt((s) => K.logConversation(s, id, { date: today(), note: "" }),
        `Logged a conversation with ${p.name} today.`, () => commit(before));
    } }, "We talked");
  }

  function prepButton(id) {
    return el("button", { class: "small", type: "button", onclick: () => { openId = id; setTab("people"); } }, "Prepare");
  }

  // ---------- This week ----------
  function renderWeek() {
    const box = $("week-body");
    const t = today();
    const example = isEmpty();
    const people = example ? K.migrate({ version: 2, people: F.demoPeople(t) }, genId).people : realPeople();
    const plan = K.weeklyPlan(people, t, { capacity: state.settings.weeklyCapacity });
    $("capacity").value = String(state.settings.weeklyCapacity);
    $("week-example").hidden = !example;
    $("week-demo").hidden = !hasDemo();
    $("ics-week-top").hidden = example || !plan.planned;
    $("week-range").textContent = `${K.weekday(plan.start)} ${K.formatDate(plan.start)} to ${K.weekday(plan.end)} ${K.formatDate(plan.end)}`;

    const kids = [];
    if (!plan.planned) {
      kids.push(el("p", { class: "calm" }, example ? "" : "Nothing planned this week. Everyone is within the rhythm you chose. Enjoy the quiet."));
    }
    for (const day of plan.days) {
      if (!day.items.length) continue;
      kids.push(el("section", { class: "day" },
        el("h4", { text: day.label }),
        day.items.map((it) => el("article", { class: "item", "data-person": it.id },
          el("div", { class: "item-head" },
            el("b", { text: it.name }),
            el("span", { class: "st " + (it.kind === "date" ? "date" : it.kind === "new" ? "new" : "due") },
              it.kind === "date" ? "date" : it.kind === "new" ? "new" : "due")),
          el("p", { class: "why-label" }, "Why this showed up"),
          reasonList(it.reasons),
          example ? null : el("div", { class: "acts" }, talkedButton(it.id), prepButton(it.id), snoozeSelect(it.id, "Snooze " + it.name))
        ))));
    }
    if (plan.later.length) {
      kids.push(el("details", { class: "later" },
        el("summary", {}, `Can wait until next week (${plan.later.length})`),
        plan.later.map((it) => el("article", { class: "item quiet" },
          el("div", { class: "item-head" }, el("b", { text: it.name })),
          reasonList(it.reasons),
          example ? null : el("div", { class: "acts" }, talkedButton(it.id), prepButton(it.id))))));
    }
    if (plan.snoozed.length) {
      kids.push(el("details", { class: "later" },
        el("summary", {}, `Snoozed (${plan.snoozed.length})`),
        plan.snoozed.map((it) => el("article", { class: "item quiet" },
          el("div", { class: "item-head" }, el("b", { text: it.name })),
          reasonList(it.reasons),
          example ? null : el("div", { class: "acts" }, el("button", { class: "small", type: "button", onclick: () =>
            attempt((s) => K.unsnooze(s, it.id), `${it.name} is back on the plan.`) }, "Wake up now"))))));
    }
    box.replaceChildren(...kids);
  }

  // ---------- People ----------
  function statusLine(p) {
    const t = today();
    const r = K.reminderFor(p, t);
    if (p.paused) return { cls: "paused", tag: "paused", text: "Reminders paused. Notes kept." };
    if (p.cadence === "none") return { cls: "paused", tag: "notes", text: "No reminders. Notes only." };
    if (r.snoozed) return { cls: "snoozed", tag: "snoozed", text: `Snoozed until ${K.formatDate(p.snoozedUntil)}.` };
    if (r.cadenceDue) return { cls: !p.lastContacted ? "new" : "due", tag: !p.lastContacted ? "new" : "due", text: r.reasons[0].text };
    return { cls: "ok", tag: "ok", text: `${K.cadenceLabel(p)[0].toUpperCase() + K.cadenceLabel(p).slice(1)}. Next hello around ${K.formatDate(r.nextDue)}.` };
  }

  function renderPeople() {
    const list = $("people-list");
    const detail = $("person-detail");
    const p = openId && find(openId);
    if (openId && !p) openId = null;
    $("people-main").hidden = !!p;
    detail.hidden = !p;
    if (p) { renderDetail(p); return; }
    if (isEmpty()) {
      list.replaceChildren(el("li", { class: "empty" }, "No one yet. Add someone you keep meaning to reach, or load the sample people from Your data."));
      return;
    }
    const sorted = state.people.slice().sort((a, b) => a.name.localeCompare(b.name));
    list.replaceChildren(...sorted.map((x) => {
      const s = statusLine(x);
      return el("li", {},
        el("button", { class: "person-open", type: "button", onclick: () => { openId = x.id; render(); window.scrollTo(0, 0); } },
          el("span", { class: "who" }, el("b", { text: x.name }), el("span", { class: "st " + s.cls, text: s.tag }), x.demo ? el("span", { class: "st sample" }, "sample") : null,
            el("span", { class: "meta", text: s.text }))));
    }));
  }

  function rhythmFields(prefix, p) {
    const sel = el("select", { id: prefix + "-cadence" },
      [["weekly", "week"], ["biweekly", "2 weeks"], ["monthly", "month"], ["quarterly", "3 months"],
        ["semiannually", "6 months"], ["annually", "year"], ["custom", "custom number of days"], ["none", "no reminders, just notes"]]
        .map(([v, t]) => el("option", { value: v, selected: (p ? p.cadence : "monthly") === v }, t)));
    const days = el("input", { id: prefix + "-days", type: "number", min: "1", max: "730", inputmode: "numeric",
      value: p && p.cadenceDays ? String(p.cadenceDays) : "21", "aria-label": "Days between hellos" });
    const wrap = el("div", { class: "custom-days" }, days, el("span", { class: "hint" }, " days"));
    const sync = () => { wrap.hidden = sel.value !== "custom"; };
    sel.addEventListener("change", sync);
    sync();
    return { sel, days, wrap };
  }

  function renderDetail(p) {
    const box = $("person-detail");
    const t = today();
    const prep = K.prepFor(p, t);
    const s = statusLine(p);

    // Prep card
    const prepCard = el("section", { class: "card prep", "aria-labelledby": "prep-h" },
      el("h3", { id: "prep-h" }, "Prepare to talk"),
      el("p", { class: "meta" }, prep.lastTalked, " ", prep.rhythm),
      prep.dates.length ? el("div", {}, el("h4", {}, "Coming up"), el("ul", { class: "plain" }, prep.dates.map((d) => el("li", { text: d })))) : null,
      prep.topics.length ? el("div", {}, el("h4", {}, "Things to ask about"), el("ul", { class: "plain" }, prep.topics.map((d) => el("li", { text: d })))) : null,
      prep.recent.length ? el("div", {}, el("h4", {}, "Recent conversations"),
        el("ul", { class: "plain" }, prep.recent.map((e) => el("li", {}, el("span", { class: "meta" }, K.formatDate(e.date) + ": "), e.note || "Talked.")))) : null,
      prep.notes ? el("div", {}, el("h4", {}, "Your notes"), el("p", { class: "notes-view", text: prep.notes })) : null,
      el("h4", {}, "Draft openers"),
      el("p", { class: "hint" }, "Suggestions to edit in your own words. Nothing is sent from here."),
      el("ul", { class: "openers" }, prep.openers.map((o) => el("li", {},
        el("span", { text: o }),
        el("button", { class: "small", type: "button", onclick: (e) => copyText(o, e.currentTarget) }, "Copy")))));

    // Log form
    const logDate = el("input", { id: "log-date", type: "date", value: t, max: t });
    const logNote = el("textarea", { id: "log-note", placeholder: "What did you talk about? Anything to follow up on next time?", rows: "3" });
    const topicChecks = p.topics.map((tp, i) => el("label", { class: "check-row" },
      el("input", { type: "checkbox", value: tp, id: "rt-" + i }), " Asked about: ", tp));
    const logForm = el("form", { class: "card", id: "log-form", onsubmit: (e) => {
      e.preventDefault();
      const resolved = topicChecks.map((l) => l.querySelector("input")).filter((c) => c.checked).map((c) => c.value);
      const before = state;
      attempt((st) => K.logConversation(st, p.id, { date: logDate.value, note: logNote.value, resolvedTopics: resolved }),
        `Logged a conversation with ${p.name}.`, () => commit(before));
    } },
      el("h3", {}, "Log a conversation"),
      el("label", { for: "log-date" }, "When"), logDate,
      el("label", { for: "log-note" }, "Note ", el("span", { class: "hint" }, "(optional, private)")), logNote,
      topicChecks.length ? el("fieldset", { class: "topics-done" }, el("legend", {}, "Did you get to these?"), topicChecks) : null,
      el("button", { class: "btn", type: "submit" }, "Log it"));

    // Edit form
    const rf = rhythmFields("ed", p);
    const name = el("input", { id: "ed-name", value: p.name, required: true, maxlength: "120" });
    const last = el("input", { id: "ed-last", type: "date", value: p.lastContacted || "", max: t });
    const notes = el("textarea", { id: "ed-notes", rows: "4", placeholder: "Private notes: kids' names, what they are into, how they like to be reached." });
    notes.value = p.notes;
    const topics = el("textarea", { id: "ed-topics", rows: "3", placeholder: "One per line, e.g. How the new job is going" });
    topics.value = p.topics.join("\n");
    const dateRows = el("div", { id: "ed-dates" });
    const addDateRow = (d) => {
      const row = el("div", { class: "date-row" },
        el("select", { "aria-label": "Kind of date", class: "d-kind" },
          K.DATE_KINDS.map((k) => el("option", { value: k, selected: (d ? d.kind : "birthday") === k }, k))),
        el("input", { "aria-label": "Label", class: "d-label", value: d ? d.label : "", placeholder: "Label" }),
        el("input", { "aria-label": "Date (YYYY-MM-DD, or MM-DD if you do not know the year)", class: "d-date", value: d ? d.date : "", placeholder: "YYYY-MM-DD or MM-DD" }),
        el("button", { class: "small", type: "button", "aria-label": "Remove this date", onclick: () => row.remove() }, "×"));
      dateRows.append(row);
    };
    p.dates.forEach(addDateRow);
    const editForm = el("form", { class: "card", id: "edit-form", onsubmit: (e) => {
      e.preventDefault();
      const dates = [...dateRows.querySelectorAll(".date-row")].map((r, i) => ({
        id: "d" + (i + 1),
        kind: r.querySelector(".d-kind").value,
        label: r.querySelector(".d-label").value,
        date: r.querySelector(".d-date").value.trim(),
      })).filter((d) => d.date);
      attempt((st) => K.updatePerson(st, p.id, {
        name: name.value,
        cadence: rf.sel.value,
        cadenceDays: rf.sel.value === "custom" ? rf.days.value : undefined,
        lastContacted: last.value || null,
        notes: notes.value,
        topics: topics.value.split("\n"),
        dates,
      }), "Saved.");
    } },
      el("h3", {}, "Details"),
      el("label", { for: "ed-name" }, "Name"), name,
      el("label", { for: "ed-cadence" }, "A hello every"), rf.sel, rf.wrap,
      el("label", { for: "ed-last" }, "Last talked"), last,
      el("label", { for: "ed-notes" }, "Private notes"), notes,
      el("label", { for: "ed-topics" }, "Things to ask about next time"), topics,
      el("p", { class: "lbl" }, "Important dates ", el("span", { class: "hint" }, "(they repeat every year)")), dateRows,
      el("button", { class: "small", type: "button", onclick: () => addDateRow(null) }, "+ Add a date"),
      el("div", {}, el("button", { class: "btn", type: "submit" }, "Save details")));

    // Quiet controls
    const controls = el("section", { class: "card controls" },
      el("h3", {}, "Reminders"),
      el("p", { class: "meta", text: s.text }),
      el("div", { class: "acts" },
        p.snoozedUntil && K.diffDays(t, p.snoozedUntil) > 0
          ? el("button", { class: "small", type: "button", onclick: () => attempt((st) => K.unsnooze(st, p.id), "Snooze ended.") }, "End snooze")
          : snoozeSelect(p.id),
        el("button", { class: "small", type: "button", onclick: () => {
          const before = state;
          attempt((st) => K.setPaused(st, p.id, !p.paused),
            p.paused ? `Reminders back on for ${p.name}.` : `Reminders paused for ${p.name}. Notes stay.`, () => commit(before));
        } }, p.paused ? "Resume reminders" : "Pause reminders"),
        el("button", { class: "small danger", type: "button", onclick: () => removeWithUndo(p.id) }, "Remove")),
      el("p", { class: "hint" }, "Snooze and pause are quiet: nothing counts against anyone, and nothing keeps score."));

    box.replaceChildren(
      el("div", { class: "detail-head" },
        el("button", { class: "small", type: "button", id: "back", onclick: () => { openId = null; render(); } }, "← Everyone"),
        el("h2", { text: p.name }),
        el("span", { class: "st " + s.cls, text: s.tag })),
      el("div", { class: "detail-grid" },
        el("div", {}, prepCard, logForm),
        el("div", {}, editForm, controls)));
  }

  function removeWithUndo(id) {
    let removed;
    const before = state;
    try { ({ removed } = K.removePerson(state, id)); } catch (e) { notify(e.message, { kind: "warn" }); return; }
    openId = null;
    commit(K.removePerson(state, id).state, `Removed ${removed.name} and their notes.`, () => commit(before));
  }

  function copyText(text, btn) {
    const done = () => { btn.textContent = "Copied"; setTimeout(() => { btn.textContent = "Copy"; }, 1500); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, () => notify("Could not copy. Select the text and copy it yourself.", { kind: "warn" }));
    } else notify("Copy is not available here. Select the text and copy it yourself.", { kind: "warn" });
  }

  // ---------- Dates ----------
  function renderDates() {
    const t = today();
    const items = K.upcomingDates(state.people, t, 60);
    const list = $("dates-list");
    if (!items.length) {
      list.replaceChildren(el("li", { class: "empty" }, "No birthdays or anniversaries in the next 60 days. Add them on a person's page."));
      return;
    }
    list.replaceChildren(...items.map((d) => el("li", {},
      el("button", { class: "person-open", type: "button", onclick: () => { openId = d.personId; setTab("people"); } },
        el("span", { class: "who" }, el("b", { text: d.name }), el("span", { class: "st date", text: d.kind }),
          el("span", { class: "meta", text: d.text }))))));
  }

  // ---------- Your data ----------
  function download(name, text, type) {
    const a = el("a", { href: URL.createObjectURL(new Blob([text], { type })), download: name });
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }

  function renderData() {
    const real = state.people.filter((p) => !p.demo).length;
    $("data-status").textContent = (storageOK ? "Saved in this browser on this device only. " : "This browser is not letting the page save, so changes last until you close the tab. ") +
      `${real} ${real === 1 ? "person" : "people"}` + (hasDemo() ? ", plus the sample people." : ".");
    $("demo-load").hidden = hasDemo();
    $("demo-clear").hidden = !hasDemo();
    $("recovery").hidden = !recoveryRaw && !storeGet(KEY_RECOVERY);
    renderVcfPick();
  }

  function render() {
    if (tab === "week") renderWeek();
    if (tab === "people") renderPeople();
    if (tab === "dates") renderDates();
    if (tab === "data") renderData();
    $("count-people").textContent = state.people.length ? `(${state.people.length})` : "";
  }

  // ---------- events ----------
  function wire() {
    for (const name of TABS) $("tab-" + name).addEventListener("click", () => { if (name !== "people") openId = null; setTab(name); });
    $("tabs").addEventListener("keydown", (e) => {
      const i = TABS.indexOf(tab);
      if (e.key === "ArrowRight") setTab(TABS[(i + 1) % TABS.length], true);
      else if (e.key === "ArrowLeft") setTab(TABS[(i + TABS.length - 1) % TABS.length], true);
      else return;
      e.preventDefault();
    });

    $("capacity").addEventListener("change", (e) => attempt((s) => K.setCapacity(s, +e.target.value)));

    const rf = rhythmFields("add", null);
    $("add-rhythm").replaceChildren(rf.sel, rf.wrap);
    $("add-last").max = today();
    $("add").addEventListener("submit", (e) => {
      e.preventDefault();
      const bday = $("add-bday").value.trim();
      const ok = attempt((s) => K.addPerson(s, {
        name: $("add-name").value,
        cadence: rf.sel.value,
        cadenceDays: rf.sel.value === "custom" ? rf.days.value : undefined,
        lastContacted: $("add-last").value || null,
        dates: bday ? [{ kind: "birthday", label: "Birthday", date: bday }] : [],
        createdAt: today(),
      }, genId), `Added ${$("add-name").value.trim()}.`);
      if (ok) { $("add-name").value = ""; $("add-last").value = ""; $("add-bday").value = ""; $("add-name").focus(); }
    });

    $("start-add").addEventListener("click", () => { setTab("people"); $("add-name").focus(); });
    $("start-demo").addEventListener("click", loadDemo);
    $("demo-load").addEventListener("click", loadDemo);
    $("demo-clear").addEventListener("click", clearDemo);
    $("week-demo-clear").addEventListener("click", clearDemo);

    $("export").addEventListener("click", () => {
      download(`keep-in-touch-${today()}.json`, K.exportState(state, today()), "application/json");
      notify("Exported. The file is yours: keep it somewhere private. Sample people are not included.");
    });

    $("import-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const file = $("import-file").files[0];
      if (!file) { notify("Choose a .json or .csv file first.", { kind: "warn" }); return; }
      const mode = $("import-form").querySelector("input[name=mode]:checked").value;
      if (mode === "replace" && state.people.length &&
        !confirm(`Replace everyone (${state.people.length}) with the people in ${file.name}? Export first if you want a copy.`)) return;
      const reader = new FileReader();
      reader.onerror = () => notify("Could not read that file.", { kind: "warn" });
      reader.onload = () => {
        let r;
        try { r = K.importText(reader.result, state, mode, genId); }
        catch (err) { showImportReport(null, err.message); return; }
        const before = state;
        commit(r.state, `Imported: ${r.added} added, ${r.updated} updated, ${r.skipped.length} skipped.`, () => commit(before));
        showImportReport(r);
        $("import-file").value = "";
      };
      reader.readAsText(file);
    });

    $("delete-form").addEventListener("submit", (e) => {
      e.preventDefault();
      if ($("delete-confirm").value.trim().toUpperCase() !== "DELETE") {
        notify('Type DELETE to confirm. Nothing was removed.', { kind: "warn" });
        return;
      }
      for (const k of [KEY, KEY_V1, KEY_RECOVERY, TAB_KEY]) storeDel(k);
      recoveryRaw = null;
      openId = null;
      $("delete-confirm").value = "";
      state = K.createState();
      render();
      notify("Everything is deleted from this browser. There is no copy anywhere else unless you exported one.", { sticky: true });
    });

    $("vcf-file").addEventListener("change", (e) => { const f = e.target.files[0]; if (f) readVcf(f); });
    for (const id of ["ics-dates", "ics-dates-top"]) $(id).addEventListener("click", exportDatesICS);
    for (const id of ["ics-week", "ics-week-top"]) $(id).addEventListener("click", exportWeekICS);

    $("recovery-download").addEventListener("click", () => {
      download(`keep-in-touch-recovered-${today()}.txt`, recoveryRaw || storeGet(KEY_RECOVERY) || "", "text/plain");
    });
    $("recovery-dismiss").addEventListener("click", () => { storeDel(KEY_RECOVERY); recoveryRaw = null; render(); });
  }

  // ---------- contacts in (.vcf) ----------
  // The parsed file lives only in memory until the person picks who to add.
  let vcf = null; // { file, contacts, skipped, checked: Set<key> }

  function dateSummary(d) {
    const iso = d.date.length === 5 ? "2000-" + d.date : d.date;
    return `${d.label} ${K.formatDate(iso)}`;
  }

  function renderVcfPick() {
    const box = $("vcf-pick");
    if (!vcf) { box.hidden = true; box.replaceChildren(); return; }
    const matched = IO.matchContacts(vcf.contacts, state.people);
    const q = vcf.filter.trim().toLowerCase();
    const shown = matched.filter((c) => (!q || c.name.toLowerCase().includes(q)) && (!vcf.datesOnly || c.dates.length));
    const selectable = (c) => !c.existingId || c.newDates.length > 0;
    const picked = matched.filter((c) => vcf.checked.has(c.key) && selectable(c));
    const newCount = picked.filter((c) => !c.existingId).length;
    const dateCount = picked.filter((c) => c.existingId).reduce((n, c) => n + c.newDates.length, 0);

    const search = el("input", { type: "search", id: "vcf-filter", placeholder: "Find a name", "aria-label": "Find a name", value: vcf.filter });
    search.addEventListener("input", () => { vcf.filter = search.value; renderVcfPick(); $("vcf-filter").focus(); });
    const datesOnly = el("input", { type: "checkbox", id: "vcf-dates-only", checked: vcf.datesOnly });
    datesOnly.addEventListener("change", () => { vcf.datesOnly = datesOnly.checked; renderVcfPick(); });
    const rf = rhythmFields("vcf", { cadence: vcf.cadence, cadenceDays: vcf.cadenceDays });
    rf.sel.addEventListener("change", () => { vcf.cadence = rf.sel.value; });
    rf.days.addEventListener("input", () => { vcf.cadenceDays = rf.days.value; });

    const rows = shown.map((c) => {
      const can = selectable(c);
      const box = el("input", { type: "checkbox", value: c.key, checked: can && vcf.checked.has(c.key), disabled: !can,
        "aria-label": c.name });
      box.addEventListener("change", () => { box.checked ? vcf.checked.add(c.key) : vcf.checked.delete(c.key); renderVcfPick(); });
      const meta = c.existingId
        ? (c.newDates.length ? `Already in your list. Adds ${c.newDates.map(dateSummary).join(", ")}.` : "Already in your list, nothing new to add.")
        : (c.dates.length ? c.dates.map(dateSummary).join(", ") : "No dates in this contact.");
      return el("li", {}, el("label", {}, box, el("span", {}, el("b", { text: c.name }), el("span", { class: "meta", text: meta }))));
    });

    box.replaceChildren(
      el("p", { id: "vcf-summary" }, `${vcf.contacts.length} contacts in ${vcf.file}` +
        (vcf.skipped.length ? `, ${vcf.skipped.length} without a name skipped.` : ".") + " Nothing is added until you choose."),
      el("div", { class: "pick-tools" }, search,
        el("label", { class: "check-row" }, datesOnly, " Only contacts with dates"),
        el("button", { class: "small", type: "button", id: "vcf-all", onclick: () => { shown.filter(selectable).forEach((c) => vcf.checked.add(c.key)); renderVcfPick(); } }, "Select shown"),
        el("button", { class: "small", type: "button", id: "vcf-none", onclick: () => { vcf.checked.clear(); renderVcfPick(); } }, "Clear")),
      el("ul", { class: "pick-list", id: "vcf-list", "aria-label": "Contacts in the file" },
        rows.length ? rows : el("li", { class: "empty" }, "No contacts match.")),
      el("label", { for: "vcf-cadence" }, "New people get a hello every"), rf.sel, rf.wrap,
      el("div", { class: "acts" },
        el("button", { class: "btn", type: "button", id: "vcf-apply", disabled: !picked.length, onclick: applyVcf },
          picked.length ? `Add ${newCount} ${newCount === 1 ? "person" : "people"}` + (dateCount ? ` and ${dateCount} ${dateCount === 1 ? "date" : "dates"}` : "") : "Choose who to add"),
        el("button", { class: "small", type: "button", id: "vcf-cancel", onclick: () => { vcf = null; $("vcf-file").value = ""; renderVcfPick(); } }, "Cancel")));
    box.hidden = false;
  }

  function applyVcf() {
    const picked = vcf.contacts.filter((c) => vcf.checked.has(c.key));
    const rhythm = { cadence: vcf.cadence, cadenceDays: vcf.cadence === "custom" ? vcf.cadenceDays : undefined };
    const before = state;
    let r;
    try { r = IO.applyContacts(state, picked, rhythm, genId, today()); }
    catch (e) { notify(e.message, { kind: "warn" }); return; }
    vcf = null;
    $("vcf-file").value = "";
    const parts = [`${r.added} ${r.added === 1 ? "person" : "people"} added`];
    if (r.datesAdded) parts.push(`${r.datesAdded} ${r.datesAdded === 1 ? "date" : "dates"} added to people already in your list`);
    commit(r.state, parts.join(", ") + ".", () => commit(before));
  }

  function readVcf(file) {
    const reader = new FileReader();
    reader.onerror = () => notify("Could not read that file.", { kind: "warn" });
    reader.onload = () => {
      try {
        const { contacts, skipped } = IO.parseVCards(reader.result);
        vcf = { file: file.name, contacts, skipped, checked: new Set(), filter: "", datesOnly: false, cadence: "monthly", cadenceDays: "21" };
      } catch (e) { vcf = null; notify(e.message, { kind: "warn" }); }
      renderVcfPick();
    };
    reader.readAsText(file);
  }

  // ---------- calendar out (.ics) ----------
  function exportDatesICS() {
    const r = IO.datesToICS(state.people, today());
    if (!r.count) { notify(hasDemo() ? "No dates to add yet. Sample people are left out of calendar files." : "No dates to add yet. Add a birthday on someone's page first.", { kind: "warn" }); return; }
    download(`keep-in-touch-dates-${today()}.ics`, r.text, "text/calendar");
    notify(`Downloaded ${r.count} ${r.count === 1 ? "date" : "dates"}. Open the file with your calendar app. Each one repeats every year.`);
  }

  function exportWeekICS() {
    const r = IO.planToICS(state.people, today(), state.settings.weeklyCapacity);
    if (!r.count) { notify(hasDemo() ? "Nothing planned to add. Sample people are left out of calendar files." : "Nothing planned this week, so there is nothing to add.", { kind: "warn" }); return; }
    download(`keep-in-touch-week-${today()}.ics`, r.text, "text/calendar");
    notify(`Downloaded ${r.count} ${r.count === 1 ? "hello" : "hellos"} for this week. Open the file with your calendar app.`);
  }

  function showImportReport(r, error) {
    const box = $("import-report");
    if (error) {
      box.replaceChildren(el("p", { class: "warn-text" }, "Nothing was imported. ", error));
    } else {
      box.replaceChildren(
        el("p", {}, `${r.added} added, ${r.updated} updated, ${r.skipped.length} skipped.`),
        r.skipped.length ? el("ul", { class: "plain" }, r.skipped.map((s) => el("li", {}, `Row ${s.row}${s.name ? " (" + s.name + ")" : ""}: ${s.reason}`))) : null);
    }
    box.hidden = false;
  }

  function loadDemo() {
    const before = state;
    const existing = new Set(state.people.map((p) => p.id));
    const demo = K.migrate({ version: 2, people: F.demoPeople(today()) }, genId).people.filter((p) => !existing.has(p.id));
    commit({ ...state, people: [...state.people, ...demo] }, "Loaded nine sample people. Remove them any time from This week or Your data.", () => commit(before));
    setTab("week");
  }

  function clearDemo() {
    const before = state;
    commit({ ...state, people: state.people.filter((p) => !p.demo) }, "Sample people removed.", () => commit(before));
  }

  // ---------- other tabs ----------
  // Another tab of this page saved. Reload from storage so this tab's next
  // change builds on that save instead of overwriting it.
  window.addEventListener("storage", (e) => {
    if (e.key !== KEY && e.key !== null) return;
    state = load();
    if (openId && !find(openId)) openId = null;
    render();
    notify("Updated with changes made in another tab.");
  });

  // ---------- boot ----------
  state = load();
  wire();
  if (!storageOK) {
    notify("This browser is blocking storage, so nothing will be kept after you close the tab. Export to keep a copy.", { kind: "warn", sticky: true });
  } else if (recoveryRaw) {
    notify("Your saved data could not be read, so the tool started fresh. A copy of the unreadable data is kept: see Your data to download it.", { kind: "warn", sticky: true });
  }
  setTab(storeGet(TAB_KEY) || "week");
})();
