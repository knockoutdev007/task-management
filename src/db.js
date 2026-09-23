/**
 * Database access. MySQL via mysql2/promise, through a connection pool — the
 * app is a single Node process but requests are concurrent, so every export
 * here is async (unlike the SQLite/better-sqlite3 version this replaced,
 * which was synchronous). Every call site elsewhere in the app awaits these.
 *
 * Rows are stored snake_case and handed to the API camelCase, so the SQL stays
 * idiomatic and the JSON the browser sees stays idiomatic too. The mapping
 * lives here and nowhere else.
 */
import mysql from "mysql2/promise";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

// Connecting (and validating connection settings) is lazy, triggered by the
// first real query rather than by importing this module — a few call paths
// (e.g. scripts/notif-test.js) import src/domain.js, which imports getConfig
// from here, but never actually call it; those must stay usable with no
// database configured at all, the same way they were before this file talked
// to a network service instead of always-available local SQLite.
let pool = null;
let schemaReady = null;

/** Two supported conventions: a single DATABASE_URL (GoDaddy/most hosts), or
 *  discrete DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD (some platforms —
 *  e.g. airoapp.ai — auto-inject these instead of a URL when a managed
 *  database is attached, with no way to see/construct a URL from them). */
function connectionConfig() {
  if (process.env.DATABASE_URL) return { uri: process.env.DATABASE_URL };
  if (process.env.DB_HOST) {
    return {
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME
    };
  }
  console.error("\n  No database configured — set DATABASE_URL, or DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD. See .env.example.\n");
  process.exit(1);
}

function getPool() {
  if (!pool) pool = mysql.createPool({ ...connectionConfig(), waitForConnections: true, connectionLimit: 10 });
  return pool;
}

// Schema is applied on every boot via CREATE TABLE IF NOT EXISTS (a no-op
// against tables that already exist) — same idea as the old SQLite version,
// just over a one-off connection with multipleStatements enabled so the
// whole schema.sql file can run in one shot. The regular pool above never
// gets multipleStatements, so ordinary query traffic can't smuggle extra
// statements through a single placeholder.
async function applySchema() {
  const sql = fs.readFileSync(path.join(HERE, "schema.sql"), "utf8");
  const conn = await mysql.createConnection({ ...connectionConfig(), multipleStatements: true });
  try {
    await conn.query(sql);
    await migrateTaskBoardColumns(conn);
  } finally { await conn.end(); }
}

/** Older databases predate the Task Board columns; CREATE TABLE IF NOT EXISTS
 *  above is a no-op against an existing `tasks` table, so add them here if
 *  missing (MySQL supports ADD COLUMN directly — no SQLite-style table-rebuild
 *  needed, see the pre-migration email->username commit for that older shape).
 *  Backfills assigned_date so the assignment timer never has to special-case
 *  a null value on a task that predates this feature. */
async function migrateTaskBoardColumns(conn) {
  const [cols] = await conn.query(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tasks'"
  );
  const names = new Set(cols.map(c => c.COLUMN_NAME));
  if (!names.has("board_category")) await conn.query("ALTER TABLE tasks ADD COLUMN board_category VARCHAR(16) NOT NULL DEFAULT 'to_do'");
  if (!names.has("assigned_date"))  await conn.query("ALTER TABLE tasks ADD COLUMN assigned_date VARCHAR(32)");
  if (!names.has("paused_at"))      await conn.query("ALTER TABLE tasks ADD COLUMN paused_at VARCHAR(32)");
  if (!names.has("paused_ms_total")) await conn.query("ALTER TABLE tasks ADD COLUMN paused_ms_total BIGINT NOT NULL DEFAULT 0");
  await conn.query("UPDATE tasks SET assigned_date = SUBSTRING(created_at, 1, 10) WHERE assigned_date IS NULL");
}

/** Every exported function funnels through this — ensures the pool exists and
 *  schema.sql has run before the first real query, memoized so concurrent
 *  callers (e.g. a Promise.all of several queries) only trigger it once. */
