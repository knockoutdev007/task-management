"use strict";
/* ==========================================================================
   VIEW · DAILY UPDATE (employee, a short checklist for today)
   ========================================================================== */
function viewUpdate() {
  const id = meId();
  const today = todayISO();
  const existing = myUpdates(id).find(u => u.date === today) || {};
  const items = planItems(existing);
  const mine = S.tasks.filter(t => t.assigneeId === id);
  const doneToday = mine.filter(t => t.status === "COMPLETED" && (t.completedAt || "").slice(0, 10) === today);
  const past = myUpdates(id).slice(-6).reverse();
  return `
  <div class="ph"><div><h1>Today's update</h1>
    <div class="sub">Add what you're doing today as a short list, and tick items off as you finish — saved as you go.</div></div></div>
  <div class="cc-grid">
    <section class="panel">
      <div class="panel-h"><h2>${esc(fmtDate(today, { absolute: true }))}</h2>${existing.at ? `<span class="hint">last saved ${esc(fmtAgo(existing.at))}</span>` : ""}</div>
      <div class="panel-b" style="display:grid;gap:8px">
        ${doneToday.length ? `<div class="note-box"><h4>Already recorded from your tasks today</h4>${doneToday.map(t => `• ${esc(t.title)}`).join("<br>")}<br><button class="btn sm" data-prefillplan style="margin-top:6px">Add these as items</button></div>` : ""}
        <div style="display:grid;gap:4px">
          ${items.length ? items.map(it => `<div class="sr-item" style="width:100%">
            <button class="iconbtn" data-toggleplan="${esc(it.id)}" aria-label="${it.done ? "Mark not done" : "Mark done"}" style="width:24px;height:24px;flex:none">${it.done ? icon("check") : ""}</button>
            <span style="flex:1;font-size:13px;min-width:0;overflow-wrap:anywhere;${it.done ? "text-decoration:line-through;color:var(--ink-4)" : ""}">${esc(it.text)}</span>
            <button class="iconbtn" data-delplan="${esc(it.id)}" aria-label="Remove" style="width:24px;height:24px;flex:none">${icon("x")}</button>
          </div>`).join("") : emptyState("Nothing added yet", "Add your first item below.")}
        </div>
        <div style="display:flex;gap:8px">
          <input class="inp" id="u-newitem" placeholder="Add something you're doing today…" style="flex:1">
          <button class="btn" data-addplan>${icon("plus")}Add</button>
        </div>
      </div>
    </section>
    <section class="panel"><div class="panel-h"><h2>Your recent updates</h2></div>
      <div class="panel-b" style="display:grid;gap:11px">
        ${past.length ? past.map(u => `<div style="border-left:2px solid var(--line);padding-left:9px">
          <div style="font-size:10.5px;color:var(--ink-4);text-transform:uppercase;letter-spacing:.06em">${esc(fmtDate(u.date, { absolute: true }))}</div>
          ${planItems(u).map(it => `<div style="font-size:12.5px;${it.done ? "text-decoration:line-through;color:var(--ink-4)" : ""}">${esc(it.text)}</div>`).join("") || emptyState("No items", "")}
        </div>`).join("") : emptyState("No updates yet", "")}
      </div></section>
  </div>`;
}

/* ==========================================================================
   VIEW · ANALYTICS (weekly management report)
   ========================================================================== */
