"use strict";
/* ==========================================================================
   VIEW · TEAM
   ========================================================================== */
const TEAM_COLS = [
  ["name", "Employee", ""], ["team", "Team", ""], ["priority", "Priority", "c"], ["status", "Status", "c"],
  ["crit", "Crit", "c"], ["high", "High", "c"], ["due", "Due today", "c"], ["overdue", "Overdue", "c"],
  ["blocked", "Blocked", "c"], ["done", "Done / wk", "c"], ["break", "Break today", "c"]
];
const TEAM_SORTERS = {
  name: ({ e }) => (e.name || "").toLowerCase(),
  team: ({ e }) => teamName(e.departmentId, e.teamId).toLowerCase(),
  priority: ({ cur }) => cur ? -prio(cur.priority).weight : Infinity,
  status: ({ cur }) => cur ? cfg().statuses.findIndex(s => s.id === cur.status) : Infinity,
  crit: ({ w }) => w.critical,
  high: ({ w }) => w.high,
  due: ({ w }) => w.dueToday,
  overdue: ({ w }) => w.overdue,
  blocked: ({ w }) => w.blocked,
  done: ({ w }) => w.completedWeek,
  break: ({ brk }) => brk
};
function sortTeamRows(list) {
  const f = TEAM_SORTERS[S.teamSort.key] || TEAM_SORTERS.name;
  return list.slice().sort(by(f, S.teamSort.dir));
}
function viewTeam() {
  if (S.empDetail) return viewEmployee(S.empDetail);
  const people = visibleEmployees().slice().sort(by(e => e.name));
  const TF = S.teamFilters;
  const loads = people.map(e => ({
    e, w: workload(e.id), cur: currentTasks(e.id, 1)[0],
    ob: openBreakFor(e.id), brk: totalBreakSeconds(e.id, todayISO()),
    brkExtra: sum(breaksToday(e.id), b => b.extraSec)
  }));
  const shown = sortTeamRows(loads.filter(({ cur }) =>
    (!TF.priority || (cur && cur.priority === TF.priority)) &&
    (!TF.status || (cur && cur.status === TF.status))));
  const byDept = {};
  shown.forEach(x => { const k = x.e.departmentId || "none"; (byDept[k] = byDept[k] || []).push(x); });
  const filtered = TF.priority || TF.status;
  return `
  <div class="ph"><div><h1>Team</h1><div class="sub">${filtered ? `${shown.length} of ${people.length} people match the filter` : `${people.length} people across ${Object.keys(byDept).length} department${Object.keys(byDept).length === 1 ? "" : "s"}`}.</div></div>
    <div class="sp"><button class="btn" data-export="team">${icon("dl")}Export</button>${isManager() ? `<button class="btn pri" data-newemp>${icon("plus")}Add person</button>` : ""}</div></div>
  ${priorityStatusFilterBar("team", TF, "clearteamfilters", `<span class="fcount">${shown.length} shown</span>`)}
  ${shown.length ? Object.entries(byDept).map(([dept, rows]) => `
    <section class="panel" style="margin-bottom:14px">
      <div class="panel-h"><h2>${esc(deptName(dept))}</h2><span class="hint">${rows.length} people</span></div>
      <div class="tw"><table class="t">
        <thead><tr>${TEAM_COLS.map(([k, l, cls]) => `<th class="${cls ? cls + " " : ""}sortable" data-teamsort="${k}">${esc(l)}${S.teamSort.key === k ? `<span class="caret"> ${S.teamSort.dir > 0 ? "▲" : "▼"}</span>` : ""}</th>`).join("")}<th></th></tr></thead>
        <tbody>${rows.map(({ e, w, cur, ob, brk, brkExtra }) => `<tr>
          <td><span class="cellname">${av(e, "sm")}<span class="tx"><button class="linkish" data-emp="${esc(e.id)}">${esc(e.name)}</button><div style="font-size:10.5px;color:var(--ink-4)">${esc(e.title || "")}</div></span></span></td>
          <td style="font-size:11.5px">${esc(teamName(e.departmentId, e.teamId))}</td>
          <td class="c">${cur ? pPill(cur.priority) : "<span style='color:var(--ink-4)'>·</span>"}</td>
          <td class="c">${cur ? sChip(cur.status) : "<span style='color:var(--ink-4)'>·</span>"}</td>
          <td class="c mono" style="${w.critical ? "color:var(--crit);font-weight:600" : "color:var(--ink-4)"}">${w.critical || "·"}</td>
          <td class="c mono" style="${w.high ? "color:var(--high)" : "color:var(--ink-4)"}">${w.high || "·"}</td>
          <td class="c mono">${w.dueToday || "<span style='color:var(--ink-4)'>·</span>"}</td>
          <td class="c mono" style="${w.overdue ? "color:var(--crit);font-weight:600" : "color:var(--ink-4)"}">${w.overdue || "·"}</td>
          <td class="c mono" style="${w.blocked ? "color:var(--block);font-weight:600" : "color:var(--ink-4)"}">${w.blocked || "·"}</td>
          <td class="c mono" style="${w.completedWeek ? "color:var(--ok)" : "color:var(--ink-4)"}">${w.completedWeek || "·"}</td>
          <td class="c mono" style="${brkExtra > 0 ? "color:var(--crit);font-weight:600" : ob ? "color:var(--warn);font-weight:600" : "color:var(--ink-4)"}">${ob ? "● " : ""}${fmtDuration(brk)}${brkExtra > 0 ? ` +${fmtDuration(brkExtra)}` : ""}</td>
          <td class="r"><button class="btn sm" data-emp="${esc(e.id)}">Open</button></td>
        </tr>`).join("")}</tbody>
      </table></div>
    </section>`).join("") : emptyState("No one matches this filter", "Try a different priority or status.")}`;
}

