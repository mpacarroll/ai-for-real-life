// Synthetic sample people for the demo and the tests. Every name, note and
// date here is invented. Dates are offsets from "today" so the sample always
// shows a realistic week: someone due, a birthday coming up, a snooze, a pause.
(function (root) {
  "use strict";
  const K = typeof module !== "undefined" && module.exports ? require("./keepintouch.js") : root.KIT;

  function mmdd(today, offset) {
    return K.addDays(today, offset).slice(5);
  }

  function demoPeople(today) {
    const d = (n) => K.addDays(today, -n);
    return [
      {
        id: "demo-mom", name: "Mom", cadence: "weekly", lastContacted: d(9),
        notes: "Calls are best after 7pm her time. Prefers a call to a text.",
        topics: ["The new tomato beds"],
        dates: [{ id: "d1", kind: "birthday", label: "Birthday", date: `1958-${mmdd(today, 3)}` }],
        log: [{ date: d(9), note: "She is planting tomatoes this year and wants seed tips." }],
      },
      {
        id: "demo-sam", name: "Sam Okafor", cadence: "quarterly", lastContacted: d(120),
        notes: "College roommate. Moved to Denver for the hospital job.",
        topics: ["How the new job at the hospital is going"],
        log: [{ date: d(120), note: "Just started nights on the cardiac ward." }],
      },
      {
        id: "demo-priya", name: "Priya Raman", cadence: "monthly",
        notes: "Met at the old job. Loves trail running.",
        topics: [],
      },
      {
        id: "demo-joe", name: "Uncle Joe", cadence: "monthly", lastContacted: d(12),
        notes: "Fixing up the boat again.",
        log: [{ date: d(12), note: "The boat engine finally runs." }],
      },
      {
        id: "demo-lena", name: "Lena and Marco", cadence: "semiannually", lastContacted: d(150),
        dates: [{ id: "d1", kind: "anniversary", label: "Their anniversary", date: `2016-${mmdd(today, 5)}` }],
        notes: "Neighbors from the old street.",
      },
      {
        id: "demo-tom", name: "Tom Becker", cadence: "biweekly", lastContacted: d(30),
        snoozedUntil: K.addDays(today, 10),
        notes: "Busy with the move until next week.",
        topics: ["The move to the new place"],
      },
      {
        id: "demo-ava", name: "Ava Lindqvist", cadence: "custom", cadenceDays: 45, lastContacted: d(50),
        notes: "Book club friend.", topics: ["What she thought of the last book"],
      },
      {
        id: "demo-grandpa", name: "Grandpa Ray", cadence: "weekly", lastContacted: d(3),
        notes: "Sunday calls are a standing thing.",
      },
      {
        id: "demo-kim", name: "Kim from the climbing gym", cadence: "monthly", lastContacted: d(60),
        paused: true, notes: "Taking a break from climbing. Paused on purpose.",
      },
    ].map((p) => ({ ...p, demo: true }));
  }

  const api = { demoPeople };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.KIT_FIXTURES = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
