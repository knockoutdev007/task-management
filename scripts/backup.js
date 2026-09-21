/**
 * Dump the database via `mysqldump`, safe to run while the server is up.
 *   npm run backup            -> ./backups/tcc-YYYY-MM-DD-HHmm.sql.gz
 * Keeps the 30 most recent. Put it in cron:  0 2 * * * cd /srv/tcc && npm run backup
 *
 * Requires the `mysqldump` and `gzip` binaries on PATH, and DATABASE_URL set
 * (same connection the app uses — see .env.example). Unlike the old SQLite
 * backup, this shells out rather than using an in-process driver API, since
 * mysql2 has no equivalent of better-sqlite3's online db.backup().
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const dir = process.env.BACKUP_DIR || path.join(HERE, "..", "backups");
fs.mkdirSync(dir, { recursive: true });

const url = new URL(process.env.DATABASE_URL || "");
if (!url.hostname) {
  console.error("DATABASE_URL is not set. See .env.example.");
  process.exit(1);
}
const database = url.pathname.replace(/^\//, "");

const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
const target = path.join(dir, `tcc-${stamp}.sql.gz`);

const dump = spawn("mysqldump", [
  "--host", url.hostname,
  "--port", url.port || "3306",
  "--user", decodeURIComponent(url.username),
  `--password=${decodeURIComponent(url.password)}`,
  "--single-transaction", "--routines", "--events",
  database
]);
const gzip = spawn("gzip");
dump.stdout.pipe(gzip.stdin);
const out = fs.createWriteStream(target);
gzip.stdout.pipe(out);

let dumpErr = "";
dump.stderr.on("data", d => { dumpErr += d; });

await new Promise((resolve, reject) => {
  out.on("close", resolve);
  dump.on("error", reject);
  gzip.on("error", reject);
  dump.on("exit", code => { if (code !== 0) reject(new Error("mysqldump failed: " + dumpErr)); });
});

const keep = 30;
const old = fs.readdirSync(dir).filter(f => f.startsWith("tcc-") && f.endsWith(".sql.gz")).sort().slice(0, -keep);
old.forEach(f => fs.unlinkSync(path.join(dir, f)));

console.log(`Backed up to ${target}${old.length ? ` (removed ${old.length} old snapshot${old.length === 1 ? "" : "s"})` : ""}`);
