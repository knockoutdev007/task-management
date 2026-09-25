/**
 * Business rules that must hold no matter what the browser sends.
 *
 * The frontend enforces the same rules for a good experience; these are the
 * ones that actually count, because anyone can call the API with curl.
 */
import { randomUUID } from "node:crypto";
import { getConfig } from "./db.js";

export const isManager = user => !!user && user.role === "manager";
/** A team-scoped manager: same elevated powers as a manager, but only over
 *  their own department+team's people and tasks, and only for whichever
 *  specific capabilities a real manager granted them (see hasCapability) —
 *  see the functions below that check this alongside a team match and a
 *  capability check, never isTeamLead() alone. */
export const isTeamLead = user => !!user && user.role === "teamlead";
export const isManagerOrTeamLead = user => isManager(user) || isTeamLead(user);
export const sameTeam = (a, b) => !!a && !!b && a.departmentId === b.departmentId && a.teamId === b.teamId;

/** Every "deptId|teamId" a team lead manages: the one they personally belong
 *  to, plus any extra teams a manager put them in charge of via
 *  employees.managed_teams. Managers/employees never call this — team-scoped
 *  checks go through inManagedScope() below, not a single sameTeam() match. */
export function managedTeamKeys(user) {
  if (!user) return [];
  const own = `${user.departmentId}|${user.teamId}`;
  const extra = Array.isArray(user.managedTeams) ? user.managedTeams : [];
  return Array.from(new Set([own, ...extra]));
}
/** Is `target` (a task or an employee — anything with departmentId/teamId) in
 *  any team this user manages? */
export function inManagedScope(user, target) {
  if (!user || !target) return false;
  return managedTeamKeys(user).includes(`${target.departmentId}|${target.teamId}`);
}

/** The individually-toggleable powers a manager can grant a team lead —
 *  stored per person as employees.capabilities (a JSON array of these ids).
 *  A manager already has all of them implicitly; an employee has none. */
export const TEAM_LEAD_CAPABILITIES = [
  { id: "team",      label: "Team page — view & edit their own team's people" },
  { id: "tasks",     label: "Manage their team's tasks — assign, due dates, complete (also scopes Board/All Tasks/Task Board to their team)" },
  { id: "blockers",  label: "Blockers page" },
  { id: "working",   label: "Currently working on page" },
  { id: "daily",     label: "Daily summary page" },
  { id: "dayboard",  label: "Day plan board page" },
  { id: "goodvibes", label: "Manage today's Good Vibes Wall turn for their team" }
];
/** True for a manager unconditionally; for a team lead, only if this
 *  specific capability was granted to them. Never true for a plain employee. */
export function hasCapability(user, cap) {
  if (isManager(user)) return true;
  return isTeamLead(user) && Array.isArray(user.capabilities) && user.capabilities.includes(cap);
}

const statusKind = (cfg, id) => (cfg.statuses.find(s => s.id === id) || { kind: "open" }).kind;
export const isClosedStatus = (cfg, id) => statusKind(cfg, id) === "done";

/* --------------------------------------------------------------- breaks */

/** Fixed break types — deliberately not config-driven, unlike priorities/statuses. */
export const BREAK_TYPES = [
  { id: "SHORT1", label: "Short Break 1", allottedSec: 15 * 60 },
  { id: "SHORT2", label: "Short Break 2", allottedSec: 15 * 60 },
  { id: "LONG", label: "Long Break", allottedSec: 30 * 60 }
];
export const breakType = id => BREAK_TYPES.find(t => t.id === id) || null;

/* ------------------------------------------------------------ permissions */

/** Who may change a task at all. Employees own their own work; a team lead
 *  granted the "tasks" capability also owns every task on any team they manage. */
export function canEditTask(user, stored) {
  if (!user) return false;
  if (isManager(user)) return true;
  if (hasCapability(user, "tasks") && stored && inManagedScope(user, stored)) return true;
  if (!stored) return true;                              // creating their own
  return stored.assigneeId === user.id || stored.createdById === user.id;
}
/** Who may mark it done — the person doing the work, a "tasks"-capable team
 *  lead for a task on any team they manage, or a manager. */
