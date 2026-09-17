/** Break tracking. Start/end always act on the caller's own id — never
 *  delegatable, unlike daily updates where a manager may post on someone's
 *  behalf. Viewing is scoped: employees see their own, managers see anyone's. */
import { randomUUID } from "node:crypto";
import * as store from "../db.js";
import { isManager, breakType } from "../domain.js";
import { broadcast } from "../events.js";

export function mountBreaks(app, requireUser) {
  app.get("/api/breaks", requireUser, (req, res) => {
    if (isManager(req.user) && !req.query.employeeId) {
      return res.json({ breaks: store.listAllBreaks() });
    }
    const employeeId = isManager(req.user) ? String(req.query.employeeId) : req.user.id;
    if (!store.getEmployee(employeeId)) return res.status(404).json({ error: "No such person." });
    res.json({ breaks: store.listBreaks(employeeId) });
  });

  app.post("/api/breaks/start", requireUser, (req, res) => {
    const type = breakType(req.body?.kind);
    if (!type) return res.status(422).json({ error: "Choose a valid break type." });
    if (store.getOpenBreak(req.user.id)) {
      return res.status(409).json({ error: "You're already on a break." });
    }
    if (store.usedBreakKindToday(req.user.id, type.id)) {
      return res.status(409).json({ error: `You've already used ${type.label} today.` });
    }
    const b = store.startBreak(randomUUID(), req.user.id, type.id);
    broadcast(["breaks"], req.user.id);
    res.status(201).json({ break: b });
  });

  app.post("/api/breaks/end", requireUser, (req, res) => {
    const open = store.getOpenBreak(req.user.id);
    if (!open) return res.status(409).json({ error: "You're not on a break." });
    const b = store.endBreak(open.id);
    broadcast(["breaks"], req.user.id);
    res.json({ break: b });
  });
}
