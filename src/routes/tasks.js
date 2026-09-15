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
  diffActivity, noteEntry, isManager, notificationRecipients, mentionedEmployeeIds
} from "../domain.js";

/** @-mentions in a comment notify directly, on top of whatever
 *  notificationRecipients() already covers for the "comment" activity kind. */
function notifyMentions(task, comment, user, employees) {
  for (const empId of mentionedEmployeeIds(comment.body, employees)) {
    if (empId === user.id) continue;
    store.addNotification({
      id: randomUUID(), employeeId: empId, taskId: task.id, activityId: null,
      kind: "mention", text: `${user.name} mentioned you in a comment on “${task.title}”`, createdAt: comment.at
    });
  }
}
import { broadcast } from "../events.js";

const clean = s => (s == null ? null : String(s));

/** Comments arrive inside the task body; only genuinely new ones are written,
 *  and always under the caller's own name. */
function syncComments(taskId, user, incoming) {
  const known = new Set(store.commentIds(taskId));
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
    store.addComment(taskId, row);
    added.push(row);
  }
  return added;
}

function writeTask(user, id, incoming, extraNotes) {
  const stored = store.getTask(id);
  if (!canEditTask(user, stored)) return { status: 403, body: { error: "You can only change your own tasks." } };

  const { task: merged, denied } = applyFieldPermissions(user, { ...incoming, id }, stored);

  // Fill in what the assignee implies, so department/team never drift.
  if (merged.assigneeId) {
    const e = store.getEmployee(merged.assigneeId);
    if (e && (isManager(user) || !stored)) { merged.departmentId = e.departmentId; merged.teamId = e.teamId; }
  }
  if (merged.status === "COMPLETED") {
    merged.progress = 100;
    merged.completedAt = merged.completedAt || new Date().toISOString();
  } else if (stored && stored.status === "COMPLETED") {
    merged.completedAt = merged.completedAt || null;
  }
  if (!merged.createdAt) merged.createdAt = new Date().toISOString();
  merged.updatedAt = new Date().toISOString();

  const errs = validateTask(merged);
  if (Object.keys(errs).length) return { status: 422, body: { error: "That task isn't valid.", fields: errs } };

  const activity = diffActivity(user, stored, merged);
  store.upsertTask(merged);
  const addedComments = syncComments(id, user, incoming.comments);
  for (const c of addedComments) activity.push(noteEntry(user, "comment", c.body.slice(0, 200)));
  for (const n of extraNotes || []) {
    if (n && n.note) activity.push(noteEntry(user, String(n.kind || "note"), String(n.note).slice(0, 300)));
  }
  for (const a of activity) store.addActivity(id, a);

  const employees = store.listEmployees();
  for (const a of activity) {
    for (const r of notificationRecipients(merged, a, employees)) {
      store.addNotification({
        id: randomUUID(), employeeId: r.employeeId, taskId: id, activityId: a.id,
        kind: r.kind, text: r.text, createdAt: a.at
      });
    }
  }
  for (const c of addedComments) notifyMentions(merged, c, user, employees);

  broadcast(["tasks", "notifications"], user.id);
  return { status: 200, body: { task: store.getTask(id), denied } };
}