export function canCompleteTask(user, stored) {
  if (!user) return false;
  if (isManager(user)) return true;
  if (hasCapability(user, "tasks") && stored && inManagedScope(user, stored)) return true;
  return !!(stored && stored.assigneeId === user.id);
}

/** Fields only a manager may set. Employees keep the stored value. A team
 *  lead is let through on assigneeId/dueDate specifically — see
 *  applyFieldPermissions' `teamLeadCanManage` opt — everywhere else in this
 *  list (departmentId/teamId) they're treated the same as an employee, since
 *  reassigning across teams or altering the team a task belongs to stays a
 *  real manager's call. */
export const MANAGER_ONLY_FIELDS = ["assigneeId", "dueDate", "departmentId", "teamId"];
const TEAM_LEAD_MANAGEABLE_FIELDS = new Set(["assigneeId", "dueDate"]);

/* ------------------------------------------------------------- task board */

/** Fixed board categories — deliberately not config-driven, unlike the
 *  existing free-text `category` tag (same convention as BREAK_TYPES above).
 *  Distinct on purpose from `category`: that field is a Settings-editable
 *  subject tag used app-wide; this is the Task Board's own filter. */
export const BOARD_CATEGORIES = [
  { id: "project", label: "Project" },
  { id: "to_do", label: "To Do" },
  { id: "on_hold", label: "On Hold" },
  { id: "rock", label: "Rock" }
];

/** Who may create/edit tasks on the Task Board. Not `canEditTask` — that
 *  already enforces real assignee/manager rules for the rest of the app, so
 *  reusing it here would be wrong. This is a separate, temporary rule.
 *  TODO: restrict to Managers — flip the body to `return isManager(user);`. */
export function canManageTaskBoard(user) { return !!user; }

/** Is the assignment timer running for this task right now? */
export const isBoardTimerRunning = t => t.status !== "COMPLETED" && t.boardCategory !== "on_hold";

/**
 * Pure pause/resume transition: whenever "is this timer running" flips, stash
 * or accumulate the paused time. No-op if it didn't flip. Covers all four
 * brief scenarios (pause-on-done, pause-on-hold, resume-from-hold,
 * reopen-from-done) with one rule — display copy is what tells them apart,
 * not this transition. Duplicated (not shared) in public/app/taskTimer.js
 * for client-side optimistic UI; the server's result here is authoritative.
 */
export function nextBoardPauseState({ wasRunning, isRunning, pausedAt, pausedMsTotal }, nowISO) {
  pausedMsTotal = Number(pausedMsTotal) || 0;
  if (wasRunning === isRunning) return { pausedAt: pausedAt || null, pausedMsTotal };
  if (isRunning) {                                          // resuming
    const ms = pausedAt ? Math.max(0, new Date(nowISO) - new Date(pausedAt)) : 0;
    return { pausedAt: null, pausedMsTotal: pausedMsTotal + ms };
  }
  return { pausedAt: pausedAt || nowISO, pausedMsTotal };     // pausing (done or on_hold)
}

/**
 * Fold an incoming task onto the stored one, dropping anything this user is
 * not allowed to change. Returns the task to persist plus a list of fields
 * that were silently held back, so the API can tell the caller.
 *
 * `opts.teamLeadCanManage` is precomputed by the caller (writeTask, which has
 * DB access to look up the target assignee) — true when this user is a team
 * lead AND the task's assignee (existing or incoming) is on their own team.
 * It's the one exception to MANAGER_ONLY_FIELDS: a team lead may still set
 * assigneeId/dueDate within their own team, same as a manager would.
 */