function donutChart(b) {
  if (!b.total) return `<div style="font-size:12px;color:var(--ink-4)">No tasks assigned yet.</div>`;
  const slices = [["Pending", b.pending, "var(--ink-4)"], ["Active", b.active, "var(--accent)"],
    ["Blocked", b.blocked, "var(--block)"], ["Completed", b.completed, "var(--ok)"]].filter(([, n]) => n);
  let off = 25;
  const segs = slices.map(([, n, color]) => {
    const pct = (n / b.total) * 100, seg =
      `<circle r="15.9155" cx="21" cy="21" fill="transparent" stroke="${color}" stroke-width="6" stroke-dasharray="${pct} ${100 - pct}" stroke-dashoffset="${off}"/>`;
    off -= pct; return seg;
  }).join("");
  const legend = slices.map(([label, n, color]) => `<span style="display:flex;gap:5px;align-items:center">
    <i style="width:9px;height:9px;background:${color};border-radius:2px;display:block"></i>${esc(label)}
    <span class="mono" style="color:var(--ink-4)">${n}</span></span>`).join("");
  return `<div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap">
    <svg class="spark" viewBox="0 0 42 42" width="110" height="110" role="img"
      aria-label="Task breakdown: ${slices.map(([l, n]) => `${l} ${n}`).join(", ")} of ${b.total} total">
      ${segs}
      <text x="21" y="21" text-anchor="middle" dominant-baseline="central" font-size="8" font-weight="700" fill="var(--ink-2)" font-family="IBM Plex Mono, monospace">${b.total}</text>
    </svg>
    <div style="display:flex;flex-direction:column;gap:6px;font-size:11.5px;color:var(--ink-3)">${legend}</div>
  </div>`;
}
function viewEmployee(id) {
  const e = emp(id); if (!e) { S.empDetail = null; return viewTeam(); }
  const w = workload(id), d = delivery(id, 4), b = statusBreakdown(id);
  const mine = S.tasks.filter(t => t.assigneeId === id);
  const open = mine.filter(isActive).sort((a, b) => attnScore(b) - attnScore(a) || prio(b.priority).weight - prio(a.priority).weight);
  const done = mine.filter(t => t.status === "COMPLETED").sort(by(t => t.completedAt || "", -1)).slice(0, 12);
  const ups = myUpdates(id).slice(-7).reverse();
  const brks = recentBreaks(id, 20);
  return `
  <div class="ph">
    <div style="display:flex;gap:12px;align-items:center">${av(e, "lg")}
      <div><h1>${esc(e.name)}</h1><div class="sub">${esc(e.title || "")} · ${esc(deptName(e.departmentId))} / ${esc(teamName(e.departmentId, e.teamId))} · ${esc(e.username || "")}</div></div></div>
    <div class="sp"><button class="btn" data-emp="">← Team</button>
      <button class="btn" data-newfor="${esc(e.id)}">${icon("plus")}Assign task</button>
      ${canEditPerson(e) ? `<button class="btn" data-editemp="${esc(e.id)}">${icon("edit")}Edit</button>` : ""}</div>
  </div>
  ${kpiStrip([
    { label: "Active", value: w.active, tone: "acc" },
    { label: "Critical", value: w.critical, tone: "crit" },
    { label: "High", value: w.high, tone: "warn" },
    { label: "Due today", value: w.dueToday, tone: "med" },
    { label: "Overdue", value: w.overdue, tone: "crit" },
    { label: "Blocked", value: w.blocked, tone: "block" },
    { label: "Done this week", value: w.completedWeek, tone: "ok" },
    { label: "Workload", value: `<span style="font-size:15px">${w.band === "OVERLOADED" ? "Over" : w.band[0] + w.band.slice(1).toLowerCase()}</span>`, tone: w.band === "OVERLOADED" ? "crit" : w.band === "HIGH" ? "warn" : "ok" },
    { label: "Break time", value: fmtDuration(totalBreakSeconds(id, todayISO())), tone: "warn" }
  ])}
  <div class="cc-grid">
    <div class="stack">
      <section class="panel"><div class="panel-h"><h2>Open work</h2><span class="hint">${open.length} tasks, most urgent first</span></div>
        <div class="panel-b flush">${open.map(miniRow).join("") || emptyState("No open tasks", "")}</div></section>
      <section class="panel"><div class="panel-h"><h2>Recently completed</h2></div>
        <div class="tw"><table class="t"><thead><tr><th>Task</th><th>Priority</th><th class="c">Due</th><th class="c">Completed</th><th class="c">Est / act</th></tr></thead>
        <tbody>${done.map(t => {
          const late = dOf(t.completedAt) && dOf(t.dueDate) && startOfDay(dOf(t.completedAt)) > startOfDay(dOf(t.dueDate));
          return `<tr><td>${taskLink(t)}</td><td>${pPill(t.priority)}</td>
            <td class="c" style="font-size:11.5px">${esc(fmtDate(t.dueDate, { absolute: true }))}</td>
            <td class="c" style="font-size:11.5px;${late ? "color:var(--crit)" : "color:var(--ok)"}">${esc(fmtDate(t.completedAt, { absolute: true }))}${late ? " · late" : ""}</td>
            <td class="c mono" style="font-size:11px">${t.estimatedHours || "—"} / ${t.actualHours || "—"}</td></tr>`;
        }).join("") || `<tr><td colspan="5">${emptyState("Nothing completed yet", "")}</td></tr>`}</tbody></table></div></section>
    </div>
    <div class="stack">
      <section class="panel"><div class="panel-h"><h2>Task breakdown</h2><span class="hint">${b.total} task${b.total === 1 ? "" : "s"} total</span></div>
        <div class="panel-b">${donutChart(b)}</div></section>
      <section class="panel"><div class="panel-h"><h2>Delivery signals</h2><span class="hint">last 4 weeks</span></div>
        <div class="panel-b">${deliveryPanel(d)}</div></section>
      <section class="panel"><div class="panel-h"><h2>Break history</h2><span class="hint">most recent ${brks.length}</span></div>
        <div class="panel-b" style="display:grid;gap:7px">
          ${brks.length ? brks.map(brk => `
            <div style="display:flex;justify-content:space-between;align-items:center;font-size:12.5px">
              <span>${esc(brk.typeLabel || "Break")} · ${esc(fmtDate(brk.startedAt, { absolute: true }))} · ${esc(fmtTime(brk.startedAt))} – ${brk.endedAt ? esc(fmtTime(brk.endedAt)) : "now"}</span>
              <span class="mono" style="${brk.extraSec > 0 ? "color:var(--crit);font-weight:600" : brk.endedAt ? "color:var(--ink-3)" : "color:var(--warn);font-weight:600"}">${fmtDuration(brk.liveDurationSec)}${brk.extraSec > 0 ? ` (+${fmtDuration(brk.extraSec)} over)` : ""}</span>
            </div>`).join("") : emptyState("No breaks recorded", "Nothing logged yet.")}
        </div></section>
      <section class="panel"><div class="panel-h"><h2>Recent daily updates</h2></div>
        <div class="panel-b" style="display:grid;gap:11px">
          ${ups.length ? ups.map(u => `<div style="border-left:2px solid var(--accent-line);padding-left:9px">
            <div style="font-size:10.5px;color:var(--ink-4);text-transform:uppercase;letter-spacing:.06em">${esc(fmtDate(u.date, { absolute: true }))}</div>
            ${planItems(u).map(it => `<div style="font-size:12.5px;${it.done ? "text-decoration:line-through;color:var(--ink-4)" : ""}">${esc(it.text)}</div>`).join("")}
          </div>`).join("") : emptyState("No updates posted", "Nothing submitted through the daily update form yet.")}
        </div></section>
    </div>
  </div>`;
}

