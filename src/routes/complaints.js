/**
 * Complaint Wall. Any employee can submit a complaint; it sits in a
 * manager-only inbox until a manager publishes it. Published complaints
 * are always anonymous on the board, whether or not they have a poll.
 * A poll asks "do you believe this happened as described" — yes/no.
 * Everyone sees the running total; only managers see who voted which way,
 * same as only managers ever see who filed the complaint at all.
 */
import { randomUUID } from "node:crypto";
import * as store from "../db.js";
import { broadcast } from "../events.js";
import { wrap } from "../wrap.js";

export function mountComplaints(app, requireUser, requireManager) {
  /** A manager can switch the whole feature off from Settings > "Features"
   *  (cfg().featureFlags.complaints) — enforced here, not just hidden from
   *  the nav, so a direct API call can't bypass it either. Covers both
   *  route prefixes this file registers under. */
  const requireEnabled = wrap(async (req, res, next) => {
    const cfg = await store.getConfig();
    if ((cfg.featureFlags || {}).complaints === false) return res.status(404).json({ error: "Complaint Wall is turned off." });
    next();
  });
  app.use("/api/complaints", requireEnabled);
  app.use("/api/admin/complaints", requireEnabled);

  app.get("/api/complaints/bootstrap", requireUser, wrap(async (req, res) => {
    const isManagerView = req.user.role === "manager";
    res.json({ complaints: await store.listComplaints({ isManagerView, viewerId: req.user.id }) });
  }));

  app.post("/api/complaints", requireUser, wrap(async (req, res) => {
    const body = String(req.body?.body || "").trim().slice(0, 4000);
    if (!body) return res.status(422).json({ error: "Write your complaint first." });
    await store.insertComplaint({ id: randomUUID(), employeeId: req.user.id, body });
    res.status(201).json({ ok: true });
  }));

  app.post("/api/complaints/:id/vote", requireUser, wrap(async (req, res) => {
    const c = await store.getComplaint(req.params.id);
    if (!c || c.status !== "published") return res.status(404).json({ error: "Complaint not found." });
    if (!c.pollEnabled) return res.status(409).json({ error: "This complaint doesn't have an open poll." });
    if (typeof req.body?.believe !== "boolean") return res.status(422).json({ error: "Vote yes or no." });
    const result = await store.castComplaintVote(req.params.id, req.user.id, req.body.believe);
    broadcast(["complaints"], req.user.id);
    res.json(result);
  }));

  /** Manager-only: publish/archive/return-to-inbox and start/stop the poll.
   *  One flexible endpoint rather than four narrow ones, same shape as
   *  PUT /api/config elsewhere in this app. */
  app.put("/api/admin/complaints/:id", requireUser, requireManager, wrap(async (req, res) => {
    const b = req.body || {};
    if (b.status !== undefined && !["pending", "published", "archived"].includes(b.status)) {
      return res.status(422).json({ error: "Invalid status." });
    }
    const updated = await store.updateComplaint(req.params.id, { status: b.status, pollEnabled: b.pollEnabled, byId: req.user.id });
    if (!updated) return res.status(404).json({ error: "Complaint not found." });
    broadcast(["complaints"], req.user.id);
    res.json({ complaint: updated });
  }));
}
