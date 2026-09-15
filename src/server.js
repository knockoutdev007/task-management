/**
 * Team Control Center — server entry point.
 *
 *   npm run seed     load demo data (once)
 *   npm start        serve on PORT (default 3000)
 */
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { attachUser, requireUser, requireManager, mountAuth } from "./auth.js";
import { mountEvents } from "./events.js";
import { mountTasks } from "./routes/tasks.js";
import { mountAdmin } from "./routes/admin.js";
import { mountAttachments } from "./routes/attachments.js";
import { mountBreaks } from "./routes/breaks.js";
import { mountNotifications } from "./routes/notifications.js";
import { listEmployees } from "./db.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(HERE, "..", "public");
const PORT = Number(process.env.PORT || 3000);

const app = express();
app.set("trust proxy", Number(process.env.TRUST_PROXY || 1));   // behind nginx / a platform router
app.disable("x-powered-by");

app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "same-origin");
  next();
});
app.use(express.json({ limit: "1mb" }));
app.use(attachUser);

mountAuth(app);
mountEvents(app, requireUser);
mountTasks(app, requireUser, requireManager);
mountAdmin(app, requireUser, requireManager);
mountAttachments(app, requireUser);
mountBreaks(app, requireUser);
mountNotifications(app, requireUser);

app.get("/api/health", (_req, res) => res.json({ ok: true, people: listEmployees().length }));

app.use(express.static(PUBLIC, { index: "index.html", maxAge: process.env.NODE_ENV === "production" ? "1h" : 0 }));
app.get("/api/*", (_req, res) => res.status(404).json({ error: "No such endpoint." }));
app.get("*", (_req, res) => res.sendFile(path.join(PUBLIC, "index.html")));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Something went wrong on the server." });
});

app.listen(PORT, () => {
  const n = listEmployees().length;
  console.log(`\n  Team Control Center → http://localhost:${PORT}`);
  if (!n) console.log("  No people yet. Run:  npm run seed\n");
  else console.log(`  ${n} people in the database.\n`);
});
