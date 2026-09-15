/**
 * Task file attachments. Stored on disk under the data directory (next to
 * the SQLite file, so both live on the same persistent volume in
 * production); metadata lives in the task_attachments table.
 *
 * Anyone signed in may read or add an attachment — same rule as comments,
 * since the person mentioned to help on a task is often not its owner.
 * Removing one requires being the uploader, able to edit the task, or a
 * manager.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import multer from "multer";
import * as store from "../db.js";
import { canEditTask, isManager, noteEntry, notificationRecipients } from "../domain.js";
import { broadcast } from "../events.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DATABASE_PATH || path.join(HERE, "..", "..", "data", "tcc.db");
const UPLOAD_DIR = path.join(path.dirname(DB_PATH), "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const MAX_SIZE = 25 * 1024 * 1024; // 25MB
const ALLOWED_TYPES = new Set([
  "image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml",
  "application/pdf",
  "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint", "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain", "text/csv",
  "application/zip", "application/x-zip-compressed",
  "video/mp4", "audio/mpeg"
]);

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => cb(null, randomUUID() + path.extname(file.originalname || "").slice(0, 12))
  }),
  limits: { fileSize: MAX_SIZE },
  fileFilter: (_req, file, cb) => cb(null, ALLOWED_TYPES.has(file.mimetype))
}).single("file");

export function mountAttachments(app, requireUser) {
  app.post("/api/tasks/:id/attachments", requireUser, (req, res) => {
    const t = store.getTask(req.params.id);
    if (!t) return res.status(404).json({ error: "No such task." });
    upload(req, res, err => {
      if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE")
        return res.status(413).json({ error: "That file is larger than 25MB." });
      if (err) return res.status(400).json({ error: "Couldn't upload that file." });
      if (!req.file) return res.status(400).json({ error: "That file type isn't allowed." });

      const a = {
        id: randomUUID(), filename: req.file.filename, originalName: req.file.originalname,
        mimeType: req.file.mimetype, size: req.file.size,
        uploadedById: req.user.id, uploadedAt: new Date().toISOString()
      };
      store.addAttachment(t.id, a);
      const act = noteEntry(req.user, "attachment", "Attached: " + a.originalName);
      store.addActivity(t.id, act);
      for (const r of notificationRecipients(t, act, store.listEmployees())) {
        store.addNotification({ id: randomUUID(), employeeId: r.employeeId, taskId: t.id, activityId: act.id, kind: r.kind, text: r.text, createdAt: act.at });
      }
      broadcast(["tasks", "notifications"], req.user.id);
      res.status(201).json({ task: store.getTask(t.id) });
    });
  });

  app.get("/api/tasks/:id/attachments/:attId", requireUser, (req, res) => {
    const row = store.getAttachmentRow(req.params.attId);
    if (!row || row.task_id !== req.params.id) return res.status(404).json({ error: "No such file." });
    const filePath = path.join(UPLOAD_DIR, row.filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: "That file is missing on disk." });
    res.download(filePath, row.original_name);
  });

  app.delete("/api/tasks/:id/attachments/:attId", requireUser, (req, res) => {
    const t = store.getTask(req.params.id);
    if (!t) return res.status(404).json({ error: "No such task." });
    const row = store.getAttachmentRow(req.params.attId);
    if (!row || row.task_id !== t.id) return res.status(404).json({ error: "No such file." });
    const allowed = row.uploaded_by_id === req.user.id || canEditTask(req.user, t) || isManager(req.user);
    if (!allowed) return res.status(403).json({ error: "You can't remove that file." });
    store.deleteAttachmentRow(row.id);
    fs.unlink(path.join(UPLOAD_DIR, row.filename), () => {});
    const act = noteEntry(req.user, "attachment", "Removed: " + row.original_name);
    store.addActivity(t.id, act);
    for (const r of notificationRecipients(t, act, store.listEmployees())) {
      store.addNotification({ id: randomUUID(), employeeId: r.employeeId, taskId: t.id, activityId: act.id, kind: r.kind, text: r.text, createdAt: act.at });
    }
    broadcast(["tasks", "notifications"], req.user.id);
    res.json({ task: store.getTask(t.id) });
  });
}
