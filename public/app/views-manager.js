"use strict";
/* ==========================================================================
   VIEW · TEAM CONTROL CENTER  (the morning screen)
   ========================================================================== */
function viewControlCenter() {
  const ts = visibleTasks(), k = teamKPIs(ts);
  const people = S.employees.filter(e => e.active !== false);
  const loads = people.map(e => ({ e, w: workload(e.id) })).sort((a, b) => b.w.score - a.w.score);
  const loadGroups = (() => {
    const teams = allTeams();
    const groups = teams.map(t => ({ label: t.name, rows: loads.filter(({ e }) => e.teamId === t.id && e.departmentId === t.deptId) }))
                         .filter(g => g.rows.length);
    const grouped = new Set(groups.flatMap(g => g.rows.map(({ e }) => e.id)));
    const rest = loads.filter(({ e }) => !grouped.has(e.id));
    if (rest.length) groups.push({ label: "Unassigned", rows: rest });
    return groups;
  })();

  const attnTasks = ts.filter(t => isActive(t) && attention(t).length).sort((a, b) => attnScore(b) - attnScore(a));
  const recent = ts.filter(t => t.status === "COMPLETED").sort(by(t => t.completedAt || "", -1)).slice(0, 8);
  const upcoming = ts.filter(isActive).filter(t => { const f = flags(t); return f.dueToday || f.dueIn7 || f.overdue; }).sort(by(t => t.dueDate || "9999"));

  return `
  <div class="ph">
    <div><h1>Marketing Team</h1>
      <div class="sub">${greeting()} — ${k.active} active tasks across ${people.length} people. ${k.attention ? `<strong style="color:var(--crit)">${k.attention} need your attention.</strong>` : "Nothing is flagged right now."}</div>
    </div>
    <div class="sp">
      <button class="btn" data-go="daily">${icon("inbox")}Daily summary</button>
      <button class="btn" data-export="workload">${icon("dl")}Export workload</button>
    </div>
  </div>

  ${kpiStrip([
    { label: "Active tasks",   value: k.active,         tone: "acc",   filter: "flag:active",       detail: `${k.inProgress} in progress` },
    { label: "Due today",      value: k.dueToday,       tone: k.dueToday ? "med" : "acc", filter: "due:today", detail: "across the team" },
    { label: "Overdue",        value: k.overdue,        tone: "crit",  filter: "flag:overdue",      detail: k.overdue ? "past due date" : "all clear" },
    { label: "Blocked",        value: k.blocked,        tone: "block", filter: "flag:blocked",      detail: `${ts.filter(t => isActive(t) && flags(t).needsManager).length} need you` },
    { label: "Critical",       value: k.critical,       tone: "crit",  filter: "flag:critical",     detail: "open critical work" },
    { label: "Needs an update", value: k.stale,          tone: "warn",  filter: "flag:stale",        detail: "past staleness threshold" },
    { label: "Completed today", value: k.completedToday, tone: "ok",   filter: "completed:today",   detail: `${k.completedWeek} this week` },
    { label: "Due this week",  value: k.dueWeek,        tone: "med",   filter: "due:week",          detail: "next 7 days" }
  ])}

  <div class="cc-grid">
    <div class="stack">
      <section class="panel">
        <div class="panel-h">
          <h2>Team workload</h2>
          <span class="hint">weighted by priority, remaining effort and deadline — not task count</span>
          <div class="sp"><button class="btn sm" data-go="team">Detail</button></div>
        </div>
        <div class="tw"><table class="t">
          <thead><tr>
            <th>Employee</th><th class="c">Active</th><th class="c">Crit</th><th class="c">High</th>
            <th class="c">Due today</th><th class="c">Overdue</th><th class="c">Blocked</th>
            <th class="c">Done / wk</th><th style="width:1%">Workload</th>
          </tr></thead>
          <tbody>${loadGroups.map(g => `
            <tr class="grp-row"><td colspan="9">${esc(g.label)} <span class="mono" style="font-weight:400;color:var(--ink-4)">${g.rows.length}</span></td></tr>
            ${g.rows.map(({ e, w }) => `
            <tr>
              <td><span class="cellname">${av(e, "sm")}<span class="tx"><button class="linkish" data-emp="${esc(e.id)}">${esc(e.name)}</button></span></span></td>
              <td class="c mono">${w.active}</td>
              <td class="c mono" style="${w.critical ? "color:var(--crit);font-weight:600" : "color:var(--ink-4)"}">${w.critical || "·"}</td>
              <td class="c mono" style="${w.high ? "color:var(--high)" : "color:var(--ink-4)"}">${w.high || "·"}</td>
              <td class="c mono">${w.dueToday || "<span style='color:var(--ink-4)'>·</span>"}</td>
              <td class="c mono" style="${w.overdue ? "color:var(--crit);font-weight:600" : "color:var(--ink-4)"}">${w.overdue || "·"}</td>
              <td class="c mono" style="${w.blocked ? "color:var(--block);font-weight:600" : "color:var(--ink-4)"}">${w.blocked || "·"}</td>
              <td class="c mono" style="${w.completedWeek ? "color:var(--ok)" : "color:var(--ink-4)"}">${w.completedWeek || "·"}</td>
              <td style="white-space:nowrap">${wlBadge(w)} <span class="mono" style="font-size:10px;color:var(--ink-4)" title="${w.remainingHours}h of estimated effort remaining">${w.score}</span></td>
            </tr>`).join("")}`).join("") || `<tr><td colspan="9">${emptyState("No people yet", "Add team members in Settings.")}</td></tr>`}
          </tbody>
        </table></div>
        <div class="panel-b" style="border-top:1px solid var(--line-soft)">
          <details class="calc"><summary>How workload is calculated</summary>
            <div class="note-box">Each open task contributes <span class="mono">priority weight × remaining-effort factor × deadline urgency</span>, summed per person.
              <ul>
                <li>Priority weight — critical 4.0, high 2.6, medium 1.5, low 0.8</li>
                <li>Remaining effort — estimated hours × (100 − progress), scaled 0.4–3.2</li>
                <li>Deadline urgency — overdue ×1.9, due today ×1.6, ≤3 days ×1.35, ≤7 days ×1.1, later ×0.85</li>
                <li>Blocked tasks count at roughly half capacity plus a fixed attention cost — they occupy a person without consuming their hours</li>
              </ul>
              Bands: <strong>Low</strong> under ${cfg().workload.normal} · <strong>Normal</strong> ${cfg().workload.normal}–${cfg().workload.high} · <strong>High</strong> ${cfg().workload.high}–${cfg().workload.overloaded} · <strong>Overloaded</strong> above ${cfg().workload.overloaded}. Thresholds are editable in Settings.
            </div>
          </details>
        </div>
      </section>

      <section class="panel">
        <div class="panel-h"><h2>Currently working on</h2><span class="hint">top-priority open task per person</span>
          <div class="sp"><button class="btn sm" data-go="working">See all</button></div></div>
        <div class="panel-b"><div class="cwo">${people.slice(0, 6).map(e => workCard(e, 1)).join("")}</div></div>
      </section>
    </div>

    <div class="stack">
      <section class="panel">
        <div class="panel-h"><h2>Requires attention</h2>
          <span class="hint">${attnTasks.length} item${attnTasks.length === 1 ? "" : "s"}</span>
          <div class="sp"><button class="btn sm" data-go="attention">All</button></div></div>
        <div class="att">${attnTasks.slice(0, 7).map(attnItem).join("") || emptyState("Nothing flagged", "No overdue, blocked, stale or off-track work right now.")}</div>
      </section>

      <section class="panel">
        <div class="panel-h"><h2>Upcoming deadlines</h2><span class="hint">next 7 days</span></div>
        <div class="panel-b flush">${deadlineGroups(upcoming)}</div>
      </section>

      <section class="panel">
        <div class="panel-h"><h2>Recently completed</h2></div>
        <div class="tw"><table class="t"><tbody>
          ${recent.map(t => `<tr>
            <td style="width:22px">${av(emp(t.assigneeId), "sm")}</td>
            <td>${taskLink(t)}<div style="font-size:10.5px;color:var(--ink-4)">${esc(empName(t.assigneeId))} · ${esc(projName(t.projectId))}</div></td>
            <td class="r" style="white-space:nowrap"><span class="tag">${esc(fmtDate(t.completedAt))}</span></td>
          </tr>`).join("") || `<tr><td>${emptyState("Nothing completed yet", "")}</td></tr>`}
        </tbody></table></div>
      </section>
    </div>
  </div>`;
}

