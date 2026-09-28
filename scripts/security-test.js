/**
 * Security-focused checks against a running server: session/cookie hardening,
 * login throttling (brute force), SQL injection resistance, cross-user
 * authorization boundaries (IDOR), input validation limits, and file upload
 * handling.
 *
 * Complements scripts/smoke-test.js (business rules and day-to-day RBAC)
 * rather than duplicating it — that file already covers who may edit/reassign/
 * delete a task, so this one focuses on things an attacker would actually try:
 * forged cookies, guessed ids, oversized/mistyped uploads, brute-forced
 * logins, SQL injection payloads in auth and record fields, and stale
 * sessions after a password change.
 *
 *   npm start              # in one terminal, against a scratch database
 *   npm run test:security  # in another
 *
 * Creates disposable test employees and deliberately trips the login
 * throttle for one of them — point this at a scratch database, never
 * production, same as smoke-test.js.
 */
const BASE = process.env.TEST_BASE || `http://localhost:${process.env.PORT || 3000}`;
const PASSWORD = process.env.SEED_PASSWORD || "controlcenter1";

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail ? "  :: " + detail : "")); }
};

/** A cookie-carrying client, one per signed-in person. */
function client() {
  let cookie = "";
  const call = async (method, path, body) => {
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
    return { status: r.status, data, setCookie: set, headers: r.headers };
  };
  call.cookie = () => cookie;
  return call;
}
const login = async (call, username, password = PASSWORD) => (await call("POST", "/api/auth/login", { username, password })).status;

/** For requests that need an exact literal Cookie header (forged/garbage/
 *  stale values) instead of whatever a client()'s jar currently holds. */