async function exec(sql, params) {
  const p = getPool();
  if (!schemaReady) schemaReady = applySchema();
  await schemaReady;
  return p.execute(sql, params);
}

export const now = () => new Date().toISOString();
const J = (v, fallback) => { try { return v == null ? fallback : JSON.parse(v); } catch { return fallback; } };

/** Used only by seed scripts to reset to an empty database. Order matters: children before parents. */
export async function wipeAllTables() {
  for (const table of ["task_activity", "task_comments", "tasks", "daily_updates", "projects", "sessions", "employees", "config"]) {
    await exec(`DELETE FROM ${table}`);
  }
}

/* ------------------------------------------------------------------ config */

export const DEFAULT_CONFIG = {
  priorities: [
    { id: "CRITICAL", label: "Critical", weight: 4.0, staleDays: 1 },
    { id: "HIGH",     label: "High",     weight: 2.6, staleDays: 2 },
    { id: "MEDIUM",   label: "Medium",   weight: 1.5, staleDays: 3 },
    { id: "LOW",      label: "Low",      weight: 0.8, staleDays: 5 }
  ],
  statuses: [
    { id: "NOT_STARTED",  label: "Not started",  kind: "open" },
    { id: "IN_PROGRESS",  label: "In progress",  kind: "active" },
    { id: "WAITING",      label: "Waiting",      kind: "open" },
    { id: "BLOCKED",      label: "Blocked",      kind: "blocked" },
    { id: "UNDER_REVIEW", label: "Under review", kind: "active" },
    { id: "COMPLETED",    label: "Completed",    kind: "done" },
    { id: "CANCELLED",    label: "Cancelled",    kind: "done" }
  ],
  departments: [
    { id: "mkt", name: "Marketing",  teams: [{ id: "seo", name: "SEO" }, { id: "content", name: "Content" }, { id: "ads", name: "Paid Ads" }, { id: "design", name: "Design" }] },
    { id: "ops", name: "Operations", teams: [{ id: "admin", name: "Admin" }, { id: "hr", name: "HR" }, { id: "it", name: "IT" }] }
  ],
  categories: ["Audit", "Content", "Campaign", "Development", "Design", "Reporting", "Admin", "Support", "Research"],
  workload: { normal: 5, high: 11, overloaded: 18 },
  workingDays: [1, 2, 3, 4, 5],
  defaultDueDays: 7,
  progressSteps: [0, 10, 25, 50, 75, 90, 100],
  notify: { assigned: true, priority: true, dueSoon: true, overdue: true, blocked: true, comment: true, completed: false, reassigned: true, dependency: true, attachment: true },
  boards: [],       // manager-created extra Task-Board-style nav entries: [{ id, name }]
  hiddenNav: []     // manager-only nav view keys a manager has hidden from everyone's sidebar
};

export async function getConfig() {
  const [rows] = await exec("SELECT value FROM config WHERE `key` = 'settings'");
  return rows[0] ? { ...DEFAULT_CONFIG, ...J(rows[0].value, {}) } : { ...DEFAULT_CONFIG };
}
export async function setConfig(value) {
  await exec(
    "INSERT INTO config (`key`, value, updated_at) VALUES ('settings', ?, ?) " +
    "ON DUPLICATE KEY UPDATE value = VALUES(value), updated_at = VALUES(updated_at)",
    [JSON.stringify(value), now()]
  );
  return getConfig();
}

/* --------------------------------------------------------------- employees */

const employeeOut = r => r && ({
  id: r.id, name: r.name, initials: r.initials, username: r.username,
  role: r.role, title: r.title,
  departmentId: r.department_id, teamId: r.team_id, managerId: r.manager_id,
  capacityHours: r.capacity_hours, color: r.color,
  active: !!r.active,
  mustChangePassword: !!r.must_change_password,
  hasPassword: !!r.password_hash,
  lastLoginAt: r.last_login_at,
  createdAt: r.created_at, updatedAt: r.updated_at
});

