"use strict";
/* ==========================================================================
   DERIVED METRICS — every number on every screen comes from these functions,
   computed from the stored rows. Nothing is hand-entered.
   ========================================================================== */

/** Point-in-time facts about one task. */
function flags(t) {
  const today = startOfDay(new Date());
  const due = dOf(t.dueDate), exp = dOf(t.expectedCompletion);
  const closed = isClosed(t);
  const p = prio(t.priority);
  const f = {
    closed,
    overdue: false, daysOverdue: 0,
    dueToday: false, dueTomorrow: false, dueIn7: false, dueIn3: false,
    stale: false, staleHours: 0, staleThresholdDays: p.staleDays,
    blocked: t.status === "BLOCKED" || !!(t.blocker && t.blocker.reason && !t.blocker.resolvedAt),
    blockedDays: 0, needsManager: false,
    expectedPassed: false, behind: 0, overrun: 0,
    waitingDays: 0
  };
  if (due && !closed) {
    const d = daysBetween(today, due);
    if (d < 0) { f.overdue = true; f.daysOverdue = -d; }
    else if (d === 0) f.dueToday = true;
    else if (d === 1) { f.dueTomorrow = true; f.dueIn3 = true; f.dueIn7 = true; }
    else { if (d <= 3) f.dueIn3 = true; if (d <= 7) f.dueIn7 = true; }
  }
  if (exp && !closed && daysBetween(today, exp) < 0) f.expectedPassed = true;
  if (!closed) {
    f.staleHours = hoursSince(t.updatedAt || t.createdAt);
    f.stale = f.staleHours > p.staleDays * 24;
  }
  if (f.blocked && t.blocker) {
    const since = dOf(t.blocker.since);
    f.blockedDays = since ? Math.max(0, daysBetween(since, today)) : 0;
    f.needsManager = !!t.blocker.needsManager;
  }
  if (t.status === "WAITING") {
    const last = dOf(t.updatedAt); f.waitingDays = last ? Math.max(0, daysBetween(last, today)) : 0;
  }
  // schedule variance: how far elapsed vs how far done
  const st = dOf(t.startDate) || dOf(t.createdAt);
  if (st && due && !closed) {
    const span = Math.max(1, daysBetween(st, due));
    const gone = clamp(daysBetween(st, today), 0, span + 60);
    f.behind = Math.round((gone / span) * 100) - (t.progress || 0);
  }
  const est = Number(t.estimatedHours) || 0, act = Number(t.actualHours) || 0;
  if (est > 0 && act > est) f.overrun = Math.round(((act - est) / est) * 100);
  f.remainingHours = est > 0 ? Math.max(0, est * (1 - (t.progress || 0) / 100)) : (closed ? 0 : 4);
  return f;
}