async function withCookie(method, path, cookieHeader, body) {
  const r = await fetch(BASE + path, {
    method,
    headers: { ...(cookieHeader ? { cookie: cookieHeader } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual"
  });
  let data = null;
  try { data = await r.json(); } catch { /* not json */ }
  return { status: r.status, data, headers: r.headers };
}

console.log(`\nTeam Control Center — security checks against ${BASE}\n`);

/* ------------------------------------------------------------------ setup */
const mgr = client();
ok("manager signs in", await login(mgr, "roshani.shinde") === 200);

let r = await mgr("PUT", "/api/employees/emp-sec-alpha", { name: "Sec Alpha", username: "sec.alpha", role: "employee", departmentId: "mkt", teamId: "seo" });
const alphaPw = r.data.temporaryPassword;
r = await mgr("PUT", "/api/employees/emp-sec-beta", { name: "Sec Beta", username: "sec.beta", role: "employee", departmentId: "mkt", teamId: "content" });
const betaPw = r.data.temporaryPassword;
r = await mgr("PUT", "/api/employees/emp-sec-throttle", { name: "Sec Throttle", username: "sec.throttle", role: "employee", departmentId: "mkt", teamId: "seo" });
const throttlePw = r.data.temporaryPassword;
r = await mgr("PUT", "/api/employees/emp-sec-fixation", { name: "Sec Fixation", username: "sec.fixation", role: "employee", departmentId: "mkt", teamId: "seo" });
const fixationPw = r.data.temporaryPassword;

const alpha = client();
ok("test employee \"alpha\" signs in with their temp password", await login(alpha, "sec.alpha", alphaPw) === 200);
const beta = client();
ok("test employee \"beta\" signs in with their temp password", await login(beta, "sec.beta", betaPw) === 200);

r = await mgr("POST", "/api/tasks", { title: "Security test task", assigneeId: "emp-sec-alpha", priority: "MEDIUM", status: "NOT_STARTED", progress: 0 });
const TASK = r.data.task.id;
ok("setup: a task exists for the attachment/comment/IDOR checks below", r.status === 201 && !!TASK, JSON.stringify(r.data));

/* ------------------------------------------------------ session & cookies */
r = await withCookie("GET", "/api/auth/me");
ok("no cookie: /api/auth/me returns {me:null}, not an error", r.status === 200 && r.data.me === null);

r = await withCookie("GET", "/api/auth/me", "tcc_session=not-a-real-cookie-value");
ok("a garbage session cookie fails closed to anonymous (200, me:null), doesn't error", r.status === 200 && r.data.me === null, JSON.stringify(r.data));

r = await withCookie("GET", "/api/auth/me", "tcc_session=" + encodeURIComponent("11111111-1111-1111-1111-111111111111.wrongsignature"));
ok("a well-formed but wrong-signature cookie also fails closed to anonymous", r.status === 200 && r.data.me === null, JSON.stringify(r.data));

r = await withCookie("GET", "/api/tasks", "tcc_session=not-a-real-cookie-value");
ok("a protected route still 401s for a garbage cookie (requireUser catches what attachUser silently ignores)", r.status === 401, `got ${r.status}`);

const cookieProbe = client();
r = await cookieProbe("POST", "/api/auth/login", { username: "sec.alpha", password: alphaPw });
ok("login response sets a cookie", !!r.setCookie);
ok("the session cookie is HttpOnly", /HttpOnly/i.test(r.setCookie || ""), r.setCookie);
ok("the session cookie is SameSite=Lax", /SameSite=Lax/i.test(r.setCookie || ""), r.setCookie);

r = await mgr("GET", "/api/health");
ok("security headers are present: X-Content-Type-Options: nosniff", (r.headers.get("x-content-type-options") || "") === "nosniff");
ok("security headers are present: X-Frame-Options: SAMEORIGIN", (r.headers.get("x-frame-options") || "") === "SAMEORIGIN");

/* --------------------------------------------------------- login throttle */
{
  const probe = client();
  let last;
  for (let i = 0; i < 8; i++) last = (await probe("POST", "/api/auth/login", { username: "sec.throttle", password: "definitely-wrong" })).status;
  ok("8 wrong passwords in a row are each rejected as plain 401s", last === 401, `last status was ${last}`);

  const ninth = await probe("POST", "/api/auth/login", { username: "sec.throttle", password: "definitely-wrong" });
  ok("the 9th attempt within the window is throttled (429)", ninth.status === 429, `got ${ninth.status}`);

  const evenCorrect = await probe("POST", "/api/auth/login", { username: "sec.throttle", password: throttlePw });
  ok("once tripped, even the correct password is throttled (429)", evenCorrect.status === 429, `got ${evenCorrect.status}`);

  const otherAccount = client();
  const otherResult = await otherAccount("POST", "/api/auth/login", { username: "sec.beta", password: "definitely-wrong" });
  ok("the throttle is keyed per-username, not per-IP — a different account from the same caller isn't blocked by sec.throttle's lockout",
     otherResult.status === 401, `got ${otherResult.status}`);
}

/* ------------------------------------------------------------- sql injection */
/* Every query in src/db.js is parameterized (mysql2 `?` placeholders), so
 * these payloads should never be interpreted as SQL — they should either be
 * rejected the same way any other bad input is, or stored/returned as inert
 * literal text. This section proves that behaviorally rather than just by
 * reading the source: send classic injection strings through auth and
 * through record lookups/writes, then check the server is still healthy and
 * no row was added, dropped, or leaked. */
{
  const AUTH_BYPASS_PAYLOADS = [
    "' OR '1'='1",
    "' OR '1'='1' -- ",
    "' OR 1=1#",
    "admin'--",
    "' UNION SELECT * FROM employees --",
    "'; DROP TABLE employees; --"
  ];
  for (const payload of AUTH_BYPASS_PAYLOADS) {
    const probe = client();
    r = await probe("POST", "/api/auth/login", { username: payload, password: payload });
    ok(`login with a SQLi payload as username (${JSON.stringify(payload)}) is rejected, not a 500 or auth bypass`,
       r.status === 401, `got ${r.status} :: ${JSON.stringify(r.data)}`);
  }

  r = await mgr("GET", "/api/health");
  ok("the server (and its database connection) is still healthy after the login-based SQLi probes", r.status === 200 && r.data.ok === true, JSON.stringify(r.data));

  const beforeTasks = (await mgr("GET", "/api/tasks")).data.tasks;
  const sqliTitle = "Robert'); DROP TABLE tasks; --";
  r = await mgr("POST", "/api/tasks", { title: sqliTitle, assigneeId: "emp-sec-alpha", priority: "MEDIUM", status: "NOT_STARTED", progress: 0 });
  ok("a task title containing a SQL injection payload is accepted and stored as inert literal text",
     r.status === 201 && r.data.task.title === sqliTitle, JSON.stringify(r.data));
  const sqliTaskId = r.data.task?.id;

  const afterTasks = (await mgr("GET", "/api/tasks")).data.tasks;
  ok("the tasks table survives the payload — exactly one row was added, nothing dropped or duplicated",
     afterTasks.length === beforeTasks.length + 1, `before ${beforeTasks.length}, after ${afterTasks.length}`);
  ok("the stored title round-trips byte-for-byte, proving it was carried as data, never executed as SQL",
     (afterTasks.find(t => t.id === sqliTaskId) || {}).title === sqliTitle);

  r = await mgr("GET", `/api/tasks/${encodeURIComponent("' OR '1'='1")}`);
  ok("an id-shaped SQLi payload used as a task lookup returns a clean 404, not a 500 or an all-rows leak",
     r.status === 404 && !Array.isArray(r.data?.task), `got ${r.status} :: ${JSON.stringify(r.data)}`);

  r = await mgr("PUT", `/api/admin/complaints/${encodeURIComponent("1' OR '1'='1")}`, { status: "published" });
  ok("an id-shaped SQLi payload against the complaints admin endpoint returns 404, not an error or a mass-update",
     r.status === 404, `got ${r.status} :: ${JSON.stringify(r.data)}`);

  const sqliComplaintBody = "x'; UPDATE employees SET role='manager' WHERE username='sec.alpha'; --";
  r = await alpha("POST", "/api/complaints", { body: sqliComplaintBody });
  ok("a complaint body containing a SQL injection payload is accepted (queued for manager review)", r.status === 201, JSON.stringify(r.data));

  r = await mgr("GET", "/api/complaints/bootstrap");
  const storedComplaint = (r.data.complaints || []).find(c => c.body === sqliComplaintBody);
  ok("the complaint's body round-trips exactly as submitted — the payload was stored as text, not executed",
     !!storedComplaint, JSON.stringify((r.data.complaints || []).map(c => c.body)));

  r = await alpha("GET", "/api/auth/me");
  ok("the targeted account's role is untouched — the UPDATE embedded in the complaint body never ran", r.data.me?.role === "employee", JSON.stringify(r.data));
}

/* ------------------------------------------------------- session fixation */
{
  const fix = client();
  ok("fixation-test account signs in", await login(fix, "sec.fixation", fixationPw) === 200);
  const oldCookie = fix.cookie();
  r = await fix("POST", "/api/auth/password", { current: fixationPw, next: "a-much-longer-new-password" });
  ok("password change succeeds", r.status === 200, JSON.stringify(r.data));
  const afterChange = await withCookie("GET", "/api/bootstrap", oldCookie);
  ok("the pre-change session cookie is dead after a password change (old sessions are dropped everywhere)",
     afterChange.status === 401, `got ${afterChange.status}`);
}

/* ------------------------------------------------------------ breaks IDOR */
{
  r = await alpha("POST", "/api/breaks/start", { kind: "SHORT1" });
  ok("start a Short Break 1", r.status === 201 && r.data.break.kind === "SHORT1", JSON.stringify(r.data));

  r = await alpha("POST", "/api/breaks/start", { kind: "LONG" });
  ok("cannot start a second break while one is already open (409)", r.status === 409, `got ${r.status}`);

  r = await alpha("POST", "/api/breaks/start", { kind: "NOT-A-REAL-KIND" });
  ok("an invalid break kind is refused (422), even mid-break", r.status === 422, `got ${r.status}`);

  r = await alpha("POST", "/api/breaks/end");
  ok("end the open break", r.status === 200 && r.data.break.kind === "SHORT1", JSON.stringify(r.data));

  r = await alpha("POST", "/api/breaks/end");
  ok("ending again with nothing open is refused (409)", r.status === 409, `got ${r.status}`);

  r = await alpha("POST", "/api/breaks/start", { kind: "SHORT1" });
  ok("the same break kind cannot be started twice in one day (409)", r.status === 409, `got ${r.status}`);

  r = await alpha("POST", "/api/breaks/start", { kind: "SHORT2" });
  ok("a different break kind the same day is fine", r.status === 201, `got ${r.status}`);
  await alpha("POST", "/api/breaks/end");

  r = await alpha("GET", "/api/breaks?employeeId=emp-sec-beta");
  const onlySelf = (r.data.breaks || []).length > 0 && (r.data.breaks || []).every(b => b.employeeId === "emp-sec-alpha");
  ok("a non-manager's ?employeeId= for someone else is silently ignored — only their own breaks come back",
     r.status === 200 && onlySelf, JSON.stringify(r.data));

  r = await mgr("GET", "/api/breaks");
  ok("a manager's unscoped GET /api/breaks includes other people's breaks", r.status === 200 && (r.data.breaks || []).some(b => b.employeeId === "emp-sec-alpha"));

  r = await mgr("GET", "/api/breaks?employeeId=emp-sec-alpha");
  const onlyAlpha = (r.data.breaks || []).length > 0 && (r.data.breaks || []).every(b => b.employeeId === "emp-sec-alpha");
  ok("a manager scoping to one employeeId gets only that person's breaks", r.status === 200 && onlyAlpha, JSON.stringify(r.data));
}

/* ------------------------------------------------------ notifications IDOR */
{
  r = await alpha("POST", `/api/tasks/${TASK}/comments`, { body: "@Sec Beta can you take a look at this?" });
  ok("posting a comment with an @mention succeeds", r.status === 200, JSON.stringify(r.data));

  r = await beta("GET", "/api/notifications");
  const mentionNotif = (r.data.notifications || []).find(n => n.kind === "mention" && n.taskId === TASK);
  ok("the mentioned person actually received a notification", !!mentionNotif, JSON.stringify(r.data));

  if (mentionNotif) {
    r = await alpha("POST", `/api/notifications/${mentionNotif.id}/read`);
    ok("another employee cannot mark someone else's notification as read (404, not 403 — doesn't confirm it exists)", r.status === 404, `got ${r.status}`);

    r = await beta("POST", `/api/notifications/${mentionNotif.id}/read`);
    ok("the notification's own owner can mark it read", r.status === 200, `got ${r.status}`);
  }
}

/* ------------------------------------ attachment upload/download/delete IDOR */
{
  const fd1 = new FormData();
  fd1.append("file", new Blob(["hello from alpha"], { type: "text/plain" }), "alpha-note.txt");
  let res = await fetch(`${BASE}/api/tasks/${TASK}/attachments`, { method: "POST", headers: { cookie: alpha.cookie() }, body: fd1 });
  let data = await res.json();
  ok("the task's assignee can upload an allowed file type", res.status === 201, JSON.stringify(data));
  const att = (data.task?.attachments || []).find(a => a.name === "alpha-note.txt");
  ok("the uploaded attachment is recorded on the task", !!att, JSON.stringify(data.task?.attachments));

  if (att) {
    res = await fetch(`${BASE}/api/tasks/${TASK}/attachments/${att.id}`, { headers: { cookie: beta.cookie() } });
    ok("an unrelated employee CAN download the attachment (intended: same read policy as comments, per attachments.js's own header comment)", res.status === 200, `got ${res.status}`);

    res = await fetch(`${BASE}/api/tasks/${TASK}/attachments/${att.id}`, { method: "DELETE", headers: { cookie: beta.cookie() } });
    ok("an unrelated employee (not the uploader, not the assignee, not a manager) CANNOT delete it (403)", res.status === 403, `got ${res.status}`);

    res = await fetch(`${BASE}/api/tasks/${TASK}/attachments/${att.id}`, { method: "DELETE", headers: { cookie: alpha.cookie() } });
    ok("the uploader (who is also the assignee here) CAN delete their own attachment", res.status === 200, `got ${res.status}`);
  }

  const fdBad = new FormData();
  fdBad.append("file", new Blob(["#!/bin/sh\necho pwned"], { type: "application/x-sh" }), "run.sh");
  res = await fetch(`${BASE}/api/tasks/${TASK}/attachments`, { method: "POST", headers: { cookie: alpha.cookie() }, body: fdBad });
  ok("a disallowed MIME type is rejected (400)", res.status === 400, `got ${res.status}`);

  const big = new Uint8Array(25 * 1024 * 1024 + 1); // one byte over the 25MB limit
  const fdBig = new FormData();
  fdBig.append("file", new Blob([big], { type: "image/png" }), "huge.png");
  res = await fetch(`${BASE}/api/tasks/${TASK}/attachments`, { method: "POST", headers: { cookie: alpha.cookie() }, body: fdBig });
  ok("a file over the 25MB limit is rejected (413)", res.status === 413, `got ${res.status}`);
}

/* ----------------------------------------------------- input validation limits */
{
  r = await mgr("POST", "/api/tasks", { title: "x".repeat(301), assigneeId: "emp-sec-alpha", priority: "MEDIUM", status: "NOT_STARTED", progress: 0 });
  ok("a title over 300 characters is refused (422)", r.status === 422 && !!r.data.fields?.title, JSON.stringify(r.data));

  r = await mgr("POST", "/api/tasks", { title: "x".repeat(300), assigneeId: "emp-sec-alpha", priority: "MEDIUM", status: "NOT_STARTED", progress: 0 });
  ok("a title of exactly 300 characters is accepted", r.status === 201, JSON.stringify(r.data));

  const longComment = "y".repeat(5000);
  r = await mgr("POST", `/api/tasks/${TASK}/comments`, { body: longComment });
  ok("an oversized comment is accepted but silently truncated at 4000 characters (known limit, not a rejection)",
     r.status === 200 && r.data.task.comments.slice(-1)[0].body.length === 4000, `got length ${r.data.task?.comments?.slice(-1)[0]?.body?.length}`);
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
