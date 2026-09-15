/**
 * Unit check for the client-side notification rules in public/app/metrics.js.
 *
 * That file is a plain browser <script> (classic global scope, not an ES
 * module), so it can't be `import`ed directly. Instead we run its real,
 * unmodified source — together with public/app/util.js, which it depends on
 * for S/meId/empName/etc. — inside a small vm sandbox, seed a minimal task
 * fixture, and call the real notifications() function. This exists because
 * a missing kind branch in that if/else chain (e.g. "complete") produces no
 * runtime error anywhere — it just silently never notifies anyone — so
 * nothing except a direct check of its output would catch it.
 *
 *   npm run test:notif
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(HERE, "..", "public", "app");

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail ? "  :: " + detail : "")); }
};

function loadNotifications() {
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
  // — pull out the two we need with one more (non-strict) script in the same context.
  vm.runInContext("this.S = S; this.notifications = notifications;", sandbox);
  return sandbox;
}

const sandbox = loadNotifications();
ok("notifications() loaded from the real metrics.js source", typeof sandbox.notifications === "function");

const MGR = { id: "emp-mgr", name: "Manager", role: "manager" };
const EMP = { id: "emp-1", name: "Employee", role: "employee" };

function runAs(me, tasks) {
  sandbox.S.me = me;
  sandbox.S.employees = [MGR, EMP];
  sandbox.S.tasks = tasks;
  return sandbox.notifications();
}

// Regression fixture for the bug fixed in 8ce436b: a brand-new task created
// already assigned to someone (kind "create", not "assign").
const createTask = {
  id: "T-1", title: "New task", assigneeId: EMP.id, createdById: MGR.id,
  priority: "MEDIUM", status: "NOT_STARTED", dependencies: [],
  activity: [{ at: new Date().toISOString(), byId: MGR.id, kind: "create" }]
};
let n = runAs(EMP, [createTask]);
ok("a brand-new task assigned at creation notifies the assignee",
  n.some(x => x.taskId === "T-1" && x.kind === "assign"), JSON.stringify(n));

// Reassignment to a new, previously-uninvolved assignee (kind "reassign").
const reassignTask = {
  id: "T-2", title: "Moved task", assigneeId: EMP.id, createdById: MGR.id,
  priority: "MEDIUM", status: "NOT_STARTED", dependencies: [],
  activity: [{ at: new Date().toISOString(), byId: MGR.id, kind: "reassign", to: EMP.id }]
};
n = runAs(EMP, [reassignTask]);
ok("a task reassigned to someone notifies the new assignee",
  n.some(x => x.taskId === "T-2" && x.kind === "assign"), JSON.stringify(n));

// A task marked complete (kind "complete") — this toggle exists in Settings
// and in the PREF map but had no notification-rule branch until this change.
const completeTask = {
  id: "T-3", title: "Finished task", assigneeId: EMP.id, createdById: MGR.id,
  priority: "MEDIUM", status: "COMPLETED", dependencies: [],
  activity: [{ at: new Date().toISOString(), byId: EMP.id, kind: "complete" }]
};
sandbox.S.config.notify.completed = true; // default config ships this preference off; flip it on to test the rule itself
n = runAs(MGR, [completeTask]);
ok("a completed task notifies its creator",
  n.some(x => x.taskId === "T-3" && x.kind === "complete"), JSON.stringify(n));

// Sanity: nobody gets notified about their own action.
n = runAs(MGR, [{ ...createTask, id: "T-4", activity: [{ at: new Date().toISOString(), byId: MGR.id, kind: "create" }] }]);
ok("the actor never gets a notification for their own action", n.every(x => x.taskId !== "T-4"));

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
