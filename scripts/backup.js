/**
 * Dump the database via `mysqldump`, safe to run while the server is up.
 *   npm run backup            -> ./backups/tcc-YYYY-MM-DD-HHmm.sql.gz
 * Keeps the 30 most recent. Put it in cron:  0 2 * * * cd /srv/tcc && npm run backup
 *
 * Requires the `mysqldump` and `gzip` binaries on PATH, and the same DB
 * connection settings the app uses — either DATABASE_URL, or discrete
 * DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD (see .env.example and db.js).
 * Unlike the old SQLite backup, this shells out rather than using an
 * in-process driver API, since mysql2 has no equivalent of better-sqlite3's
 * online db.backup().
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const dir = process.env.BACKUP_DIR || path.join(HERE, "..", "backups");
fs.mkdirSync(dir, { recursive: true });

function connection() {
  if (process.env.DATABASE_URL) {
    const url = new URL(process.env.DATABASE_URL);
    return { host: url.hostname, port: url.port || "3306", user: decodeURIComponent(url.username),
             password: decodeURIComponent(url.password), database: url.pathname.replace(/^\//, "") };
  }
  if (process.env.DB_HOST) {
    return { host: process.env.DB_HOST, port: process.env.DB_PORT || "3306", user: process.env.DB_USER,
             password: process.env.DB_PASSWORD, database: process.env.DB_NAME };
  }
  console.error("No database configured — set DATABASE_URL, or DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD. See .env.example.");
  process.exit(1);
}
const { host, port, user, password, database } = connection();

const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
const target = path.join(dir, `tcc-${stamp}.sql.gz`);

const dump = spawn("mysqldump", [
  "--host", host, "--port", String(port), "--user", user, `--password=${password}`,
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