/** Why a task needs the manager. Severity 3 = act now, 2 = watch, 1 = note. */
function attention(t) {
  if (isClosed(t)) return [];
  const f = flags(t), p = prio(t.priority), out = [];
  const bigPrio = t.priority === "CRITICAL" || t.priority === "HIGH";
  if (f.overdue) out.push({ sev: f.daysOverdue > 2 || bigPrio ? 3 : 2, ic: "🔴", text: `${f.daysOverdue} day${f.daysOverdue === 1 ? "" : "s"} overdue — due ${fmtDate(t.dueDate, { absolute: true })}` });
  if (f.blocked) out.push({ sev: f.needsManager ? 3 : (f.blockedDays >= 2 ? 3 : 2), ic: "⛔", text: `Blocked ${f.blockedDays === 0 ? "today" : f.blockedDays + " day" + (f.blockedDays === 1 ? "" : "s")}${f.needsManager ? " — manager intervention requested" : ""}${t.blocker && t.blocker.reason ? ": " + t.blocker.reason : ""}` });
  if (f.stale) {
    const h = Math.round(f.staleHours);
    out.push({ sev: t.priority === "CRITICAL" ? 3 : bigPrio ? 2 : 1, ic: "⚠", text: `No update in ${h < 48 ? h + " hours" : Math.round(h / 24) + " days"} (${p.label.toLowerCase()} threshold is ${p.staleDays}d)` });
  }
  if (f.expectedPassed && !f.overdue) out.push({ sev: 2, ic: "📅", text: `Expected completion ${fmtDate(t.expectedCompletion, { absolute: true })} has passed` });
  if (t.priority === "CRITICAL" && (t.progress || 0) < 25 && t.status !== "NOT_STARTED") out.push({ sev: 3, ic: "🔥", text: `Critical task sitting at ${t.progress || 0}% progress` });
  if (t.priority === "CRITICAL" && t.status === "NOT_STARTED") out.push({ sev: 3, ic: "🔥", text: "Critical task not started" });
  if (t.priority === "CRITICAL" && !t.expectedCompletion) out.push({ sev: 1, ic: "❓", text: "Critical task has no expected completion date" });
  if (f.behind >= 40 && !f.overdue) out.push({ sev: f.behind >= 60 ? 3 : 2, ic: "📉", text: `Progress ${f.behind} points behind schedule — ${t.progress || 0}% done with ~${clamp((t.progress || 0) + f.behind, 0, 100)}% of the time window used` });
  if (f.overrun >= 25) out.push({ sev: f.overrun >= 60 ? 2 : 1, ic: "⏱", text: `Effort ${f.overrun}% over estimate (${fmtH(t.actualHours)} logged vs ${fmtH(t.estimatedHours)} estimated)` });
  if ((t.reopenCount || 0) > 0) out.push({ sev: 2, ic: "↺", text: `Reopened ${t.reopenCount} time${t.reopenCount === 1 ? "" : "s"} after being marked complete` });
  if (t.status === "WAITING" && f.waitingDays >= 2) out.push({ sev: 2, ic: "⏳", text: `Waiting on someone else for ${f.waitingDays} days with no change` });
  const openDeps = (t.dependencies || []).filter(d => d.status !== "RESOLVED");
  if (openDeps.length && (f.overdue || f.dueIn3)) out.push({ sev: 2, ic: "🔗", text: `${openDeps.length} unresolved dependenc${openDeps.length === 1 ? "y" : "ies"} with the deadline ${f.overdue ? "already passed" : "within 3 days"}` });
  return out.sort((a, b) => b.sev - a.sev);
}
const attnScore = t => { const a = attention(t); return a.length ? Math.max(...a.map(x => x.sev)) * 100 + a.length : 0; };

/* ---------------------------------------------------------------- workload */
/**
 * Workload is NOT a task count. Each open task contributes
 *   priority weight  x  remaining-effort factor  x  deadline urgency
 * so one critical task due tomorrow outweighs six low-priority ones due next month.
 */
function workload(empId) {
  const mine = S.tasks.filter(t => t.assigneeId === empId);
  const open = mine.filter(isActive);
  let score = 0;
  open.forEach(t => {
    const f = flags(t), p = prio(t.priority);
    const effort = clamp(f.remainingHours / 6, 0.4, 3.2);
    const urgency = f.overdue ? 1.9 : f.dueToday ? 1.6 : f.dueIn3 ? 1.35 : f.dueIn7 ? 1.1 : 0.85;
    let c = p.weight * effort * urgency;
    if (f.blocked) c = c * 0.55 + p.weight * 0.6;   // blocked work still occupies attention
    score += c;
  });
  const w = cfg().workload;
  const band = score >= w.overloaded ? "OVERLOADED" : score >= w.high ? "HIGH" : score >= w.normal ? "NORMAL" : "LOW";
  const wkAgo = addDays(new Date(), -7);
  return {
    empId, score: Math.round(score * 10) / 10, band,
    active: open.length,
    critical: open.filter(t => t.priority === "CRITICAL").length,
    high: open.filter(t => t.priority === "HIGH").length,
    medium: open.filter(t => t.priority === "MEDIUM").length,
    low: open.filter(t => t.priority === "LOW").length,
    dueToday: open.filter(t => flags(t).dueToday).length,
    overdue: open.filter(t => flags(t).overdue).length,
    blocked: open.filter(t => flags(t).blocked).length,
    stale: open.filter(t => flags(t).stale).length,
    remainingHours: Math.round(sum(open, t => flags(t).remainingHours)),
    completedWeek: mine.filter(t => t.status === "COMPLETED" && dOf(t.completedAt) >= wkAgo).length,
    completedToday: mine.filter(t => t.status === "COMPLETED" && (t.completedAt || "").slice(0, 10) === todayISO()).length,
    attention: open.filter(t => attention(t).length).length
  };
}