export async function listEmployees() {
  const [rows] = await exec("SELECT * FROM employees ORDER BY name");
  return rows.map(employeeOut);
}
export async function getEmployee(id) {
  const [rows] = await exec("SELECT * FROM employees WHERE id = ?", [id]);
  return employeeOut(rows[0]);
}
export async function getEmployeeByUsername(username) {
  const [rows] = await exec("SELECT * FROM employees WHERE username = ?", [String(username || "").trim()]);
  return rows[0];                       // username's column collation is already case-insensitive
}
export async function getPasswordHash(id) {
  const [rows] = await exec("SELECT password_hash FROM employees WHERE id = ?", [id]);
  return (rows[0] || {}).password_hash;
}

/** lowercase, collapse non-alphanumeric runs to ".", trim edge dots. Pure — no DB access. */
export const slugifyName = name =>
  String(name || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.+|\.+$/g, "") || "user";

/** Turn "John Doe" into a unique User ID ("john.doe", "john.doe2", ...) against the live table. */
export async function usernameFor(name, excludeId) {
  const base = slugifyName(name);
  const [rows] = await exec("SELECT id, username FROM employees");
  const taken = new Set(
    rows.filter(r => r.id !== excludeId).map(r => r.username.toLowerCase())
  );
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(base + n)) n++;
  return base + n;
}
/** Same dedup rule as usernameFor, but against an in-memory set — for building a batch (e.g. a seed run) at once. */
export function usernameForBatch(name, takenSet) {
  const base = slugifyName(name);
  let candidate = base, n = 2;
  while (takenSet.has(candidate)) candidate = base + n++;
  takenSet.add(candidate);
  return candidate;
}

export async function upsertEmployee(e) {
  const t = now();
  const [existingRows] = await exec("SELECT id, created_at FROM employees WHERE id = ?", [e.id]);
  const existing = existingRows[0];
  await exec(`
    INSERT INTO employees (id, name, initials, username, role, title, department_id, team_id,
                           manager_id, capacity_hours, color, active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      name = VALUES(name), initials = VALUES(initials), username = VALUES(username),
      role = VALUES(role), title = VALUES(title), department_id = VALUES(department_id),
      team_id = VALUES(team_id), manager_id = VALUES(manager_id),
      capacity_hours = VALUES(capacity_hours), color = VALUES(color),
      active = VALUES(active), updated_at = VALUES(updated_at)
  `, [
    e.id, e.name, e.initials || "", e.username,
    e.role === "manager" ? "manager" : "employee", e.title || "",
    e.departmentId || "", e.teamId || "",
    e.managerId || null, e.capacityHours || 40,
    e.color || "#0E7C86", e.active === false ? 0 : 1,
    existing ? existing.created_at : t, t
  ]);
  return getEmployee(e.id);
}
export const setPassword = async (id, hash, mustChange = 0) =>
  exec("UPDATE employees SET password_hash = ?, must_change_password = ?, updated_at = ? WHERE id = ?",
    [hash, mustChange ? 1 : 0, now(), id]);
export const touchLogin = async id =>
  exec("UPDATE employees SET last_login_at = ? WHERE id = ?", [now(), id]);
export const deleteEmployee = async id =>
  exec("UPDATE employees SET active = 0, updated_at = ? WHERE id = ?", [now(), id]);

/* ---------------------------------------------------------------- projects */

const projectOut = r => r && ({
  id: r.id, name: r.name, code: r.code, ownerId: r.owner_id, description: r.description,
  startDate: r.start_date, targetDate: r.target_date, status: r.status,
  createdAt: r.created_at, updatedAt: r.updated_at
});
export async function listProjects() {
  const [rows] = await exec("SELECT * FROM projects ORDER BY name");
  return rows.map(projectOut);
}
export async function getProject(id) {
  const [rows] = await exec("SELECT * FROM projects WHERE id = ?", [id]);
  return projectOut(rows[0]);
}

