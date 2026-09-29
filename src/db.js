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
import { randomUUID } from "node:crypto";

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
    await migrateEmployeeRoleCheck(conn);
    await migrateEmployeeCapabilitiesColumn(conn);
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

/** Older databases have `employees.role CHECK (role IN ('manager','employee'))`
 *  from before the Team Lead role — CREATE TABLE IF NOT EXISTS is a no-op
 *  against an existing table, so widen the constraint here if it's still the
 *  old two-value one. Looked up by clause text, not a fixed constraint name,
 *  since MySQL and MariaDB (this app runs on both) auto-name an unnamed
 *  single-column CHECK differently. A server old enough to not enforce CHECK
 *  at all (see schema.sql's own note) has nothing here to widen — harmless.
 *
 *  How the old CHECK is dropped depends on the server: MySQL 8.0.16+ needs
 *  `DROP CHECK <name>` (a plain `MODIFY COLUMN` leaves the old constraint in
 *  place, so re-adding one with the same name fails with
 *  ER_CHECK_CONSTRAINT_DUP_NAME and the old two-value rule keeps rejecting
 *  'teamlead'); MariaDB rejects DROP CHECK/DROP CONSTRAINT on the auto-named
 *  inline CHECK (ER_CANT_DROP_FIELD_OR_KEY) but silently drops it on
 *  `MODIFY COLUMN` without a CHECK clause. Try each in turn, then add the
 *  widened rule under a fresh name so it can never collide with the old one. */
async function migrateEmployeeRoleCheck(conn) {
  const [rows] = await conn.query(`
    SELECT tc.CONSTRAINT_NAME, cc.CHECK_CLAUSE
    FROM information_schema.TABLE_CONSTRAINTS tc
    JOIN information_schema.CHECK_CONSTRAINTS cc
      ON tc.CONSTRAINT_NAME = cc.CONSTRAINT_NAME AND tc.CONSTRAINT_SCHEMA = cc.CONSTRAINT_SCHEMA
    WHERE tc.TABLE_NAME = 'employees' AND tc.CONSTRAINT_SCHEMA = DATABASE() AND tc.CONSTRAINT_TYPE = 'CHECK'
  `);
  const roleConstraint = rows.find(r => /\brole\b/i.test(r.CHECK_CLAUSE) && /manager/i.test(r.CHECK_CLAUSE));
  if (roleConstraint && !/teamlead/i.test(roleConstraint.CHECK_CLAUSE)) {
    const name = roleConstraint.CONSTRAINT_NAME.replace(/`/g, "``");
    const drops = [
      `ALTER TABLE employees DROP CHECK \`${name}\``,
      `ALTER TABLE employees DROP CONSTRAINT \`${name}\``,
      "ALTER TABLE employees MODIFY COLUMN role VARCHAR(16) NOT NULL DEFAULT 'employee'"
    ];
    let lastErr = null, dropped = false;
    for (const sql of drops) {
      try { await conn.query(sql); dropped = true; break; } catch (err) { lastErr = err; }
    }
    if (!dropped) throw lastErr;
    await conn.query("ALTER TABLE employees ADD CONSTRAINT `employees_role_chk` CHECK (role IN ('manager','employee','teamlead'))");
  }
}

/** Older databases predate the per-team-lead capability picker and/or the
 *  multi-team "managed_teams" extension — add whichever column CREATE TABLE
 *  IF NOT EXISTS was a no-op against on an existing table. */
async function migrateEmployeeCapabilitiesColumn(conn) {
  const [cols] = await conn.query(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employees'"
  );
  const names = new Set(cols.map(c => c.COLUMN_NAME));
  if (!names.has("capabilities")) await conn.query("ALTER TABLE employees ADD COLUMN capabilities TEXT NOT NULL");
  if (!names.has("managed_teams")) await conn.query("ALTER TABLE employees ADD COLUMN managed_teams TEXT NOT NULL");
  // TEXT can't carry a DEFAULT on MySQL < 8.0.13, so backfill rows the ALTER left empty.
  await conn.query("UPDATE employees SET capabilities = '[]' WHERE capabilities = ''");
  await conn.query("UPDATE employees SET managed_teams = '[]' WHERE managed_teams = ''");
}

/** Every exported function funnels through this — ensures the pool exists and
 *  schema.sql has run before the first real query, memoized so concurrent
 *  callers (e.g. a Promise.all of several queries) only trigger it once. */