/** The task a person is most plausibly working on right now. */
function currentTasks(empId, n = 3) {
  const open = S.tasks.filter(t => t.assigneeId === empId && isActive(t));
  const rank = t => {
    const f = flags(t);
    let r = 0;
    if (t.status === "IN_PROGRESS") r += 1000;
    if (t.status === "UNDER_REVIEW") r += 600;
    if (t.status === "BLOCKED") r += 500;
    if (t.status === "WAITING") r += 400;
    r += prio(t.priority).weight * 60;
    if (f.overdue) r += 220 + Math.min(f.daysOverdue, 10) * 6;
    if (f.dueToday) r += 160;
    if (f.dueIn3) r += 70;
    return r;
  };
  return open.sort((a, b) => rank(b) - rank(a)).slice(0, n);
}

/* -------------------------------------------------------------------- breaks */
const openBreakFor = empId => S.breaks.find(b => b.employeeId === empId && !b.endedAt) || null;
/** Sum of completed breaks for a person, optionally bounded to [sinceISO, untilISO).
 *  Every break row is kept forever in the database — this is just a display window,
 *  not a retention limit, so any past day/week/month can still be queried. */
function totalBreakSeconds(empId, sinceISO, untilISO) {
  return sum(S.breaks.filter(b => b.employeeId === empId && b.endedAt
               && (!sinceISO || b.startedAt >= sinceISO) && (!untilISO || b.startedAt < untilISO)),
             b => b.durationSec || 0);
}
/** Every break that started today for one person, oldest first — an open one's
 *  duration is computed live from its start time rather than stored. */
function breaksToday(empId) {
  const start = todayISO();
  return S.breaks.filter(b => b.employeeId === empId && b.startedAt.slice(0, 10) === start)
    .sort(by(b => b.startedAt))
    .map(b => ({ ...b, liveDurationSec: b.durationSec ?? Math.round((Date.now() - dOf(b.startedAt).getTime()) / 1000) }));
}
/** A person's most recent breaks (any day), newest first — for the manager's
 *  timestamped view of exactly when someone was away and for how long. */
function recentBreaks(empId, n = 20) {
  return S.breaks.filter(b => b.employeeId === empId)
    .sort(by(b => b.startedAt, -1)).slice(0, n)
    .map(b => ({ ...b, liveDurationSec: b.durationSec ?? Math.round((Date.now() - dOf(b.startedAt).getTime()) / 1000) }));
}