export function mountTasks(app, requireUser, requireManager) {
  app.get("/api/tasks", requireUser, (_req, res) => res.json({ tasks: store.listTasks() }));

  app.get("/api/tasks/next-id", requireUser, (_req, res) => res.json({ id: store.nextTaskId() }));

  app.get("/api/tasks/:id", requireUser, (req, res) => {
    const t = store.getTask(req.params.id);
    return t ? res.json({ task: t }) : res.status(404).json({ error: "No such task." });
  });

  // Create. The server mints the id so two people creating at the same moment
  // can't land on the same one and overwrite each other.
  app.post("/api/tasks", requireUser, (req, res) => {
    const body = req.body || {};
    const id = store.nextTaskId();
    const r = writeTask(req.user, id, { ...body, id, createdAt: new Date().toISOString() }, body._notes);
    res.status(r.status === 200 ? 201 : r.status).json(r.body);
  });

  // Replace an existing task. The client always holds a whole task, so this is
  // the single update path — PATCH below is sugar over it.
  app.put("/api/tasks/:id", requireUser, (req, res) => {
    if (!store.getTask(req.params.id)) return res.status(404).json({ error: "No such task. Reload and try again." });
    const body = req.body || {};
    const r = writeTask(req.user, req.params.id, body, body._notes);
    res.status(r.status).json(r.body);
  });

  app.patch("/api/tasks/:id", requireUser, (req, res) => {
    const stored = store.getTask(req.params.id);
    if (!stored) return res.status(404).json({ error: "No such task." });
    const { _notes, ...patch } = req.body || {};
    const r = writeTask(req.user, req.params.id, { ...stored, ...patch }, _notes);
    res.status(r.status).json(r.body);
  });

  app.post("/api/tasks/:id/comments", requireUser, (req, res) => {
    const t = store.getTask(req.params.id);
    if (!t) return res.status(404).json({ error: "No such task." });
    const body = String(req.body?.body || "").trim();
    if (!body) return res.status(400).json({ error: "Write something first." });
    const c = { id: randomUUID(), authorId: req.user.id, at: new Date().toISOString(),
                body: body.slice(0, 4000), managerNote: isManager(req.user) && !!req.body?.managerNote };
    store.addComment(t.id, c);
    const a = noteEntry(req.user, "comment", c.body.slice(0, 200));
    store.addActivity(t.id, a);
    const employees = store.listEmployees();
    for (const r of notificationRecipients(t, a, employees)) {
      store.addNotification({ id: randomUUID(), employeeId: r.employeeId, taskId: t.id, activityId: a.id, kind: r.kind, text: r.text, createdAt: a.at });
    }
    notifyMentions(t, c, req.user, employees);
    broadcast(["tasks", "notifications"], req.user.id);
    res.json({ task: store.getTask(t.id) });
  });

  app.post("/api/tasks/:id/complete", requireUser, (req, res) => {
    const stored = store.getTask(req.params.id);
    if (!stored) return res.status(404).json({ error: "No such task." });
    if (!canCompleteTask(req.user, stored)) {
      return res.status(403).json({ error: "Only the assignee or a manager can complete this task." });
    }
    const r = writeTask(req.user, stored.id, {
      ...stored, status: "COMPLETED", progress: 100, completedAt: new Date().toISOString(),
      blocker: stored.blocker ? { ...stored.blocker, resolvedAt: new Date().toISOString() } : null
    });
    res.status(r.status).json(r.body);
  });

  /** Bulk update. Rows the caller may not touch are reported, not silently skipped. */
  app.post("/api/tasks/bulk", requireUser, (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.slice(0, 500) : [];
    const patch = req.body?.patch || {};
    const note = String(req.body?.note || "").trim();
    const updated = [], refused = [];
    for (const id of ids) {
      const stored = store.getTask(id);
      if (!stored) { refused.push({ id, reason: "not found" }); continue; }
      if (!canEditTask(req.user, stored)) { refused.push({ id, reason: "not yours" }); continue; }
      const next = { ...stored, ...patch };
      if (note) next.comments = [...(stored.comments || []), { id: randomUUID(), body: note, managerNote: isManager(req.user) }];
      const r = writeTask(req.user, id, next);
      if (r.status === 200) updated.push(id);
      else refused.push({ id, reason: r.body.fields ? Object.values(r.body.fields)[0] : r.body.error });
    }
    broadcast(["tasks"], req.user.id);
    res.json({ updated, refused });
  });

  app.delete("/api/tasks/:id", requireUser, requireManager, (req, res) => {
    store.deleteTask(req.params.id);
    broadcast(["tasks"], req.user.id);
    res.json({ ok: true });
  });
}

export { writeTask, clean };
