/**
 * A signed-in person's own notification feed. Every route here is scoped to
 * req.user.id — nobody may read or mark another employee's notifications,
 * mirroring how POST /api/auth/password (src/auth.js) never trusts a
 * caller-supplied id and only ever touches the caller's own row.
 */
import * as store from "../db.js";

export function mountNotifications(app, requireUser) {
  app.get("/api/notifications", requireUser, (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 40, 200);
    res.json({ notifications: store.listNotifications(req.user.id, limit) });
  });

  app.post("/api/notifications/:id/read", requireUser, (req, res) => {
    const n = store.getNotification(req.params.id);
    if (!n || n.employeeId !== req.user.id) return res.status(404).json({ error: "No such notification." });
    store.markNotificationRead(req.params.id, req.user.id, new Date().toISOString());
    res.json({ ok: true });
  });

  app.post("/api/notifications/read-all", requireUser, (req, res) => {
    store.markAllNotificationsRead(req.user.id, new Date().toISOString());
    res.json({ ok: true });
  });

  // A personal override on top of the global default (config.notify) —
  // any signed-in person may read/write their own, never anyone else's.
  app.get("/api/me/notify-prefs", requireUser, (req, res) => {
    res.json({ prefs: store.getEmployeeNotifyPrefs(req.user.id) });
  });

  app.put("/api/me/notify-prefs", requireUser, (req, res) => {
    const patch = {};
    for (const [k, v] of Object.entries(req.body || {})) patch[k] = !!v;
    store.setEmployeeNotifyPrefs(req.user.id, patch);
    res.json({ prefs: store.getEmployeeNotifyPrefs(req.user.id) });
  });
}