/* ------------------------------------------------------------- team totals */
function teamKPIs(taskSet) {
  const ts = taskSet || S.tasks;
  const open = ts.filter(isActive);
  const today = todayISO();
  const wkStart = startOfWeek(new Date());
  return {
    active: open.length,
    completedToday: ts.filter(t => t.status === "COMPLETED" && (t.completedAt || "").slice(0, 10) === today).length,
    completedWeek: ts.filter(t => t.status === "COMPLETED" && dOf(t.completedAt) >= wkStart).length,
    overdue: open.filter(t => flags(t).overdue).length,
    blocked: open.filter(t => flags(t).blocked).length,
    critical: open.filter(t => t.priority === "CRITICAL").length,
    dueToday: open.filter(t => flags(t).dueToday).length,
    dueWeek: open.filter(t => { const f = flags(t); return f.dueIn7 || f.dueToday; }).length,
    stale: open.filter(t => flags(t).stale).length,
    attention: open.filter(t => attention(t).length).length,
    inProgress: open.filter(t => t.status === "IN_PROGRESS").length,
    completionRate: pct(ts.filter(t => t.status === "COMPLETED").length, ts.filter(t => t.status !== "CANCELLED").length)
  };
}
function startOfWeek(d) { const x = startOfDay(d); const day = (x.getDay() + 6) % 7; return addDays(x, -day); }

/* --------------------------------------------------------- period analytics */
function periodStats(from, to, taskSet) {
  const ts = (taskSet || S.tasks);
  const inRange = (s) => { const d = dOf(s); return d && d >= from && d < to; };
  const created   = ts.filter(t => inRange(t.createdAt));
  const completed = ts.filter(t => t.status === "COMPLETED" && inRange(t.completedAt));
  const cancelled = ts.filter(t => t.status === "CANCELLED" && inRange(t.updatedAt));
  const openAtEnd = ts.filter(t => {
    const c = dOf(t.createdAt);
    if (!c || c >= to) return false;
    if (!isClosed(t)) return true;
    const closedAt = dOf(t.completedAt) || dOf(t.updatedAt);
    return !closedAt || closedAt >= to;   // closed after this period ended, so it was open during it
  });
  const cycle = completed.map(t => { const a = dOf(t.startDate) || dOf(t.createdAt), b = dOf(t.completedAt); return a && b ? Math.max(0, (b - a) / DAY) : null; }).filter(x => x != null);
  const delay = completed.map(t => { const d = dOf(t.dueDate), c = dOf(t.completedAt); return d && c ? (c - d) / DAY : null; }).filter(x => x != null);
  const onTime = completed.filter(t => { const d = dOf(t.dueDate), c = dOf(t.completedAt); return !d || (c && startOfDay(c) <= startOfDay(d)); }).length;
  return {
    from, to,
    created: created.length,
    completed: completed.length,
    cancelled: cancelled.length,
    carried: openAtEnd.filter(t => dOf(t.createdAt) < from).length,
    overdue: openAtEnd.filter(t => { const d = dOf(t.dueDate); return d && d < to && !isClosed(t); }).length,
    blocked: openAtEnd.filter(t => flags(t).blocked).length,
    avgCycle: cycle.length ? Math.round((sum(cycle) / cycle.length) * 10) / 10 : null,
    avgDelay: delay.length ? Math.round((sum(delay) / delay.length) * 10) / 10 : null,
    onTimeRate: completed.length ? pct(onTime, completed.length) : null,
    completionRate: (created.length + openAtEnd.length) ? pct(completed.length, completed.length + openAtEnd.length) : 0,
    completedTasks: completed, createdTasks: created
  };
}

/**
 * Delivery health — five weighted indicators, each computed from stored rows.
 * Deliberately NOT "tasks completed". Shown with its own breakdown.
 */