/* ==========================================================================
   VIEW · PROJECTS
   ========================================================================== */
function viewProjects() {
  if (S.projDetail) return viewProject(S.projDetail);
  const ps = S.projects.map(p => ({ p, s: projectStats(p.id) }));
  const unassigned = S.tasks.filter(t => !t.projectId).length;
  return `
  <div class="ph"><div><h1>Projects</h1><div class="sub">${ps.length} projects${unassigned ? ` · ${unassigned} tasks not attached to any project` : ""}.</div></div>
    ${canAdmin() ? `<div class="sp"><button class="btn pri" data-newproj>${icon("plus")}New project</button></div>` : ""}</div>
  <div class="cols-2">${ps.map(({ p, s }) => `
    <section class="panel">
      <div class="panel-h"><h2><button class="linkish" data-proj="${esc(p.id)}" style="font-family:var(--f-display);font-weight:600">${esc(p.name)}</button></h2>
        <span class="hint">${esc(p.code || "")}</span>
        <div class="sp">${s.overdue ? `<span class="flag od">${icon("alert")}${s.overdue} overdue</span>` : ""}${s.blocked ? `<span class="flag bl">${icon("ban")}${s.blocked}</span>` : ""}</div></div>
      <div class="panel-b" style="display:grid;gap:10px">
        <div style="display:flex;gap:9px;align-items:center">
          <span style="flex:1"><span class="pb-t" style="height:8px"><span class="pb-f ${s.progress >= 100 ? "done" : s.overdue ? "risk" : ""}" style="width:${s.progress}%"></span></span></span>
          <span class="metric-v" style="font-size:16px">${s.progress}%</span></div>
        <div class="dl" style="grid-template-columns:auto 1fr auto 1fr">
          <dt>Owner</dt><dd>${esc(empName(p.ownerId))}</dd>
          <dt>Target</dt><dd>${esc(fmtDate(p.targetDate, { absolute: true }))}</dd>
          <dt>Tasks</dt><dd class="mono">${s.total}</dd>
          <dt>People</dt><dd class="mono">${s.people.length}</dd>
          <dt>Completed</dt><dd class="mono" style="color:var(--ok)">${s.completed}</dd>
          <dt>In progress</dt><dd class="mono">${s.inProgress}</dd>
          <dt>Not started</dt><dd class="mono">${s.notStarted}</dd>
          <dt>Effort</dt><dd class="mono">${s.hoursAct}h / ${s.hoursEst}h</dd>
        </div>
      </div>
    </section>`).join("") || `<div class="panel"><div class="panel-b">${emptyState("No projects yet", "")}</div></div>`}</div>`;
}
function viewProject(pid) {
  const p = proj(pid); if (!p) { S.projDetail = null; return viewProjects(); }
  const s = projectStats(pid);
  const byPerson = s.people.map(id => ({ e: emp(id), t: s.tasks.filter(x => x.assigneeId === id) })).filter(x => x.e);
  return `
  <div class="ph"><div><h1>${esc(p.name)}</h1><div class="sub">${esc(p.description || "")} Owner ${esc(empName(p.ownerId))} · ${esc(fmtDate(p.startDate, { absolute: true }))} → ${esc(fmtDate(p.targetDate, { absolute: true }))}</div></div>
    <div class="sp"><button class="btn" data-proj="">← Projects</button><button class="btn" data-projtasks="${esc(p.id)}">See tasks</button></div></div>
  ${kpiStrip([
    { label: "Overall progress", value: s.progress + "%", tone: "acc" },
    { label: "Total tasks", value: s.total, tone: "acc" },
    { label: "Completed", value: s.completed, tone: "ok" },
    { label: "In progress", value: s.inProgress, tone: "med" },
    { label: "Not started", value: s.notStarted, tone: "acc" },
    { label: "Blocked", value: s.blocked, tone: "block" },
    { label: "Overdue", value: s.overdue, tone: "crit" },
    { label: "Effort", value: s.hoursAct + "h", tone: "acc" }
  ])}
  <div class="cols-2">
    <section class="panel"><div class="panel-h"><h2>By person</h2></div>
      <div class="tw"><table class="t"><thead><tr><th>Person</th><th class="c">Tasks</th><th class="c">Done</th><th class="c">Open</th><th class="c">Overdue</th><th>Progress</th></tr></thead>
      <tbody>${byPerson.map(({ e, t }) => {
        const done = t.filter(x => x.status === "COMPLETED").length;
        return `<tr><td>${personCell(e.id)}</td><td class="c mono">${t.length}</td><td class="c mono" style="color:var(--ok)">${done}</td>
          <td class="c mono">${t.filter(isActive).length}</td>
          <td class="c mono" style="${t.filter(x => isActive(x) && flags(x).overdue).length ? "color:var(--crit)" : "color:var(--ink-4)"}">${t.filter(x => isActive(x) && flags(x).overdue).length || "·"}</td>
          <td>${(() => { const v = pct(done, t.length); return `<span class="pb"><span class="pb-t"><span class="pb-f" style="width:${v}%"></span></span><span class="pb-n">${v}%</span></span>`; })()}</td></tr>`;
      }).join("")}</tbody></table></div></section>
    <section class="panel"><div class="panel-h"><h2>Needs attention in this project</h2></div>
      <div class="att">${s.tasks.filter(t => isActive(t) && attention(t).length).sort((a, b) => attnScore(b) - attnScore(a)).slice(0, 8).map(attnItem).join("") || emptyState("Nothing flagged", "")}</div></section>
  </div>`;
}

