/**
 * Task API. This is where the permission and validation rules bite: the
 * browser sends a whole task object, the server folds it onto the stored row,
 * strips anything the caller may not change, validates the result and derives
 * the audit entries itself.
 */
import { randomUUID } from "node:crypto";
import * as store from "../db.js";
import {
  canEditTask, canCompleteTask, applyFieldPermissions, validateTask,
  diffActivity, noteEntry, isManager, isTeamLead, hasCapability, inManagedScope, notificationRecipients, mentionedEmployeeIds,
  canManageTaskBoard, isBoardTimerRunning, nextBoardPauseState
} from "../domain.js";
import { wrap } from "../wrap.js";

/** @-mentions in a comment notify directly, on top of whatever
 *  notificationRecipients() already covers for the "comment" activity kind. */
async function notifyMentions(task, comment, user, employees) {
  for (const empId of mentionedEmployeeIds(comment.body, employees)) {
    if (empId === user.id) continue;
    await store.addNotification({
      id: randomUUID(), employeeId: empId, taskId: task.id, activityId: null,
      kind: "mention", text: `${user.name} mentioned you in a comment on “${task.title}”`, createdAt: comment.at
    });
  }
}
import { broadcast } from "../events.js";

const clean = s => (s == null ? null : String(s));

/** Comments arrive inside the task body; only genuinely new ones are written,
 *  and always under the caller's own name. */
async function syncComments(taskId, user, incoming) {
  const known = new Set(await store.commentIds(taskId));
  const added = [];
  for (const c of incoming || []) {
    if (!c || known.has(c.id)) continue;
    const body = String(c.body || "").trim();
    if (!body) continue;
    const row = {
      id: c.id && !known.has(c.id) ? String(c.id).slice(0, 64) : randomUUID(),
      authorId: user.id,                                  // never trust a client-supplied author
      at: new Date().toISOString(),
      body: body.slice(0, 4000),
      managerNote: isManager(user) ? !!c.managerNote : false
    };
    await store.addComment(taskId, row);
    added.push(row);
  }
  return added;
}

async function writeTask(user, id, incoming, extraNotes) {
  const stored = await store.getTask(id);
  if (!canEditTask(user, stored)) return { status: 403, body: { error: "You can only change your own tasks." } };

  // A team lead granted the "tasks" capability may set assigneeId/dueDate
  // like a manager, but only within a team they manage — resolved here (not
  // in applyFieldPermissions, which is pure/no DB access) by looking up
  // whoever the task would end up assigned to, existing or incoming, and
  // checking they're on one of the team lead's teams.
  let teamLeadCanManage = false;
  if (isTeamLead(user) && !isManager(user) && hasCapability(user, "tasks")) {
    const candidateId = incoming.assigneeId || (stored ? stored.assigneeId : user.id);
    if (candidateId === user.id) teamLeadCanManage = true;
    else if (candidateId) {
      const target = await store.getEmployee(candidateId);
      teamLeadCanManage = inManagedScope(user, target);
    }
  }

  const { task: merged, denied } = applyFieldPermissions(user, { ...incoming, id }, stored, { teamLeadCanManage });

  // Task Board fields: only the Task Board UI ever sends these, so gate them
  // separately from the rest of a task write rather than touching canEditTask.
  const touchesBoard = ["boardCategory", "assignedDate"].some(
    f => incoming[f] !== undefined && String(incoming[f]) !== String(stored ? stored[f] : undefined)
  );
  if (touchesBoard && !canManageTaskBoard(user)) return { status: 403, body: { error: "You can't change Task Board fields." } };

  // Fill in what the assignee implies, so department/team never drift.
  if (merged.assigneeId) {
    const e = await store.getEmployee(merged.assigneeId);
    if (e && (isManager(user) || !stored || teamLeadCanManage)) { merged.departmentId = e.departmentId; merged.teamId = e.teamId; }
  }
  if (merged.status === "COMPLETED") {
    merged.progress = 100;
    merged.completedAt = merged.completedAt || new Date().toISOString();
  } else if (stored && stored.status === "COMPLETED") {
    merged.completedAt = merged.completedAt || null;
  }
  if (!merged.createdAt) merged.createdAt = new Date().toISOString();
  merged.updatedAt = new Date().toISOString();

  // Defaults so every task (not just ones created via the Task Board) is
  // always valid, and so the assignment timer's pause bookkeeping below has
  // real values to work from.
  if (!merged.boardCategory) merged.boardCategory = (stored && stored.boardCategory) || "to_do";
  if (!merged.assignedDate) merged.assignedDate = (stored && stored.assignedDate) || merged.createdAt.slice(0, 10);

  // Assignment timer: the server derives pausedAt/pausedMsTotal itself —
  // never trust the client's copy, same posture as completedAt/progress above.
  const wasRunning = stored ? isBoardTimerRunning(stored) : true;
  const isRunning = isBoardTimerRunning(merged);
  const pauseState = nextBoardPauseState(
    { wasRunning, isRunning, pausedAt: stored ? stored.pausedAt : null, pausedMsTotal: stored ? stored.pausedMsTotal : 0 },
    merged.updatedAt
  );
  merged.pausedAt = pauseState.pausedAt;
  merged.pausedMsTotal = pauseState.pausedMsTotal;

  const errs = await validateTask(merged);
  if (Object.keys(errs).length) return { status: 422, body: { error: "That task isn't valid.", fields: errs } };

  const activity = diffActivity(user, stored, merged);
  await store.upsertTask(merged);
  const addedComments = await syncComments(id, user, incoming.comments);
  for (const c of addedComments) activity.push(noteEntry(user, "comment", c.body.slice(0, 200)));
  for (const n of extraNotes || []) {
    if (n && n.note) activity.push(noteEntry(user, String(n.kind || "note"), String(n.note).slice(0, 300)));
  }
  for (const a of activity) await store.addActivity(id, a);

  const employees = await store.listEmployees();
  for (const a of activity) {
    for (const r of notificationRecipients(merged, a, employees)) {
      await store.addNotification({
        id: randomUUID(), employeeId: r.employeeId, taskId: id, activityId: a.id,
        kind: r.kind, text: r.text, createdAt: a.at
      });
    }
  }
  for (const c of addedComments) await notifyMentions(merged, c, user, employees);

  broadcast(["tasks", "notifications"], user.id);
  return { status: 200, body: { task: await store.getTask(id), denied } };
}