function delivery(empId, weeks = 4) {
  const to = addDays(startOfDay(new Date()), 1), from = addDays(to, -weeks * 7);
  const mine = S.tasks.filter(t => t.assigneeId === empId);
  const st = periodStats(from, to, mine);
  const open = mine.filter(isActive);
  const done = st.completedTasks;

  const comps = [];
  if (done.length + open.length >= 3) {
    comps.push({ key: "Throughput vs. commitments", weight: 22, value: pct(done.length, done.length + open.length),
      note: `${done.length} completed against ${open.length} still open in the last ${weeks} weeks` });
  }
  if (done.length) {
    comps.push({ key: "On-time delivery", weight: 26, value: st.onTimeRate,
      note: `${Math.round((st.onTimeRate / 100) * done.length)} of ${done.length} completed on or before the due date` });
    const weighted = sum(done, t => prio(t.priority).weight);
    const avgW = weighted / done.length;
    comps.push({ key: "Weight of work delivered", weight: 18, value: clamp(Math.round((avgW / 2.6) * 100), 0, 100),
      note: `Average priority weight ${Math.round(avgW * 100) / 100} (high = 2.6, critical = 4.0)` });
    const est = done.filter(t => Number(t.estimatedHours) > 0 && Number(t.actualHours) > 0);
    if (est.length >= 2) {
      const ratios = est.map(t => Number(t.actualHours) / Number(t.estimatedHours));
      const avg = sum(ratios) / ratios.length;
      comps.push({ key: "Estimate accuracy", weight: 14, value: clamp(Math.round(100 - Math.abs(1 - avg) * 100), 0, 100),
        note: `Logged ${Math.round(avg * 100)}% of estimated hours across ${est.length} completed tasks` });
    }
  }
  if (open.length) {
    const fresh = open.filter(t => !flags(t).stale).length;
    comps.push({ key: "Update consistency", weight: 20, value: pct(fresh, open.length),
      note: `${fresh} of ${open.length} open tasks updated inside their staleness threshold` });
    const clean = open.filter(t => !flags(t).overdue).length;
    comps.push({ key: "Deadline hygiene", weight: 18, value: pct(clean, open.length),
      note: `${open.length - clean} of ${open.length} open tasks are past their due date` });
  }
  const tw = sum(comps, c => c.weight);
  const score = tw ? Math.round(sum(comps, c => c.value * c.weight) / tw) : null;
  const reliable = done.length + open.length >= 5 && comps.length >= 3;
  return { empId, score, reliable, components: comps, window: weeks, completed: done.length, open: open.length, stats: st };
}

/* ---------------------------------------------------------- project rollups */
function projectStats(pid) {
  const ts = S.tasks.filter(t => t.projectId === pid);
  const done = ts.filter(t => t.status === "COMPLETED");
  const weightDone = sum(done, t => prio(t.priority).weight);
  const weightAll = sum(ts.filter(t => t.status !== "CANCELLED"), t => prio(t.priority).weight);
  const partial = sum(ts.filter(isActive), t => prio(t.priority).weight * ((t.progress || 0) / 100));
  return {
    total: ts.length,
    completed: done.length,
    inProgress: ts.filter(t => t.status === "IN_PROGRESS" || t.status === "UNDER_REVIEW").length,
    notStarted: ts.filter(t => t.status === "NOT_STARTED").length,
    blocked: ts.filter(t => isActive(t) && flags(t).blocked).length,
    overdue: ts.filter(t => isActive(t) && flags(t).overdue).length,
    progress: weightAll ? Math.round(((weightDone + partial) / weightAll) * 100) : 0,
    people: uniq(ts.map(t => t.assigneeId)).filter(Boolean),
    hoursEst: sum(ts, t => Number(t.estimatedHours) || 0),
    hoursAct: sum(ts, t => Number(t.actualHours) || 0),
    tasks: ts
  };
}

