/**
 * Database access. SQLite via better-sqlite3 (synchronous, which is the right
 * shape for a single-process internal tool — no connection pool to reason about).
 *
 * Rows are stored snake_case and handed to the API camelCase, so the SQL stays
 * idiomatic and the JSON the browser sees stays idiomatic too. The mapping
 * lives here and nowhere else.
 */
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DATABASE_PATH || path.join(HERE, "..", "data", "tcc.db");

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
export const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec(fs.readFileSync(path.join(HERE, "schema.sql"), "utf8"));

export const now = () => new Date().toISOString();
const J = (v, fallback) => { try { return v == null ? fallback : JSON.parse(v); } catch { return fallback; } };

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
  notify: { assigned: true, priority: true, dueSoon: true, overdue: true, blocked: true, comment: true, completed: false, reassigned: true, dependency: true, attachment: true }
};

export function getConfig() {
  const row = db.prepare("SELECT value FROM config WHERE key = 'settings'").get();
  return row ? { ...DEFAULT_CONFIG, ...J(row.value, {}) } : { ...DEFAULT_CONFIG };
}
export function setConfig(value) {
  db.prepare(`INSERT INTO config (key, value, updated_at) VALUES ('settings', ?, ?)
              ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
    .run(JSON.stringify(value), now());
  return getConfig();
}

/* --------------------------------------------------------------- employees */

const employeeOut = r => r && ({
  id: r.id, name: r.name, initials: r.initials, email: r.email,
  role: r.role, title: r.title,
  departmentId: r.department_id, teamId: r.team_id, managerId: r.manager_id,
  capacityHours: r.capacity_hours, color: r.color,
  active: !!r.active,
  mustChangePassword: !!r.must_change_password,
  hasPassword: !!r.password_hash,
  lastLoginAt: r.last_login_at,
  createdAt: r.created_at, updatedAt: r.updated_at
});

export const listEmployees = () =>
  db.prepare("SELECT * FROM employees ORDER BY name").all().map(employeeOut);
export const getEmployee = id =>
  employeeOut(db.prepare("SELECT * FROM employees WHERE id = ?").get(id));
export const getEmployeeByEmail = email =>
  db.prepare("SELECT * FROM employees WHERE email = ? COLLATE NOCASE").get(String(email || "").trim());
export const getPasswordHash = id =>
  (db.prepare("SELECT password_hash FROM employees WHERE id = ?").get(id) || {}).password_hash;

export function upsertEmployee(e) {
  const t = now();
  const existing = db.prepare("SELECT id, created_at FROM employees WHERE id = ?").get(e.id);
  db.prepare(`
    INSERT INTO employees (id, name, initials, email, role, title, department_id, team_id,
                           manager_id, capacity_hours, color, active, created_at, updated_at)
    VALUES (@id, @name, @initials, @email, @role, @title, @department_id, @team_id,
            @manager_id, @capacity_hours, @color, @active, @created_at, @updated_at)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name, initials = excluded.initials, email = excluded.email,
      role = excluded.role, title = excluded.title, department_id = excluded.department_id,
      team_id = excluded.team_id, manager_id = excluded.manager_id,
      capacity_hours = excluded.capacity_hours, color = excluded.color,
      active = excluded.active, updated_at = excluded.updated_at
  `).run({
    id: e.id, name: e.name, initials: e.initials || "", email: e.email,
    role: e.role === "manager" ? "manager" : "employee", title: e.title || "",
    department_id: e.departmentId || "", team_id: e.teamId || "",
    manager_id: e.managerId || null, capacity_hours: e.capacityHours || 40,
    color: e.color || "#0E7C86", active: e.active === false ? 0 : 1,
    created_at: existing ? existing.created_at : t, updated_at: t
  });
  return getEmployee(e.id);
}
export const setPassword = (id, hash, mustChange = 0) =>
  db.prepare("UPDATE employees SET password_hash = ?, must_change_password = ?, updated_at = ? WHERE id = ?")
    .run(hash, mustChange ? 1 : 0, now(), id);
export const touchLogin = id =>
  db.prepare("UPDATE employees SET last_login_at = ? WHERE id = ?").run(now(), id);
export const deleteEmployee = id =>
  db.prepare("UPDATE employees SET active = 0, updated_at = ? WHERE id = ?").run(now(), id);

/* ---------------------------------------------------------------- projects */

const projectOut = r => r && ({
  id: r.id, name: r.name, code: r.code, ownerId: r.owner_id, description: r.description,
  startDate: r.start_date, targetDate: r.target_date, status: r.status,
  createdAt: r.created_at, updatedAt: r.updated_at
});
export const listProjects = () =>
  db.prepare("SELECT * FROM projects ORDER BY name").all().map(projectOut);
export const getProject = id =>
  projectOut(db.prepare("SELECT * FROM projects WHERE id = ?").get(id));

export function upsertProject(p) {
  const t = now();
  const existing = db.prepare("SELECT created_at FROM projects WHERE id = ?").get(p.id);
  db.prepare(`
    INSERT INTO projects (id, name, code, owner_id, description, start_date, target_date, status, created_at, updated_at)
    VALUES (@id, @name, @code, @owner_id, @description, @start_date, @target_date, @status, @created_at, @updated_at)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name, code = excluded.code, owner_id = excluded.owner_id,
      description = excluded.description, start_date = excluded.start_date,
      target_date = excluded.target_date, status = excluded.status, updated_at = excluded.updated_at
  `).run({
    id: p.id, name: p.name, code: p.code || "", owner_id: p.ownerId || null,
    description: p.description || "", start_date: p.startDate || null,
    target_date: p.targetDate || null, status: p.status || "ACTIVE",
    created_at: existing ? existing.created_at : t, updated_at: t
  });
  return getProject(p.id);
}
export const deleteProject = id => db.prepare("DELETE FROM projects WHERE id = ?").run(id);

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
  tags: J(r.tags, []), blocker: J(r.blocker, null),
  dependencies: J(r.dependencies, []), links: J(r.links, []),
  comments: comments || [], activity: activity || [], attachments: attachments || []
});
const commentOut = c => ({ id: c.id, authorId: c.author_id, at: c.at, body: c.body, managerNote: !!c.manager_note });
const activityOut = a => ({ id: a.id, at: a.at, byId: a.by_id, byName: a.by_name, kind: a.kind, field: a.field, from: a.from_value, to: a.to_value, note: a.note });
const attachmentOut = a => ({ id: a.id, name: a.original_name, mimeType: a.mime_type, size: a.size, uploadedById: a.uploaded_by_id, uploadedAt: a.uploaded_at });

/** All tasks with their comments, activity and attachments, assembled in four
 *  queries rather than 4N — this is what keeps the dashboard fast at 10k rows. */
export function listTasks() {
  const rows = db.prepare("SELECT * FROM tasks").all();
  const cs = {}, as = {}, fs_ = {};
  for (const c of db.prepare("SELECT * FROM task_comments ORDER BY at").all()) (cs[c.task_id] ||= []).push(commentOut(c));
  for (const a of db.prepare("SELECT * FROM task_activity ORDER BY at").all()) (as[a.task_id] ||= []).push(activityOut(a));
  for (const f of db.prepare("SELECT * FROM task_attachments ORDER BY uploaded_at").all()) (fs_[f.task_id] ||= []).push(attachmentOut(f));
  return rows.map(r => taskOut(r, cs[r.id], as[r.id], fs_[r.id]));
}
export function getTask(id) {
  const r = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id);
  if (!r) return null;
  return taskOut(r,
    db.prepare("SELECT * FROM task_comments WHERE task_id = ? ORDER BY at").all(id).map(commentOut),
    db.prepare("SELECT * FROM task_activity WHERE task_id = ? ORDER BY at").all(id).map(activityOut),
    db.prepare("SELECT * FROM task_attachments WHERE task_id = ? ORDER BY uploaded_at").all(id).map(attachmentOut));
}

export function upsertTask(t) {
  const ts = now();
  const existing = db.prepare("SELECT created_at FROM tasks WHERE id = ?").get(t.id);
  const num = v => (v === "" || v == null || isNaN(Number(v))) ? null : Number(v);
  db.prepare(`
    INSERT INTO tasks (id, title, description, assignee_id, created_by_id, department_id, team_id,
      project_id, category, priority, status, progress, start_date, due_date, expected_completion,
      completed_at, estimated_hours, actual_hours, reopen_count, tags, blocker, dependencies, links,
      created_at, updated_at)
    VALUES (@id, @title, @description, @assignee_id, @created_by_id, @department_id, @team_id,
      @project_id, @category, @priority, @status, @progress, @start_date, @due_date, @expected_completion,
      @completed_at, @estimated_hours, @actual_hours, @reopen_count, @tags, @blocker, @dependencies, @links,
      @created_at, @updated_at)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title, description = excluded.description, assignee_id = excluded.assignee_id,
      department_id = excluded.department_id, team_id = excluded.team_id, project_id = excluded.project_id,
      category = excluded.category, priority = excluded.priority, status = excluded.status,
      progress = excluded.progress, start_date = excluded.start_date, due_date = excluded.due_date,
      expected_completion = excluded.expected_completion, completed_at = excluded.completed_at,
      estimated_hours = excluded.estimated_hours, actual_hours = excluded.actual_hours,
      reopen_count = excluded.reopen_count, tags = excluded.tags, blocker = excluded.blocker,
      dependencies = excluded.dependencies, links = excluded.links, updated_at = excluded.updated_at
  `).run({
    id: t.id, title: t.title, description: t.description || "",
    assignee_id: t.assigneeId || null, created_by_id: t.createdById || null,
    department_id: t.departmentId || "", team_id: t.teamId || "",
    project_id: t.projectId || null, category: t.category || "",
    priority: t.priority, status: t.status, progress: Number(t.progress) || 0,
    start_date: t.startDate || null, due_date: t.dueDate || null,
    expected_completion: t.expectedCompletion || null, completed_at: t.completedAt || null,
    estimated_hours: num(t.estimatedHours), actual_hours: num(t.actualHours),
    reopen_count: Number(t.reopenCount) || 0,
    tags: JSON.stringify(t.tags || []),
    blocker: t.blocker ? JSON.stringify(t.blocker) : null,
    dependencies: JSON.stringify(t.dependencies || []),
    links: JSON.stringify(t.links || []),
    created_at: existing ? existing.created_at : (t.createdAt || ts),
    updated_at: t.updatedAt || ts
  });
  return t.id;
}
export const deleteTask = id => db.prepare("DELETE FROM tasks WHERE id = ?").run(id);

export const addComment = (taskId, c) =>
  db.prepare("INSERT INTO task_comments (id, task_id, author_id, at, body, manager_note) VALUES (?,?,?,?,?,?)")
    .run(c.id, taskId, c.authorId || null, c.at, c.body, c.managerNote ? 1 : 0);
export const commentIds = taskId =>
  db.prepare("SELECT id FROM task_comments WHERE task_id = ?").all(taskId).map(r => r.id);

export const addActivity = (taskId, a) =>
  db.prepare("INSERT INTO task_activity (id, task_id, at, by_id, by_name, kind, field, from_value, to_value, note) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .run(a.id, taskId, a.at, a.byId || null, a.byName || "", a.kind, a.field || null,
         a.from == null ? null : String(a.from), a.to == null ? null : String(a.to), a.note || null);

export const addAttachment = (taskId, a) =>
  db.prepare(`INSERT INTO task_attachments (id, task_id, filename, original_name, mime_type, size, uploaded_by_id, uploaded_at)
              VALUES (?,?,?,?,?,?,?,?)`)
    .run(a.id, taskId, a.filename, a.originalName, a.mimeType || "", a.size || 0, a.uploadedById || null, a.uploadedAt);
export const getAttachmentRow = id => db.prepare("SELECT * FROM task_attachments WHERE id = ?").get(id);
export const deleteAttachmentRow = id => db.prepare("DELETE FROM task_attachments WHERE id = ?").run(id);

/* ------------------------------------------------------------- notifications */

const notificationOut = r => ({
  id: r.id, employeeId: r.employee_id, taskId: r.task_id, activityId: r.activity_id,
  kind: r.kind, text: r.text, at: r.created_at, readAt: r.read_at
});

export const addNotification = n =>
  db.prepare(`INSERT INTO notifications (id, employee_id, task_id, activity_id, kind, text, created_at, read_at)
              VALUES (?,?,?,?,?,?,?,?)`)
    .run(n.id, n.employeeId, n.taskId || null, n.activityId || null, n.kind, n.text, n.createdAt, n.readAt || null);

/** One employee's notifications, most recent first, capped like the old client-side list was. */
export const listNotifications = (employeeId, limit = 40) =>
  db.prepare("SELECT * FROM notifications WHERE employee_id = ? ORDER BY created_at DESC LIMIT ?")
    .all(employeeId, limit).map(notificationOut);

export const getNotification = id => {
  const r = db.prepare("SELECT * FROM notifications WHERE id = ?").get(id);
  return r ? notificationOut(r) : null;
};

export const markNotificationRead = (id, employeeId, at) =>
  db.prepare("UPDATE notifications SET read_at = ? WHERE id = ? AND employee_id = ?").run(at, id, employeeId);

export const markAllNotificationsRead = (employeeId, at) =>
  db.prepare("UPDATE notifications SET read_at = ? WHERE employee_id = ? AND read_at IS NULL").run(at, employeeId);

export function nextTaskId() {
  const row = db.prepare("SELECT id FROM tasks WHERE id LIKE 'TSK-%' ORDER BY id DESC LIMIT 1").get();
  const n = row ? Number(String(row.id).slice(4)) : 0;
  return "TSK-" + String((isNaN(n) ? 0 : n) + 1).padStart(4, "0");
}

/* ---------------------------------------------------------- daily updates */

const updateOut = r => ({ date: r.date, at: r.at, completed: r.completed, current: r.current, next: r.next, blocked: r.blocked, help: r.help, note: r.note });

/** Grouped per employee, matching the shape the dashboard renders. */
export function listUpdates() {
  const rows = db.prepare("SELECT * FROM daily_updates ORDER BY date").all();
  const byEmp = {};
  for (const r of rows) (byEmp[r.employee_id] ||= { id: r.employee_id, employeeId: r.employee_id, entries: [] }).entries.push(updateOut(r));
  return Object.values(byEmp);
}
export function upsertUpdate(employeeId, e) {
  db.prepare(`
    INSERT INTO daily_updates (id, employee_id, date, at, completed, current, next, blocked, help, note)
    VALUES (@id, @employee_id, @date, @at, @completed, @current, @next, @blocked, @help, @note)
    ON CONFLICT(employee_id, date) DO UPDATE SET
      at = excluded.at, completed = excluded.completed, current = excluded.current,
      next = excluded.next, blocked = excluded.blocked, help = excluded.help, note = excluded.note
  `).run({
    id: employeeId + ":" + e.date, employee_id: employeeId, date: e.date, at: e.at || now(),
    completed: e.completed || "", current: e.current || "", next: e.next || "",
    blocked: e.blocked || "", help: e.help || "", note: e.note || ""
  });
}

/* -------------------------------------------------------------------- breaks */

const breakOut = r => r && ({
  id: r.id, employeeId: r.employee_id, startedAt: r.started_at, endedAt: r.ended_at,
  durationSec: r.duration_sec, createdAt: r.created_at, updatedAt: r.updated_at
});

/** One employee's break history, most recent first. */
export const listBreaks = employeeId =>
  db.prepare("SELECT * FROM breaks WHERE employee_id = ? ORDER BY started_at DESC").all(employeeId).map(breakOut);

/** Every break for every employee — used for the manager-wide bootstrap. */
export const listAllBreaks = () =>
  db.prepare("SELECT * FROM breaks ORDER BY started_at DESC").all().map(breakOut);

/** The break in progress for someone, or null. */
export const getOpenBreak = employeeId =>
  breakOut(db.prepare("SELECT * FROM breaks WHERE employee_id = ? AND ended_at IS NULL").get(employeeId));

export function startBreak(id, employeeId) {
  const t = now();
  db.prepare(`INSERT INTO breaks (id, employee_id, started_at, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?)`).run(id, employeeId, t, t, t);
  return getOpenBreak(employeeId);
}

export function endBreak(id) {
  const row = db.prepare("SELECT * FROM breaks WHERE id = ?").get(id);
  if (!row || row.ended_at) return breakOut(row);
  const t = now();
  const durationSec = Math.max(0, Math.round((new Date(t) - new Date(row.started_at)) / 1000));
  db.prepare("UPDATE breaks SET ended_at = ?, duration_sec = ?, updated_at = ? WHERE id = ?")
    .run(t, durationSec, t, id);
  return breakOut(db.prepare("SELECT * FROM breaks WHERE id = ?").get(id));
}

/* ---------------------------------------------------------------- sessions */

export const createSession = (id, employeeId, expiresAt) =>
  db.prepare("INSERT INTO sessions (id, employee_id, created_at, expires_at) VALUES (?,?,?,?)")
    .run(id, employeeId, now(), expiresAt);
export const readSession = id =>
  db.prepare("SELECT * FROM sessions WHERE id = ? AND expires_at > ?").get(id, now());
export const dropSession = id => db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
export const dropSessionsFor = employeeId => db.prepare("DELETE FROM sessions WHERE employee_id = ?").run(employeeId);
export const purgeSessions = () => db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now());