/* ==========================================================================
   VIEW · DAILY SUMMARY
   ========================================================================== */
function viewDaily() {
  const ts = visibleTasks(), k = teamKPIs(ts), today = todayISO();
  const d = new Date();
  const completedToday = ts.filter(t => t.status === "COMPLETED" && (t.completedAt || "").slice(0, 10) === today);
  const inprog = ts.filter(t => t.status === "IN_PROGRESS").sort((a, b) => prio(b.priority).weight - prio(a.priority).weight);
  const attn = ts.filter(t => isActive(t) && attention(t).length).sort((a, b) => attnScore(b) - attnScore(a));
  const blockers = ts.filter(t => isActive(t) && flags(t).blocked);
  const people = visibleEmployees();
  const todaysUpdates = people.map(e => ({ e, u: myUpdates(e.id).find(x => x.date === today) })).filter(x => x.u);
  const missing = people.filter(e => e.active !== false && !myUpdates(e.id).some(x => x.date === today) && workload(e.id).active > 0);
  return `
  <div class="ph"><div><h1>Daily team summary</h1>
    <div class="sub">${DOW[d.getDay()]} ${MON[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} — generated from the task records, not typed by anyone.</div></div>
    <div class="sp"><button class="btn" data-copysummary>${icon("edit")}Copy as text</button><button class="btn" data-export="daily">${icon("dl")}Export</button></div></div>

  <div class="kpis" style="grid-template-columns:repeat(5,minmax(0,1fr))">
    ${[["Completed today", k.completedToday, "ok"], ["In progress", k.inProgress, "acc"], ["Blocked", k.blocked, "block"], ["Overdue", k.overdue, "crit"], ["Critical open", k.critical, "crit"]]
      .map(([l, v, t]) => `<div class="kpi t-${t}"><div class="k-l">${l}</div><div class="k-v">${v}</div></div>`).join("")}
  </div>

  <div class="cols-2">
    <div class="stack">
      <section class="panel"><div class="panel-h"><h2>Completed today</h2><span class="hint">${completedToday.length}</span></div>
        <div class="panel-b flush">${completedToday.map(t => `<div class="sr-item" style="border-radius:0;border-bottom:1px solid var(--line-soft)">
          ${av(emp(t.assigneeId), "sm")}<span style="flex:1"><span class="t">${esc(empName(t.assigneeId))} — ${taskLink(t)}</span>
          <span class="m">${esc(projName(t.projectId))} · ${esc(fmtH(t.actualHours))} logged</span></span>${pPill(t.priority)}</div>`).join("") || emptyState("Nothing completed yet today", "")}</div></section>

      <section class="panel"><div class="panel-h"><h2>Currently in progress</h2><span class="hint">${inprog.length}</span></div>
        <div class="panel-b flush">${inprog.slice(0, 14).map(t => `<div class="sr-item" style="border-radius:0;border-bottom:1px solid var(--line-soft)">
          ${av(emp(t.assigneeId), "sm")}<span style="flex:1"><span class="t">${esc(empName(t.assigneeId))} — ${taskLink(t)}</span>
          <span class="m">due ${esc(fmtDate(t.dueDate))} · updated ${esc(fmtAgo(t.updatedAt))}</span></span>${pBar(t)}</div>`).join("") || emptyState("Nothing in progress", "")}</div></section>

      <section class="panel"><div class="panel-h"><h2>Today's check-ins</h2><span class="hint">${todaysUpdates.length} of ${people.length}</span></div>
        <div class="panel-b" style="display:grid;gap:10px">
          ${todaysUpdates.map(({ e, u }) => `<div style="border-left:2px solid ${e.color || avColor(e.id)};padding-left:9px">
            <strong style="font-size:12.5px">${esc(e.name)}</strong>
            ${planItems(u).map(it => `<div style="font-size:12.5px;${it.done ? "text-decoration:line-through;color:var(--ink-4)" : ""}">${esc(it.text)}</div>`).join("")}
          </div>`).join("") || emptyState("No check-ins yet today", "")}
          ${missing.length ? `<div class="note-box">No update yet from ${missing.map(e => esc(e.name)).join(", ")}. Their task records are still current below — the check-in is optional colour, not the source of truth.</div>` : ""}
        </div></section>
    </div>

    <div class="stack">
      <section class="panel"><div class="panel-h"><h2>Requires attention</h2><span class="hint">${attn.length}</span></div>
        <div class="att">${attn.slice(0, 10).map(attnItem).join("") || emptyState("Nothing flagged", "")}</div></section>
      <section class="panel"><div class="panel-h"><h2>Blockers</h2><span class="hint">${blockers.length}</span></div>
        <div class="panel-b flush">${blockers.map(t => { const f = flags(t); return `<div class="sr-item" style="border-radius:0;border-bottom:1px solid var(--line-soft);align-items:flex-start">
          ${av(emp(t.assigneeId), "sm")}<span style="flex:1"><span class="t">${esc(empName(t.assigneeId))} — ${taskLink(t)}</span>
          <span class="m" style="color:var(--block)">${esc((t.blocker || {}).reason || "")} · ${f.blockedDays}d${f.needsManager ? " · needs you" : ""}</span></span></div>`; }).join("") || emptyState("Nothing blocked", "")}</div></section>
    </div>
  </div>`;
}
/** Everyone's plan for today, one card each, tiled so a manager can scan the
 *  whole company at once — unlike "Today's check-ins" above, a person with
 *  no entry yet still gets a card (so a gap in the day is visible directly,
 *  not just named in a footnote). */