/* ------------------------------------------------------------ notifications */
// Table-driven so a server-emitted activity `kind` can't silently ship
// without a matching client notification (or vice versa: `dependency`
// below has no current emitter and is a documented, intentional no-op).
const NOTIF_RULES = {
  assign:     { relevant: (t, a) => a.to === meId(), text: (t, a) => `${empName(a.byId)} assigned you “${t.title}”` },
  create:     { relevant: (t, a) => t.assigneeId === meId(), text: (t, a) => `${empName(a.byId)} assigned you “${t.title}”`, remapKind: "assign" },
  reassign:   { relevant: (t, a, c) => a.to === meId() || c.mine,
                text: (t, a) => a.to === meId() ? `${empName(a.byId)} assigned you “${t.title}”` : `“${t.title}” reassigned to ${empName(t.assigneeId)}`,
                remapKind: (t, a) => a.to === meId() ? "assign" : "reassign" },
  priority:   { relevant: (t, a, c) => c.mine || t.assigneeId === meId(), text: (t, a) => `Priority on “${t.title}” changed ${a.from} → ${a.to}` },
  block:      { relevant: (t, a, c) => c.mine || t.createdById === meId(), text: (t) => `${empName(t.assigneeId)} reported a blocker on “${t.title}”` },
  comment:    { relevant: (t, a, c) => c.mine || t.assigneeId === meId(), text: (t, a) => `${empName(a.byId)} commented on “${t.title}”` },
  due:        { relevant: (t, a) => t.assigneeId === meId(), text: (t, a) => `Due date on “${t.title}” moved to ${fmtDate(a.to, { absolute: true })}` },
  complete:   { relevant: (t, a, c) => c.mine || t.createdById === meId(), text: (t, a) => `${empName(a.byId)} completed “${t.title}”` },
  attachment: { relevant: (t, a, c) => c.mine || t.assigneeId === meId() || t.createdById === meId(),
                text: (t, a) => `${empName(a.byId)} ${(a.note || "").startsWith("Removed") ? "removed a file from" : "sent a file on"} “${t.title}”` },
  dependency: { relevant: (t, a, c) => c.iNeedHelp, text: (t, a) => `${empName(a.byId)} needs your help on “${t.title}”` }
};
function notifications() {
  if (!S.me) return [];
  const out = [], mine = isManager();
  S.tasks.forEach(t => {
    const iNeedHelp = (t.dependencies || []).some(d => d.ownerId === meId() && d.status !== "RESOLVED");
    const relevant = mine || t.assigneeId === meId() || t.createdById === meId() || iNeedHelp;
    if (!relevant) return;
    const f = flags(t);
    const ctx = { mine, iNeedHelp };
    (t.activity || []).slice(-8).forEach(a => {
      if (a.byId === meId()) return;
      const ts = dOf(a.at); if (!ts || Date.now() - ts.getTime() > 7 * DAY) return;
      const rule = NOTIF_RULES[a.kind];
      if (!rule || !rule.relevant(t, a, ctx)) return;
      const kind = typeof rule.remapKind === "function" ? rule.remapKind(t, a) : (rule.remapKind || a.kind);
      out.push({ at: a.at, text: rule.text(t, a, ctx), taskId: t.id, kind, sev: kind === "block" ? 3 : kind === "dependency" ? 2 : 1 });
    });
    if (isActive(t) && (mine ? f.overdue && (t.priority === "CRITICAL" || t.priority === "HIGH") : f.overdue)) {
      out.push({ at: t.dueDate + "T09:00:00.000Z", text: `“${t.title}” is ${f.daysOverdue}d overdue`, taskId: t.id, kind: "overdue", sev: 3 });
    }
    if (isActive(t) && f.dueTomorrow && (t.assigneeId === meId())) {
      out.push({ at: nowISO(), text: `“${t.title}” is due tomorrow`, taskId: t.id, kind: "due", sev: 2 });
    }
  });
  const PREF = { assign: "assigned", priority: "priority", block: "blocked", comment: "comment",
                 reassign: "reassigned", due: "dueSoon", overdue: "overdue", complete: "completed", dependency: "dependency", attachment: "attachment" };
  const prefs = cfg().notify || {};
  const seen = new Set();
  return out.filter(n => {
    const pk = PREF[n.kind];
    if (pk && prefs[pk] === false) return false;
    const k = n.kind + n.taskId + n.text;
    if (seen.has(k)) return false; seen.add(k); return true;
  }).sort(by(n => n.at, -1)).slice(0, 40);
}
