"use strict";
/* ==========================================================================
   DATA LAYER — talks to the REST API, keeps a local mirror, re-renders.
   Writes are optimistic: the UI moves immediately, the server's answer wins.
   ========================================================================== */
const clone = o => JSON.parse(JSON.stringify(o));

let renderQueued = false;
function render() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; try { paint(); } catch (e) { console.error(e); } });
}

/* ------------------------------------------------------------- transport */

async function req(method, url, body) {
  let r;
  try {
    r = await fetch(url, {
      method,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  } catch {
    S.offline = true; render();
    return { ok: false, status: 0, data: { error: "Can't reach the server." } };
  }
  S.offline = false;
  let data = null;
  try { data = await r.json(); } catch { data = {}; }
  // A 401 anywhere else means the session lapsed — drop back to the sign-in
  // screen. On the login endpoint itself it just means wrong credentials, and
  // re-rendering there would wipe the message the person needs to read.
  if (r.status === 401 && url !== "/api/auth/login") {
    S.me = null; S.ready = true; render();
    return { ok: false, status: 401, data: { error: "Your session expired. Sign in again." } };
  }
  return { ok: r.ok, status: r.status, data };
}
const GET = u => req("GET", u);
const PUT = (u, b) => req("PUT", u, b);
const POST = (u, b) => req("POST", u, b);
const DEL = u => req("DELETE", u);

/** Turn a server error into one sentence a person can act on. */
function explain(res, fallback) {
  const d = res.data || {};
  if (d.fields) return Object.values(d.fields)[0];
  return d.error || fallback || "That didn't save.";
}

/* -------------------------------------------------------------- bootstrap */

function absorb(d) {
  if (d.me !== undefined) S.me = d.me;
  if (d.employees) S.employees = d.employees;
  if (d.projects) S.projects = d.projects;
  if (d.tasks) S.tasks = d.tasks;
  if (d.updates) S.updates = d.updates;
  if (d.breaks) S.breaks = d.breaks;
  if (d.config) S.config = Object.assign(clone(DEFAULT_CONFIG), d.config);
  if (d.notifications) S.notifications = d.notifications;
  if (d.myNotifyPrefs) S.myNotifyPrefs = d.myNotifyPrefs;
}

async function initData() {
  const r = await GET("/api/bootstrap");
  S.ready = true;
  if (r.ok) {
    absorb(r.data);
    S.connected = true;
    if (!VIEWS[S.view] || !VIEWS[S.view].roles.includes(S.me.role)) S.view = S.me.role === "manager" ? "cc" : "myday";
    openStream();
  }
  render();
}

/** Live updates from other people, over Server-Sent Events. */
let stream = null, streamRetry = 0;
function openStream() {
  if (stream || !window.EventSource) return;
  stream = new EventSource("/api/stream");
  stream.addEventListener("change", async ev => {
    let msg = {};
    try { msg = JSON.parse(ev.data); } catch {}
    if (msg.actorId && S.me && msg.actorId === S.me.id) return;   // our own write, already applied
    const cols = msg.collections || ["tasks"];
    const before = cols.includes("tasks") ? new Map(S.tasks.map(t => [t.id, t.assigneeId])) : null;
    const knownNotifIds = cols.includes("notifications") ? new Set(S.notifications.map(n => n.id)) : null;
    await refresh(cols);
    if (before && S.me && (cfg().notify || {}).assigned !== false) {
      const mine = S.tasks.filter(t => t.assigneeId === S.me.id && before.get(t.id) !== S.me.id);
      if (mine.length) queueAssignPopup(empName(msg.actorId), mine);
    }
    if (knownNotifIds) {
      S.notifications.filter(n => !knownNotifIds.has(n.id)).forEach(maybeDesktopNotify);
    }
  });
  stream.onopen = async () => {
    streamRetry = 0; S.offline = false;
    // A connection can drop and come back with no broadcast to say what was
    // missed (src/events.js keeps no per-client backlog) - resync everything
    // rather than leave stale state until unrelated activity happens to
    // trigger the next broadcast.
    await refresh(["tasks", "employees", "projects", "updates", "breaks", "config", "notifications"]);
  };
  stream.onerror = () => {
    stream.close(); stream = null;
    streamRetry = Math.min(streamRetry + 1, 6);
    setTimeout(openStream, 1000 * streamRetry);
  };
}
async function refresh(collections) {
  const jobs = [];
  if (collections.includes("tasks"))     jobs.push(GET("/api/tasks").then(r => r.ok && (S.tasks = r.data.tasks)));
  if (collections.includes("employees")) jobs.push(GET("/api/employees").then(r => r.ok && (S.employees = r.data.employees)));
  if (collections.includes("projects"))  jobs.push(GET("/api/projects").then(r => r.ok && (S.projects = r.data.projects)));
  if (collections.includes("updates"))   jobs.push(GET("/api/updates").then(r => r.ok && (S.updates = r.data.updates)));
  if (collections.includes("breaks"))    jobs.push(GET("/api/breaks").then(r => r.ok && (S.breaks = r.data.breaks)));
  if (collections.includes("config"))    jobs.push(GET("/api/config").then(r => r.ok && (S.config = Object.assign(clone(DEFAULT_CONFIG), r.data.config))));
  if (collections.includes("notifications")) jobs.push(GET("/api/notifications").then(r => r.ok && (S.notifications = r.data.notifications)));
  await Promise.all(jobs);
  render();
}

/* ------------------------------------------------------------- auth flow */

async function login(email, password) {
  const r = await POST("/api/auth/login", { email, password });
  if (!r.ok) return explain(r, "Couldn't sign in.");
  await initData();
  return null;
}
async function logout() {
  await POST("/api/auth/logout");
  if (stream) { stream.close(); stream = null; }
  S.me = null; S.tasks = []; S.employees = []; S.projects = []; S.updates = []; S.breaks = [];
  closeLayer(); render();
}
async function changePassword(current, next) {
  const r = await POST("/api/auth/password", { current, next });
  return r.ok ? null : explain(r, "Couldn't change the password.");
}

/* ---------------------------------------------------------------- writes */

/** Local-only activity, shown until the server's authoritative trail arrives. */
function logEntry(kind, field, from, to, note) {
  return { id: "tmp-" + Math.random().toString(36).slice(2), at: nowISO(),
           byId: meId(), byName: S.me ? S.me.name : "System",
           kind, field: field || null, from: from ?? null, to: to ?? null, note: note || null };
}
const FIELD_LABELS = {
  title: "Title", description: "Description", assigneeId: "Assignee", priority: "Priority", status: "Status",
  progress: "Progress", dueDate: "Due date", startDate: "Start date", expectedCompletion: "Expected completion",
  estimatedHours: "Estimated effort", actualHours: "Actual effort", projectId: "Project", category: "Category",
  departmentId: "Department", teamId: "Team", tags: "Tags"
};
function diffEntries(oldT, newT) {
  const out = [];
  Object.keys(FIELD_LABELS).forEach(k => {
    const a = Array.isArray(oldT[k]) ? oldT[k].join(", ") : oldT[k];
    const b = Array.isArray(newT[k]) ? newT[k].join(", ") : newT[k];
    if ((a ?? "") === (b ?? "")) return;
    let kind = "edit";
    if (k === "priority") kind = "priority";
    else if (k === "status") kind = b === "COMPLETED" ? "complete" : b === "BLOCKED" ? "block" : "status";
    else if (k === "assigneeId") kind = oldT.assigneeId ? "reassign" : "assign";
    else if (k === "dueDate") kind = "due";
    else if (k === "progress") kind = "progress";
    out.push(logEntry(kind, k, a, b));
  });
  return out;
}

const DENIED_LABEL = {
  assigneeId: "who it's assigned to", dueDate: "the due date",
  departmentId: "the department", teamId: "the team", status: "completion"
};
function warnDenied(denied) {
  if (!denied || !denied.length) return;
  toast("Saved, but " + denied.map(f => DENIED_LABEL[f] || f).join(" and ") + " can only be changed by a manager.", true);
}

function replaceTask(t) {
  const i = S.tasks.findIndex(x => x.id === t.id);
  if (i >= 0) S.tasks[i] = t; else S.tasks = S.tasks.concat([t]);
}

/** Create or update a task. `extraLog` entries become server-side audit notes. */
async function saveTask(task, extraLog) {
  const prev = S.tasks.find(t => t.id === task.id);
  const optimistic = clone(task);
  optimistic.activity = (optimistic.activity || []).concat(
    prev ? diffEntries(prev, task) : [logEntry("create", null, null, null, "Task created")],
    extraLog || []);
  optimistic.updatedAt = nowISO();
  replaceTask(optimistic);
  render();

  const payload = clone(task);
  delete payload.activity;                         // the server derives the trail
  payload._notes = (extraLog || []).map(e => ({ kind: e.kind, note: e.note })).filter(n => n.note);

  const r = prev ? await PUT("/api/tasks/" + task.id, payload) : await POST("/api/tasks", payload);
  if (!r.ok) {
    if (prev) replaceTask(prev); else S.tasks = S.tasks.filter(t => t.id !== task.id);
    render();
    if (r.status !== 401) toast(explain(r), true);
    return null;
  }
  // On create the server mints the real id, so drop the provisional row.
  if (!prev && r.data.task.id !== task.id) S.tasks = S.tasks.filter(t => t.id !== task.id);
  replaceTask(r.data.task);
  warnDenied(r.data.denied);
  render();
  return r.data.task;
}
async function patchTask(id, patch, extraLog) {
  const t = S.tasks.find(x => x.id === id);
  if (!t) return null;
  return saveTask(Object.assign(clone(t), patch), extraLog);
}

/** Returns { employee, temporaryPassword } — the caller decides what to show,
 *  because the edit dialog has to close before the password one opens. */
async function saveEmployee(e) {
  const r = await PUT("/api/employees/" + e.id, e);
  if (!r.ok) { toast(explain(r), true); return null; }
  await refresh(["employees"]);
  return r.data;
}
async function resetPassword(id) {
  const person = emp(id);
  const r = await POST("/api/employees/" + id + "/reset-password");
  if (!r.ok) { toast(explain(r), true); return; }
  closeLayer();
  showTempPassword(person, r.data.temporaryPassword);
}
async function toggleBreak() {
  const open = openBreakFor(meId());
  if (open) {
    const r = await POST("/api/breaks/end");
    if (!r.ok) { toast(explain(r), true); return; }
    const i = S.breaks.findIndex(b => b.id === r.data.break.id);
    if (i >= 0) S.breaks[i] = r.data.break; else S.breaks.push(r.data.break);
  } else {
    const r = await POST("/api/breaks/start");
    if (!r.ok) { toast(explain(r), true); return; }
    S.breaks.push(r.data.break);
  }
  render();
}
async function saveProject(p) {
  const r = await PUT("/api/projects/" + p.id, p);
  if (!r.ok) { toast(explain(r), true); return null; }
  await refresh(["projects"]);
  return r.data.project;
}
async function deleteProjectRemote(id) {
  const r = await DEL("/api/projects/" + id);
  if (!r.ok) { toast(explain(r), true); return false; }
  S.projects = S.projects.filter(p => p.id !== id);
  S.tasks.forEach(t => { if (t.projectId === id) t.projectId = null; });
  render();
  return true;
}
/** Settings changes go straight through; the server refuses anything unsafe. */
async function saveConfig() {
  const snapshot = clone(S.config);
  render();
  const r = await PUT("/api/config", snapshot);
  if (!r.ok) { toast(explain(r), true); await refresh(["config"]); return false; }
  S.config = Object.assign(clone(DEFAULT_CONFIG), r.data.config);
  render();
  return true;
}
/* ------------------------------------------------------- desktop notifications */
// Off by default; a person opts in from the Account modal, which is the only
// place permission is ever requested (never on load - browsers expect a
// direct user gesture, and an unsolicited prompt is its own kind of nag).
const desktopNotifsWanted = () => store.get("desktopNotifs", false) && window.Notification && Notification.permission === "granted";

async function enableDesktopNotifs() {
  if (!window.Notification) { toast("Your browser doesn't support desktop notifications.", true); return false; }
  const perm = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
  if (perm !== "granted") { toast("Desktop notifications need to be allowed in your browser.", true); return false; }
  store.set("desktopNotifs", true);
  render();
  return true;
}
function disableDesktopNotifs() { store.set("desktopNotifs", false); render(); }

/** Same kind → preference gating as the in-app list, so a muted kind stays muted here too. */
function maybeDesktopNotify(n) {
  if (!desktopNotifsWanted() || document.hasFocus()) return;
  const prefs = { ...(cfg().notify || {}), ...(S.myNotifyPrefs || {}) };
  const pk = PREF[n.kind];
  if (pk && prefs[pk] === false) return;
  new Notification(n.text, { tag: n.id });
}

/** Opening the bell clears every unread row in one call, optimistically. */
async function markAllNotificationsRead() {
  const at = new Date().toISOString();
  S.notifications.forEach(n => { if (!n.readAt) n.readAt = at; });
  render();
  await POST("/api/notifications/read-all");
}
/** A person's own override on top of the global notify defaults. */
async function saveMyNotifyPrefs(patch) {
  Object.assign(S.myNotifyPrefs, patch);
  render();
  const r = await PUT("/api/me/notify-prefs", patch);
  if (!r.ok) { toast(explain(r), true); await GET("/api/me/notify-prefs").then(r2 => r2.ok && (S.myNotifyPrefs = r2.data.prefs)); render(); return false; }
  S.myNotifyPrefs = r.data.prefs;
  render();
  return true;
}
async function saveDailyUpdate(entry) {
  const r = await PUT("/api/updates/" + entry.date, entry);
  if (!r.ok) { toast(explain(r), true); return false; }
  S.updates = r.data.updates;
  render();
  return true;
}
async function bulkUpdate(ids, patch, note) {
  const r = await POST("/api/tasks/bulk", { ids, patch, note });
  if (!r.ok) { toast(explain(r), true); return null; }
  await refresh(["tasks"]);
  return r.data;
}
async function deleteTaskRemote(id) {
  const r = await DEL("/api/tasks/" + id);
  if (!r.ok) { toast(explain(r), true); return false; }
  S.tasks = S.tasks.filter(t => t.id !== id);
  render();
  return true;
}

/** File uploads are multipart, so they bypass the JSON `req()` transport. */
async function uploadAttachment(taskId, file) {
  const fd = new FormData(); fd.append("file", file);
  let r, data = {};
  try { r = await fetch("/api/tasks/" + taskId + "/attachments", { method: "POST", credentials: "same-origin", body: fd }); }
  catch { toast("Can't reach the server.", true); return false; }
  try { data = await r.json(); } catch { /* no body */ }
  if (!r.ok) { toast(explain({ status: r.status, data }), true); return false; }
  replaceTask(data.task); render(); return true;
}
async function deleteAttachmentRemote(taskId, attId) {
  const r = await DEL(`/api/tasks/${taskId}/attachments/${attId}`);
  if (!r.ok) { toast(explain(r), true); return false; }
  replaceTask(r.data.task); render(); return true;
}

const myUpdates = id => (S.updates.find(u => u.id === id || u.employeeId === id) || {}).entries || [];
const latestUpdate = id => { const e = myUpdates(id); return e.length ? e[e.length - 1] : null; };

/* -------------------------------------------------------------- mirrored */
/* The server enforces all of this. These copies exist so the interface can
   disable what won't work, instead of letting people hit an error.          */

function validateTask(t) {
  const errs = {};
  if (!t.title || !t.title.trim()) errs.title = "A task needs a title.";
  if (!t.assigneeId) errs.assigneeId = "Assign this to someone.";
  const p = Number(t.progress);
  if (isNaN(p) || p < 0 || p > 100) errs.progress = "Progress must be between 0 and 100.";
  const sd = dOf(t.startDate), dd = dOf(t.dueDate), ed = dOf(t.expectedCompletion);
  if (sd && dd && dd < sd) errs.dueDate = "Due date cannot be before the start date.";
  if (sd && ed && ed < sd) errs.expectedCompletion = "Expected completion cannot be before the start date.";
  if (t.status === "COMPLETED") {
    if (p !== 100) errs.progress = "A completed task must be at 100%.";
    if (!t.completedAt) errs.completedAt = "A completed task needs a completion date.";
  }
  if (t.priority === "CRITICAL" && !t.expectedCompletion) errs.expectedCompletion = "Critical tasks need an expected completion date.";
  if (t.status === "BLOCKED" && !(t.blocker && t.blocker.reason && t.blocker.reason.trim())) errs.blocker = "Explain what is blocking this task.";
  for (const f of ["estimatedHours", "actualHours"]) {
    if (t[f] !== "" && t[f] != null && Number(t[f]) < 0) errs[f] = "Effort cannot be negative.";
  }
  return errs;
}
function canEdit(t) {
  if (!S.me) return false;
  if (isManager()) return true;
  return t.assigneeId === meId() || t.createdById === meId();
}
function canComplete(t) {
  if (!S.me) return false;
  return isManager() || t.assigneeId === meId();
}
const canAdmin = () => isManager();

/** A provisional id for the draft form. The server mints the real one on save,
 *  so two people creating at the same moment can never collide. */
function nextTaskId() { return "NEW-" + Math.random().toString(36).slice(2, 8).toUpperCase(); }
