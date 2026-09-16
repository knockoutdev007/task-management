/**
 * User ID + password authentication with a server-side session table and an
 * httpOnly cookie. No third-party identity provider, so nobody needs an
 * account anywhere else to use this.
 *
 * Swapping in Google/Microsoft SSO later means replacing `login` and the
 * cookie issue below; everything downstream only reads `req.user`.
 */
import bcrypt from "bcryptjs";
import { randomUUID, randomBytes, timingSafeEqual, createHmac } from "node:crypto";
import {
  getEmployeeByUsername, getEmployee, getPasswordHash, setPassword,
  createSession, readSession, dropSession, dropSessionsFor, touchLogin, purgeSessions
} from "./db.js";

const COOKIE = "tcc_session";
const DAYS = Number(process.env.SESSION_DAYS || 14);
const SECRET = process.env.SESSION_SECRET || "";
if (!SECRET || SECRET.length < 24) {
  console.error("\n  SESSION_SECRET is missing or too short.\n" +
                "  Set a random value of at least 24 characters in .env — see .env.example.\n");
  process.exit(1);
}

const sign = id => createHmac("sha256", SECRET).update(id).digest("base64url");
const stamp = id => id + "." + sign(id);
function unstamp(value) {
  const i = String(value || "").lastIndexOf(".");
  if (i < 1) return null;
  const id = value.slice(0, i), sig = value.slice(i + 1);
  const expected = sign(id);
  if (sig.length !== expected.length) return null;
  return timingSafeEqual(Buffer.from(sig), Buffer.from(expected)) ? id : null;
}

export const hashPassword = pw => bcrypt.hashSync(String(pw), 12);
export const randomPassword = () => randomBytes(9).toString("base64url");

function parseCookies(header) {
  const out = {};
  String(header || "").split(";").forEach(part => {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function issue(res, sessionId) {
  const secure = process.env.NODE_ENV === "production" && process.env.INSECURE_COOKIES !== "1";
  res.setHeader("Set-Cookie",
    `${COOKIE}=${encodeURIComponent(stamp(sessionId))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${DAYS * 86400}` +
    (secure ? "; Secure" : ""));
}
function clear(res) {
  res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

/** Attaches req.user when a valid session cookie is present. Never rejects. */
export function attachUser(req, _res, next) {
  const raw = parseCookies(req.headers.cookie)[COOKIE];
  const id = raw && unstamp(raw);
  if (id) {
    const s = readSession(id);
    if (s) {
      const u = getEmployee(s.employee_id);
      if (u && u.active) { req.user = u; req.sessionId = id; }
    }
  }
  next();
}
export const requireUser = (req, res, next) =>
  req.user ? next() : res.status(401).json({ error: "Sign in to continue." });
export const requireManager = (req, res, next) =>
  req.user && req.user.role === "manager" ? next() : res.status(403).json({ error: "Managers only." });

/* --------------------------------------------------------- login attempts */
// Small in-memory throttle. Enough for an internal tool behind a VPN or SSO
// proxy; put a real rate limiter in front if this is exposed to the internet.
const attempts = new Map();
const tooMany = key => {
  const a = attempts.get(key);
  return a && a.n >= 8 && Date.now() - a.first < 15 * 60_000;
};
const noteAttempt = key => {
  const a = attempts.get(key);
  if (!a || Date.now() - a.first > 15 * 60_000) attempts.set(key, { n: 1, first: Date.now() });
  else a.n++;
};

export function mountAuth(app) {
  setInterval(purgeSessions, 3600_000).unref();

  app.post("/api/auth/login", (req, res) => {
    const username = String(req.body?.username || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    const key = username + "|" + (req.ip || "");
    if (tooMany(key)) return res.status(429).json({ error: "Too many attempts. Wait 15 minutes and try again." });

    const row = getEmployeeByUsername(username);
    const ok = row && row.active && row.password_hash && bcrypt.compareSync(password, row.password_hash);
    if (!ok) { noteAttempt(key); return res.status(401).json({ error: "That User ID and password don't match." }); }

    attempts.delete(key);
    const sid = randomUUID();
    createSession(sid, row.id, new Date(Date.now() + DAYS * 86400_000).toISOString());
    touchLogin(row.id);
    issue(res, sid);
    res.json({ me: getEmployee(row.id) });
  });

  app.post("/api/auth/logout", (req, res) => {
    if (req.sessionId) dropSession(req.sessionId);
    clear(res);
    res.json({ ok: true });
  });

  app.get("/api/auth/me", (req, res) => res.json({ me: req.user || null }));

  app.post("/api/auth/password", requireUser, (req, res) => {
    const current = String(req.body?.current || ""), next = String(req.body?.next || "");
    if (next.length < 10) return res.status(400).json({ error: "Use at least 10 characters." });
    const hash = getPasswordHash(req.user.id);
    if (hash && !bcrypt.compareSync(current, hash)) return res.status(400).json({ error: "Your current password is wrong." });
    setPassword(req.user.id, hashPassword(next), 0);
    dropSessionsFor(req.user.id);                       // sign out other devices
    const sid = randomUUID();
    createSession(sid, req.user.id, new Date(Date.now() + DAYS * 86400_000).toISOString());
    issue(res, sid);
    res.json({ ok: true });
  });
}