async function exec(sql, params) {
  const p = getPool();
  if (!schemaReady) {
    // Clear the memo on failure so a transient DB outage at boot doesn't
    // poison every later query — the next call retries the schema.
    schemaReady = applySchema().catch(err => { schemaReady = null; throw err; });
  }
  await schemaReady;
  return p.execute(sql, params);
}

export const now = () => new Date().toISOString();
const J = (v, fallback) => { try { return v == null ? fallback : JSON.parse(v); } catch { return fallback; } };

/** Used only by seed scripts to reset to an empty database. Order matters: children before parents. */
export async function wipeAllTables() {
  for (const table of [
    "complaint_votes", "complaints",
    "good_vibes_likes", "good_vibes_comments", "good_vibes_posts", "good_vibes_assignments", "good_vibes_rotation_order",
    "task_activity", "task_comments", "tasks", "daily_updates", "projects", "sessions", "employees", "config"
  ]) {
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
  hiddenNav: [],    // manager-only nav view keys a manager has hidden from everyone's sidebar
  // Whole-feature on/off switches a manager flips from Settings > "Features" — unlike
  // hiddenNav (manager-only views, hidden from the manager's own sidebar), these gate
  // views shared with employees/team leads, for every role, and are enforced here on
  // the server too (see the feature-gate middleware in routes/goodvibes.js and
  // routes/complaints.js), not just hidden client-side. Missing/undefined reads as on.
  featureFlags: { goodVibes: true, complaints: true, website: true },
  // All Tasks table column ids a manager has hidden from everyone's table — hidden by
  // default (the table is dense with all 15 columns shown); re-enable any of these
  // from Settings > "All tasks — optional columns".
  hiddenTaskCols: ["progress", "created", "due", "expected", "updated", "est", "act", "blocker", "attention"],
  // Manager-chosen display order for that same set of optional columns, draggable
  // from the same Settings panel. Core columns (id/title/assignee/project/priority/
  // status) always stay first and are never reordered.
  taskColOrder: ["progress", "created", "due", "expected", "updated", "est", "act", "blocker", "attention"]
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
  capabilities: J(r.capabilities, []),
  managedTeams: J(r.managed_teams, []),
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
  const role = ["manager", "teamlead"].includes(e.role) ? e.role : "employee";
  // Capabilities/managed teams only mean anything for a team lead — clear
  // them on anyone else so a later re-promotion never resurrects a stale grant.
  const capabilities = role === "teamlead" ? JSON.stringify(Array.isArray(e.capabilities) ? e.capabilities : []) : "[]";
  const managedTeams = role === "teamlead" ? JSON.stringify(Array.isArray(e.managedTeams) ? e.managedTeams : []) : "[]";
  await exec(`
    INSERT INTO employees (id, name, initials, username, role, title, department_id, team_id,
                           manager_id, capacity_hours, color, capabilities, managed_teams, active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      name = VALUES(name), initials = VALUES(initials), username = VALUES(username),
      role = VALUES(role), title = VALUES(title), department_id = VALUES(department_id),
      team_id = VALUES(team_id), manager_id = VALUES(manager_id),
      capacity_hours = VALUES(capacity_hours), color = VALUES(color), capabilities = VALUES(capabilities),
      managed_teams = VALUES(managed_teams), active = VALUES(active), updated_at = VALUES(updated_at)
  `, [
    e.id, e.name, e.initials || "", e.username,
    role, e.title || "",
    e.departmentId || "", e.teamId || "",
    e.managerId || null, e.capacityHours || 40,
    e.color || "#0E7C86", capabilities, managedTeams, e.active === false ? 0 : 1,
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
export async function countProjects() {
  const [rows] = await exec("SELECT COUNT(*) AS c FROM projects");
  return rows[0].c;
}
export const deleteAllProjects = async () => exec("DELETE FROM projects");

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
export async function countTasks() {
  const [rows] = await exec("SELECT COUNT(*) AS c FROM tasks");
  return rows[0].c;
}
export const deleteAllTasks = async () => exec("DELETE FROM tasks");

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
export async function listAttachmentFilenames() {
  const [rows] = await exec("SELECT filename FROM task_attachments");
  return rows.map(r => r.filename);
}

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

/* ------------------------------------------------------------ good vibes wall */
// Storage only — the business rules (isWorkingDay/nextInRotation/projectUpcoming
// in src/domain.js) are duplicated as tiny private helpers below rather than
// imported, to avoid a circular import (domain.js already imports getConfig
// from this file); same "duplicate, don't couple" convention this codebase
// already uses for BREAK_TYPES/BOARD_CATEGORIES between client and server.
const _isWorkingDay = (dateISO, workingDays) => (workingDays || []).includes(new Date(dateISO + "T00:00:00Z").getUTCDay());
const _nextInRotation = (order, currentId) => {
  if (!order.length) return null;
  const idx = order.indexOf(currentId);
  return order[(idx === -1 ? 0 : idx + 1) % order.length];
};
const _addDaysISO = (dateISO, n) => {
  const d = new Date(dateISO + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const gvRotationRowOut = r => ({ employeeId: r.employee_id, name: r.name, active: !!r.active, sortOrder: r.sort_order });

/** Appends any employee missing from the rotation order table, alphabetically
 *  (matching listEmployees()'s own ORDER BY name), after whatever's already there. */
export async function ensureRotationSeeded() {
  const [existing] = await exec("SELECT employee_id FROM good_vibes_rotation_order");
  const known = new Set(existing.map(r => r.employee_id));
  const [empRows] = await exec("SELECT id FROM employees ORDER BY name");
  const missing = empRows.filter(r => !known.has(r.id));
  if (!missing.length) return;
  const [maxRows] = await exec("SELECT COALESCE(MAX(sort_order), 0) AS maxOrder FROM good_vibes_rotation_order");
  let next = maxRows[0].maxOrder + 1;
  const t = now();
  for (const r of missing) {
    await exec("INSERT INTO good_vibes_rotation_order (employee_id, sort_order, updated_at) VALUES (?, ?, ?)", [r.id, next++, t]);
  }
}

/** Active employees only, in rotation order — this *is* the "skip inactive
 *  employees" rule: they're simply excluded from the working sequence. */
export async function getActiveRotationOrder() {
  await ensureRotationSeeded();
  const [rows] = await exec(`
    SELECT r.employee_id FROM good_vibes_rotation_order r
    JOIN employees e ON e.id = r.employee_id
    WHERE e.active = 1
    ORDER BY r.sort_order
  `);
  return rows.map(r => r.employee_id);
}

/** Every employee (active + inactive) in rotation order, for the admin screen. */
export async function listRotationAdmin() {
  await ensureRotationSeeded();
  const [rows] = await exec(`
    SELECT r.employee_id, r.sort_order, e.name, e.active
    FROM good_vibes_rotation_order r
    JOIN employees e ON e.id = r.employee_id
    ORDER BY r.sort_order
  `);
  return rows.map(gvRotationRowOut);
}

/** Rewrites sort_order 1..N for a full permutation of the known set. */
export async function setRotationOrder(employeeIds) {
  const t = now();
  for (let i = 0; i < employeeIds.length; i++) {
    await exec("UPDATE good_vibes_rotation_order SET sort_order = ?, updated_at = ? WHERE employee_id = ?", [i + 1, t, employeeIds[i]]);
  }
  return listRotationAdmin();
}

const gvAssignmentOut = r => r && ({
  id: r.id, date: r.date, employeeId: r.employee_id, status: r.status,
  skippedEmployeeId: r.skipped_employee_id, reassignedById: r.reassigned_by_id,
  createdAt: r.created_at, updatedAt: r.updated_at
});
export async function getLatestAssignment() {
  const [rows] = await exec("SELECT * FROM good_vibes_assignments ORDER BY date DESC LIMIT 1");
  return gvAssignmentOut(rows[0]);
}
export async function getAssignmentByDate(date) {
  const [rows] = await exec("SELECT * FROM good_vibes_assignments WHERE date = ?", [date]);
  return gvAssignmentOut(rows[0]);
}
export async function insertAssignment(row) {
  const t = now();
  await exec(
    `INSERT INTO good_vibes_assignments (id, date, employee_id, status, skipped_employee_id, reassigned_by_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [row.id, row.date, row.employeeId, row.status || "scheduled", row.skippedEmployeeId || null, row.reassignedById || null, t, t]
  );
  return getAssignmentByDate(row.date);
}
/** Used by admin skip/reassign — overwrites who holds a day's slot. */
export async function updateAssignment(id, patch) {
  const t = now();
  await exec(
    `UPDATE good_vibes_assignments SET employee_id = ?, status = ?, skipped_employee_id = ?, reassigned_by_id = ?, updated_at = ? WHERE id = ?`,
    [patch.employeeId, patch.status, patch.skippedEmployeeId || null, patch.reassignedById || null, t, id]
  );
  const [rows] = await exec("SELECT * FROM good_vibes_assignments WHERE id = ?", [id]);
  return gvAssignmentOut(rows[0]);
}

/** Walks the rotation forward one working day at a time from the last known
 *  assignment through targetDateISO (inclusive), creating a real row (and a
 *  "your turn" notification) for every intervening working day — not just
 *  jumping to today — so a gap (a weekend, the app going untouched a few
 *  days) never silently drops a turn. Runs at request time; there's no
 *  cron/scheduler in this app. Idempotent: a concurrent duplicate insert on
 *  the same date (UNIQUE(date)) is treated as a no-op, not an error. */
export async function ensureAssignmentsThrough(targetDateISO) {
  const config = await getConfig();
  const workingDays = (config.workingDays && config.workingDays.length) ? config.workingDays : [1, 2, 3, 4, 5];
  const order = await getActiveRotationOrder();
  if (!order.length) return [];

  const created = [];
  const insertOnce = async row => {
    try {
      const saved = await insertAssignment(row);
      created.push(saved);
      await addNotification({
        id: randomUUID(), employeeId: saved.employeeId, taskId: null, activityId: null,
        kind: "goodvibes_turn", text: "It's your turn on the Good Vibes Wall!", createdAt: saved.createdAt, readAt: null
      });
      return saved;
    } catch (e) {
      if (e && e.code === "ER_DUP_ENTRY") return getAssignmentByDate(row.date);
      throw e;
    }
  };

  let last = await getLatestAssignment();
  if (!last) {
    if (_isWorkingDay(targetDateISO, workingDays)) await insertOnce({ id: randomUUID(), date: targetDateISO, employeeId: order[0] });
    return created;
  }

  let cursorDate = _addDaysISO(last.date, 1);
  let cursorEmployeeId = last.employeeId;
  let guard = 0;
  while (cursorDate <= targetDateISO && guard++ < 3650) {
    if (_isWorkingDay(cursorDate, workingDays)) {
      cursorEmployeeId = _nextInRotation(order, cursorEmployeeId);
      const saved = await insertOnce({ id: randomUUID(), date: cursorDate, employeeId: cursorEmployeeId });
      cursorEmployeeId = saved.employeeId;   // in case a concurrent request already claimed this date
    }
    cursorDate = _addDaysISO(cursorDate, 1);
  }
  return created;
}

const gvPostOut = r => r && ({
  id: r.id, assignmentId: r.assignment_id, employeeId: r.employee_id,
  category: r.category, body: r.body,
  hiddenAt: r.hidden_at, hiddenById: r.hidden_by_id,
  createdAt: r.created_at, updatedAt: r.updated_at
});
const gvCommentOut = r => ({
  id: r.id, postId: r.post_id, authorId: r.author_id, at: r.at, body: r.body,
  hiddenAt: r.hidden_at, hiddenById: r.hidden_by_id
});

/** Every post (comments and like count nested), newest first, assembled in
 *  three parallel queries — same "N queries, not N×M" shape as listTasks(). */
export async function listGvPosts({ includeHidden = false, viewerEmployeeId = null } = {}) {
  const postWhere = includeHidden ? "" : "WHERE hidden_at IS NULL";
  const commentWhere = includeHidden ? "" : "WHERE hidden_at IS NULL";
  const [[posts], [likes], [comments]] = await Promise.all([
    exec(`SELECT * FROM good_vibes_posts ${postWhere} ORDER BY created_at DESC`),
    exec("SELECT * FROM good_vibes_likes"),
    exec(`SELECT * FROM good_vibes_comments ${commentWhere} ORDER BY at`)
  ]);
  const likesByPost = {}, commentsByPost = {};
  for (const l of likes) (likesByPost[l.post_id] ||= []).push(l);
  for (const c of comments) (commentsByPost[c.post_id] ||= []).push(gvCommentOut(c));
  return posts.map(p => {
    const postLikes = likesByPost[p.id] || [];
    return {
      ...gvPostOut(p),
      likeCount: postLikes.length,
      likedByMe: viewerEmployeeId ? postLikes.some(l => l.employee_id === viewerEmployeeId) : false,
      comments: commentsByPost[p.id] || []
    };
  });
}
export async function getGvPost(id) {
  const [rows] = await exec("SELECT * FROM good_vibes_posts WHERE id = ?", [id]);
  return gvPostOut(rows[0]);
}
export async function getGvPostByAssignment(assignmentId) {
  const [rows] = await exec("SELECT * FROM good_vibes_posts WHERE assignment_id = ?", [assignmentId]);
  return gvPostOut(rows[0]);
}
export async function insertGvPost(row) {
  const t = now();
  await exec(
    `INSERT INTO good_vibes_posts (id, assignment_id, employee_id, category, body, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [row.id, row.assignmentId, row.employeeId, row.category, row.body, t, t]
  );
  return getGvPost(row.id);
}
export const hideGvPost = async (id, byId) =>
  exec("UPDATE good_vibes_posts SET hidden_at = ?, hidden_by_id = ? WHERE id = ?", [now(), byId, id]);

/** Toggle: delete-if-exists else insert. Returns the resulting state. */
export async function toggleGvLike(postId, employeeId) {
  const [existing] = await exec("SELECT id FROM good_vibes_likes WHERE post_id = ? AND employee_id = ?", [postId, employeeId]);
  if (existing[0]) await exec("DELETE FROM good_vibes_likes WHERE id = ?", [existing[0].id]);
  else await exec("INSERT INTO good_vibes_likes (id, post_id, employee_id, created_at) VALUES (?, ?, ?, ?)", [randomUUID(), postId, employeeId, now()]);
  const [countRows] = await exec("SELECT COUNT(*) AS n FROM good_vibes_likes WHERE post_id = ?", [postId]);
  return { liked: !existing[0], likeCount: countRows[0].n };
}

export async function addGvComment(postId, row) {
  await exec(
    "INSERT INTO good_vibes_comments (id, post_id, author_id, at, body) VALUES (?, ?, ?, ?, ?)",
    [row.id, postId, row.authorId || null, row.at, row.body]
  );
  return gvCommentOut({ id: row.id, post_id: postId, author_id: row.authorId || null, at: row.at, body: row.body, hidden_at: null, hidden_by_id: null });
}
export const hideGvComment = async (id, byId) =>
  exec("UPDATE good_vibes_comments SET hidden_at = ?, hidden_by_id = ? WHERE id = ?", [now(), byId, id]);

/** One round trip for the Good Vibes Wall page: today's assignment (with its
 *  post, if any), the visible posts feed, and a read-only preview of who's
 *  next. Also the piece shared field-for-field with /api/bootstrap. */
export async function getGoodVibesBootstrap({ viewerEmployeeId = null, includeHidden = false, upcomingCount = 5 } = {}) {
  const todayDate = now().slice(0, 10);
  await ensureAssignmentsThrough(todayDate);
  const [todayAssignment, posts, order] = await Promise.all([
    getAssignmentByDate(todayDate),
    listGvPosts({ includeHidden, viewerEmployeeId }),
    getActiveRotationOrder()
  ]);
  const todayPost = todayAssignment ? (posts.find(p => p.assignmentId === todayAssignment.id) || null) : null;
  const upcoming = [];
  if (order.length) {
    let cursor = todayAssignment ? todayAssignment.employeeId : null;
    for (let i = 0; i < upcomingCount; i++) {
      cursor = _nextInRotation(order, cursor);
      if (cursor == null) break;
      upcoming.push(cursor);
    }
  }
  return {
    today: todayAssignment ? { ...todayAssignment, post: todayPost } : null,
    posts,
    upcoming
  };
}

/* --------------------------------------------------------- complaint wall */

/** yesVotes/noVotes/totalVotes are always included; employeeId, the
 *  publish/archive actor ids, and the individual `votes` array are added
 *  by the caller only for a manager viewer — the shape itself never
 *  carries the submitter's identity by default. */
const complaintOut = (r, votes) => {
  const yesVotes = votes.filter(v => v.believe).length;
  return {
    id: r.id, body: r.body, status: r.status, pollEnabled: !!r.poll_enabled,
    createdAt: r.created_at, updatedAt: r.updated_at,
    publishedAt: r.published_at, archivedAt: r.archived_at,
    yesVotes, noVotes: votes.length - yesVotes, totalVotes: votes.length
  };
};
async function getComplaintRow(id) {
  const [rows] = await exec("SELECT * FROM complaints WHERE id = ?", [id]);
  return rows[0];
}

/** Full, manager-shaped view of one complaint (identity + individual
 *  votes included) — used for the admin write routes and for checking a
 *  complaint's state before accepting a vote. Never hand this object
 *  straight back to a non-manager caller. */
export async function getComplaint(id) {
  const row = await getComplaintRow(id);
  if (!row) return null;
  const [votes] = await exec("SELECT * FROM complaint_votes WHERE complaint_id = ?", [id]);
  const out = complaintOut(row, votes);
  out.employeeId = row.employee_id;
  out.publishedById = row.published_by_id;
  out.archivedById = row.archived_by_id;
  out.votes = votes.map(v => ({ employeeId: v.employee_id, believe: !!v.believe, at: v.created_at }));
  return out;
}

/** Managers see every complaint in every status, with identity and
 *  individual votes. Everyone else sees only published complaints,
 *  anonymized, with just the vote totals plus their own vote (if any). */
export async function listComplaints({ isManagerView = false, viewerId = null } = {}) {
  const where = isManagerView ? "" : "WHERE status = 'published'";
  const [[rows], [allVotes]] = await Promise.all([
    exec(`SELECT * FROM complaints ${where} ORDER BY created_at DESC`),
    exec("SELECT * FROM complaint_votes")
  ]);
  const votesByComplaint = {};
  for (const v of allVotes) (votesByComplaint[v.complaint_id] ||= []).push(v);
  return rows.map(r => {
    const votes = votesByComplaint[r.id] || [];
    const out = complaintOut(r, votes);
    const mine = viewerId ? votes.find(v => v.employee_id === viewerId) : null;
    out.myVote = mine ? !!mine.believe : null;
    if (isManagerView) {
      out.employeeId = r.employee_id;
      out.publishedById = r.published_by_id;
      out.archivedById = r.archived_by_id;
      out.votes = votes.map(v => ({ employeeId: v.employee_id, believe: !!v.believe, at: v.created_at }));
    }
    return out;
  });
}

export async function insertComplaint(row) {
  const t = now();
  await exec(
    `INSERT INTO complaints (id, employee_id, body, status, poll_enabled, created_at, updated_at)
     VALUES (?, ?, ?, 'pending', 0, ?, ?)`,
    [row.id, row.employeeId, row.body, t, t]
  );
  return getComplaint(row.id);
}

/** Manager-only write: move a complaint between pending/published/archived
 *  and/or toggle its poll. Publish/archive timestamps and actor ids are
 *  only (re)stamped the moment status actually changes into that state. */
export async function updateComplaint(id, { status, pollEnabled, byId } = {}) {
  const existing = await getComplaintRow(id);
  if (!existing) return null;
  const t = now();
  const nextStatus = status !== undefined ? status : existing.status;
  const enteringPublished = status === "published" && existing.status !== "published";
  const enteringArchived = status === "archived" && existing.status !== "archived";
  await exec(
    `UPDATE complaints SET status = ?, poll_enabled = ?, published_at = ?, published_by_id = ?,
       archived_at = ?, archived_by_id = ?, updated_at = ? WHERE id = ?`,
    [
      nextStatus,
      pollEnabled !== undefined ? (pollEnabled ? 1 : 0) : existing.poll_enabled,
      enteringPublished ? t : existing.published_at,
      enteringPublished ? byId : existing.published_by_id,
      enteringArchived ? t : existing.archived_at,
      enteringArchived ? byId : existing.archived_by_id,
      t, id
    ]
  );
  return getComplaint(id);
}

/** Upserts the voter's yes/no, then returns only the tally plus their own
 *  vote — never other employees' identities or individual votes, even
 *  though the caller may not be a manager. */
export async function castComplaintVote(complaintId, employeeId, believe) {
  await exec(
    `INSERT INTO complaint_votes (id, complaint_id, employee_id, believe, created_at) VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE believe = VALUES(believe), created_at = VALUES(created_at)`,
    [randomUUID(), complaintId, employeeId, believe ? 1 : 0, now()]
  );
  const [votes] = await exec("SELECT believe FROM complaint_votes WHERE complaint_id = ?", [complaintId]);
  const yesVotes = votes.filter(v => v.believe).length;
  return { yesVotes, noVotes: votes.length - yesVotes, totalVotes: votes.length, myVote: believe };
}