export async function upsertProject(p) {
  const t = now();
  const [existingRows] = await exec("SELECT created_at FROM projects WHERE id = ?", [p.id]);
  const existing = existingRows[0];
  await exec(`
    INSERT INTO projects (id, name, code, owner_id, description, start_date, target_date, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      name = VALUES(name), code = VALUES(code), owner_id = VALUES(owner_id),
      description = VALUES(description), start_date = VALUES(start_date),
      target_date = VALUES(target_date), status = VALUES(status), updated_at = VALUES(updated_at)
  `, [
    p.id, p.name, p.code || "", p.ownerId || null,
    p.description || "", p.startDate || null,
    p.targetDate || null, p.status || "ACTIVE",
    existing ? existing.created_at : t, t
  ]);
  return getProject(p.id);
}
export const deleteProject = async id => exec("DELETE FROM projects WHERE id = ?", [id]);

/* ------------------------------------------------------------------- tasks */

const taskOut = (r, comments, activity, attachments) => r && ({
  id: r.id, title: r.title, description: r.description,
  assigneeId: r.assignee_id, createdById: r.created_by_id,
  departmentId: r.department_id, teamId: r.team_id, projectId: r.project_id,
  category: r.category, priority: r.priority, status: r.status, progress: r.progress,
  startDate: r.start_date, dueDate: r.due_date, expectedCompletion: r.expected_completion,
  completedAt: r.completed_at, createdAt: r.created_at, updatedAt: r.updated_at,
  estimatedHours: r.estimated_hours, actualHours: r.actual_hours,
  reopenCount: r.reopen_count,
  boardCategory: r.board_category, assignedDate: r.assigned_date,
  pausedAt: r.paused_at, pausedMsTotal: r.paused_ms_total,
  tags: J(r.tags, []), blocker: J(r.blocker, null),
  dependencies: J(r.dependencies, []), links: J(r.links, []),
  comments: comments || [], activity: activity || [], attachments: attachments || []
});
const commentOut = c => ({ id: c.id, authorId: c.author_id, at: c.at, body: c.body, managerNote: !!c.manager_note });
const activityOut = a => ({ id: a.id, at: a.at, byId: a.by_id, byName: a.by_name, kind: a.kind, field: a.field, from: a.from_value, to: a.to_value, note: a.note });
const attachmentOut = a => ({ id: a.id, name: a.original_name, mimeType: a.mime_type, size: a.size, uploadedById: a.uploaded_by_id, uploadedAt: a.uploaded_at });

/** All tasks with their comments, activity and attachments, assembled in four
 *  parallel queries rather than 4N — this is what keeps the dashboard fast at 10k rows. */
export async function listTasks() {
  const [[rows], [comments], [activities], [attachments]] = await Promise.all([
    exec("SELECT * FROM tasks"),
    exec("SELECT * FROM task_comments ORDER BY at"),
    exec("SELECT * FROM task_activity ORDER BY at"),
    exec("SELECT * FROM task_attachments ORDER BY uploaded_at")
  ]);
  const cs = {}, as = {}, fs_ = {};
  for (const c of comments) (cs[c.task_id] ||= []).push(commentOut(c));
  for (const a of activities) (as[a.task_id] ||= []).push(activityOut(a));
  for (const f of attachments) (fs_[f.task_id] ||= []).push(attachmentOut(f));
  return rows.map(r => taskOut(r, cs[r.id], as[r.id], fs_[r.id]));
}
export async function getTask(id) {
  const [rows] = await exec("SELECT * FROM tasks WHERE id = ?", [id]);
  const r = rows[0];
  if (!r) return null;
  const [[comments], [activities], [attachments]] = await Promise.all([
    exec("SELECT * FROM task_comments WHERE task_id = ? ORDER BY at", [id]),
    exec("SELECT * FROM task_activity WHERE task_id = ? ORDER BY at", [id]),
    exec("SELECT * FROM task_attachments WHERE task_id = ? ORDER BY uploaded_at", [id])
  ]);
  return taskOut(r, comments.map(commentOut), activities.map(activityOut), attachments.map(attachmentOut));
}