function greeting() {
  const h = new Date().getHours();
  const n = S.me ? S.me.name.split(" ")[0] : "";
  return (h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening") + (n ? ", " + n : "");
}

function workCard(e, n) {
  const cur = currentTasks(e.id, 3);
  const w = workload(e.id);
  const upd = latestUpdate(e.id);
  const ob = openBreakFor(e.id);
  const breakBadge = ob ? `<span class="flag st">${icon("clock")}On break · ${fmtDuration(Math.round((Date.now() - dOf(ob.startedAt).getTime()) / 1000))}</span>` : "";
  if (!cur.length) {
    return `<article class="wcard idle">
      <div class="wc-h">${av(e)}<div><div class="nm">${esc(e.name)}</div><div class="ro">${esc(e.title || "")}</div></div>${breakBadge ? `<span style="margin-left:auto">${breakBadge}</span>` : ""}</div>
      <div class="wc-b"><div style="font-size:12px;color:var(--ink-4)">No open tasks. ${w.completedWeek ? w.completedWeek + " completed this week." : "Capacity available."}</div>
      <button class="btn sm" data-newfor="${esc(e.id)}">${icon("plus")}Assign work</button></div>
    </article>`;
  }
  const t = cur[0], f = flags(t);
  const next = nextAction(t);
  return `<article class="wcard">
    <div class="wc-h">${av(e)}<div style="min-width:0"><div class="nm">${esc(e.name)}</div><div class="ro">${esc(e.title || "")}</div></div>
      <span style="margin-left:auto;display:flex;gap:6px;align-items:center">${breakBadge}${wlBadge(w)}</span></div>
    <div class="wc-b">
      <div style="font-size:11.5px;color:var(--ink-4);margin-bottom:4px">${w.active} task${w.active === 1 ? "" : "s"} open${w.dueToday ? ` · ${w.dueToday} due today` : ""}</div>
      <div class="tt">${taskLink(t)}</div>
      <dl class="kv">
        <dt>Priority</dt><dd>${pPill(t.priority)}</dd>
        <dt>Status</dt><dd>${sChip(t.status)}</dd>
        <dt>Progress</dt><dd>${pBar(t)}</dd>
        <dt>Due</dt><dd class="${f.overdue ? "" : ""}" style="${f.overdue ? "color:var(--crit);font-weight:600" : ""}">${esc(fmtDate(t.dueDate))}${f.overdue ? ` · ${f.daysOverdue}d late` : ""}</dd>
        <dt>Expected</dt><dd>${esc(fmtDate(t.expectedCompletion))}</dd>
        <dt>Last update</dt><dd style="${f.stale ? "color:var(--warn);font-weight:600" : ""}">${esc(fmtAgo(t.updatedAt))}</dd>
        <dt>Blocker</dt><dd>${f.blocked && t.blocker ? `<span style="color:var(--block)">${esc(t.blocker.reason)}</span>` : "None"}</dd>
        <dt>Next action</dt><dd>${esc(next)}</dd>
      </dl>
      ${cur.length > 1 ? `<div class="more">Also open: ${cur.slice(1).map(x => `${pPill(x.priority)} ${esc(x.title)}`).join(" · ")}</div>` : ""}
      ${(() => { if (!upd || upd.date !== todayISO()) return ""; const items = planItems(upd); const open = items.find(it => !it.done);
        return items.length ? `<div class="more">Said today: “${esc((open || items[items.length - 1]).text)}”${open ? "" : " (all done)"}</div>` : ""; })()}
    </div>
  </article>`;
}
function nextAction(t) {
  if (t.blocker && t.blocker.reason && !t.blocker.resolvedAt) return "Unblock: " + t.blocker.reason.slice(0, 60);
  const openDep = (t.dependencies || []).find(d => d.status !== "RESOLVED");
  if (openDep) return "Waiting on " + (openDep.description || empName(openDep.ownerId));
  if (t.status === "UNDER_REVIEW") return "Awaiting review sign-off";
  if (t.status === "NOT_STARTED") return "Start work";
  const lastNote = (t.comments || []).slice(-1)[0];
  if (t.progress >= 90) return "Final pass and hand off";
  if (lastNote) return lastNote.body.slice(0, 60);
  return "Continue to " + (PROGRESS_STEPS.find(p => p > (t.progress || 0)) || 100) + "%";
}

function attnItem(t) {
  const rs = attention(t), sev = rs.length ? rs[0].sev : 1, f = flags(t);
  return `<div class="att-i sev-${sev}"><div class="bar"></div><div class="att-b">
    <div class="top">${pPill(t.priority)}<span class="ttl">${taskLink(t)}</span></div>
    <div class="meta">${av(emp(t.assigneeId), "sm")} ${esc(empName(t.assigneeId))} · ${sChip(t.status)} · ${t.progress || 0}% · due ${esc(fmtDate(t.dueDate))} · ${esc(projName(t.projectId))}</div>
    <div class="reasons">${rs.slice(0, 3).map(r => `<div class="reason r${r.sev}"><span class="ic">${r.ic}</span><span>${esc(r.text)}</span></div>`).join("")}</div>
  </div></div>`;
}

function deadlineGroups(list) {
  const g = { Overdue: [], Today: [], Tomorrow: [], "This week": [] };
  list.forEach(t => { const f = flags(t); if (f.overdue) g.Overdue.push(t); else if (f.dueToday) g.Today.push(t); else if (f.dueTomorrow) g.Tomorrow.push(t); else if (f.dueIn7) g["This week"].push(t); });
  const rows = Object.entries(g).filter(([, v]) => v.length).map(([k, v]) => `
    <div class="sr-group" style="border-top:1px solid var(--line-soft);background:var(--surface-2)">${esc(k)} · ${v.length}</div>
    ${v.slice(0, 8).map(t => `<div class="sr-item">
      ${av(emp(t.assigneeId), "sm")}
      <span style="flex:1;min-width:0"><span class="t" style="display:block">${taskLink(t)}</span><span class="m">${esc(empName(t.assigneeId))} · ${esc(fmtDate(t.dueDate, { absolute: true }))}</span></span>
      ${pPill(t.priority)}
    </div>`).join("")}`).join("");
  return rows || emptyState("Nothing due in the next 7 days", "");
}

/* ==========================================================================
   VIEW · CURRENTLY WORKING ON
   ========================================================================== */
function viewWorking() {
  const people = S.employees.filter(e => e.active !== false);
  const withWork = people.filter(e => currentTasks(e.id, 1).length);
  const idle = people.filter(e => !currentTasks(e.id, 1).length);
  return `
  <div class="ph"><div><h1>Currently working on</h1>
    <div class="sub">One card per person, top priority first. ${withWork.length} of ${people.length} have open work.</div></div>
    <div class="sp"><button class="btn" data-export="working">${icon("dl")}Export</button></div></div>
  <div class="cwo">${withWork.map(e => workCard(e, 3)).join("")}</div>
  ${idle.length ? `<h2 style="font-size:13px;margin:20px 0 10px;color:var(--ink-3)">No open tasks · ${idle.length}</h2>
    <div class="cwo">${idle.map(e => workCard(e, 1)).join("")}</div>` : ""}`;
}

/* ==========================================================================
   VIEW · REQUIRES ATTENTION
   ========================================================================== */
function viewAttention() {
  const ts = visibleTasks().filter(t => isActive(t) && attention(t).length).sort((a, b) => attnScore(b) - attnScore(a));
  const buckets = [
    { k: "Act now", f: t => attention(t)[0].sev === 3 },
    { k: "Watch", f: t => attention(t)[0].sev === 2 },
    { k: "Note", f: t => attention(t)[0].sev === 1 }
  ];
  const overloaded = S.employees.map(e => ({ e, w: workload(e.id) })).filter(x => x.w.band === "OVERLOADED" || (x.w.critical + x.w.high) >= 4);
  return `
  <div class="ph"><div><h1>Requires attention</h1>
    <div class="sub">Surfaced from the data, with the reason stated. ${ts.length} task${ts.length === 1 ? "" : "s"} flagged.</div></div>
    <div class="sp"><button class="btn" data-export="attention">${icon("dl")}Export</button></div></div>

  ${overloaded.length ? `<section class="panel" style="margin-bottom:14px">
    <div class="panel-h"><h2>People carrying too much high-priority work at once</h2></div>
    <div class="panel-b" style="display:grid;gap:8px">
      ${overloaded.map(({ e, w }) => `<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        ${av(e, "sm")}<strong style="font-size:12.5px">${esc(e.name)}</strong>
        ${wlBadge(w)}
        <span style="font-size:12px;color:var(--ink-2)">${w.critical} critical and ${w.high} high-priority tasks open simultaneously, ${w.remainingHours}h of remaining estimated effort${w.overdue ? `, ${w.overdue} overdue` : ""}.</span>
        <button class="btn sm" data-emp="${esc(e.id)}" style="margin-left:auto">Review load</button>
      </div>`).join("")}
    </div></section>` : ""}

  ${buckets.map(b => {
    const rows = ts.filter(b.f);
    if (!rows.length) return "";
    return `<section class="panel" style="margin-bottom:14px">
      <div class="panel-h"><h2>${esc(b.k)}</h2><span class="hint">${rows.length}</span></div>
      <div class="att">${rows.map(attnItem).join("")}</div></section>`;
  }).join("") || `<div class="panel"><div class="panel-b">${emptyState("Nothing needs you right now", "No overdue, blocked, stale, off-track or over-budget work.")}</div></div>`}`;
}

/* ==========================================================================
   VIEW · BLOCKERS
   ========================================================================== */
function viewBlockers() {
  const onlyMgr = S.filters.flag === "manager";
  let rows = visibleTasks().filter(t => isActive(t) && flags(t).blocked);
  if (onlyMgr) rows = rows.filter(t => flags(t).needsManager);
  rows.sort((a, b) => flags(b).blockedDays - flags(a).blockedDays);
  return `
  <div class="ph"><div><h1>Blockers</h1><div class="sub">${rows.length} open blocker${rows.length === 1 ? "" : "s"}, oldest first.</div></div>
    <div class="sp">
      <button class="chip" aria-pressed="${onlyMgr}" data-blockfilter="manager">Manager intervention required</button>
      <button class="btn" data-export="blockers">${icon("dl")}Export</button>
    </div></div>
  <section class="panel"><div class="tw"><table class="t">
    <thead><tr><th>Employee</th><th>Task</th><th>What is blocking it</th><th>Cause</th><th class="c">Since</th><th class="c">Expected</th><th class="c">Needs manager</th><th></th></tr></thead>
    <tbody>${rows.map(t => {
      const f = flags(t), b = t.blocker || {};
      return `<tr>
        <td>${personCell(t.assigneeId)}</td>
        <td>${taskLink(t)}<div style="font-size:10.5px;color:var(--ink-4)">${pPill(t.priority)} ${esc(projName(t.projectId))}</div></td>
        <td style="max-width:280px">${esc(b.reason || "—")}</td>
        <td>${esc(b.cause || (b.ownerId ? empName(b.ownerId) : "—"))}</td>
        <td class="c"><span class="mono">${f.blockedDays}d</span><div style="font-size:10px;color:var(--ink-4)">${esc(fmtDate(b.since, { absolute: true }))}</div></td>
        <td class="c">${esc(fmtDate(b.expectedResolution, { absolute: true }))}</td>
        <td class="c">${b.needsManager ? `<span class="pill p-CRITICAL">Yes</span>` : `<span style="color:var(--ink-4)">—</span>`}</td>
        <td class="r"><button class="btn sm" data-unblock="${esc(t.id)}">Resolve</button></td>
      </tr>`;
    }).join("") || `<tr><td colspan="8">${emptyState("Nothing is blocked", "The team has a clear run.")}</td></tr>`}</tbody>
  </table></div></section>`;
}
