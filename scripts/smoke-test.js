/**
 * End-to-end check against a running server. Start it first, then:
 *   npm test
 *
 * This exercises the API directly rather than the browser, because the point
 * is to prove the rules hold even when the request doesn't come from our
 * own interface. Run it against a scratch database, not production.
 */
const BASE = process.env.TEST_BASE || `http://localhost:${process.env.PORT || 3000}`;
const PASSWORD = process.env.SEED_PASSWORD || "controlcenter1";

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail ? "  :: " + detail : "")); }
};

/** A tiny cookie-carrying client, one per signed-in person. */
function client() {
  let cookie = "";
  return async function call(method, path, body) {
    const r = await fetch(BASE + path, {
      method,
      headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual"
    });
    const set = r.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    let data = null;
    try { data = await r.json(); } catch { /* not json */ }
    return { status: r.status, data };
  };
}
const login = async (call, username) => (await call("POST", "/api/auth/login", { username, password: PASSWORD })).status;

console.log(`\nTeam Control Center — API checks against ${BASE}\n`);

/* ------------------------------------------------------------- anonymous */
const anon = client();
ok("anonymous cannot read the board", (await anon("GET", "/api/bootstrap")).status === 401);
ok("anonymous cannot write a task", (await anon("PUT", "/api/tasks/TSK-0001", { title: "x" })).status === 401);
ok("wrong password is rejected",
   (await anon("POST", "/api/auth/login", { username: "roshani.shinde", password: "nope" })).status === 401);

/* ---------------------------------------------------------------- manager */
const mgr = client();
ok("manager signs in", await login(mgr, "roshani.shinde") === 200);
const boot = await mgr("GET", "/api/bootstrap");
ok("bootstrap returns the whole board",
   boot.status === 200 && boot.data.tasks.length > 25 && boot.data.employees.length === 19,
   `tasks=${boot.data?.tasks?.length} people=${boot.data?.employees?.length}`);
ok("password hashes never leave the server",
   !JSON.stringify(boot.data).match(/password_hash|\$2[aby]\$/));

const ravi = boot.data.employees.find(e => e.name === "Wilson Fernandes");
const mira = boot.data.employees.find(e => e.name === "Moinul Khan");

/* ------------------------------------------------------------- validation */
let r = await mgr("POST", "/api/tasks", { title: "", assigneeId: ravi.id, priority: "MEDIUM", status: "NOT_STARTED", progress: 0 });
ok("a task with no title is refused", r.status === 422 && !!r.data.fields.title);

r = await mgr("POST", "/api/tasks", { title: "Critical with no target", assigneeId: ravi.id, priority: "CRITICAL", status: "NOT_STARTED", progress: 0 });
ok("a critical task needs an expected completion date", r.status === 422 && !!r.data.fields.expectedCompletion);

r = await mgr("POST", "/api/tasks", { title: "Backwards dates", assigneeId: ravi.id, priority: "MEDIUM", status: "NOT_STARTED", progress: 0, startDate: "2026-09-20", dueDate: "2026-09-10" });
ok("a due date before the start date is refused", r.status === 422 && !!r.data.fields.dueDate);

r = await mgr("POST", "/api/tasks", { title: "Done but not done", assigneeId: ravi.id, priority: "MEDIUM", status: "COMPLETED", progress: 40 });
ok("a completed task is forced to 100%", r.status === 201 && r.data.task.progress === 100 && !!r.data.task.completedAt);
const forced = r.data.task.id;

r = await mgr("POST", "/api/tasks", { title: "Blocked with no reason", assigneeId: ravi.id, priority: "MEDIUM", status: "BLOCKED", progress: 10 });
ok("a blocked task must say what is blocking it", r.status === 422 && !!r.data.fields.blocker);