function viewDayBoard() {
  const offset = Math.min(0, S.dayBoardOffset || 0);
  const isToday = offset === 0;
  const date = iso(addDays(new Date(), offset));
  const allPeople = visibleEmployees().filter(e => e.active !== false).slice().sort(by(e => e.name));

  const countFor = id => allPeople.filter(e => {
    if (!id) return true;
    if (id === "unassigned") return !e.teamId;
    const [deptId, teamId] = id.split("|");
    return e.departmentId === deptId && e.teamId === teamId;
  }).length;
  const selected = S.dayBoardTeam || "";
  const tabs = [{ id: "", label: "All" }, ...allTeams().map(t => ({ id: `${t.deptId}|${t.id}`, label: t.name }))]
    .filter(t => t.id === "" || t.id === selected || countFor(t.id) > 0);
  if (allPeople.some(e => !e.teamId)) tabs.push({ id: "unassigned", label: "Unassigned" });

  const people = allPeople.filter(e => {
    if (!selected) return true;
    if (selected === "unassigned") return !e.teamId;
    const [deptId, teamId] = selected.split("|");
    return e.departmentId === deptId && e.teamId === teamId;
  });

  const rows = people.map(e => ({ e, u: myUpdates(e.id).find(x => x.date === date) }));
  return `
  <div class="ph"><div><h1>Day plan board</h1>
    <div class="sub">What everyone ${isToday ? "'s doing today" : "posted"}, ${allPeople.length} people, one screen.</div></div>
    <div class="sp" style="align-items:center">
      <button class="btn sm" data-dayboard="-1">${icon("clock")}← Previous day</button>
      <input class="inp" type="date" id="dayboard-date" value="${date}" max="${todayISO()}" style="width:150px">
      <button class="btn sm" data-dayboard="1" ${isToday ? "disabled" : ""}>Next day →</button>
      <button class="btn sm pri" data-dayboard="0" ${isToday ? "disabled" : ""}>Today</button>
    </div></div>
  <div class="seg-tabs">
    ${tabs.map(t => `<button class="seg-tab" data-dayteam="${esc(t.id)}" aria-selected="${selected === t.id}">${esc(t.label)}<span class="n">${countFor(t.id)}</span></button>`).join("")}
  </div>
  <section class="panel"><div class="panel-h"><h2>${esc(fmtDate(date, { absolute: true }))}</h2><span class="hint">${rows.filter(r => r.u).length} of ${people.length} checked in</span></div>
    <div class="panel-b" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px">
      ${rows.map(({ e, u }) => { const items = u ? planItems(u) : []; const done = items.filter(it => it.done).length;
        return `<div style="border-left:2px solid ${e.color || avColor(e.id)};padding:2px 0 2px 9px;${u ? "" : "opacity:.6;border-left-style:dashed"}">
        <div style="display:flex;gap:7px;align-items:center">${av(e, "sm")}<strong style="font-size:12.5px">${esc(e.name)}</strong>
          ${items.length ? `<span style="margin-left:auto;font-size:11px;color:var(--ink-4)">${done}/${items.length}</span>` : ""}</div>
        ${items.length ? items.map(it => `<div style="font-size:12.5px;${it.done ? "text-decoration:line-through;color:var(--ink-4)" : ""}">${esc(it.text)}</div>`).join("")
          : `<div style="font-size:12.5px;color:var(--ink-4)">${isToday ? "No check-in yet today" : "No check-in that day"}</div>`}
      </div>`; }).join("") || emptyState("No one on this team yet", "")}
    </div></section>`;
}
function summaryText() {
  const ts = visibleTasks(), k = teamKPIs(ts), today = todayISO(), d = new Date();
  const L = [];
  L.push(`TEAM STATUS — ${MON[d.getMonth()].toUpperCase()} ${d.getDate()}, ${d.getFullYear()}`, "");
  L.push(`Completed today: ${k.completedToday}`, `In progress: ${k.inProgress}`, `Blocked: ${k.blocked}`, `Overdue: ${k.overdue}`, `Critical open: ${k.critical}`, "");
  const done = ts.filter(t => t.status === "COMPLETED" && (t.completedAt || "").slice(0, 10) === today);
  if (done.length) { L.push("COMPLETED"); done.forEach(t => L.push(`  • ${empName(t.assigneeId)} — ${t.title}`)); L.push(""); }
  const ip = ts.filter(t => t.status === "IN_PROGRESS").sort((a, b) => prio(b.priority).weight - prio(a.priority).weight).slice(0, 12);
  if (ip.length) { L.push("CURRENTLY IN PROGRESS"); ip.forEach(t => L.push(`  • ${empName(t.assigneeId)} — ${t.title} — ${t.progress || 0}%`)); L.push(""); }
  const attn = ts.filter(t => isActive(t) && attention(t).length).sort((a, b) => attnScore(b) - attnScore(a)).slice(0, 10);
  if (attn.length) { L.push("REQUIRES ATTENTION"); attn.forEach(t => L.push(`  • ${empName(t.assigneeId)} — ${t.title} — ${attention(t)[0].text}`)); L.push(""); }
  const bl = ts.filter(t => isActive(t) && flags(t).blocked);
  if (bl.length) { L.push("BLOCKERS"); bl.forEach(t => L.push(`  • ${empName(t.assigneeId)} — ${(t.blocker || {}).reason || "blocked"} (${flags(t).blockedDays}d)`)); }
  return L.join("\n");
}