function viewAnalytics() {
  const off = S.analyticsWeek;
  const thisStart = addDays(startOfWeek(new Date()), off * 7);
  const thisEnd = addDays(thisStart, 7);
  const prevStart = addDays(thisStart, -7);
  const ts = visibleTasks();
  const cur = periodStats(thisStart, thisEnd, ts);
  const prev = periodStats(prevStart, thisStart, ts);
  const label = `${MON[thisStart.getMonth()]} ${thisStart.getDate()} – ${MON[addDays(thisEnd, -1).getMonth()]} ${addDays(thisEnd, -1).getDate()}`;

  const tr = (a, b, invert) => {
    if (b == null || a == null) return `<span class="trend flat">—</span>`;
    if (b === 0 && a === 0) return `<span class="trend flat">no change</span>`;
    const diff = a - b;
    const p = b === 0 ? null : Math.round((diff / Math.abs(b)) * 100);
    const good = invert ? diff < 0 : diff > 0;
    if (diff === 0) return `<span class="trend flat">no change</span>`;
    return `<span class="trend ${good ? "up" : "down"}">${diff > 0 ? "+" : ""}${p == null ? diff : p + "%"}</span>`;
  };
  const metric = (label, val, prevVal, invert, suffix) => `
    <div style="padding:10px 12px;border:1px solid var(--line);border-radius:var(--r-md);background:var(--surface)">
      <div class="k-l" style="font-size:10px;text-transform:uppercase;letter-spacing:.085em;color:var(--ink-4);font-weight:600">${esc(label)}</div>
      <div class="metric-row"><span class="metric-v">${val == null ? "—" : val}${suffix || ""}</span>${tr(val, prevVal, invert)}</div>
      <div style="font-size:10.5px;color:var(--ink-4)">prev ${prevVal == null ? "—" : prevVal}${suffix || ""}</div>
    </div>`;

  const perPerson = S.employees.map(e => {
    const mine = ts.filter(t => t.assigneeId === e.id);
    const c = periodStats(thisStart, thisEnd, mine);
    const w = workload(e.id);
    const brk = totalBreakSeconds(e.id, iso(thisStart), iso(thisEnd));
    return { e, c, w, brk };
  }).sort((a, b) => b.c.completed - a.c.completed);

  const prioDist = cfg().priorities.map(p => ({ p, n: ts.filter(t => isActive(t) && t.priority === p.id).length }));
  const totalOpen = sum(prioDist, x => x.n) || 1;
  const statusDist = cfg().statuses.map(s => ({ s, n: ts.filter(t => t.status === s.id).length }));
  const totalAll = ts.length || 1;

  // 8-week completion trend
  const trend = [];
  for (let i = 7; i >= 0; i--) {
    const a = addDays(startOfWeek(new Date()), (off - i) * 7), b = addDays(a, 7);
    const s = periodStats(a, b, ts);
    trend.push({ label: `${MON[a.getMonth()]} ${a.getDate()}`, completed: s.completed, created: s.created });
  }

  return `
  <div class="ph"><div><h1>Weekly management report</h1><div class="sub">${esc(label)}${off === 0 ? " · current week" : ""} — every figure derived from task records.</div></div>
    <div class="sp">
      <button class="btn sm" data-week="-1">← Earlier</button>
      <button class="btn sm" data-week="0" ${off === 0 ? "disabled" : ""}>This week</button>
      <button class="btn sm" data-week="1" ${off >= 0 ? "disabled" : ""}>Later →</button>
      <button class="btn" data-export="weekly">${icon("dl")}Export report</button>
    </div></div>

  <div class="kpis" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr));margin-bottom:14px">
    ${metric("Tasks created", cur.created, prev.created, false)}
    ${metric("Tasks completed", cur.completed, prev.completed, false)}
    ${metric("Carried forward", cur.carried, prev.carried, true)}
    ${metric("Overdue at week end", cur.overdue, prev.overdue, true)}
    ${metric("Cancelled", cur.cancelled, prev.cancelled, true)}
    ${metric("Blocked", cur.blocked, prev.blocked, true)}
    ${metric("Completion rate", cur.completionRate, prev.completionRate, false, "%")}
    ${metric("On-time rate", cur.onTimeRate, prev.onTimeRate, false, "%")}
    ${metric("Avg completion time", cur.avgCycle, prev.avgCycle, true, "d")}
    ${metric("Avg delay vs due date", cur.avgDelay, prev.avgDelay, true, "d")}
  </div>

  <div class="cols-2" style="margin-bottom:14px">
    <section class="panel"><div class="panel-h"><h2>Created vs completed</h2><span class="hint">last 8 weeks</span></div>
      <div class="panel-b">${trendChart(trend)}</div></section>
    <section class="panel"><div class="panel-h"><h2>Distribution</h2></div>
      <div class="panel-b" style="display:grid;gap:14px">
        <div><div class="lbl" style="margin-bottom:6px">Open work by priority</div><div class="bars">
          ${prioDist.map(({ p, n }) => `<div class="bar-row"><span>${esc(p.label)}</span>
            <span class="bar-t"><span class="bar-f" style="width:${pct(n, totalOpen)}%;background:${p.id === "CRITICAL" ? "var(--crit)" : p.id === "HIGH" ? "var(--high)" : p.id === "MEDIUM" ? "var(--med)" : "var(--low)"}"></span></span>
            <span class="mono r">${n}</span></div>`).join("")}</div></div>
        <div><div class="lbl" style="margin-bottom:6px">All tasks by status</div><div class="bars">
          ${statusDist.filter(x => x.n).map(({ s, n }) => `<div class="bar-row"><span>${esc(s.label)}</span>
            <span class="bar-t"><span class="bar-f" style="width:${pct(n, totalAll)}%;background:var(--accent)"></span></span>
            <span class="mono r">${n}</span></div>`).join("")}</div></div>
      </div></section>
  </div>

  <section class="panel" style="margin-bottom:14px">
    <div class="panel-h"><h2>By employee</h2><span class="hint">${esc(label)}</span></div>
    <div class="tw"><table class="t">
      <thead><tr><th>Employee</th><th class="c">Created</th><th class="c">Completed</th><th class="c">Break time</th><th class="c">Overdue</th><th class="c">Blocked</th><th class="c">Carried</th><th class="c">Completion %</th><th class="c">On-time %</th><th class="c">Avg completion</th><th>Workload now</th></tr></thead>
      <tbody>${perPerson.map(({ e, c, w, brk }) => `<tr>
        <td>${personCell(e.id)}</td>
        <td class="c mono">${c.created}</td>
        <td class="c mono" style="${c.completed ? "color:var(--ok);font-weight:600" : "color:var(--ink-4)"}">${c.completed || "·"}</td>
        <td class="c mono" style="${brk ? "color:var(--warn)" : "color:var(--ink-4)"}">${brk ? fmtDuration(brk) : "·"}</td>
        <td class="c mono" style="${w.overdue ? "color:var(--crit)" : "color:var(--ink-4)"}">${w.overdue || "·"}</td>
        <td class="c mono" style="${w.blocked ? "color:var(--block)" : "color:var(--ink-4)"}">${w.blocked || "·"}</td>
        <td class="c mono">${c.carried}</td>
        <td class="c mono">${c.completionRate}%</td>
        <td class="c mono">${c.onTimeRate == null ? "—" : c.onTimeRate + "%"}</td>
        <td class="c mono">${c.avgCycle == null ? "—" : c.avgCycle + "d"}</td>
        <td>${wlBadge(w)}</td>
      </tr>`).join("")}</tbody>
    </table></div>
    <div class="panel-b" style="border-top:1px solid var(--line-soft)">
      <details class="calc"><summary>What these columns do and don't tell you</summary>
        <div class="note-box">
          <ul>
            <li><strong>Created / Completed</strong> — counts inside the selected week, by the task's created and completed timestamps.</li>
            <li><strong>Carried</strong> — tasks open at the end of the week that were created before it started.</li>
            <li><strong>Completion %</strong> — completed ÷ (completed + still open) for this person, this week.</li>
            <li><strong>On-time %</strong> — of the tasks they completed, the share finished on or before the due date.</li>
            <li><strong>Avg completion</strong> — mean days from start date to completion.</li>
          </ul>
          A low count here is not evidence of low output: large tasks span weeks, blocked work sits still through no fault of the assignee, and reassignments move credit. Read this next to the blocker list and the workload column, and use it to start a conversation, not to end one.
        </div>
      </details>
    </div>
  </section>`;
}
function trendChart(rows) {
  const W = 520, H = 150, pad = { t: 12, r: 10, b: 26, l: 30 };
  const max = Math.max(4, ...rows.map(r => Math.max(r.completed, r.created)));
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  const bw = iw / rows.length;
  const y = v => pad.t + ih - (v / max) * ih;
  const ticks = [0, Math.round(max / 2), max];
  return `<div style="overflow-x:auto"><svg class="spark" viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="Created versus completed tasks over the last eight weeks">
    ${ticks.map(v => `<g><line x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)" stroke-width="1"/>
      <text x="${pad.l - 6}" y="${y(v) + 3.5}" text-anchor="end" font-size="9" fill="var(--ink-4)" font-family="IBM Plex Mono, monospace">${v}</text></g>`).join("")}
    ${rows.map((r, i) => {
      const x = pad.l + i * bw;
      const w1 = bw * 0.3;
      return `<g>
        <rect x="${x + bw * 0.16}" y="${y(r.created)}" width="${w1}" height="${Math.max(1, pad.t + ih - y(r.created))}" fill="var(--med)" opacity=".55" rx="1.5"/>
        <rect x="${x + bw * 0.52}" y="${y(r.completed)}" width="${w1}" height="${Math.max(1, pad.t + ih - y(r.completed))}" fill="var(--ok)" rx="1.5"/>
        <text x="${x + bw / 2}" y="${H - 9}" text-anchor="middle" font-size="8.5" fill="var(--ink-4)" font-family="IBM Plex Mono, monospace">${esc(r.label)}</text>
      </g>`;
    }).join("")}
  </svg></div>
  <div style="display:flex;gap:14px;font-size:11px;color:var(--ink-3);margin-top:4px">
    <span style="display:flex;gap:5px;align-items:center"><i style="width:9px;height:9px;background:var(--med);opacity:.55;border-radius:2px;display:block"></i>Created</span>
    <span style="display:flex;gap:5px;align-items:center"><i style="width:9px;height:9px;background:var(--ok);border-radius:2px;display:block"></i>Completed</span>
  </div>`;
}

