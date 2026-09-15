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
}