export function applyFieldPermissions(user, incoming, stored, opts = {}) {
  const out = { ...incoming };
  const denied = [];
  const teamManage = !!opts.teamLeadCanManage;
  if (!stored) {
    // On create, an employee (or a team lead assigning outside their team)
    // may only assign work to themselves.
    if (!isManager(user) && !teamManage && out.assigneeId && out.assigneeId !== user.id) {
      out.assigneeId = user.id;
      denied.push("assigneeId");
    }
    out.createdById = user.id;
    return { task: out, denied };
  }
  out.createdById = stored.createdById;                  // never rewritable
  out.createdAt = stored.createdAt;
  if (!isManager(user)) {
    for (const f of MANAGER_ONLY_FIELDS) {
      if (teamManage && TEAM_LEAD_MANAGEABLE_FIELDS.has(f)) continue;
      const a = stored[f] ?? null, b = out[f] ?? null;
      if (String(a) !== String(b)) { out[f] = stored[f]; denied.push(f); }
    }
    if (out.status === "COMPLETED" && stored.status !== "COMPLETED" && !canCompleteTask(user, stored)) {
      out.status = stored.status; out.progress = stored.progress; out.completedAt = stored.completedAt;
      denied.push("status");
    }
  }
  return { task: out, denied };
}

/* ------------------------------------------------------------- validation */

/** Mirrors the client-side rules. Returns { field: message }. */
export async function validateTask(t) {
  const cfg = await getConfig();
  const errs = {};
  const d = s => { if (!s) return null; const x = new Date(String(s).length === 10 ? s + "T00:00:00Z" : s); return isNaN(x) ? null : x; };

  if (!t.title || !String(t.title).trim()) errs.title = "A task needs a title.";
  if (String(t.title || "").length > 300) errs.title = "Title is too long (300 characters max).";
  if (!t.assigneeId) errs.assigneeId = "Assign this to someone.";
  if (!cfg.priorities.some(p => p.id === t.priority)) errs.priority = "Unknown priority.";
  if (!cfg.statuses.some(s => s.id === t.status)) errs.status = "Unknown status.";

  const p = Number(t.progress);
  if (isNaN(p) || p < 0 || p > 100) errs.progress = "Progress must be between 0 and 100.";

  const sd = d(t.startDate), dd = d(t.dueDate), ed = d(t.expectedCompletion);
  if (sd && dd && dd < sd) errs.dueDate = "Due date cannot be before the start date.";
  if (sd && ed && ed < sd) errs.expectedCompletion = "Expected completion cannot be before the start date.";

  if (t.status === "COMPLETED") {
    if (p !== 100) errs.progress = "A completed task must be at 100%.";
    if (!t.completedAt) errs.completedAt = "A completed task needs a completion date.";
  }
  if (t.priority === "CRITICAL" && !t.expectedCompletion) errs.expectedCompletion = "Critical tasks need an expected completion date.";
  if (t.status === "BLOCKED" && !(t.blocker && String(t.blocker.reason || "").trim())) errs.blocker = "Explain what is blocking this task.";
  for (const f of ["estimatedHours", "actualHours"]) {
    if (t[f] != null && t[f] !== "" && (isNaN(Number(t[f])) || Number(t[f]) < 0)) errs[f] = "Effort cannot be negative.";
  }

  if (!BOARD_CATEGORIES.some(c => c.id === t.boardCategory)) errs.boardCategory = "Unknown category.";
  const ad = d(t.assignedDate);
  if (!ad) errs.assignedDate = "Set the date this was assigned.";
  else if (ad > new Date()) errs.assignedDate = "Assigned date can't be in the future.";

  return errs;
}

/* --------------------------------------------------------------- activity */

export const FIELD_LABELS = {
  title: "Title", description: "Description", assigneeId: "Assignee", priority: "Priority",
  status: "Status", progress: "Progress", dueDate: "Due date", startDate: "Start date",
  expectedCompletion: "Expected completion", estimatedHours: "Estimated effort",
  actualHours: "Actual effort", projectId: "Project", category: "Category",
  departmentId: "Department", teamId: "Team", tags: "Tags",
  boardCategory: "Board category", assignedDate: "Date assigned"
};

const entry = (user, kind, field, from, to, note) => ({
  id: randomUUID(), at: new Date().toISOString(),
  byId: user ? user.id : null, byName: user ? user.name : "System",
  kind, field: field || null, from: from ?? null, to: to ?? null, note: note || null
});