export function mountTasks(app, requireUser, requireManager) {
  app.get("/api/tasks", requireUser, wrap(async (_req, res) => res.json({ tasks: await store.listTasks() })));

  app.get("/api/tasks/next-id", requireUser, wrap(async (_req, res) => res.json({ id: await store.nextTaskId() })));

  app.get("/api/tasks/:id", requireUser, wrap(async (req, res) => {
    const t = await store.getTask(req.params.id);
    return t ? res.json({ task: t }) : res.status(404).json({ error: "No such task." });
  }));

  // Create. The server mints the id so two people creating at the same moment
  // can't land on the same one and overwrite each other.
  app.post("/api/tasks", requireUser, wrap(async (req, res) => {
    const body = req.body || {};
    const id = await store.nextTaskId();
    const r = await writeTask(req.user, id, { ...body, id, createdAt: new Date().toISOString() }, body._notes);
    res.status(r.status === 200 ? 201 : r.status).json(r.body);
  }));

  // Replace an existing task. The client always holds a whole task, so this is
  // the single update path — PATCH below is sugar over it.
  app.put("/api/tasks/:id", requireUser, wrap(async (req, res) => {
    if (!(await store.getTask(req.params.id))) return res.status(404).json({ error: "No such task. Reload and try again." });
    const body = req.body || {};
    const r = await writeTask(req.user, req.params.id, body, body._notes);
    res.status(r.status).json(r.body);
  }));

  app.patch("/api/tasks/:id", requireUser, wrap(async (req, res) => {
    const stored = await store.getTask(req.params.id);
    if (!stored) return res.status(404).json({ error: "No such task." });
    const { _notes, ...patch } = req.body || {};
    const r = await writeTask(req.user, req.params.id, { ...stored, ...patch }, _notes);
    res.status(r.status).json(r.body);
  }));

  app.post("/api/tasks/:id/comments", requireUser, wrap(async (req, res) => {
    const t = await store.getTask(req.params.id);
    if (!t) return res.status(404).json({ error: "No such task." });
    const body = String(req.body?.body || "").trim();
    if (!body) return res.status(400).json({ error: "Write something first." });
    const c = { id: randomUUID(), authorId: req.user.id, at: new Date().toISOString(),
                body: body.slice(0, 4000), managerNote: isManager(req.user) && !!req.body?.managerNote };
    await store.addComment(t.id, c);
    const a = noteEntry(req.user, "comment", c.body.slice(0, 200));
    await store.addActivity(t.id, a);
    const employees = await store.listEmployees();
    for (const r of notificationRecipients(t, a, employees)) {
      await store.addNotification({ id: randomUUID(), employeeId: r.employeeId, taskId: t.id, activityId: a.id, kind: r.kind, text: r.text, createdAt: a.at });
    }
    await notifyMentions(t, c, req.user, employees);
    broadcast(["tasks", "notifications"], req.user.id);
    res.json({ task: await store.getTask(t.id) });
  }));

  app.post("/api/tasks/:id/complete", requireUser, wrap(async (req, res) => {
    const stored = await store.getTask(req.params.id);
    if (!stored) return res.status(404).json({ error: "No such task." });
    if (!canCompleteTask(req.user, stored)) {
      return res.status(403).json({ error: "Only the assignee or a manager can complete this task." });
    }
    const r = await writeTask(req.user, stored.id, {
      ...stored, status: "COMPLETED", progress: 100, completedAt: new Date().toISOString(),
      blocker: stored.blocker ? { ...stored.blocker, resolvedAt: new Date().toISOString() } : null
    });
    res.status(r.status).json(r.body);
  }));

  /** Bulk update. Rows the caller may not touch are reported, not silently skipped. */
  app.post("/api/tasks/bulk", requireUser, wrap(async (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.slice(0, 500) : [];
    const patch = req.body?.patch || {};
    const note = String(req.body?.note || "").trim();
    const updated = [], refused = [];
    for (const id of ids) {
      const stored = await store.getTask(id);
      if (!stored) { refused.push({ id, reason: "not found" }); continue; }
      if (!canEditTask(req.user, stored)) { refused.push({ id, reason: "not yours" }); continue; }
      const next = { ...stored, ...patch };
      if (note) next.comments = [...(stored.comments || []), { id: randomUUID(), body: note, managerNote: isManager(req.user) }];
      const r = await writeTask(req.user, id, next);
      if (r.status === 200) updated.push(id);
      else refused.push({ id, reason: r.body.fields ? Object.values(r.body.fields)[0] : r.body.error });
    }
    broadcast(["tasks"], req.user.id);
    res.json({ updated, refused });
  }));

  app.delete("/api/tasks/:id", requireUser, requireManager, wrap(async (req, res) => {
    await store.deleteTask(req.params.id);
    broadcast(["tasks"], req.user.id);
    res.json({ ok: true });
  }));
}

export { writeTask, clean };