/* ------------------------------------------------------------- happy path */
r = await mgr("POST", "/api/tasks", {
  title: "Verify furnace landing page tracking", description: "Before the budget step-up.",
  assigneeId: ravi.id, projectId: "prj-q4-heating", category: "Audit",
  priority: "HIGH", status: "NOT_STARTED", progress: 0,
  startDate: new Date().toISOString().slice(0, 10),
  dueDate: new Date(Date.now() + 6 * 864e5).toISOString().slice(0, 10),
  expectedCompletion: new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10),
  estimatedHours: 5
});
ok("manager creates and assigns a task", r.status === 201 && r.data.task.assigneeId === ravi.id, JSON.stringify(r.data).slice(0, 120));
const TASK = r.data.task.id;
ok("the server mints sequential ids", /^TSK-\d{4}$/.test(TASK), TASK);
ok("creation is recorded in the audit trail", r.data.task.activity.some(a => a.kind === "create"));
ok("department follows the assignee", r.data.task.departmentId === ravi.departmentId);

/* ------------------------------------------------------------- employee */
const emp = client();
ok("employee signs in", await login(emp, "wilson.fernandes") === 200);

r = await emp("PATCH", `/api/tasks/${TASK}`, { progress: 50, status: "IN_PROGRESS", actualHours: 3 });
ok("employee updates their own task", r.status === 200 && r.data.task.progress === 50);
ok("the progress change is in the history",
   r.data.task.activity.some(a => a.field === "progress" && a.to === "50"),
   JSON.stringify(r.data.task.activity.slice(-2)));

r = await emp("PATCH", `/api/tasks/${TASK}`, { dueDate: "2027-01-01" });
ok("employee CANNOT move a deadline",
   r.status === 200 && r.data.task.dueDate !== "2027-01-01" && r.data.denied.includes("dueDate"),
   `due=${r.data.task?.dueDate} denied=${r.data.denied}`);

r = await emp("PATCH", `/api/tasks/${TASK}`, { assigneeId: mira.id });
ok("employee CANNOT reassign work",
   r.status === 200 && r.data.task.assigneeId === ravi.id && r.data.denied.includes("assigneeId"));

const miraTask = boot.data.tasks.find(t => t.assigneeId === mira.id && t.status !== "COMPLETED");
r = await emp("PATCH", `/api/tasks/${miraTask.id}`, { progress: 100, status: "COMPLETED" });
ok("employee CANNOT touch someone else's task", r.status === 403, `got ${r.status}`);

r = await emp("POST", `/api/tasks/${miraTask.id}/complete`);
ok("employee CANNOT complete someone else's task", r.status === 403, `got ${r.status}`);

r = await emp("PUT", "/api/config", { workload: { normal: 1, high: 2, overloaded: 3 } });
ok("employee CANNOT change settings", r.status === 403);

r = await emp("PUT", `/api/employees/${ravi.id}`, { name: "Wilson Fernandes", username: "wilson.fernandes", role: "manager" });
ok("employee CANNOT promote themselves", r.status === 403);

r = await emp("DELETE", `/api/tasks/${TASK}`);
ok("employee CANNOT delete a task", r.status === 403);

/* --------------------------------------------------------------- blockers */
r = await emp("PATCH", `/api/tasks/${TASK}`, {
  status: "BLOCKED",
  blocker: { reason: "No admin access to the analytics property", cause: "Account owner",
             since: new Date().toISOString().slice(0, 10), needsManager: true, resolvedAt: null }
});
ok("employee reports a blocker", r.status === 200 && r.data.task.status === "BLOCKED" && r.data.task.blocker.needsManager);
ok("the blocker is written to the history", r.data.task.activity.some(a => a.kind === "block"));

r = await emp("POST", `/api/tasks/${TASK}/comments`, { body: "Ticket raised with the host.", managerNote: true });
ok("an employee's comment cannot masquerade as a manager note",
   r.status === 200 && r.data.task.comments.slice(-1)[0].managerNote === false);
ok("the comment is attributed to the author",
   r.data.task.comments.slice(-1)[0].authorId === ravi.id);

/* --------------------------------------------------------- daily updates */
const today = new Date().toISOString().slice(0, 10);
r = await emp("PUT", `/api/updates/${today}`, { current: "Conversion tracking audit", blocked: "Analytics admin access" });
ok("employee posts a daily update", r.status === 200);
r = await emp("PUT", `/api/updates/${today}`, { employeeId: mira.id, current: "Not mine to post" });
const mirasToday = (r.data.updates || []).find(u => u.employeeId === mira.id);
ok("an employee's update cannot be filed under someone else",
   !mirasToday || !mirasToday.entries.some(e => e.date === today && e.current === "Not mine to post"));

