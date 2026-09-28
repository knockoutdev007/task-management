/**
 * Good Vibes Wall: one active employee posts each working day, on a fair
 * rotating schedule (src/db.js's ensureAssignmentsThrough walks the sequence
 * forward, skipping inactive employees; src/domain.js holds the pure
 * rotation math). Everyone can read, like and comment. A manager can manage
 * the whole rotation and moderate anything; a team lead gets a narrower
 * slice — they can only skip/reassign *today's* turn, and only when today's
 * assignee is on their own team (a reassign target must be too) — the
 * rotation itself is one shared org-wide sequence, so reordering it or
 * moderating posts outside that stays manager-only (see mountGoodVibes call
 * in src/server.js for the requireUser/requireManager/requireManagerOrTeamLead split).
 */
import { randomUUID } from "node:crypto";
import * as store from "../db.js";
import { isManager, isTeamLead, inManagedScope, hasCapability, GOOD_VIBES_CATEGORIES, nextInRotation, projectUpcoming } from "../domain.js";
import { broadcast } from "../events.js";
import { wrap } from "../wrap.js";

const todayISO = () => new Date().toISOString().slice(0, 10);

export function mountGoodVibes(app, requireUser, requireManager, requireManagerOrTeamLead) {
  /** A manager can switch the whole feature off from Settings > "Features"
   *  (cfg().featureFlags.goodVibes) — enforced here, not just hidden from
   *  the nav, so a direct API call can't bypass it either. */
  app.use("/api/goodvibes", wrap(async (req, res, next) => {
    const cfg = await store.getConfig();
    if ((cfg.featureFlags || {}).goodVibes === false) return res.status(404).json({ error: "Good Vibes Wall is turned off." });
    next();
  }));

  /* ---------------------------------------------------------------- reads */
  app.get("/api/goodvibes/bootstrap", requireUser, wrap(async (req, res) => {
    const goodVibes = await store.getGoodVibesBootstrap({ viewerEmployeeId: req.user.id, includeHidden: isManager(req.user) });
    res.json({ goodVibes });
  }));

  app.get("/api/goodvibes/posts", requireUser, wrap(async (req, res) => {
    const includeHidden = isManager(req.user) && req.query.includeHidden === "1";
    const posts = await store.listGvPosts({ includeHidden, viewerEmployeeId: req.user.id });
    res.json({ posts });
  }));

  app.get("/api/goodvibes/upcoming", requireUser, wrap(async (req, res) => {
    const count = Math.min(Math.max(Number(req.query.count) || 5, 1), 20);
    const today = todayISO();
    await store.ensureAssignmentsThrough(today);
    const [todayAssignment, order] = await Promise.all([store.getAssignmentByDate(today), store.getActiveRotationOrder()]);
    res.json({ upcoming: projectUpcoming(order, todayAssignment ? todayAssignment.employeeId : null, count) });
  }));

  // Team leads get in here too — they just can't reorder (PUT admin/rotation
  // stays requireManager-only below) and the client only shows them today's
  // quick actions, not the full org list, when they're not a full manager.
  app.get("/api/goodvibes/rotation", requireUser, requireManagerOrTeamLead, wrap(async (_req, res) => {
    const today = todayISO();
    await store.ensureAssignmentsThrough(today);
    const [rotation, todayAssignment] = await Promise.all([store.listRotationAdmin(), store.getAssignmentByDate(today)]);
    res.json({ rotation, today: todayAssignment });
  }));

  /* --------------------------------------------------------------- posts */
  app.post("/api/goodvibes/posts", requireUser, wrap(async (req, res) => {
    const today = todayISO();
    await store.ensureAssignmentsThrough(today);
    const assignment = await store.getAssignmentByDate(today);
    if (!assignment) return res.status(409).json({ error: "Today isn't a working day." });
    if (assignment.employeeId !== req.user.id) return res.status(403).json({ error: "It's not your turn today." });
    if (await store.getGvPostByAssignment(assignment.id)) return res.status(409).json({ error: "You've already posted today." });

    const category = String(req.body?.category || "");
    if (!GOOD_VIBES_CATEGORIES.some(c => c.id === category)) return res.status(422).json({ error: "Pick a category." });
    const body = String(req.body?.body || "").trim();
    if (!body) return res.status(422).json({ error: "Write something first." });

    const post = await store.insertGvPost({
      id: randomUUID(), assignmentId: assignment.id, employeeId: req.user.id,
      category, body: body.slice(0, 2000)
    });
    broadcast(["goodvibes"], req.user.id);
    res.status(201).json({ post: { ...post, likeCount: 0, likedByMe: false, comments: [] } });
  }));

  app.post("/api/goodvibes/posts/:id/like", requireUser, wrap(async (req, res) => {
    const post = await store.getGvPost(req.params.id);
    if (!post) return res.status(404).json({ error: "No such post." });
    const result = await store.toggleGvLike(post.id, req.user.id);
    broadcast(["goodvibes"], req.user.id);
    res.json(result);
  }));

  app.post("/api/goodvibes/posts/:id/comments", requireUser, wrap(async (req, res) => {
    const post = await store.getGvPost(req.params.id);
    if (!post) return res.status(404).json({ error: "No such post." });
    const body = String(req.body?.body || "").trim();
    if (!body) return res.status(400).json({ error: "Write something first." });
    const comment = await store.addGvComment(post.id, {
      id: randomUUID(), authorId: req.user.id, at: new Date().toISOString(), body: body.slice(0, 4000)
    });
    broadcast(["goodvibes"], req.user.id);
    res.json({ comment });
  }));

  /* ---------------------------------------------------------------- admin */
  app.put("/api/goodvibes/admin/rotation", requireUser, requireManager, wrap(async (req, res) => {
    const employeeIds = Array.isArray(req.body?.employeeIds) ? req.body.employeeIds : [];
    const known = new Set((await store.listRotationAdmin()).map(r => r.employeeId));
    const distinct = new Set(employeeIds);
    if (employeeIds.length !== known.size || distinct.size !== employeeIds.length || employeeIds.some(id => !known.has(id))) {
      return res.status(422).json({ error: "That isn't a valid reordering of the current rotation." });
    }
    const rotation = await store.setRotationOrder(employeeIds);
    broadcast(["goodvibes"], req.user.id);
    res.json({ rotation });
  }));

  // Consumes today's turn and hands it to the next eligible person in
  // sequence — that new person becomes the anchor for tomorrow's computation,
  // same as any ordinary day. The skipped person resumes their normal
  // position next cycle; nothing about their place in the order changes.
  app.post("/api/goodvibes/admin/skip", requireUser, requireManagerOrTeamLead, wrap(async (req, res) => {
    const today = todayISO();
    await store.ensureAssignmentsThrough(today);
    const assignment = await store.getAssignmentByDate(today);
    if (!assignment) return res.status(409).json({ error: "Today isn't a working day." });
    if (isTeamLead(req.user) && !isManager(req.user)) {
      if (!hasCapability(req.user, "goodvibes")) return res.status(403).json({ error: "You don't have the Good Vibes Wall capability." });
      const current = await store.getEmployee(assignment.employeeId);
      if (!current || !inManagedScope(req.user, current)) return res.status(403).json({ error: "You can only skip today's turn when it's someone on your own team." });
    }
    if (await store.getGvPostByAssignment(assignment.id)) return res.status(409).json({ error: "Already posted today — can't change the assignment." });
    const order = await store.getActiveRotationOrder();
    const nextId = nextInRotation(order, assignment.employeeId);
    if (!nextId) return res.status(409).json({ error: "No one else is active in the rotation." });
    const updated = await store.updateAssignment(assignment.id, {
      employeeId: nextId, status: "skipped", skippedEmployeeId: assignment.employeeId, reassignedById: null
    });
    broadcast(["goodvibes"], req.user.id);
    res.json({ assignment: updated });
  }));

  // Explicit override, doesn't have to follow sequence — but also becomes
  // the new anchor going forward, so rotation continues from here. Only
  // ever called for today from the UI; a day that isn't already generated
  // (e.g. a future date) simply isn't reassignable yet.
  app.put("/api/goodvibes/admin/assignments/:date", requireUser, requireManagerOrTeamLead, wrap(async (req, res) => {
    const date = String(req.params.date || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: "Bad date." });
    const employee = await store.getEmployee(String(req.body?.employeeId || ""));
    if (!employee || !employee.active) return res.status(422).json({ error: "Pick an active person." });
    const teamLeadActing = isTeamLead(req.user) && !isManager(req.user);
    if (teamLeadActing && !hasCapability(req.user, "goodvibes")) return res.status(403).json({ error: "You don't have the Good Vibes Wall capability." });
    if (teamLeadActing && date !== todayISO()) return res.status(403).json({ error: "Team leads can only reassign today's turn." });
    if (teamLeadActing && !inManagedScope(req.user, employee)) return res.status(403).json({ error: "You can only reassign to someone on your own team." });
    if (date === todayISO()) await store.ensureAssignmentsThrough(date);
    const assignment = await store.getAssignmentByDate(date);
    if (!assignment) return res.status(409).json({ error: "That day doesn't have an assignment yet." });
    if (teamLeadActing) {
      const current = await store.getEmployee(assignment.employeeId);
      if (!current || !inManagedScope(req.user, current)) return res.status(403).json({ error: "You can only reassign today's turn when it's someone on your own team." });
    }
    if (await store.getGvPostByAssignment(assignment.id)) return res.status(409).json({ error: "That day already has a post — it can't be reassigned." });
    const updated = await store.updateAssignment(assignment.id, {
      employeeId: employee.id, status: "reassigned", skippedEmployeeId: null, reassignedById: req.user.id
    });
    broadcast(["goodvibes"], req.user.id);
    res.json({ assignment: updated });
  }));

  app.delete("/api/goodvibes/admin/posts/:id", requireUser, requireManager, wrap(async (req, res) => {
    const post = await store.getGvPost(req.params.id);
    if (!post) return res.status(404).json({ error: "No such post." });
    await store.hideGvPost(post.id, req.user.id);
    broadcast(["goodvibes"], req.user.id);
    res.json({ ok: true });
  }));

  app.delete("/api/goodvibes/admin/comments/:id", requireUser, requireManager, wrap(async (req, res) => {
    await store.hideGvComment(req.params.id, req.user.id);
    broadcast(["goodvibes"], req.user.id);
    res.json({ ok: true });
  }));
}
