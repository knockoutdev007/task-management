/**
 * Load the demo team, projects and tasks.
 *
 *   npm run seed          add the demo data (refuses if people already exist)
 *   npm run seed:reset    wipe every table first — destroys real data
 *
 * Dates in scripts/seed-data are anchored to a fixed day and shifted so the
 * demo always shows a believable "today": overdue work, work due now, and
 * work completed earlier in the week.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db, upsertEmployee, upsertProject, upsertTask, addComment, addActivity,
         upsertUpdate, setConfig, listEmployees, setPassword, usernameForBatch } from "../src/db.js";
import { hashPassword } from "../src/auth.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(HERE, "seed-data");
const RESET = process.argv.includes("--reset");
const PASSWORD = process.env.SEED_PASSWORD || "controlcenter1";

const ANCHOR = new Date("2026-09-10T00:00:00Z");           // the day the fixtures were written for
const TODAY = new Date(); TODAY.setUTCHours(0, 0, 0, 0);
const SHIFT_DAYS = Math.round((TODAY - ANCHOR) / 86400000);

const shiftDate = s => {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + SHIFT_DAYS);
  return d.toISOString().slice(0, 10);
};
const shiftStamp = s => {
  if (!s || typeof s !== "string" || s.length < 20) return s;
  const d = new Date(s);
  if (isNaN(d)) return s;
  d.setUTCDate(d.getUTCDate() + SHIFT_DAYS);
  return d.toISOString();
};
const read = (sub, f) => JSON.parse(fs.readFileSync(path.join(DATA, sub, f), "utf8"));
// git doesn't track empty directories, so an all-empty fixture folder (e.g. no
// sample dailyUpdates) may not exist at all in a fresh checkout — that's fine,
// it just means there's nothing to load, not an error.
const files = sub => {
  try { return fs.readdirSync(path.join(DATA, sub)).filter(f => f.endsWith(".json")).sort(); }
  catch (e) { if (e.code === "ENOENT") return []; throw e; }
};

if (RESET) {
  console.log("Wiping every table…");
  db.exec(`DELETE FROM task_activity; DELETE FROM task_comments; DELETE FROM tasks;
           DELETE FROM daily_updates; DELETE FROM projects; DELETE FROM sessions;
           DELETE FROM employees; DELETE FROM config;`);
} else if (listEmployees().length) {
  console.error("There are already people in this database. Use `npm run seed:reset` to replace everything.");
  process.exit(1);
}

const seed = db.transaction(() => {
  setConfig(read("config", "settings.json"));

  const takenUsernames = new Set();
  for (const f of files("employees")) {
    const id = f.replace(".json", ""), e = read("employees", f);
    upsertEmployee({ ...e, id, username: usernameForBatch(e.name, takenUsernames) });
    setPassword(id, hashPassword(PASSWORD), 1);          // must change on first sign-in
  }
  for (const f of files("projects")) {
    const id = f.replace(".json", ""), p = read("projects", f);
    upsertProject({ ...p, id, startDate: shiftDate(p.startDate), targetDate: shiftDate(p.targetDate) });
  }
  for (const f of files("tasks")) {
    const id = f.replace(".json", ""), t = read("tasks", f);
    upsertTask({
      ...t, id,
      startDate: shiftDate(t.startDate), dueDate: shiftDate(t.dueDate),
      expectedCompletion: shiftDate(t.expectedCompletion),
      createdAt: shiftStamp(t.createdAt), updatedAt: shiftStamp(t.updatedAt),
      completedAt: shiftStamp(t.completedAt),
      blocker: t.blocker ? { ...t.blocker, since: shiftDate(t.blocker.since), expectedResolution: shiftDate(t.blocker.expectedResolution) } : null
    });
    // Fixture ids are only unique within their own task; these tables are global.
    for (const c of t.comments || []) addComment(id, { ...c, id: `${id}:${c.id}`, at: shiftStamp(c.at) });
    for (const a of t.activity || []) addActivity(id, { ...a, id: `${id}:${a.id}`, at: shiftStamp(a.at) });
  }
  for (const f of files("dailyUpdates")) {
    const id = f.replace(".json", ""), u = read("dailyUpdates", f);
    for (const e of u.entries || []) upsertUpdate(id, { ...e, date: shiftDate(e.date), at: shiftStamp(e.at) });
  }
});
seed();

const people = listEmployees();
const managers = people.filter(p => p.role === "manager");
console.log(`
  Seeded ${people.length} people, ${files("projects").length} projects, ${files("tasks").length} tasks.

  Everyone's starting password is:  ${PASSWORD}
  They are prompted to change it after signing in.

  Sign in as the manager:  ${managers.map(m => m.username).join(", ")}

  Replace this demo team with your own in Settings → People,
  then bulk-reassign or delete the demo tasks from All tasks.
`);
