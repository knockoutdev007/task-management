"use strict";
/* ============================================================================
   TEAM CONTROL CENTER
   Single-file operations dashboard. Shared state lives in the artifact `db`
   capability; all derived metrics are computed client-side from those rows.
   ========================================================================= */

/* ---------------------------------------------------------------- utilities */
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
const uid = p => p + "-" + Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 6);
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const sum = (a, f) => a.reduce((t, x) => t + (f ? f(x) : x), 0);
const by = (f, dir = 1) => (a, b) => { const x = f(a), y = f(b); return x < y ? -dir : x > y ? dir : 0; };
const uniq = a => Array.from(new Set(a));
const pct = (n, d) => d ? Math.round((n / d) * 100) : 0;

const DAY = 86400000;
const todayISO = () => new Date().toISOString().slice(0, 10);
const nowISO   = () => new Date().toISOString();
const dOf = s => { if (!s) return null; const d = new Date(s.length === 10 ? s + "T00:00:00" : s); return isNaN(d) ? null : d; };
const startOfDay = d => { const x = new Date(d); x.setHours(0,0,0,0); return x; };
const daysBetween = (a, b) => Math.round((startOfDay(b) - startOfDay(a)) / DAY);
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DOW = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

function fmtDate(s, opts = {}) {
  const d = dOf(s); if (!d) return "—";
  const t = startOfDay(new Date()), diff = daysBetween(t, d);
  if (!opts.absolute) { if (diff === 0) return "Today"; if (diff === 1) return "Tomorrow"; if (diff === -1) return "Yesterday"; }
  const y = d.getFullYear() !== t.getFullYear() ? " " + d.getFullYear() : "";
  return `${MON[d.getMonth()]} ${d.getDate()}${y}`;
}
function fmtAgo(ts) {
  const d = dOf(ts); if (!d) return "never";
  const m = Math.round((Date.now() - d.getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return m + "m ago";
  const h = Math.round(m / 60); if (h < 24) return h + "h ago";
  const dd = Math.round(h / 24); if (dd < 30) return dd + "d ago";
  return fmtDate(ts, { absolute: true });
}
function hoursSince(ts) { const d = dOf(ts); return d ? (Date.now() - d.getTime()) / 3600000 : Infinity; }
function fmtDT(ts) {
  const d = dOf(ts); if (!d) return "—";
  const hh = d.getHours(), mm = String(d.getMinutes()).padStart(2, "0");
  const ap = hh >= 12 ? "PM" : "AM", h12 = hh % 12 || 12;
  return `${MON[d.getMonth()]} ${d.getDate()}, ${h12}:${mm} ${ap}`;
}
function fmtTime(ts) {
  const d = dOf(ts); if (!d) return "—";
  const hh = d.getHours(), mm = String(d.getMinutes()).padStart(2, "0");
  const ap = hh >= 12 ? "PM" : "AM", h12 = hh % 12 || 12;
  return `${h12}:${mm} ${ap}`;
}
function fmtH(n) { if (n == null || isNaN(n)) return "—"; return (Math.round(n * 10) / 10) + "h"; }
function fmtDuration(seconds) {
  if (seconds == null || isNaN(seconds)) return "—";
  const m = Math.round(seconds / 60);
  if (m < 60) return m + "m";
  const h = Math.floor(m / 60), rem = m % 60;
  return rem ? `${h}h ${rem}m` : `${h}h`;
}
function fmtBytes(n) {
  if (!n && n !== 0) return "—";
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  return (n / (1024 * 1024)).toFixed(1) + " MB";
}
function initials(name) { return String(name || "?").trim().split(/\s+/).slice(0, 2).map(w => w[0]).join("").toUpperCase(); }
const AV_COLORS = ["#0E7C86","#2A5FA0","#6E42A8","#A85708","#16794A","#B8342A","#55708F","#8A5A2B","#3E7C5A","#7A4470"];
function avColor(id) { let h = 0; const s = String(id); for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return AV_COLORS[h % AV_COLORS.length]; }

function icon(name, cls = "") {
  const P = {
    grid:'<path d="M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z"/>',
    users:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/>',
    board:'<path d="M3 4h18v16H3z"/><path d="M9 4v16M15 4v16"/>',
    list:'<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    alert:'<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>',
    folder:'<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9l-.9-1.2A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
    chart:'<path d="M3 3v18h18"/><path d="M7 15l4-5 3 3 5-7"/>',
    sun:'<path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/><circle cx="12" cy="12" r="4"/>',
    cog:'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
    calendar:'<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    sunrise:'<path d="M12 2v6M4.9 10.9l1.4 1.4M2 18h2M20 18h2M17.7 12.3l1.4-1.4M22 22H2"/><path d="M8 18a4 4 0 0 1 8 0"/>',
    check:'<path d="M20 6 9 17l-5-5"/>',
    clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    ban:'<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>',
    dl:'<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5M12 15V3"/>',
    x:'<path d="M18 6 6 18M6 6l12 12"/>',
    plus:'<path d="M12 5v14M5 12h14"/>',
    edit:'<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4Z"/>',
    flag:'<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1Z"/><path d="M4 22v-7"/>',
    inbox:'<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.7 4H7.3a2 2 0 0 0-1.8 1.1Z"/>'
  };
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${P[name] || ""}</svg>`;
}
const av = (emp, size = "") => emp
  ? `<span class="av ${size}" style="background:${emp.color || avColor(emp.id)}" title="${esc(emp.name)}">${esc(emp.initials || initials(emp.name))}</span>`
  : `<span class="av ${size}" style="background:var(--ink-4)">?</span>`;

function csvEscape(v) { const s = String(v ?? ""); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
/* Saving a file is mediated by the host: it asks the viewer to confirm.
   Falls back to a plain link only when the page runs outside that host. */
let DL = undefined;
async function saveFile(filename, text) {
  if (DL === undefined) {
    try { DL = await (window.claude && window.claude.use ? window.claude.use("downloads") : null); }
    catch (e) { DL = null; }
  }
  if (DL) {
    try {
      const r = await DL.save({ filename: filename, data: text });
      if (r && r.status === "saved") toast("Saved " + filename);
      return;
    } catch (e) {
      const c = e && e.code;
      if (c === "declined") return;
      if (c === "rate_limited") return toast("A save prompt is already open.", true);
      if (c === "too_large") return toast("That export is too large for the destination you picked.", true);
      if (c === "rejected_extension" || c === "extension_not_enabled") return toast("This view cannot save that file type.", true);
      DL = null;   // unavailable here — fall through to the link path
    }
  }
  const blob = new Blob([text], { type: filename.slice(-4) === ".csv" ? "text/csv;charset=utf-8" : "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 400);
  toast("Exported " + filename);
}
function downloadCSV(filename, rows) {
  saveFile(filename, "\uFEFF" + rows.map(function (r) { return r.map(csvEscape).join(","); }).join("\r\n"));
}
let toastT;
function toast(msg, isErr) {
  clearTimeout(toastT);
  $$(".toast").forEach(t => t.remove());
  const el = document.createElement("div");
  el.className = "toast" + (isErr ? " err" : "");
  el.textContent = msg; el.setAttribute("role", "status");
  document.body.appendChild(el);
  toastT = setTimeout(() => el.remove(), 2600);
}
const store = {
  get(k, d) { try { const v = localStorage.getItem("tcc:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("tcc:" + k, JSON.stringify(v)); } catch {} }
};

/* ------------------------------------------------------------ default config */
const DEFAULT_CONFIG = {
  priorities: [
    { id: "CRITICAL", label: "Critical", weight: 4.0, staleDays: 1 },
    { id: "HIGH",     label: "High",     weight: 2.6, staleDays: 2 },
    { id: "MEDIUM",   label: "Medium",   weight: 1.5, staleDays: 3 },
    { id: "LOW",      label: "Low",      weight: 0.8, staleDays: 5 }
  ],
  statuses: [
    { id: "NOT_STARTED",  label: "Not started",  kind: "open" },
    { id: "IN_PROGRESS",  label: "In progress",  kind: "active" },
    { id: "WAITING",      label: "Waiting",      kind: "open" },
    { id: "BLOCKED",      label: "Blocked",      kind: "blocked" },
    { id: "UNDER_REVIEW", label: "Under review", kind: "active" },
    { id: "COMPLETED",    label: "Completed",    kind: "done" },
    { id: "CANCELLED",    label: "Cancelled",    kind: "done" }
  ],
  departments: [
    { id: "mkt", name: "Marketing", teams: [{ id: "seo", name: "SEO" }, { id: "content", name: "Content" }, { id: "ads", name: "Paid Ads" }, { id: "design", name: "Design" }] },
    { id: "ops", name: "Operations", teams: [{ id: "admin", name: "Admin" }, { id: "hr", name: "HR" }, { id: "it", name: "IT" }] }
  ],
  categories: ["Audit", "Content", "Campaign", "Development", "Design", "Reporting", "Admin", "Support", "Research"],
  workload: { normal: 5, high: 11, overloaded: 18 },
  workingDays: [1, 2, 3, 4, 5],
  defaultDueDays: 7,
  progressSteps: [0, 10, 25, 50, 75, 90, 100],
  notify: { assigned: true, priority: true, dueSoon: true, overdue: true, blocked: true, comment: true, completed: false, reassigned: true }
};
const PROGRESS_STEPS = [0, 10, 25, 50, 75, 90, 100];

/* --------------------------------------------------------------------- state */
const S = {
  ready: false, connected: false, offline: false,
  employees: [], tasks: [], projects: [], updates: [], breaks: [], notifications: [], assignQueue: [],
  config: JSON.parse(JSON.stringify(DEFAULT_CONFIG)),
  me: null,
  view: store.get("view", "cc"),
  q: "",
  filters: { assignee: "", dept: "", team: "", project: "", priority: "", status: "", flag: "", due: "", search: "" },
  sort: { key: "due", dir: 1 },
  selection: new Set(),
  boardFilter: { assignee: "", project: "" },
  openTask: null,
  analyticsWeek: 0,
  empDetail: null,
  projDetail: null,
  notifSeen: store.get("notifSeen", 0)
};

/* --------------------------------------------------------- config accessors */
const cfg = () => S.config;
const prio = id => cfg().priorities.find(p => p.id === id) || { id, label: id, weight: 1, staleDays: 3 };
const stat = id => cfg().statuses.find(s => s.id === id) || { id, label: id, kind: "open" };
const isDone = t => { const k = stat(t.status).kind; return k === "done"; };
const isClosed = t => stat(t.status).kind === "done";
const isActive = t => !isClosed(t);
const emp = id => S.employees.find(e => e.id === id) || null;
const proj = id => S.projects.find(p => p.id === id) || null;
const empName = id => (emp(id) || {}).name || "Unassigned";
const projName = id => (proj(id) || {}).name || "—";
const deptName = id => (cfg().departments.find(d => d.id === id) || {}).name || "—";
function teamName(deptId, teamId) {
  const d = cfg().departments.find(x => x.id === deptId);
  return ((d && d.teams || []).find(t => t.id === teamId) || {}).name || "—";
}
const allTeams = () => cfg().departments.flatMap(d => (d.teams || []).map(t => ({ ...t, deptId: d.id, deptName: d.name })));
const isManager = () => !!S.me && S.me.role === "manager";
const meId = () => S.me ? S.me.id : null;
