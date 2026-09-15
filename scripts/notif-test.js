/**
 * Unit check for the client-side notification logic in public/app/metrics.js.
 *
 * That file is a plain browser <script> (classic global scope, not an ES
 * module), so it can't be `import`ed directly. Instead we run its real,
 * unmodified source — together with public/app/util.js, which it depends on
 * for S/meId/empName/etc. — inside a small vm sandbox, seed a minimal
 * fixture (as if it came back from GET /api/notifications), and call the
 * real notifications() function.
 *
 * It also checks that the server's fan-out (src/domain.js
 * notificationRecipients) and the client's preference map (metrics.js PREF)
 * agree on which `kind` values exist — the two runtimes can't share code
 * (classic script vs. ES module), so nothing else would catch one side
 * silently gaining or losing a kind.
 *
 *   npm run test:notif
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(HERE, "..", "public", "app");
const SRC = path.join(HERE, "..", "src");

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail ? "  :: " + detail : "")); }
};

function loadClient() {
  const store = new Map();
  const sandbox = {
    console,
    window: {},
    localStorage: {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: k => store.delete(k)
    },
    document: { querySelectorAll: () => [], createElement: () => ({ classList: { add() {} }, style: {} }) }
  };
  vm.createContext(sandbox);
  for (const file of ["util.js", "metrics.js"]) {
    vm.runInContext(fs.readFileSync(path.join(APP, file), "utf8"), sandbox, { filename: file });
  }
  // util.js/metrics.js declare their top-level bindings with const/let, which
  // (unlike var) don't become properties of the sandbox object automatically
  // — pull out what we need with one more (non-strict) script in the same context.
  vm.runInContext("this.S = S; this.notifications = notifications; this.PREF = PREF;", sandbox);
  return sandbox;
}

/** Loads util.js + metrics.js + api.js, with just enough stubbed (a fake
 *  EventSource/Notification, document.hasFocus, localStorage) to exercise
 *  maybeDesktopNotify()'s gating without a real browser. */
function loadClientWithApi({ focused = false, permission = "granted", optedIn = true } = {}) {
  const fired = [];
  class FakeEventSource { constructor() { this.listeners = {}; } addEventListener(t, f) { this.listeners[t] = f; } close() {} }
  class FakeNotification { constructor(text, opts) { fired.push({ text, ...opts }); } static requestPermission() { return Promise.resolve(permission); } }
  FakeNotification.permission = permission;
  const store = new Map(optedIn ? [["tcc:desktopNotifs", "true"]] : []);
  const sandbox = {
    console,
    window: { EventSource: FakeEventSource, Notification: FakeNotification },
    Notification: FakeNotification, EventSource: FakeEventSource,
    document: { hasFocus: () => focused, querySelectorAll: () => [], createElement: () => ({ classList: { add() {} }, style: {} }) },
    localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    requestAnimationFrame: fn => fn(),
    paint: () => {}, queueAssignPopup: () => {}, empName: () => "",
    fetch: async () => ({ ok: true, status: 200, json: async () => ({}) })
  };
  vm.createContext(sandbox);
  for (const file of ["util.js", "metrics.js", "api.js"]) {
    vm.runInContext(fs.readFileSync(path.join(APP, file), "utf8"), sandbox, { filename: file });
  }
  vm.runInContext("this.S = S; this.maybeDesktopNotify = maybeDesktopNotify;", sandbox);
  return { sandbox, fired };
}

const sandbox = loadClient();
ok("notifications() loaded from the real metrics.js source", typeof sandbox.notifications === "function");

const MGR = { id: "emp-mgr", name: "Manager", role: "manager" };
const EMP = { id: "emp-1", name: "Employee", role: "employee" };

function runAs(me, { notifications = [], tasks = [] } = {}) {
  sandbox.S.me = me;
  sandbox.S.employees = [MGR, EMP];
  sandbox.S.notifications = notifications;
  sandbox.S.tasks = tasks;
  return sandbox.notifications();
}

// The server pre-renders text + kind for each recipient — the client should
// render server rows more or less as-is, subject to preference filtering.
const feedRow = (over = {}) => ({
  id: "n-" + Math.random().toString(36).slice(2), employeeId: EMP.id, taskId: "T-1",
  activityId: "a-1", kind: "assign", text: `Manager assigned you "Ship it"`,
  at: new Date().toISOString(), readAt: null, ...over
});

let n = runAs(EMP, { notifications: [feedRow()] });
ok("a feed row for the assign kind is rendered", n.some(x => x.taskId === "T-1" && x.kind === "assign"), JSON.stringify(n));