export async function upsertTask(t) {
  const ts = now();
  const [existingRows] = await exec("SELECT created_at FROM tasks WHERE id = ?", [t.id]);
  const existing = existingRows[0];
  const num = v => (v === "" || v == null || isNaN(Number(v))) ? null : Number(v);
  await exec(`
    INSERT INTO tasks (id, title, description, assignee_id, created_by_id, department_id, team_id,
      project_id, category, priority, status, progress, start_date, due_date, expected_completion,
      completed_at, estimated_hours, actual_hours, reopen_count, board_category, assigned_date,
      paused_at, paused_ms_total, tags, blocker, dependencies, links, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      title = VALUES(title), description = VALUES(description), assignee_id = VALUES(assignee_id),
      department_id = VALUES(department_id), team_id = VALUES(team_id), project_id = VALUES(project_id),
      category = VALUES(category), priority = VALUES(priority), status = VALUES(status),
      progress = VALUES(progress), start_date = VALUES(start_date), due_date = VALUES(due_date),
      expected_completion = VALUES(expected_completion), completed_at = VALUES(completed_at),
      estimated_hours = VALUES(estimated_hours), actual_hours = VALUES(actual_hours),
      reopen_count = VALUES(reopen_count), board_category = VALUES(board_category),
      assigned_date = VALUES(assigned_date), paused_at = VALUES(paused_at),
      paused_ms_total = VALUES(paused_ms_total), tags = VALUES(tags), blocker = VALUES(blocker),
      dependencies = VALUES(dependencies), links = VALUES(links), updated_at = VALUES(updated_at)
  `, [
    t.id, t.title, t.description || "",
    t.assigneeId || null, t.createdById || null,
    t.departmentId || "", t.teamId || "",
    t.projectId || null, t.category || "",
    t.priority, t.status, Number(t.progress) || 0,
    t.startDate || null, t.dueDate || null,
    t.expectedCompletion || null, t.completedAt || null,
    num(t.estimatedHours), num(t.actualHours),
    Number(t.reopenCount) || 0,
    // Defaulted here (not just in the HTTP write path) so every caller — the
    // seed scripts included, which write tasks straight through this
    // function — gets a task the assignment timer can read correctly.
    t.boardCategory || "to_do", (t.assignedDate || t.createdAt || existing?.created_at || ts).slice(0, 10),
    t.pausedAt || null, Number(t.pausedMsTotal) || 0,
    JSON.stringify(t.tags || []),
    t.blocker ? JSON.stringify(t.blocker) : null,
    JSON.stringify(t.dependencies || []),
    JSON.stringify(t.links || []),
    existing ? existing.created_at : (t.createdAt || ts),
    t.updatedAt || ts
  ]);
  return t.id;
}
export const deleteTask = async id => exec("DELETE FROM tasks WHERE id = ?", [id]);

export const addComment = async (taskId, c) =>
  exec("INSERT INTO task_comments (id, task_id, author_id, at, body, manager_note) VALUES (?, ?, ?, ?, ?, ?)",
    [c.id, taskId, c.authorId || null, c.at, c.body, c.managerNote ? 1 : 0]);
export async function commentIds(taskId) {
  const [rows] = await exec("SELECT id FROM task_comments WHERE task_id = ?", [taskId]);
  return rows.map(r => r.id);
}

export const addActivity = async (taskId, a) =>
  exec(
    "INSERT INTO task_activity (id, task_id, at, by_id, by_name, kind, field, from_value, to_value, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [a.id, taskId, a.at, a.byId || null, a.byName || "", a.kind, a.field || null,
     a.from == null ? null : String(a.from), a.to == null ? null : String(a.to), a.note || null]
  );