/**
 * The audit trail is derived here, not accepted from the client — otherwise
 * the history could be written to say anything.
 */
export function diffActivity(user, stored, next) {
  if (!stored) return [entry(user, "create", null, null, null, "Task created")];
  const out = [];
  for (const k of Object.keys(FIELD_LABELS)) {
    const a = Array.isArray(stored[k]) ? stored[k].join(", ") : stored[k];
    const b = Array.isArray(next[k]) ? next[k].join(", ") : next[k];
    if ((a ?? "") === (b ?? "")) continue;
    let kind = "edit";
    if (k === "priority") kind = "priority";
    else if (k === "status") kind = b === "COMPLETED" ? "complete" : b === "BLOCKED" ? "block" : "status";
    else if (k === "assigneeId") kind = stored.assigneeId ? "reassign" : "assign";
    else if (k === "dueDate") kind = "due";
    else if (k === "progress") kind = "progress";
    out.push(entry(user, kind, k, a, b));
  }
  const wasBlocked = !!(stored.blocker && stored.blocker.reason && !stored.blocker.resolvedAt);
  const isBlocked = !!(next.blocker && next.blocker.reason && !next.blocker.resolvedAt);
  if (!wasBlocked && isBlocked) {
    out.push(entry(user, "block", null, null, null,
      "Blocker: " + next.blocker.reason + (next.blocker.needsManager ? " (manager intervention requested)" : "")));
  } else if (wasBlocked && !isBlocked) {
    out.push(entry(user, "unblock", null, null, null, "Blocker resolved"));
  }
  if ((next.reopenCount || 0) > (stored.reopenCount || 0)) {
    out.push(entry(user, "reopen", null, null, null, "Task reopened after completion"));
  }
  return out;
}
export const noteEntry = (user, kind, note) => entry(user, kind, null, null, null, note);

/* ------------------------------------------------------------ notifications */

/**
 * Mirrors the client's NOTIF_RULES (public/app/metrics.js) but resolved to
 * concrete recipient ids, since the client is classic-script global scope and
 * this is an ES module — no shared-code path between them without a bundler.
 * Keep the `kind` values used here (the notification's *display* kind, not
 * necessarily the activity's own kind) in sync with metrics.js's NOTIF_RULES
 * keys; scripts/notif-test.js checks both against the same key set.
 *
 * Returns [{ employeeId, kind, text }], one row per distinct recipient. An
 * activity entry can fan out to more than one recipient with *different*
 * text for each (e.g. a reassignment tells the new assignee "you were
 * assigned" and every other manager "X was reassigned to Y").
 */
export function notificationRecipients(task, a, employees) {
  const actor = a.byId;
  const managers = employees.filter(isManager).map(e => e.id);
  const byId = id => employees.find(e => e.id === id);
  const nameOf = id => (byId(id) || {}).name || "Unassigned";
  const actorName = a.byName || nameOf(actor);
  const out = new Map();
  const add = (employeeId, kind, text) => {
    if (!employeeId || employeeId === actor || out.has(employeeId)) return;
    out.set(employeeId, { kind, text });
  };
  const forManagers = (kind, text, except) => { for (const m of managers) if (m !== except) add(m, kind, text); };

  switch (a.kind) {
    case "create":
      add(task.assigneeId, "assign", `${actorName} assigned you “${task.title}”`);
      break;
    case "assign":
      add(a.to, "assign", `${actorName} assigned you “${task.title}”`);
      break;
    case "reassign":
      add(a.to, "assign", `${actorName} assigned you “${task.title}”`);
      forManagers("reassign", `“${task.title}” reassigned to ${nameOf(task.assigneeId)}`, a.to);
      break;
    case "priority":
      forManagers("priority", `Priority on “${task.title}” changed ${a.from} → ${a.to}`);
      add(task.assigneeId, "priority", `Priority on “${task.title}” changed ${a.from} → ${a.to}`);
      break;
    case "block":
      forManagers("block", `${nameOf(task.assigneeId)} reported a blocker on “${task.title}”`);
      add(task.createdById, "block", `${nameOf(task.assigneeId)} reported a blocker on “${task.title}”`);
      break;
    case "comment":
      forManagers("comment", `${actorName} commented on “${task.title}”`);
      add(task.assigneeId, "comment", `${actorName} commented on “${task.title}”`);
      break;
    case "due":
      add(task.assigneeId, "due", `Due date on “${task.title}” moved to ${a.to}`);
      break;
    case "complete":
      forManagers("complete", `${actorName} completed “${task.title}”`);
      add(task.createdById, "complete", `${actorName} completed “${task.title}”`);
      break;
    case "attachment": {
      const text = `${actorName} ${(a.note || "").startsWith("Removed") ? "removed a file from" : "sent a file on"} “${task.title}”`;
      forManagers("attachment", text);
      add(task.assigneeId, "attachment", text);
      add(task.createdById, "attachment", text);
      break;
    }
    default:
      break; // "edit", "status", "progress", "unblock", "reopen", "dependency" — no fan-out today
  }
  return Array.from(out, ([employeeId, v]) => ({ employeeId, kind: v.kind, text: v.text }));
}

