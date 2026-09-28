"use strict";
/* ==========================================================================
   SHARED UI PIECES
   ========================================================================== */
const pPill = p => `<span class="pill p-${esc(p)}">${esc(prio(p).label)}</span>`;
const sChip = s => `<span class="st st-${esc(s)}">${esc(stat(s).label)}</span>`;
function priorityOptions(selected) {
  return cfg().priorities.map(p => `<option value="${esc(p.id)}" ${selected === p.id ? "selected" : ""}>${esc(p.label)}</option>`).join("");
}
function statusOptions(selected, list) {
  return (list || cfg().statuses).map(s => `<option value="${esc(s.id)}" ${selected === s.id ? "selected" : ""}>${esc(s.label)}</option>`).join("");
}
function priorityStatusFilterBar(prefix, state, clearAttr, note) {
  return `<section class="panel" style="margin-bottom:12px"><div class="fbar">
    <label class="lbl">Filter</label>
    <select id="f-${prefix}-priority"><option value="">Any priority</option>${priorityOptions(state.priority)}</select>
    <select id="f-${prefix}-status"><option value="">Any status</option>${statusOptions(state.status)}</select>
    <button class="btn sm" data-${clearAttr}>Clear</button>
    ${note || ""}
  </div></section>`;
}
function pBar(t) {
  const f = flags(t), v = t.progress || 0;
  const cls = t.status === "COMPLETED" ? "done" : f.overdue ? "late" : f.behind >= 30 ? "risk" : "";
  return `<span class="pb"><span class="pb-t"><span class="pb-f ${cls}" style="width:${v}%"></span></span><span class="pb-n">${v}%</span></span>`;
}
function flagChips(t) {
  const f = flags(t), out = [];
  if (f.overdue) out.push(`<span class="flag od">${icon("alert")}${f.daysOverdue}d overdue</span>`);
  else if (f.dueToday) out.push(`<span class="flag st">${icon("clock")}due today</span>`);
  if (f.blocked) out.push(`<span class="flag bl">${icon("ban")}blocked${f.needsManager ? " · needs you" : ""}</span>`);
  if (f.stale) out.push(`<span class="flag st">${icon("clock")}no update ${f.staleHours < 48 ? Math.round(f.staleHours) + "h" : Math.round(f.staleHours / 24) + "d"}</span>`);
  return out.join(" ");
}
function wlBadge(w) {
  return `<span class="wl w-${w.band}" title="Workload score ${w.score} — priority × remaining effort × deadline urgency">
    <span class="wl-b"><i></i><i></i><i></i><i></i></span><span class="wl-t">${w.band === "OVERLOADED" ? "Over" : w.band.toLowerCase()}</span></span>`;
}
function kpiStrip(items) {
  return `<div class="kpis">` + items.map(k => `
    <button class="kpi t-${k.tone || "acc"}" data-kpi="${esc(k.filter || "")}" title="${esc(k.title || "Open filtered task list")}">
      <div class="k-l">${esc(k.label)}</div>
      <div class="k-v">${k.value}</div>
    </button>`).join("") + `</div>`;
}
function emptyState(title, msg) { return `<div class="empty"><strong>${esc(title)}</strong>${esc(msg || "")}</div>`; }

function taskLink(t) {
  return `<button class="linkish" data-open="${esc(t.id)}">${esc(t.title)}</button>`;
}
function personCell(id, clickable) {
  const e = emp(id);
  const name = esc(e ? e.name : "Unassigned");
  return `<span class="cellname">${av(e, "sm")}<span class="tx">${clickable && e ? `<button class="linkish" data-emp="${esc(e.id)}">${name}</button>` : name}</span></span>`;
}