r = await emp("PUT", `/api/updates/${today}`, {});
ok("an empty update is refused", r.status === 422);

/* -------------------------------------------------------- manager powers */
r = await mgr("PATCH", `/api/tasks/${TASK}`, { dueDate: "2027-01-01" });
ok("manager CAN move a deadline", r.status === 200 && r.data.task.dueDate === "2027-01-01");
r = await mgr("PATCH", `/api/tasks/${TASK}`, { assigneeId: mira.id });
ok("manager CAN reassign", r.status === 200 && r.data.task.assigneeId === mira.id);
ok("the reassignment is in the history", r.data.task.activity.some(a => a.kind === "reassign"));

r = await mgr("POST", "/api/tasks/bulk", { ids: [TASK, forced], patch: { priority: "LOW" }, note: "Deprioritised for now." });
ok("bulk update applies to every selected task", r.status === 200 && r.data.updated.length === 2, JSON.stringify(r.data));

r = await mgr("PUT", "/api/config", { workload: { normal: 30, high: 10, overloaded: 5 } });
ok("settings with impossible workload bands are refused", r.status === 422);

r = await mgr("PUT", "/api/config", { statuses: [{ id: "NOT_STARTED", label: "Not started", kind: "open" }] });
ok("a status still in use cannot be deleted", r.status === 409 || r.status === 422, `got ${r.status}`);

r = await mgr("PUT", `/api/employees/emp-new-person`, { name: "Test Person", username: "test.person", role: "employee", departmentId: "mkt", teamId: "seo" });
ok("manager adds a person and gets a one-time password", r.status === 200 && !!r.data.temporaryPassword && r.data.employee.username === "test.person");
const TEMP_PW = r.data.temporaryPassword;
r = await mgr("PUT", `/api/employees/emp-new-person-2`, { name: "Clash", username: "test.person" });
ok("a duplicate User ID is auto-disambiguated, not refused",
   r.status === 200 && r.data.employee.username === "test.person2", `got ${r.status} username=${r.data.employee?.username}`);
// the seed has two managers; demote every OTHER manager first (never the one this
// client is signed in as, until the very last step) so the "last manager" guard
// can actually be exercised without losing our own manager session along the way
const seedManagers = boot.data.employees.filter(e => e.role === "manager");
const self = seedManagers.find(e => e.name === "Roshani Shinde");
for (const m of seedManagers.filter(e => e.id !== self.id)) {
  await mgr("PUT", `/api/employees/${m.id}`, { name: m.name, username: m.username, role: "employee" });
}
r = await mgr("PUT", `/api/employees/${self.id}`, { name: self.name, username: self.username, role: "employee" });
ok("the last manager cannot demote themselves", r.status === 409, `got ${r.status}`);

r = await mgr("DELETE", `/api/tasks/${forced}`);
ok("manager CAN delete a task", r.status === 200);

/* ------------------------------------------------------------- passwords */
const fresh = client();
r = await fresh("POST", "/api/auth/login", { username: "test.person", password: TEMP_PW });
ok("a new person signs in with their temporary password", r.status === 200);
ok("they are told to change it", r.data.me && r.data.me.mustChangePassword === true);
r = await fresh("POST", "/api/auth/password", { current: "wrong", next: "a-much-longer-password" });
ok("changing a password needs the current one", r.status === 400);
r = await fresh("POST", "/api/auth/password", { current: TEMP_PW, next: "short" });
ok("a short password is refused", r.status === 400);
r = await fresh("POST", "/api/auth/password", { current: TEMP_PW, next: "a-much-longer-password" });
ok("a valid password change succeeds", r.status === 200);
r = await fresh("GET", "/api/bootstrap");
ok("the prompt clears once the password is their own", r.status === 200 && r.data.me.mustChangePassword === false);

/* --------------------------------------------------------------- logout */
r = await emp("POST", "/api/auth/logout");
ok("logout succeeds", r.status === 200);
r = await emp("GET", "/api/bootstrap");
ok("the session is dead after logout", r.status === 401);

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