/**
 * Who a comment's "@Name" tokens resolve to, so they can be notified
 * directly — separate from notificationRecipients() above, since a mention
 * can be buried anywhere in a long comment while the activity log only ever
 * keeps a 200-char note, and mentioning someone matters regardless of
 * whether they'd already be notified as the assignee/a manager/etc.
 * Mirrors the display-highlighting regex in public/app/drawer.js — an
 * "@First" or "@First Last" token, matched against employee names.
 */
export function mentionedEmployeeIds(text, employees) {
  const found = new Set();
  const re = /@([A-Za-z][\w.'-]*(?:\s[A-Z][\w.'-]*)?)/g;
  let m;
  while ((m = re.exec(String(text || "")))) {
    const token = m[1].toLowerCase();
    const match = employees.find(e => e.name.toLowerCase() === token)
      || employees.find(e => e.name.toLowerCase().startsWith(token));
    if (match) found.add(match.id);
  }
  return [...found];
}

/* ---------------------------------------------------------- good vibes wall */

/** Fixed post categories — deliberately not config-driven, same convention
 *  as BREAK_TYPES/BOARD_CATEGORIES above. */
export const GOOD_VIBES_CATEGORIES = [
  { id: "THOUGHT",      label: "Good Thought", emoji: "💡" },
  { id: "MOTIVATION",   label: "Motivation",   emoji: "🚀" },
  { id: "FUNNY",        label: "Funny",        emoji: "😂" },
  { id: "APPRECIATION", label: "Appreciation", emoji: "👏" },
  { id: "WIN",          label: "Small Win",    emoji: "🌟" },
  { id: "RANDOM",       label: "Random",       emoji: "🎲" }
];

/** Managing the rotation and moderating posts is a real manager-only action —
 *  unlike canManageTaskBoard's still-open TODO above, this one is intentional. */
export function canManageGoodVibes(user) { return isManager(user); }

/** JS Date.getUTCDay() convention: 0=Sun...6=Sat, matching config.workingDays. */
export function isWorkingDay(dateISO, workingDays) {
  return (workingDays || []).includes(new Date(dateISO + "T00:00:00Z").getUTCDay());
}

/** Next person after `currentEmployeeId` in `order`, wrapping around. Falls
 *  back to the front of the list if the current person isn't in it anymore
 *  (e.g. deactivated mid-cycle). */
export function nextInRotation(order, currentEmployeeId) {
  if (!order || !order.length) return null;
  const idx = order.indexOf(currentEmployeeId);
  return order[(idx === -1 ? 0 : idx + 1) % order.length];
}

/** A read-only preview of the next `count` people in rotation after the
 *  anchor — never persisted, so it always reflects the live order. */
export function projectUpcoming(order, anchorEmployeeId, count) {
  const out = [];
  let cursor = anchorEmployeeId;
  for (let i = 0; i < count; i++) {
    cursor = nextInRotation(order, cursor);
    if (cursor == null) break;
    out.push(cursor);
  }
  return out;
}
