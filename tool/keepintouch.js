// Keep in Touch — the brain. Pure, dependency-free, deterministic.
// Given people (name, cadence, optional lastContacted ISO date) and today's
// date, say who you are overdue to reach out to, most overdue first.
// Shared by the HTML UI (localStorage) and the Node tests.

const CADENCES = {
  weekly: 7,
  biweekly: 14,
  monthly: 30,
  quarterly: 91,
  semiannually: 182,
  annually: 365,
};

function daysBetween(a, b) {
  const ms = Math.abs(Date.parse(b) - Date.parse(a));
  return Math.round(ms / 86400000);
}

function dueContacts(people, today) {
  const scored = (people || []).map((p) => {
    const interval = CADENCES[p.cadence];
    if (!interval) {
      throw new Error(
        `Unknown cadence "${p.cadence}" for ${p.name}. Use one of: ${Object.keys(CADENCES).join(", ")}.`
      );
    }
    if (!p.lastContacted) {
      // never contacted — highest priority, its own status
      return { ...p, status: "new", overdueBy: 0, _sort: Infinity };
    }
    const since = daysBetween(p.lastContacted, today);
    const overdueBy = Math.max(0, since - interval);
    const status = overdueBy > 0 ? "overdue" : "ok";
    return { ...p, status, overdueBy, _sort: since - interval };
  });
  scored.sort((a, b) => b._sort - a._sort);
  return scored.map(({ _sort, ...rest }) => rest);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { CADENCES, dueContacts, daysBetween };
}
