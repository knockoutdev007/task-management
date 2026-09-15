/** People, projects, configuration and daily updates. */
import { randomUUID } from "node:crypto";
import * as store from "../db.js";
import { isManager } from "../domain.js";
import { hashPassword, randomPassword } from "../auth.js";
import { broadcast } from "../events.js";

const initialsOf = n => String(n || "?").trim().split(/\s+/).slice(0, 2).map(w => w[0]).join("").toUpperCase();
const PALETTE = ["#0E7C86","#2A5FA0","#6E42A8","#A85708","#16794A","#B8342A","#55708F","#8A5A2B","#3E7C5A","#7A4470"];
const colorFor = id => { let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return PALETTE[h % PALETTE.length]; };

export function mountAdmin(app, requireUser, requireManager) {

  /* ---------------------------------------------------------- employees */
  app.get("/api/employees", requireUser, (_req, res) => res.json({ employees: store.listEmployees() }));

  app.put("/api/employees/:id", requireUser, requireManager, (req, res) => {
    const b = req.body || {};
    const name = String(b.name || "").trim();
    const email = String(b.email || "").trim().toLowerCase();
    if (!name) return res.status(422).json({ error: "A name is required." });
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(422).json({ error: "A valid email is required — it's how they sign in." });

    const clash = store.getEmployeeByEmail(email);
    if (clash && clash.id !== req.params.id) return res.status(409).json({ error: "Someone else already uses that email." });

    const existing = store.getEmployee(req.params.id);
    // Don't let the last manager demote or deactivate themselves out of the system.
    if (existing && existing.role === "manager" && (b.role !== "manager" || b.active === false)) {
      const managers = store.listEmployees().filter(e => e.role === "manager" && e.active).length;
      if (managers <= 1) return res.status(409).json({ error: "This is the only active manager — promote someone else first." });
    }

    const saved = store.upsertEmployee({
      id: req.params.id, name, email, initials: initialsOf(name),
      role: b.role === "manager" ? "manager" : "employee",
      title: b.title || "", departmentId: b.departmentId || "", teamId: b.teamId || "",
      managerId: b.managerId || null, capacityHours: Number(b.capacityHours) || 40,
      color: b.color || (existing && existing.color) || colorFor(req.params.id),
      active: b.active !== false
    });

    // A brand-new person needs a way in. Return the temporary password once.
    let temporaryPassword = null;
    if (!existing || !existing.hasPassword) {
      temporaryPassword = randomPassword();
      store.setPassword(saved.id, hashPassword(temporaryPassword), 1);
    }
    broadcast(["employees"], req.user.id);
    res.json({ employee: store.getEmployee(saved.id), temporaryPassword });
  });

  /** Reset someone's password and hand the manager a one-time value to pass on. */
  app.post("/api/employees/:id/reset-password", requireUser, requireManager, (req, res) => {
    const e = store.getEmployee(req.params.id);
    if (!e) return res.status(404).json({ error: "No such person." });
    const temporaryPassword = randomPassword();
    store.setPassword(e.id, hashPassword(temporaryPassword), 1);
    store.dropSessionsFor(e.id);
    res.json({ temporaryPassword });
  });

  app.delete("/api/employees/:id", requireUser, requireManager, (req, res) => {
    const e = store.getEmployee(req.params.id);
    if (!e) return res.status(404).json({ error: "No such person." });
    if (e.role === "manager" && store.listEmployees().filter(x => x.role === "manager" && x.active).length <= 1) {
      return res.status(409).json({ error: "This is the only active manager." });
    }
    // Deactivate rather than delete: their task history stays readable.
    store.deleteEmployee(e.id);
    store.dropSessionsFor(e.id);
    broadcast(["employees"], req.user.id);
    res.json({ ok: true, deactivated: true });
  });

  /* ------------------------------------------------------------ projects */
  app.get("/api/projects", requireUser, (_req, res) => res.json({ projects: store.listProjects() }));

  app.put("/api/projects/:id", requireUser, requireManager, (req, res) => {
    const b = req.body || {};
    if (!String(b.name || "").trim()) return res.status(422).json({ error: "A project name is required." });
    const p = store.upsertProject({ ...b, id: req.params.id, name: String(b.name).trim() });
    broadcast(["projects"], req.user.id);
    res.json({ project: p });
  });

  app.delete("/api/projects/:id", requireUser, requireManager, (req, res) => {
    store.deleteProject(req.params.id);          // tasks keep their history, project_id goes null
    broadcast(["projects", "tasks"], req.user.id);
    res.json({ ok: true });
  });

  /* -------------------------------------------------------------- config */
  app.get("/api/config", requireUser, (_req, res) => res.json({ config: store.getConfig() }));

  app.put("/api/config", requireUser, requireManager, (req, res) => {
    const incoming = req.body || {};
    const current = store.getConfig();
    const next = { ...current, ...incoming };

    // Guard the invariants the dashboard relies on.
    if (!Array.isArray(next.statuses) || !next.statuses.length) return res.status(422).json({ error: "At least one status is required." });
    for (const id of ["NOT_STARTED", "IN_PROGRESS", "COMPLETED"]) {
      if (!next.statuses.some(s => s.id === id)) return res.status(422).json({ error: `The ${id} status cannot be removed.` });
    }
    if (!Array.isArray(next.priorities) || !next.priorities.length) return res.status(422).json({ error: "At least one priority is required." });
    const used = new Set(store.listTasks().map(t => t.status));
    for (const id of used) {
      if (!next.statuses.some(s => s.id === id)) return res.status(409).json({ error: `Tasks still use the “${id}” status — move them first.` });
    }
    const w = next.workload || {};
    if (!(w.normal < w.high && w.high < w.overloaded)) return res.status(422).json({ error: "Workload bands must increase: normal < high < overloaded." });

    const saved = store.setConfig(next);
    broadcast(["config"], req.user.id);
    res.json({ config: saved });
  });

  /* ------------------------------------------------------- daily updates */
  app.get("/api/updates", requireUser, (_req, res) => res.json({ updates: store.listUpdates() }));

  app.put("/api/updates/:date", requireUser, (req, res) => {
    const date = String(req.params.date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: "Bad date." });
    const b = req.body || {};
    // Managers can post on someone's behalf; everyone else posts as themselves.
    const target = (isManager(req.user) && b.employeeId) ? b.employeeId : req.user.id;
    if (!store.getEmployee(target)) return res.status(404).json({ error: "No such person." });
    if (![b.completed, b.current, b.next, b.blocked].some(v => String(v || "").trim())) {
      return res.status(422).json({ error: "Fill in at least one answer." });
    }
    store.upsertUpdate(target, { ...b, date, at: new Date().toISOString() });
    broadcast(["updates"], req.user.id);
    res.json({ updates: store.listUpdates() });
  });

  /* ----------------------------------------------------------- bootstrap */
  // One round trip for a cold load, instead of five.
  app.get("/api/bootstrap", requireUser, (req, res) => res.json({
    me: req.user,
    employees: store.listEmployees(),
    projects: store.listProjects(),
    tasks: store.listTasks(),
    updates: store.listUpdates(),
    breaks: isManager(req.user) ? store.listAllBreaks() : store.listBreaks(req.user.id),
    config: store.getConfig(),
    notifications: store.listNotifications(req.user.id),
    serverTime: new Date().toISOString()
  }));
}