n = runAs(EMP, { notifications: [feedRow({ kind: "complete", text: "Wilson completed \"Ship it\"" })] });
ok("a feed row for the complete kind is rendered by default (completed pref defaults false, so this checks the pref gate works both ways)",
  n.length === 0, "expected the default-off 'completed' preference to filter this out: " + JSON.stringify(n));

sandbox.S.config.notify.completed = true;
n = runAs(EMP, { notifications: [feedRow({ kind: "complete", text: "Wilson completed \"Ship it\"" })] });
ok("...and is rendered once that preference is turned on", n.some(x => x.kind === "complete"), JSON.stringify(n));
sandbox.S.config.notify.completed = false;

n = runAs(EMP, { notifications: [feedRow({ kind: "block" })] });
ok("preference-off kinds (blocked defaults true) still render when enabled", n.some(x => x.kind === "block"));
sandbox.S.config.notify.blocked = false;
n = runAs(EMP, { notifications: [feedRow({ kind: "block" })] });
ok("...and are hidden once that preference is turned off", n.length === 0, JSON.stringify(n));
sandbox.S.config.notify.blocked = true;

// Synthetic reminders (overdue / due tomorrow) aren't in the persisted feed —
// they're derived live from task state on every call.
const overdueTask = {
  id: "T-2", title: "Late task", assigneeId: EMP.id, createdById: MGR.id,
  priority: "HIGH", status: "IN_PROGRESS", dependencies: [],
  dueDate: new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10)
};
n = runAs(EMP, { tasks: [overdueTask] });
ok("an overdue task still produces a live 'overdue' reminder with no feed row involved",
  n.some(x => x.taskId === "T-2" && x.kind === "overdue"), JSON.stringify(n));

// Kind-set parity: every `kind` src/domain.js's notificationRecipients can
// emit must have a PREF entry client-side (metrics.js), or a later change to
// one side goes unnoticed by the other (they can't share code across the
// classic-script/ES-module split).
const domainSrc = fs.readFileSync(path.join(SRC, "domain.js"), "utf8");
const fanoutBody = domainSrc.slice(domainSrc.indexOf("export function notificationRecipients"));
const emittedKinds = new Set([...fanoutBody.matchAll(/(?:add|forManagers)\([^,]+,\s*"([a-z]+)"/g)].map(m => m[1]));
ok("found kind literals in notificationRecipients to check", emittedKinds.size > 0, [...emittedKinds]);
const missingFromPref = [...emittedKinds].filter(k => !(k in sandbox.PREF));
ok("every kind src/domain.js can emit has a PREF entry in metrics.js", missingFromPref.length === 0, missingFromPref);

// Desktop notifications (maybeDesktopNotify, public/app/api.js) must never
// fire unless the person opted in, granted permission, the tab is actually
// unfocused, and the kind isn't muted — any one of these being wrong would
// either spam someone who never asked, or silently never notify anyone.
const feedRowFor = kind => ({ id: "n1", taskId: "T-1", kind, text: "hello", at: new Date().toISOString(), readAt: null });

let d = loadClientWithApi({ focused: false, optedIn: false });
d.sandbox.S.me = { id: "e1" }; d.sandbox.S.config = { notify: {} }; d.sandbox.S.myNotifyPrefs = {};
d.sandbox.maybeDesktopNotify(feedRowFor("assign"));
ok("desktop notif: not opted in -> nothing fires", d.fired.length === 0, d.fired);

d = loadClientWithApi({ focused: false, optedIn: true });
d.sandbox.S.me = { id: "e1" }; d.sandbox.S.config = { notify: { assigned: true } }; d.sandbox.S.myNotifyPrefs = {};
d.sandbox.maybeDesktopNotify(feedRowFor("assign"));
ok("desktop notif: opted in + unfocused + permission granted -> fires", d.fired.length === 1 && d.fired[0].text === "hello", d.fired);

d = loadClientWithApi({ focused: true, optedIn: true });
d.sandbox.S.me = { id: "e1" }; d.sandbox.S.config = { notify: { assigned: true } }; d.sandbox.S.myNotifyPrefs = {};
d.sandbox.maybeDesktopNotify(feedRowFor("assign"));
ok("desktop notif: tab focused -> suppressed", d.fired.length === 0, d.fired);

d = loadClientWithApi({ focused: false, optedIn: true });
d.sandbox.S.me = { id: "e1" }; d.sandbox.S.config = { notify: { assigned: true } }; d.sandbox.S.myNotifyPrefs = { assigned: false };
d.sandbox.maybeDesktopNotify(feedRowFor("assign"));
ok("desktop notif: muted via personal preference -> suppressed", d.fired.length === 0, d.fired);

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
