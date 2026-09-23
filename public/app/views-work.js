"use strict";
/* ==========================================================================
   VIEW · MY DAY (employee home)
   ========================================================================== */
function viewMyDay() {
  const id = meId();
  const mine = S.tasks.filter(t => t.assigneeId === id);
  const open = mine.filter(isActive);
  const w = workload(id);
  const today = open.filter(t => flags(t).dueToday);
  const inprog = open.filter(t => t.status === "IN_PROGRESS");
  const overdue = open.filter(t => flags(t).overdue);
  const blocked = open.filter(t => flags(t).blocked);
  const crit = open.filter(t => t.priority === "CRITICAL");
  const tomorrow = open.filter(t => flags(t).dueTomorrow);
  const wk = open.filter(t => { const f = flags(t); return f.dueIn7 && !f.dueToday && !f.dueTomorrow; });
  const mo = open.filter(t => { const d = dOf(t.dueDate); if (!d) return false; const n = daysBetween(new Date(), d); return n > 7 && n <= 30; });
  const d = delivery(id, 4);
  const upd = latestUpdate(id);
  const didToday = upd && upd.date === todayISO();
  const myBreaksToday = breaksToday(id);

  const list = (arr, empty) => arr.length ? arr.sort(by(t => t.dueDate || "9999")).map(t => miniRow(t)).join("") : `<div class="empty" style="padding:16px">${esc(empty)}</div>`;

  return `
  <div class="ph"><div><h1>${esc(greeting())}</h1>
    <div class="sub">${open.length} open task${open.length === 1 ? "" : "s"} · ${w.remainingHours}h estimated remaining · workload ${w.band.toLowerCase()}</div></div>
    <div class="sp">
      <button class="btn pri" data-newfor="${esc(id)}">${icon("plus")}Add task</button>
      <button class="btn ${didToday ? "" : "pri"}" data-go="update">${icon("edit")}${didToday ? "Edit today's update" : "Post today's update"}</button>
    </div></div>

  ${!didToday && open.length ? `<div class="banner info">${icon("clock")}<span>You haven't posted an update today. It takes about 30 seconds and saves your manager from asking.</span><button class="btn sm" data-go="update" style="margin-left:auto">Do it now</button></div>` : ""}

  ${kpiStrip([
    { label: "Due today", value: today.length, tone: today.length ? "med" : "acc", filter: "due:today" },
    { label: "In progress", value: inprog.length, tone: "acc", filter: "status:IN_PROGRESS" },
    { label: "Overdue", value: overdue.length, tone: "crit", filter: "flag:overdue" },
    { label: "Blocked", value: blocked.length, tone: "block", filter: "flag:blocked" },
    { label: "Critical", value: crit.length, tone: "crit", filter: "flag:critical" },
    { label: "Next 7 days", value: today.length + tomorrow.length + wk.length, tone: "med", filter: "due:week" },
    { label: "Done this week", value: w.completedWeek, tone: "ok", filter: "completed:week" },
    { label: "On-time rate", value: d.stats.onTimeRate == null ? "—" : d.stats.onTimeRate + "%", tone: "ok", filter: "completed:month" }
  ])}

  <div class="cc-grid">
    <div class="stack">
      <section class="panel">
        <div class="panel-h"><h2>Today</h2><span class="hint">due today, in progress, overdue and blocked</span></div>
        <div class="panel-b flush">${list(uniqTasks([...overdue, ...today, ...blocked, ...inprog]), "Nothing on today. Pick something up from Upcoming.")}</div>
      </section>
      <section class="panel">
        <div class="panel-h"><h2>Upcoming</h2></div>
        <div class="panel-b flush">
          ${tomorrow.length ? `<div class="sr-group">Tomorrow · ${tomorrow.length}</div>${list(tomorrow)}` : ""}
          ${wk.length ? `<div class="sr-group" style="border-top:1px solid var(--line-soft)">Within 7 days · ${wk.length}</div>${list(wk)}` : ""}
          ${mo.length ? `<div class="sr-group" style="border-top:1px solid var(--line-soft)">Within 30 days · ${mo.length}</div>${list(mo)}` : ""}
          ${!tomorrow.length && !wk.length && !mo.length ? emptyState("Nothing scheduled", "No deadlines in the next 30 days.") : ""}
        </div>
      </section>
    </div>

    <div class="stack">
      <section class="panel">
        <div class="panel-h"><h2>My workload</h2></div>
        <div class="panel-b" style="display:grid;gap:10px">
          <div style="display:flex;align-items:center;gap:10px">${wlBadge(w)}<span class="mono" style="color:var(--ink-4);font-size:11px">score ${w.score}</span>
            <span style="margin-left:auto;font-size:12px;color:var(--ink-3)">${w.remainingHours}h remaining</span></div>
          <div class="bars">
            ${[["Critical", w.critical, "var(--crit)"], ["High", w.high, "var(--high)"], ["Medium", w.medium, "var(--med)"], ["Low", w.low, "var(--low)"]].map(([l, n, c]) => `
              <div class="bar-row"><span>${l}</span><span class="bar-t"><span class="bar-f" style="width:${pct(n, Math.max(1, open.length))}%;background:${c}"></span></span><span class="mono r">${n}</span></div>`).join("")}
          </div>
          <div class="dl" style="border-top:1px solid var(--line-soft);padding-top:9px">
            <dt>Overdue</dt><dd class="mono">${w.overdue}</dd>
            <dt>Blocked</dt><dd class="mono">${w.blocked}</dd>
            <dt>Stale</dt><dd class="mono">${w.stale}</dd>
            <dt>Done this week</dt><dd class="mono">${w.completedWeek}</dd>
          </div>
        </div>
      </section>

      <section class="panel">
        <div class="panel-h"><h2>My breaks today</h2><span class="hint">${fmtDuration(sum(myBreaksToday, b => b.liveDurationSec))} total</span></div>
        <div class="panel-b" style="display:grid;gap:7px">
          ${myBreaksToday.length ? myBreaksToday.map(b => `
            <div style="display:flex;justify-content:space-between;align-items:center;font-size:12.5px">
              <span>${esc(b.typeLabel || "Break")} · ${esc(fmtTime(b.startedAt))} – ${b.endedAt ? esc(fmtTime(b.endedAt)) : "now"}</span>
              <span class="mono" style="${b.extraSec > 0 ? "color:var(--crit);font-weight:600" : b.endedAt ? "color:var(--ink-3)" : "color:var(--warn);font-weight:600"}">${fmtDuration(b.liveDurationSec)}${b.extraSec > 0 ? ` (+${fmtDuration(b.extraSec)} over)` : ""}</span>
            </div>`).join("") : `<div style="font-size:12px;color:var(--ink-4)">No breaks taken today.</div>`}
        </div>
      </section>

      <section class="panel">
        <div class="panel-h"><h2>Quick actions</h2></div>
        <div class="panel-b" style="display:grid;gap:7px">
          <button class="btn" data-newfor="${esc(id)}">${icon("plus")}Add a task</button>
          <button class="btn" data-quick="progress">${icon("chart")}Update progress on a task</button>
          <button class="btn" data-quick="complete">${icon("check")}Mark a task complete</button>
          <button class="btn" data-quick="blocker">${icon("ban")}Report a blocker</button>
          <button class="btn" data-go="update">${icon("edit")}Post today's update</button>
        </div>
      </section>

      <section class="panel">
        <div class="panel-h"><h2>My delivery signals</h2><span class="hint">last 4 weeks</span></div>
        <div class="panel-b">${deliveryPanel(d)}</div>
      </section>
    </div>
  </div>`;
}
function uniqTasks(a) { const s = new Set(), o = []; a.forEach(t => { if (!s.has(t.id)) { s.add(t.id); o.push(t); } }); return o; }

function miniRow(t) {
  const f = flags(t);
  return `<div class="sr-item" style="border-bottom:1px solid var(--line-soft);border-radius:0;align-items:flex-start;padding:9px 12px">
    <span style="flex:1;min-width:0;display:grid;gap:4px">
      <span style="display:flex;gap:7px;align-items:center;flex-wrap:wrap">${pPill(t.priority)}<span class="t">${taskLink(t)}</span></span>
      <span class="m" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">${sChip(t.status)} · ${esc(projName(t.projectId))} · due ${esc(fmtDate(t.dueDate))} ${flagChips(t)}</span>
    </span>
    <span style="display:grid;gap:5px;justify-items:end">${pBar(t)}
      <span style="display:flex;gap:4px">
        <button class="btn sm" data-open="${esc(t.id)}">Open</button>
        ${canComplete(t) && !isClosed(t) ? `<button class="btn sm" data-complete="${esc(t.id)}">Done</button>` : ""}
      </span></span>
  </div>`;
}

function deliveryPanel(d) {
  if (d.score == null) return emptyState("Not enough data", "A few completed or open tasks are needed before these signals mean anything.");
  return `
    <div class="metric-row" style="margin-bottom:9px">
      <span class="metric-v" style="color:${d.score >= 75 ? "var(--ok)" : d.score >= 55 ? "var(--high)" : "var(--crit)"}">${d.score}</span>
      <span style="font-size:11.5px;color:var(--ink-3)">delivery health${d.reliable ? "" : " · low confidence, small sample"}</span>
    </div>
    <div class="bars">${d.components.map(c => `
      <div class="bar-row" title="${esc(c.note)}"><span style="font-size:11px">${esc(c.key)}</span>
        <span class="bar-t"><span class="bar-f" style="width:${c.value}%;background:${c.value >= 75 ? "var(--ok)" : c.value >= 50 ? "var(--high)" : "var(--crit)"}"></span></span>
        <span class="mono r">${c.value}%</span></div>`).join("")}</div>
    <details class="calc" style="margin-top:9px"><summary>How is this calculated?</summary>
      <div class="note-box">
        A weighted average of the indicators below over ${d.window} weeks — <strong>not</strong> a count of completed tasks, and not a performance verdict. Blocked and reassigned work distorts every one of them, so read it alongside the blocker list.
        <ul>${d.components.map(c => `<li><strong>${esc(c.key)}</strong> (weight ${c.weight}) — ${esc(c.note)}</li>`).join("")}</ul>
        ${d.reliable ? "" : `<p style="margin:6px 0 0;color:var(--warn)"><strong>Low confidence:</strong> fewer than 5 tasks in the window. Treat the number as noise.</p>`}
      </div>
    </details>`;
}

/* ==========================================================================
   VIEW · BOARD (kanban, drag and drop)
   ========================================================================== */
function viewBoard() {
  const cols = cfg().statuses.filter(s => s.id !== "CANCELLED");
  let ts = applyFilters(visibleTasks(), Object.assign({}, S.filters, { search: S.filters.search }));
  const people = S.employees;
  return `
  <div class="ph"><div><h1>Board</h1><div class="sub">Drag a card to change its status. ${ts.length} task${ts.length === 1 ? "" : "s"} shown.</div></div></div>
  <section class="panel" style="margin-bottom:12px"><div class="fbar" style="border-radius:var(--r-lg)">
    <label class="lbl">Filter</label>
    <select id="f-assignee"><option value="">Everyone</option>${people.map(e => `<option value="${esc(e.id)}" ${S.filters.assignee === e.id ? "selected" : ""}>${esc(e.name)}</option>`).join("")}</select>
    <select id="f-project"><option value="">All projects</option>${S.projects.map(p => `<option value="${esc(p.id)}" ${S.filters.project === p.id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select>
    <select id="f-priority"><option value="">Any priority</option>${priorityOptions(S.filters.priority)}</select>
    <select id="f-flag"><option value="">No flag filter</option>
      ${[["active", "Open only"], ["overdue", "Overdue"], ["blocked", "Blocked"], ["stale", "No recent update"], ["critical", "Critical"], ["attention", "Needs attention"]]
        .map(([v, l]) => `<option value="${v}" ${S.filters.flag === v ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>
    <input id="f-search" type="search" placeholder="Search in board…" value="${esc(S.filters.search || "")}" style="min-width:150px">
    <button class="btn sm" data-clearfilters>Clear</button>
    <span class="fcount">${ts.length} shown</span>
  </div></section>
  <div class="kb">${cols.map(c => {
    const items = ts.filter(t => t.status === c.id).sort((a, b) => prio(b.priority).weight - prio(a.priority).weight || String(a.dueDate || "9999").localeCompare(String(b.dueDate || "9999")));
    return `<div class="kcol" data-col="${esc(c.id)}">
      <div class="kcol-h"><span class="st st-${esc(c.id)}"></span><span class="nm">${esc(c.label)}</span><span class="n">${items.length}</span></div>
      <div class="kcol-b" data-drop="${esc(c.id)}">${items.map(kCard).join("") || `<div style="font-size:11.5px;color:var(--ink-4);padding:8px;text-align:center">—</div>`}</div>
    </div>`;
  }).join("")}</div>`;
}
function kCard(t) {
  const f = flags(t), e = emp(t.assigneeId);
  const stripe = t.priority === "CRITICAL" ? "var(--crit)" : t.priority === "HIGH" ? "var(--high)" : t.priority === "MEDIUM" ? "var(--med)" : "var(--low)";
  return `<article class="kcard" draggable="${canEdit(t)}" data-card="${esc(t.id)}">
    <div class="kstripe" style="background:${stripe}"></div>
    <div class="kt">${taskLink(t)}</div>
    <div class="krow">${pPill(t.priority)}${t.projectId ? `<span class="tag">${esc(projName(t.projectId))}</span>` : ""}</div>
    <div class="krow">${av(e, "sm")}<span>${esc(e ? e.name.split(" ")[0] : "—")}</span>
      <span style="margin-left:auto;${f.overdue ? "color:var(--crit);font-weight:600" : ""}">${esc(fmtDate(t.dueDate))}</span></div>
    ${pBar(t)}
    ${flagChips(t) ? `<div class="krow">${flagChips(t)}</div>` : ""}
  </article>`;
}

/* ==========================================================================
   VIEW · TASK BOARD (Not Done / Done, category filter, assignment timer)
   A sibling to the Board view above, not a mode of it — different columns
   (binary done/not-done vs. every status), a different category concept
   (boardCategory vs. the free-text `category` tag), and its own drag-and-
   drop/permission gate (public/app/events.js, canManageTaskBoard).

   Two nav entries render this same function (ui.js's paint() dispatcher):
   "Task Board" (everyone) and the manager-only "Managers Board", which is
   the same board/data — a manager already sees every task here, same as
   on Task Board — just reachable from its own nav item near Overview.
   `title` is only which heading to print. */
function viewTaskBoard(title) {
  const cat = S.taskBoardFilter.category;
  const ts = visibleTasks().filter(t => t.status !== "CANCELLED" && (!cat || t.boardCategory === cat));
  const notDone = ts.filter(t => t.status !== "COMPLETED");
  const done = ts.filter(t => t.status === "COMPLETED");
  return `
  <div class="ph"><div><h1>${esc(title || "Task Board")}</h1><div class="sub">${ts.length} task${ts.length === 1 ? "" : "s"} shown.</div></div>
    <div class="sp"><button class="btn pri" data-newtboard>${icon("plus")}New task</button></div></div>
  <section class="panel" style="margin-bottom:12px"><div class="fbar" style="border-radius:var(--r-lg)">
    <label class="lbl">Category</label>
    <select id="f-tb-category"><option value="">All</option>${BOARD_CATEGORIES.map(c => `<option value="${esc(c.id)}" ${cat === c.id ? "selected" : ""}>${esc(c.label)}</option>`).join("")}</select>
    <span class="fcount">${ts.length} shown</span>
  </div></section>
  <div class="kb">
    <div class="tbcol" data-tbcol="not_done">
      <div class="kcol-h"><span class="nm">Not Done</span><span class="n">${notDone.length}</span></div>
      <div class="kcol-b">${notDone.map(tbCard).join("") || `<div style="font-size:11.5px;color:var(--ink-4);padding:8px;text-align:center">—</div>`}</div>
    </div>
    <div class="tbcol" data-tbcol="done">
      <div class="kcol-h"><span class="nm">Done</span><span class="n">${done.length}</span></div>
      <div class="kcol-b">${done.map(tbCard).join("") || `<div style="font-size:11.5px;color:var(--ink-4);padding:8px;text-align:center">—</div>`}</div>
    </div>
  </div>`;
}
function tbCard(t) {
  const e = emp(t.assigneeId);
  const info = taskTimerInfo(t);
  const can = canManageTaskBoard();
  return `<article class="tbcard" draggable="${can}" data-tbcard="${esc(t.id)}">
    <div class="kt">${taskLink(t)}</div>
    <div class="krow"><span class="tag">${esc(boardCategoryLabel(t.boardCategory))}</span>${av(e, "sm")}<span>${esc(e ? e.name.split(" ")[0] : "—")}</span></div>
    <div class="krow"><span class="tbtimer${info.muted ? " muted" : ""}">${esc(info.text)}</span></div>
    <div class="krow">
      <button class="btn sm" data-tbtoggle="${esc(t.id)}" ${can ? "" : "disabled"}>${t.status === "COMPLETED" ? "Reopen" : "Mark Done"}</button>
      <select data-tbcat="${esc(t.id)}" ${can ? "" : "disabled"}>${BOARD_CATEGORIES.map(c => `<option value="${esc(c.id)}" ${t.boardCategory === c.id ? "selected" : ""}>${esc(c.label)}</option>`).join("")}</select>
    </div>
  </article>`;
}

/* ==========================================================================
   VIEW · ALL TASKS (table)
   ========================================================================== */
const TABLE_COLS = [
  ["id", "ID"], ["title", "Task"], ["assignee", "Employee"], ["project", "Project"],
  ["priority", "Priority"], ["status", "Status"], ["progress", "Progress"],
  ["created", "Created"], ["due", "Due"], ["expected", "Expected"], ["updated", "Updated"],
  ["est", "Est h"], ["act", "Act h"], ["blocker", "Blocker"], ["attention", "Attention"]
];
function viewTasks() {
  const all = visibleTasks();
  const rows = sortTasks(applyFilters(all));
  const sel = S.selection;
  const teams = allTeams();
  return `
  <div class="ph"><div><h1>All tasks</h1><div class="sub">${rows.length} of ${all.length} tasks match the current filters.</div></div>
    <div class="sp">
      ${sel.size ? `<button class="btn" data-bulk>Bulk edit ${sel.size} selected</button>` : ""}
      <button class="btn" data-export="tasks">${icon("dl")}Export CSV</button>
      <button class="btn pri" data-newtask>${icon("plus")}New task</button>
    </div></div>

  <section class="panel">
    <div class="fbar">
      <select id="f-assignee"><option value="">Everyone</option>${S.employees.map(e => `<option value="${esc(e.id)}" ${S.filters.assignee === e.id ? "selected" : ""}>${esc(e.name)}</option>`).join("")}</select>
      <select id="f-dept"><option value="">All departments</option>${cfg().departments.map(d => `<option value="${esc(d.id)}" ${S.filters.dept === d.id ? "selected" : ""}>${esc(d.name)}</option>`).join("")}</select>
      <select id="f-team"><option value="">All teams</option>${teams.map(t => `<option value="${esc(t.id)}" ${S.filters.team === t.id ? "selected" : ""}>${esc(t.deptName)} / ${esc(t.name)}</option>`).join("")}</select>
      <select id="f-project"><option value="">All projects</option>${S.projects.map(p => `<option value="${esc(p.id)}" ${S.filters.project === p.id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select>
      <select id="f-priority"><option value="">Any priority</option>${priorityOptions(S.filters.priority)}</select>
      <select id="f-status"><option value="">Any status</option>${statusOptions(S.filters.status)}</select>
      <select id="f-due"><option value="">Any due date</option>
        ${[["today", "Due today"], ["tomorrow", "Due tomorrow"], ["week", "Due this week"], ["month", "Due this month"], ["overdue", "Overdue"], ["none", "No due date"]]
          .map(([v, l]) => `<option value="${v}" ${S.filters.due === v ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>
      <select id="f-flag"><option value="">No flag filter</option>
        ${[["active", "Open only"], ["overdue", "Overdue"], ["blocked", "Blocked"], ["manager", "Needs manager"], ["stale", "No recent update"], ["critical", "Critical"], ["attention", "Needs attention"], ["unassigned", "Unassigned"]]
          .map(([v, l]) => `<option value="${v}" ${S.filters.flag === v ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>
      <select id="f-completed"><option value="">Any completion</option>
        ${[["today", "Completed today"], ["week", "Completed this week"], ["month", "Completed this month"]]
          .map(([v, l]) => `<option value="${v}" ${S.filters.completed === v ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>
      <input id="f-search" type="search" placeholder="Search…" value="${esc(S.filters.search || "")}" style="min-width:150px">
      <span style="display:flex;gap:4px;align-items:center;font-size:11px;color:var(--ink-4)">progress
        <input id="f-minp" type="number" min="0" max="100" step="5" placeholder="0" value="${esc(S.filters.minProgress ?? "")}" style="width:52px">–
        <input id="f-maxp" type="number" min="0" max="100" step="5" placeholder="100" value="${esc(S.filters.maxProgress ?? "")}" style="width:52px"></span>
      <button class="btn sm" data-clearfilters>Clear all</button>
      <span class="fcount">${rows.length} row${rows.length === 1 ? "" : "s"}</span>
    </div>
    <div class="tw scrolly"><table class="t">
      <thead><tr>
        <th style="width:26px"><input type="checkbox" id="selAll" ${rows.length && rows.every(t => sel.has(t.id)) ? "checked" : ""} aria-label="Select all"></th>
        ${TABLE_COLS.map(([k, l]) => `<th class="${SORTERS[k] ? "sortable" : ""}" ${SORTERS[k] ? `data-sort="${k}"` : ""}>${esc(l)}${S.sort.key === k ? `<span class="caret"> ${S.sort.dir > 0 ? "▲" : "▼"}</span>` : ""}</th>`).join("")}
      </tr></thead>
      <tbody>${rows.map(t => {
        const f = flags(t), a = attention(t);
        return `<tr class="${sel.has(t.id) ? "sel" : ""}">
          <td><input type="checkbox" data-selrow="${esc(t.id)}" ${sel.has(t.id) ? "checked" : ""} aria-label="Select ${esc(t.title)}"></td>
          <td class="mono" style="font-size:10.5px;color:var(--ink-4)">${esc(t.id)}</td>
          <td style="max-width:280px">${taskLink(t)}${(t.tags || []).length ? `<div style="display:flex;gap:3px;margin-top:2px">${t.tags.slice(0, 3).map(g => `<span class="tag">${esc(g)}</span>`).join("")}</div>` : ""}</td>
          <td>${personCell(t.assigneeId)}</td>
          <td style="font-size:11.5px">${esc(projName(t.projectId))}</td>
          <td>${pPill(t.priority)}</td>
          <td>${sChip(t.status)}</td>
          <td>${pBar(t)}</td>
          <td style="font-size:11.5px;color:var(--ink-3);white-space:nowrap">${esc(fmtDate(t.createdAt, { absolute: true }))}</td>
          <td style="white-space:nowrap;${f.overdue ? "color:var(--crit);font-weight:600" : ""}">${esc(fmtDate(t.dueDate))}</td>
          <td style="white-space:nowrap;font-size:11.5px;color:var(--ink-3)">${esc(fmtDate(t.expectedCompletion))}</td>
          <td style="white-space:nowrap;font-size:11.5px;${f.stale ? "color:var(--warn);font-weight:600" : "color:var(--ink-3)"}">${esc(fmtAgo(t.updatedAt))}</td>
          <td class="c mono">${t.estimatedHours || "·"}</td>
          <td class="c mono">${t.actualHours || "·"}</td>
          <td style="max-width:150px;font-size:11.5px;color:var(--block)">${f.blocked && t.blocker ? esc((t.blocker.reason || "").slice(0, 40)) : "<span style='color:var(--ink-4)'>—</span>"}</td>
          <td>${a.length ? `<span class="flag ${a[0].sev === 3 ? "od" : "st"}" title="${esc(a.map(x => x.text).join(" · "))}">${a[0].ic} ${a.length}</span>` : "<span style='color:var(--ink-4)'>—</span>"}</td>
        </tr>`;
      }).join("") || `<tr><td colspan="16">${emptyState("No tasks match", "Loosen a filter or clear them all.")}</td></tr>`}</tbody>
    </table></div>
  </section>`;
}
