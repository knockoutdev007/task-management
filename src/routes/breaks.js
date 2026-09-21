/** Break tracking. Start/end always act on the caller's own id — never
 *  delegatable, unlike daily updates where a manager may post on someone's
 *  behalf. Viewing is scoped: employees see their own, managers see anyone's. */
import { randomUUID } from "node:crypto";
import * as store from "../db.js";
import { isManager, breakType } from "../domain.js";
import { broadcast } from "../events.js";
import { wrap } from "../wrap.js";

export function mountBreaks(app, requireUser) {
  app.get("/api/breaks", requireUser, wrap(async (req, res) => {
    if (isManager(req.user) && !req.query.employeeId) {
      return res.json({ breaks: await store.listAllBreaks() });
    }
    const employeeId = isManager(req.user) ? String(req.query.employeeId) : req.user.id;
    if (!(await store.getEmployee(employeeId))) return res.status(404).json({ error: "No such person." });
    res.json({ breaks: await store.listBreaks(employeeId) });
  }));

  app.post("/api/breaks/start", requireUser, wrap(async (req, res) => {
    const type = breakType(req.body?.kind);
    if (!type) return res.status(422).json({ error: "Choose a valid break type." });
    if (await store.getOpenBreak(req.user.id)) {
      return res.status(409).json({ error: "You're already on a break." });
    }
    if (await store.usedBreakKindToday(req.user.id, type.id)) {
      return res.status(409).json({ error: `You've already used ${type.label} today.` });
    }
    const b = await store.startBreak(randomUUID(), req.user.id, type.id);
    broadcast(["breaks"], req.user.id);
    res.status(201).json({ break: b });
  }));

  app.post("/api/breaks/end", requireUser, wrap(async (req, res) => {
    const open = await store.getOpenBreak(req.user.id);
    if (!open) return res.status(409).json({ error: "You're not on a break." });
    const b = await store.endBreak(open.id);
    broadcast(["breaks"], req.user.id);
    res.json({ break: b });
  }));
}