export const addAttachment = async (taskId, a) =>
  exec(
    `INSERT INTO task_attachments (id, task_id, filename, original_name, mime_type, size, uploaded_by_id, uploaded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [a.id, taskId, a.filename, a.originalName, a.mimeType || "", a.size || 0, a.uploadedById || null, a.uploadedAt]
  );
export async function getAttachmentRow(id) {
  const [rows] = await exec("SELECT * FROM task_attachments WHERE id = ?", [id]);
  return rows[0];
}
export const deleteAttachmentRow = async id => exec("DELETE FROM task_attachments WHERE id = ?", [id]);

/* ------------------------------------------------------------- notifications */

const notificationOut = r => ({
  id: r.id, employeeId: r.employee_id, taskId: r.task_id, activityId: r.activity_id,
  kind: r.kind, text: r.text, at: r.created_at, readAt: r.read_at
});

export const addNotification = async n =>
  exec(
    `INSERT INTO notifications (id, employee_id, task_id, activity_id, kind, text, created_at, read_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [n.id, n.employeeId, n.taskId || null, n.activityId || null, n.kind, n.text, n.createdAt, n.readAt || null]
  );

/** One employee's notifications, most recent first, capped like the old client-side list was. */
export async function listNotifications(employeeId, limit = 40) {
  const [rows] = await exec(
    "SELECT * FROM notifications WHERE employee_id = ? ORDER BY created_at DESC LIMIT ?",
    [employeeId, limit]
  );
  return rows.map(notificationOut);
}

export async function getNotification(id) {
  const [rows] = await exec("SELECT * FROM notifications WHERE id = ?", [id]);
  return rows[0] ? notificationOut(rows[0]) : null;
}

export const markNotificationRead = async (id, employeeId, at) =>
  exec("UPDATE notifications SET read_at = ? WHERE id = ? AND employee_id = ?", [at, id, employeeId]);

export const markAllNotificationsRead = async (employeeId, at) =>
  exec("UPDATE notifications SET read_at = ? WHERE employee_id = ? AND read_at IS NULL", [at, employeeId]);

/** A single employee's overrides on top of the global notify defaults. */
export async function getEmployeeNotifyPrefs(employeeId) {
  const [rows] = await exec("SELECT `key`, value FROM employee_notify_prefs WHERE employee_id = ?", [employeeId]);
  const out = {};
  for (const r of rows) out[r.key] = !!r.value;
  return out;
}
export async function setEmployeeNotifyPrefs(employeeId, patch) {
  const ts = now();
  await Promise.all(Object.entries(patch || {}).map(([key, value]) =>
    exec(
      "INSERT INTO employee_notify_prefs (employee_id, `key`, value, updated_at) VALUES (?, ?, ?, ?) " +
      "ON DUPLICATE KEY UPDATE value = VALUES(value), updated_at = VALUES(updated_at)",
      [employeeId, key, value ? 1 : 0, ts]
    )
  ));
}

export async function nextTaskId() {
  const [rows] = await exec("SELECT id FROM tasks WHERE id LIKE 'TSK-%' ORDER BY id DESC LIMIT 1");
  const row = rows[0];
  const n = row ? Number(String(row.id).slice(4)) : 0;
  return "TSK-" + String((isNaN(n) ? 0 : n) + 1).padStart(4, "0");
}

/* ---------------------------------------------------------- daily updates */

const updateOut = r => ({ date: r.date, at: r.at, completed: r.completed, current: r.current, next: r.next, blocked: r.blocked, help: r.help, note: r.note });

/** Grouped per employee, matching the shape the dashboard renders. */
export async function listUpdates() {
  const [rows] = await exec("SELECT * FROM daily_updates ORDER BY date");
  const byEmp = {};
  for (const r of rows) (byEmp[r.employee_id] ||= { id: r.employee_id, employeeId: r.employee_id, entries: [] }).entries.push(updateOut(r));
  return Object.values(byEmp);
}
export async function upsertUpdate(employeeId, e) {
  await exec(`
    INSERT INTO daily_updates (id, employee_id, date, at, completed, current, next, blocked, help, note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      at = VALUES(at), completed = VALUES(completed), current = VALUES(current),
      next = VALUES(next), blocked = VALUES(blocked), help = VALUES(help), note = VALUES(note)
  `, [
    employeeId + ":" + e.date, employeeId, e.date, e.at || now(),
    e.completed || "", e.current || "", e.next || "",
    e.blocked || "", e.help || "", e.note || ""
  ]);
}

/* -------------------------------------------------------------------- breaks */

const breakOut = r => r && ({
  id: r.id, employeeId: r.employee_id, kind: r.kind, startedAt: r.started_at, endedAt: r.ended_at,
  durationSec: r.duration_sec, createdAt: r.created_at, updatedAt: r.updated_at
});

/** One employee's break history, most recent first. */
export async function listBreaks(employeeId) {
  const [rows] = await exec("SELECT * FROM breaks WHERE employee_id = ? ORDER BY started_at DESC", [employeeId]);
  return rows.map(breakOut);
}

/** Every break for every employee — used for the manager-wide bootstrap. */
export async function listAllBreaks() {
  const [rows] = await exec("SELECT * FROM breaks ORDER BY started_at DESC");
  return rows.map(breakOut);
}

/** The break in progress for someone, or null. */
export async function getOpenBreak(employeeId) {
  const [rows] = await exec("SELECT * FROM breaks WHERE employee_id = ? AND ended_at IS NULL", [employeeId]);
  return breakOut(rows[0]);
}

/** Has this person already started this break kind today (any status)? Backs the once-per-type-per-day rule.
 *  started_at is a stored ISO-8601 UTC string, not a native DATETIME, so "today" is a plain string-prefix
 *  compare against today's UTC date rather than a SQL date function. */
export async function usedBreakKindToday(employeeId, kind) {
  const today = new Date().toISOString().slice(0, 10);
  const [rows] = await exec(
    "SELECT 1 FROM breaks WHERE employee_id = ? AND kind = ? AND LEFT(started_at, 10) = ? LIMIT 1",
    [employeeId, kind, today]
  );
  return !!rows[0];
}

export async function startBreak(id, employeeId, kind) {
  const t = now();
  await exec(`INSERT INTO breaks (id, employee_id, kind, started_at, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?)`, [id, employeeId, kind, t, t, t]);
  return getOpenBreak(employeeId);
}

export async function endBreak(id) {
  const [rows] = await exec("SELECT * FROM breaks WHERE id = ?", [id]);
  const row = rows[0];
  if (!row || row.ended_at) return breakOut(row);
  const t = now();
  const durationSec = Math.max(0, Math.round((new Date(t) - new Date(row.started_at)) / 1000));
  await exec("UPDATE breaks SET ended_at = ?, duration_sec = ?, updated_at = ? WHERE id = ?",
    [t, durationSec, t, id]);
  const [rows2] = await exec("SELECT * FROM breaks WHERE id = ?", [id]);
  return breakOut(rows2[0]);
}

/* ---------------------------------------------------------------- sessions */

export const createSession = async (id, employeeId, expiresAt) =>
  exec("INSERT INTO sessions (id, employee_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
    [id, employeeId, now(), expiresAt]);
export async function readSession(id) {
  const [rows] = await exec("SELECT * FROM sessions WHERE id = ? AND expires_at > ?", [id, now()]);
  return rows[0];
}
export const dropSession = async id => exec("DELETE FROM sessions WHERE id = ?", [id]);
export const dropSessionsFor = async employeeId => exec("DELETE FROM sessions WHERE employee_id = ?", [employeeId]);
export const purgeSessions = async () => exec("DELETE FROM sessions WHERE expires_at <= ?", [now()]);