/* ==========================================================================
   VIEW · SETTINGS
   ========================================================================== */
function viewSettings() {
  const c = cfg();
  return `
  <div class="ph"><div><h1>Settings</h1><div class="sub">Everything here is configuration, not code. Changes apply to everyone immediately.</div></div></div>
  <div class="cols-2">
    <div class="stack">
      <section class="panel"><div class="panel-h"><h2>Departments and teams</h2>
        <div class="sp"><button class="btn sm" data-adddept>${icon("plus")}Department</button></div></div>
        <div class="panel-b" style="display:grid;gap:12px">
          ${c.departments.map((d, i) => `<div style="border:1px solid var(--line);border-radius:var(--r-md);padding:9px 10px">
            <div style="display:flex;gap:7px;align-items:center">
              <input class="inp" data-dept-name="${i}" value="${esc(d.name)}" style="font-weight:600">
              <button class="btn sm" data-addteam="${i}">${icon("plus")}Team</button>
              <button class="btn sm dgr" data-deldept="${i}" title="Remove">${icon("x")}</button></div>
            <div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:7px">
              ${(d.teams || []).map((t, j) => `<span class="tag" style="padding:3px 7px">
                <input data-team-name="${i}.${j}" value="${esc(t.name)}" style="border:0;background:none;width:${Math.max(6, t.name.length)}ch;font-size:11px;padding:0">
                <button data-delteam="${i}.${j}" style="border:0;background:none;padding:0;color:var(--ink-4);line-height:1" title="Remove">✕</button></span>`).join("") || `<span style="font-size:11px;color:var(--ink-4)">No teams yet</span>`}
            </div></div>`).join("")}
        </div></section>

      <section class="panel"><div class="panel-h"><h2>Priorities and staleness thresholds</h2></div>
        <div class="tw"><table class="t"><thead><tr><th>Priority</th><th class="c">Workload weight</th><th class="c">Flag as stale after</th></tr></thead>
          <tbody>${c.priorities.map((p, i) => `<tr>
            <td>${pPill(p.id)}</td>
            <td class="c"><input class="inp" type="number" step="0.1" min="0.1" max="10" data-prio-w="${i}" value="${p.weight}" style="width:74px;text-align:center"></td>
            <td class="c"><input class="inp" type="number" step="1" min="1" max="60" data-prio-s="${i}" value="${p.staleDays}" style="width:74px;text-align:center"> days</td>
          </tr>`).join("")}</tbody></table></div>
        <div class="panel-b" style="border-top:1px solid var(--line-soft)"><div class="hlp">A task with no change for longer than its threshold is flagged “no recent update” on every screen.</div></div></section>

      <section class="panel"><div class="panel-h"><h2>Statuses</h2>
        <div class="sp"><button class="btn sm" data-addstatus>${icon("plus")}Status</button></div></div>
        <div class="panel-b" style="display:grid;gap:6px">
          ${c.statuses.map((s, i) => `<div style="display:flex;gap:7px;align-items:center">
            <span class="st st-${esc(s.id)}"></span>
            <input class="inp" data-status-label="${i}" value="${esc(s.label)}" style="flex:1">
            <select class="inp" data-status-kind="${i}" style="width:120px">
              ${["open", "active", "blocked", "done"].map(k => `<option value="${k}" ${s.kind === k ? "selected" : ""}>${k}</option>`).join("")}</select>
            ${["NOT_STARTED", "IN_PROGRESS", "COMPLETED"].includes(s.id) ? `<span class="tag">core</span>` : `<button class="btn sm dgr" data-delstatus="${i}">${icon("x")}</button>`}
          </div>`).join("")}
          <div class="hlp">“done” statuses stop overdue and staleness checks. “blocked” marks work as waiting on someone.</div>
        </div></section>
    </div>

    <div class="stack">
      <section class="panel"><div class="panel-h"><h2>Workload bands</h2></div>
        <div class="panel-b" style="display:grid;gap:10px">
          <div class="frow f3">
            <div class="field"><label>Normal from</label><input class="inp" type="number" data-wl="normal" value="${c.workload.normal}"></div>
            <div class="field"><label>High from</label><input class="inp" type="number" data-wl="high" value="${c.workload.high}"></div>
            <div class="field"><label>Overloaded from</label><input class="inp" type="number" data-wl="overloaded" value="${c.workload.overloaded}"></div>
          </div>
          <div class="hlp">Scores below the first threshold read as Low. Current team scores: ${S.employees.map(e => `${esc(e.name.split(" ")[0])} ${workload(e.id).score}`).join(" · ") || "—"}</div>
        </div></section>

      <section class="panel"><div class="panel-h"><h2>Working days and defaults</h2></div>
        <div class="panel-b" style="display:grid;gap:11px">
          <div class="field"><span class="lbl">Working days</span>
            <div class="chips">${DOW.map((d, i) => `<button class="chip" data-wd="${i}" aria-pressed="${(c.workingDays || []).includes(i)}">${d}</button>`).join("")}</div></div>
          <div class="frow">
            <div class="field"><label for="s-defdue">Default due date (days out)</label><input class="inp" id="s-defdue" type="number" min="1" max="365" data-defdue value="${c.defaultDueDays}"></div>
            <div class="field"><label for="s-cats">Categories (comma separated)</label><input class="inp" id="s-cats" data-cats value="${esc((c.categories || []).join(", "))}"></div>
          </div>
        </div></section>

      <section class="panel"><div class="panel-h"><h2>Notifications</h2></div>
        <div class="panel-b" style="display:grid;gap:5px">
          ${NOTIFY_LABELS.map(([k, l]) => `<label style="display:flex;gap:8px;align-items:center;font-size:12.5px">
              <input type="checkbox" data-notify="${k}" ${(c.notify || {})[k] ? "checked" : ""}>${esc(l)}</label>`).join("")}
          <div class="hlp">This is the org-wide default. Anyone can override it for themselves from their Account menu.</div>
        </div></section>

      <section class="panel"><div class="panel-h"><h2>Projects</h2>
        <div class="sp"><button class="btn sm" data-newproj>${icon("plus")}New project</button></div></div>
        <div class="tw"><table class="t"><thead><tr><th>Name</th><th>Code</th><th>Owner</th><th class="c">Tasks</th><th class="c">Status</th><th></th></tr></thead>
          <tbody>${S.projects.map(p => `<tr>
            <td><button class="linkish" data-proj="${esc(p.id)}">${esc(p.name)}</button></td>
            <td style="font-size:11.5px">${esc(p.code || "—")}</td>
            <td style="font-size:11.5px">${esc(empName(p.ownerId))}</td>
            <td class="c mono">${S.tasks.filter(t => t.projectId === p.id).length}</td>
            <td class="c"><span class="pill p-LOW">${esc(p.status || "ACTIVE")}</span></td>
            <td class="r"><button class="btn sm dgr" data-delproj="${esc(p.id)}">${icon("x")}Delete</button></td>
          </tr>`).join("") || `<tr><td colspan="6">${emptyState("No projects yet", "Create one to start grouping tasks.")}</td></tr>`}</tbody></table></div>
        <div class="panel-b" style="border-top:1px solid var(--line-soft)"><div class="hlp">Deleting a project keeps its tasks — they just lose the project label and go back to "not attached to any project."</div></div></section>

      <section class="panel"><div class="panel-h"><h2>People</h2>
        <div class="sp"><button class="btn sm" data-newemp>${icon("plus")}Add person</button></div></div>
        <div class="tw"><table class="t"><thead><tr><th>Name</th><th>Role</th><th>Team</th><th class="c">Active</th><th></th></tr></thead>
          <tbody>${S.employees.map(e => `<tr>
            <td>${personCell(e.id)}<div style="font-size:10.5px;color:var(--ink-4);padding-left:27px">${esc(e.email || "")}</div></td>
            <td><span class="pill ${e.role === "manager" ? "p-HIGH" : "p-LOW"}">${esc(e.role)}</span></td>
            <td style="font-size:11.5px">${esc(deptName(e.departmentId))} / ${esc(teamName(e.departmentId, e.teamId))}</td>
            <td class="c">${e.active === false ? "<span style='color:var(--ink-4)'>no</span>" : "yes"}</td>
            <td class="r"><button class="btn sm" data-editemp="${esc(e.id)}">Edit</button></td>
          </tr>`).join("")}</tbody></table></div></section>

      <section class="panel"><div class="panel-h"><h2>Data and access</h2></div>
        <div class="panel-b" style="display:grid;gap:9px">
          <div class="dl"><dt>Storage</dt><dd>${S.connected ? "Shared artifact database — live for everyone with the link" : "Preview only — not connected"}</dd>
            <dt>Tasks</dt><dd class="mono">${S.tasks.length}</dd><dt>People</dt><dd class="mono">${S.employees.length}</dd><dt>Projects</dt><dd class="mono">${S.projects.length}</dd></div>
          <div style="display:flex;gap:7px;flex-wrap:wrap">
            <button class="btn" data-export="tasks">${icon("dl")}All tasks</button>
            <button class="btn" data-export="workload">${icon("dl")}Workload</button>
            <button class="btn" data-export="weekly">${icon("dl")}Weekly report</button>
            <button class="btn" data-export="overdue">${icon("dl")}Overdue</button>
            <button class="btn" data-export="completed">${icon("dl")}Completed</button>
          </div>
          <div class="hlp">Settings are writable only by people the artifact is shared with as editors; everyone else can read them.</div>
        </div></section>
    </div>
  </div>`;
}