/* ---------------------------------------------------------------- filtering */
function visibleTasks() {
  // Employees see their own work plus anything they created; a team lead
  // sees every team they manage; managers see all.
  if (!S.me) return [];
  if (isManager()) return S.tasks;
  if (isTeamLead() && hasCapability("tasks")) return S.tasks.filter(inManagedScope);
  return S.tasks.filter(t => t.assigneeId === meId() || t.createdById === meId());
}
function applyFilters(list, F) {
  F = F || S.filters;
  const today = todayISO();
  return list.filter(t => {
    if (F.assignee && t.assigneeId !== F.assignee) return false;
    if (F.dept && t.departmentId !== F.dept) return false;
    if (F.team && t.teamId !== F.team) return false;
    if (F.project && t.projectId !== F.project) return false;
    if (F.priority && t.priority !== F.priority) return false;
    if (F.status && t.status !== F.status) return false;
    if (F.category && t.category !== F.category) return false;
    const f = flags(t);
    switch (F.flag) {
      case "overdue":   if (!f.overdue) return false; break;
      case "blocked":   if (!f.blocked) return false; break;
      case "stale":     if (!f.stale) return false; break;
      case "critical":  if (t.priority !== "CRITICAL" || isClosed(t)) return false; break;
      case "attention": if (!attention(t).length) return false; break;
      case "active":    if (!isActive(t)) return false; break;
      case "unassigned":if (t.assigneeId) return false; break;
      case "manager":   if (!(f.blocked && f.needsManager)) return false; break;
    }
    switch (F.due) {
      case "today":    if (!f.dueToday) return false; break;
      case "tomorrow": if (!f.dueTomorrow) return false; break;
      case "week":     if (!(f.dueToday || f.dueIn7)) return false; break;
      case "month":    { const d = dOf(t.dueDate); if (!d || isClosed(t) || daysBetween(new Date(), d) > 30 || daysBetween(new Date(), d) < 0) return false; break; }
      case "overdue":  if (!f.overdue) return false; break;
      case "none":     if (t.dueDate) return false; break;
    }
    switch (F.completed) {
      case "today": if (!(t.status === "COMPLETED" && (t.completedAt || "").slice(0, 10) === today)) return false; break;
      case "week":  if (!(t.status === "COMPLETED" && dOf(t.completedAt) >= startOfWeek(new Date()))) return false; break;
      case "month": if (!(t.status === "COMPLETED" && dOf(t.completedAt) >= addDays(new Date(), -30))) return false; break;
    }
    if (F.minProgress != null && F.minProgress !== "" && (t.progress || 0) < +F.minProgress) return false;
    if (F.maxProgress != null && F.maxProgress !== "" && (t.progress || 0) > +F.maxProgress) return false;
    if (F.search) {
      const q = F.search.toLowerCase();
      const hay = [t.id, t.title, t.description, empName(t.assigneeId), projName(t.projectId), t.category, (t.tags || []).join(" "), t.blocker && t.blocker.reason].join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}
const SORTERS = {
  id: t => t.id, title: t => (t.title || "").toLowerCase(),
  assignee: t => empName(t.assigneeId).toLowerCase(), project: t => projName(t.projectId).toLowerCase(),
  priority: t => -prio(t.priority).weight, status: t => cfg().statuses.findIndex(s => s.id === t.status),
  progress: t => t.progress || 0, created: t => t.createdAt || "",
  due: t => t.dueDate || "9999-12-31", expected: t => t.expectedCompletion || "9999-12-31",
  updated: t => t.updatedAt || "", est: t => Number(t.estimatedHours) || 0, act: t => Number(t.actualHours) || 0,
  attention: t => -attnScore(t)
};
function sortTasks(list) {
  const f = SORTERS[S.sort.key] || SORTERS.due;
  return list.slice().sort(by(f, S.sort.dir));
}

/* ==========================================================================
   NAVIGATION
   ========================================================================== */
// A view with a `cap` set is additionally gated, for a team lead only, on
// hasCapability(cap) — a manager (and an employee, on the views they share)
// is unaffected; see paint()'s redirect logic and paintNav()'s filter below.
const VIEWS = {
  cc:        { label: "Overview",       icon: "grid",     roles: ["manager"] },
  myday:     { label: "My Day",         icon: "sunrise",  roles: ["manager", "employee", "teamlead"] },
  working:   { label: "Currently on",   icon: "users",    roles: ["manager", "teamlead"], cap: "working" },
  attention: { label: "Requires attention", icon: "alert", roles: ["manager"] },
  managerboard: { label: "Managers Board", icon: "board", roles: ["manager"] },
  board:     { label: "Board",          icon: "board",    roles: ["manager", "employee", "teamlead"] },
  tasks:     { label: "All tasks",      icon: "list",     roles: ["manager", "employee", "teamlead"] },
  team:      { label: "Team",           icon: "users",    roles: ["manager", "teamlead"], cap: "team" },
  blockers:  { label: "Blockers",       icon: "ban",      roles: ["manager", "teamlead"], cap: "blockers" },
  projects:  { label: "Projects",       icon: "folder",   roles: ["manager", "employee", "teamlead"] },
  daily:     { label: "Daily summary",  icon: "inbox",    roles: ["manager", "teamlead"], cap: "daily" },
  dayboard:  { label: "Day plan board", icon: "board",    roles: ["manager", "teamlead"], cap: "dayboard" },
  update:    { label: "Daily update",   icon: "edit",     roles: ["manager", "employee", "teamlead"] },
  analytics: { label: "Analytics",      icon: "chart",    roles: ["manager"] },
  website:   { label: "Website Updates", icon: "globe",   roles: ["manager"] },
  goodvibes: { label: "Good Vibes Wall", icon: "heart",   roles: ["manager", "employee", "teamlead"] },
  complaints:{ label: "Complaint Wall",  icon: "flag",    roles: ["manager", "employee", "teamlead"] },
  settings:  { label: "Settings",       icon: "cog",      roles: ["manager"] }
};
/** View ids a manager can switch off entirely from Settings > "Features"
 *  (cfg().featureFlags) — distinct from HIDEABLE_NAV/hiddenNav below, which
 *  only ever covers manager-only views hidden from the manager's own
 *  sidebar. These are shared with employees/team leads, so turning one off
 *  blocks it for every role, everywhere, not just the nav button. */
const VIEW_FEATURE = { goodvibes: "goodVibes", complaints: "complaints", website: "website" };
const featureEnabled = key => (cfg().featureFlags || {})[key] !== false;
/** True if this view is open to the current role — role membership first,
 *  then (team leads only) the specific capability grant, then whether its
 *  feature switch (if it has one) is on. */
const viewAllowed = v => {
  const def = VIEWS[v];
  if (!def) return false;
  const role = S.me ? S.me.role : "employee";
  if (!def.roles.includes(role)) return false;
  if (def.cap && role === "teamlead" && !hasCapability(def.cap)) return false;
  if (VIEW_FEATURE[v] && !featureEnabled(VIEW_FEATURE[v])) return false;
  return true;
};
const NAV_GROUPS = [
  { h: "Overview", items: ["cc", "myday", "working", "attention"] },
  { h: "Manager",  items: ["managerboard"] },
  { h: "Work",     items: ["board", "tasks", "blockers", "projects"] },
  { h: "Reporting",items: ["daily", "dayboard", "update", "analytics", "website"] },
  { h: "Culture",  items: ["goodvibes", "complaints"] },
  { h: "Admin",    items: ["team", "settings"] }
];
/** Manager-only nav items a manager may hide for everyone from Settings
 *  (public/app/views-report.js "Manager nav visibility"). Anything shared
 *  with employees is never offered here, and anything with its own
 *  Settings > "Features" switch (VIEW_FEATURE) is excluded too — one
 *  on/off control per view, not two. */
const HIDEABLE_NAV = Object.keys(VIEWS).filter(k => VIEWS[k].roles.length === 1 && VIEWS[k].roles[0] === "manager" && !VIEW_FEATURE[k]);
/** Overview is the fallback landing page itself (hiding it must never create
 *  a bounce loop) and Settings must always stay reachable so a manager can
 *  undo a hide — for these two, the toggle only removes the sidebar button.
 *  Every other hideable item disappears everywhere: its own nav button, any
 *  "See all"/"Detail" link elsewhere that points at it, and direct navigation
 *  bounces away instead of rendering it. */
const NAV_HIDE_SOFT = new Set(["cc", "settings"]);
const isNavHidden = v => (cfg().hiddenNav || []).includes(v) && !NAV_HIDE_SOFT.has(v);
/** Manager-created extra boards (Settings "Manager boards") — same content
 *  as Managers Board, just their own name and nav entry. `id` doubles as the
 *  S.view value; go(board.id) works for free via the generic data-view handler. */
const extraBoard = id => (cfg().boards || []).find(b => b.id === id);
function paintNav() {
  const role = S.me ? S.me.role : "employee";
  const k = S.me ? teamKPIs(visibleTasks()) : null;
  const counts = { attention: k ? k.attention : 0, blockers: k ? k.blocked : 0, tasks: k ? k.active : 0 };
  const hidden = new Set(cfg().hiddenNav || []);
  const boards = role === "manager" ? (cfg().boards || []) : [];
  $("#nav").innerHTML = NAV_GROUPS.map(g => {
    const items = g.items.filter(v => viewAllowed(v) && !hidden.has(v));
    const extra = g.h === "Manager" ? boards : [];
    if (!items.length && !extra.length) return "";
    const boardBtns = extra.map(b => `<button class="nav-i" data-view="${esc(b.id)}" ${S.view === b.id ? 'aria-current="page"' : ""}>${icon("board")}<span>${esc(b.name)}</span></button>`).join("");
    return `<div class="nav-h">${esc(g.h)}</div>` + items.map(v => {
      const c = counts[v];
      return `<button class="nav-i" data-view="${v}" ${S.view === v ? 'aria-current="page"' : ""}>
        ${icon(VIEWS[v].icon)}<span>${esc(VIEWS[v].label)}</span>
        ${c ? `<span class="cnt ${v === "attention" || v === "blockers" ? "hot" : ""}">${c}</span>` : ""}
      </button>`;
    }).join("") + boardBtns;
  }).join("");
}
function paintWho() {
  const e = S.me;
  $("#whoAv").outerHTML = e
    ? `<span class="av lg" id="whoAv" style="background:${e.color || avColor(e.id)}">${esc(e.initials || initials(e.name))}</span>`
    : `<span class="av lg" id="whoAv" style="background:var(--ink-4)">?</span>`;
  $("#whoName").textContent = e ? e.name : "Choose profile";
  $("#whoRole").textContent = e ? (e.role === "manager" ? "Manager · full access" : e.title || "Employee") : "not signed in";
}

/* ==========================================================================
   PAINT
   ========================================================================== */
function paint() {
  const d = new Date();
  $("#tbDate").textContent = `${DOW[d.getDay()]} ${MON[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  paintWho(); paintNav();
  // Persisted feed rows track their own read_at; the synthetic overdue/due-
  // tomorrow reminders (no server-side row) fall back to the old single
  // "seen" timestamp, same as before this feed existed.
  const n = notifications().filter(x => x.id ? !x.readAt : (dOf(x.at) && dOf(x.at).getTime() > (S.notifSeen || 0)));
  const notifCount = $("#notifCount");
  notifCount.hidden = n.length === 0;
  notifCount.textContent = n.length > 9 ? "9+" : String(n.length);
  $("#notifBtn").setAttribute("aria-label", n.length ? `Notifications, ${n.length} unread` : "Notifications");
  $("#notifAria").textContent = n.length ? `${n.length} unread notification${n.length === 1 ? "" : "s"}` : "";
  $("#newTaskBtn").hidden = !S.me;
  const onBreak = S.me && openBreakFor(meId());
  const onBreakX = onBreak && withBreakExtra(onBreak);
  $("#breakBtn").hidden = !S.me;
  $("#breakBtn").classList.toggle("on", !!onBreak);
  $("#breakBtn").classList.toggle("over", !!(onBreakX && onBreakX.extraSec > 0));
  $("#breakBtnLabel").textContent = onBreakX
    ? `End ${onBreakX.typeLabel || "break"} · ${fmtDuration(onBreakX.liveDurationSec)}` +
      (onBreakX.extraSec > 0 ? ` (+${fmtDuration(onBreakX.extraSec)} over)` : "")
    : "Start break";

  const v = $("#view");
  document.body.classList.toggle("signed-out", !S.me);
  if (!S.ready) { v.innerHTML = `<div class="empty" style="padding:80px 16px"><strong>Loading…</strong>One moment.</div>`; return; }
  if (!S.me) { v.innerHTML = loginScreen(); return; }
  const role = S.me.role;
  const onExtraBoard = role === "manager" && extraBoard(S.view);
  const blocked = role === "manager" && isNavHidden(S.view);
  if (!onExtraBoard && (blocked || !viewAllowed(S.view))) S.view = (role === "manager" && !isNavHidden("cc")) ? "cc" : "myday";

  const banner = S.offline
    ? `<div class="banner">${icon("alert")}<span><strong>Not connected.</strong> Changes you make now won’t be saved until the connection comes back.</span></div>`
    : S.me.mustChangePassword
    ? `<div class="banner">${icon("alert")}<span>You’re still on the temporary password you were given.</span><button class="btn sm" data-account style="margin-left:auto">Change it now</button></div>`
    : "";
  const body = (onExtraBoard ? () => viewTaskBoard(onExtraBoard.name) : ({
    cc: viewControlCenter, myday: viewMyDay, working: viewWorking, attention: viewAttention,
    board: viewBoard, managerboard: () => viewTaskBoard("Managers Board"),
    tasks: viewTasks, team: viewTeam, blockers: viewBlockers,
    projects: viewProjects, daily: viewDaily, dayboard: viewDayBoard, update: viewUpdate, analytics: viewAnalytics,
    website: viewWebsiteUpdates,
    goodvibes: viewGoodVibes, complaints: viewComplaints, settings: viewSettings
  }[S.view] || viewControlCenter))();
  v.innerHTML = banner + body;
}

function loginScreen() {
  return `<form class="login" id="loginForm" autocomplete="on">
    <div class="login-mark">${icon("grid")}</div>
    <h1>Marketing Team</h1>
    <p class="login-sub">Sign in with your User ID. If you don’t have a password yet, ask your manager to add you.</p>
    <div class="field"><label for="li-username">User ID</label>
      <input class="inp" id="li-username" name="username" type="text" autocomplete="username" required autofocus></div>
    <div class="field"><label for="li-pw">Password</label>
      <input class="inp" id="li-pw" name="password" type="password" autocomplete="current-password" required></div>
    <div id="li-err"></div>
    <button class="btn pri" type="submit" id="li-go" style="justify-content:center;padding:9px">Sign in</button>
  </form>`;
}
