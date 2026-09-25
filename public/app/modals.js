"use strict";
/* ==========================================================================
   MORE MODALS
   ========================================================================== */
function blockerModal(t) {
  const b = t.blocker || { reason: "", cause: "", ownerId: "", since: todayISO(), expectedResolution: "", needsManager: false };
  return `<div class="modal" role="dialog" aria-modal="true" aria-label="Report blocker">
    <div class="dh"><h2>${t.blocker ? "Edit blocker" : "Report a blocker"}</h2><div class="sp"><button class="iconbtn" data-close>${icon("x")}</button></div></div>
    <div class="db">
      <div class="hlp">${esc(t.id)} — ${esc(t.title)}</div>
      <div class="field"><label for="bl-reason">What is blocking this?</label>
        <textarea class="inp" id="bl-reason" rows="2" placeholder="Be specific — the manager reads this verbatim.">${esc(b.reason || "")}</textarea></div>
      <div class="frow">
        <div class="field"><label for="bl-cause">Who or what is causing it</label>
          <input class="inp" id="bl-cause" value="${esc(b.cause || "")}" placeholder="e.g. Vendor, Finance approval, dev access"></div>
        <div class="field"><label for="bl-owner">Person responsible (if internal)</label>
          <select class="inp" id="bl-owner"><option value="">Not a person</option>
            ${S.employees.map(e => `<option value="${esc(e.id)}" ${b.ownerId === e.id ? "selected" : ""}>${esc(e.name)}</option>`).join("")}</select></div>
      </div>
      <div class="frow">
        <div class="field"><label for="bl-since">Blocked since</label><input class="inp" type="date" id="bl-since" value="${esc(b.since || todayISO())}"></div>
        <div class="field"><label for="bl-exp">Expected resolution</label><input class="inp" type="date" id="bl-exp" value="${esc(b.expectedResolution || "")}"></div>
      </div>
      <label style="display:flex;gap:8px;align-items:center;font-size:13px;padding:9px 11px;border:1px solid var(--line);border-radius:var(--r-md);background:var(--surface)">
        <input type="checkbox" id="bl-mgr" ${b.needsManager ? "checked" : ""}>
        <span><strong>Manager intervention needed</strong><br><span class="hlp">Puts this at the top of the manager's attention list today.</span></span></label>
      <div id="bl-err"></div>
    </div>
    <div class="df"><span class="hlp">Sets the task status to Blocked.</span>
      <div class="sp"><button class="btn" data-close>Cancel</button><button class="btn pri" data-saveblocker="${esc(t.id)}">Save blocker</button></div></div>
  </div>`;
}
function linkModal(t) {
  return `<div class="modal" role="dialog" aria-modal="true" aria-label="Add link">
    <div class="dh"><h2>Add a link</h2><div class="sp"><button class="iconbtn" data-close>${icon("x")}</button></div></div>
    <div class="db">
      <div class="hlp">${esc(t.id)} — ${esc(t.title)}</div>
      <div class="field"><label for="lk-url">URL</label>
        <input class="inp" id="lk-url" placeholder="Drive doc, ticket, screenshot, staging link…"></div>
      <div class="field"><label for="lk-label">Label</label>
        <input class="inp" id="lk-label" placeholder="Defaults to the URL if left blank"></div>
      <div id="lk-err"></div>
    </div>
    <div class="df"><span></span>
      <div class="sp"><button class="btn" data-close>Cancel</button><button class="btn pri" data-savelink="${esc(t.id)}">Add link</button></div></div>
  </div>`;
}
/** Minimal Task Board creation form — just the 4 fields the brief asks for,
 *  not the full taskForm(). Everything else gets sane defaults on save. */
function taskBoardModal() {
  return `<div class="modal" role="dialog" aria-modal="true" aria-label="New task">
    <div class="dh"><h2>New task</h2><div class="sp"><button class="iconbtn" data-close>${icon("x")}</button></div></div>
    <div class="db">
      <div class="field"><label for="tb-title">Task name</label>
        <input class="inp" id="tb-title" maxlength="120" placeholder="What needs to get done?"></div>
      <div class="frow">
        <div class="field"><label for="tb-category">Category</label>
          <select class="inp" id="tb-category">${BOARD_CATEGORIES.map(c => `<option value="${esc(c.id)}" ${c.id === "to_do" ? "selected" : ""}>${esc(c.label)}</option>`).join("")}</select></div>
        <div class="field"><label for="tb-assignee">Assigned to</label>
          <select class="inp" id="tb-assignee"><option value="">Choose someone</option>
            ${S.employees.filter(e => e.active !== false).map(e => `<option value="${esc(e.id)}">${esc(e.name)}</option>`).join("")}</select></div>
      </div>
      <div class="field"><label for="tb-date">Date assigned</label>
        <input class="inp" type="date" id="tb-date" max="${todayISO()}" value="${todayISO()}"></div>
      <div id="tb-err"></div>
    </div>
    <div class="df"><span></span>
      <div class="sp"><button class="btn" data-close>Cancel</button><button class="btn pri" data-savetboard>Create task</button></div></div>
  </div>`;
}
/** Share Today's Post — "share" here means publish to the wall, not an
 *  external share sheet (there's no Web Share API use in this app). */
function goodVibesPostModal() {
  return `<div class="modal" role="dialog" aria-modal="true" aria-label="Share today's post">
    <div class="dh"><h2>Share today's post</h2><div class="sp"><button class="iconbtn" data-close>${icon("x")}</button></div></div>
    <div class="db">
      <div class="hlp">Posting as <strong>${esc(S.me.name)}</strong></div>
      <div class="field"><label for="gv-category">Category</label>
        <select class="inp" id="gv-category">${GOOD_VIBES_CATEGORIES.map(c => `<option value="${esc(c.id)}">${c.emoji} ${esc(c.label)}</option>`).join("")}</select></div>
      <div class="field"><label for="gv-body">What's on your mind?</label>
        <textarea class="inp" id="gv-body" rows="4" maxlength="2000" placeholder="Share a good thought, a win, something funny — anything positive."></textarea></div>
      <div id="gv-err"></div>
    </div>
    <div class="df"><span></span>
      <div class="sp"><button class="btn" data-close>Cancel</button><button class="btn pri" data-savegvpost>Post to the wall</button></div></div>
  </div>`;
}
/** Admin rotation management — reorder (move up/down, saves immediately,
 *  same "no separate save step" convention as Settings' data-wd), skip or
 *  reassign today. No drag-and-drop here on purpose — avoids a third global
 *  DnD listener trio alongside the Board's and Task Board's own (events.js). */
function goodVibesRotationModal() {
  const rotation = S.goodVibes.rotation || [];
  const today = S.goodVibes.today;
  // A team lead only acts on today's turn, and only when it's someone on
  // their own team — the shared rotation sequence itself (order, skip target
  // pool) stays a real manager's call (server mirror: src/routes/goodvibes.js).
  const teamLeadOnly = isTeamLead() && !isManager();
  const todaysEmp = today ? emp(today.employeeId) : null;
  const todayInMyTeam = !teamLeadOnly || (todaysEmp && sameTeamAs(todaysEmp));
  const activeEmployees = (teamLeadOnly ? visibleEmployees() : S.employees).filter(e => e.active !== false);
  const todayLocked = !today || today.post || (teamLeadOnly && !todayInMyTeam);
  return `<div class="modal wide" role="dialog" aria-modal="true" aria-label="Manage rotation">
    <div class="dh"><h2>Manage the rotation</h2><div class="sp"><button class="iconbtn" data-close>${icon("x")}</button></div></div>
    <div class="db">
      ${today ? `<div class="panel"><div class="panel-h"><h2>Today</h2></div><div class="panel-b" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <span class="cellname">${av(emp(today.employeeId), "sm")}<span class="tx">${esc(empName(today.employeeId))}</span></span>
        <span class="tag">${esc(today.status)}</span>
        <div class="sp" style="margin-left:auto;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <select class="inp" id="gv-reassign-select" style="max-width:180px" ${todayLocked ? "disabled" : ""}>${activeEmployees.map(e => `<option value="${esc(e.id)}" ${e.id === today.employeeId ? "selected" : ""}>${esc(e.name)}</option>`).join("")}</select>
          <button class="btn sm" data-gvsavereassign ${todayLocked ? "disabled" : ""}>Reassign</button>
          <button class="btn sm" data-gvskip ${todayLocked ? "disabled" : ""}>Skip today</button>
        </div>
        ${today.post ? `<div class="hlp" style="width:100%">Already posted today — can't be changed.</div>`
          : teamLeadOnly && !todayInMyTeam ? `<div class="hlp" style="width:100%">It's not someone on your team's turn today.</div>` : ""}
      </div></div>` : `<div class="empty" style="padding:14px">Today isn't a working day.</div>`}

      ${teamLeadOnly ? "" : `<div class="panel"><div class="panel-h"><h2>Order</h2></div>
        <div class="panel-b" style="display:grid;gap:6px">
          ${rotation.map((r, i) => `<div class="sr-item"${r.active ? "" : ' style="opacity:.55"'}>
            <span class="cellname">${av(emp(r.employeeId), "sm")}<span class="tx">${esc(r.name)}</span></span>
            ${r.active ? "" : `<span class="tag">inactive — skipped</span>`}
            <span class="sp" style="margin-left:auto;display:flex;gap:4px">
              <button class="btn sm" data-gvmoveup="${esc(r.employeeId)}" ${i === 0 ? "disabled" : ""} aria-label="Move up">↑</button>
              <button class="btn sm" data-gvmovedown="${esc(r.employeeId)}" ${i === rotation.length - 1 ? "disabled" : ""} aria-label="Move down">↓</button>
            </span>
          </div>`).join("") || `<div class="empty">No one in the rotation yet.</div>`}
        </div></div>`}
    </div>
    <div class="df"><span></span><div class="sp"><button class="btn pri" data-close>Done</button></div></div>
  </div>`;
}
function dependencyModal(t) {
  return `<div class="modal" role="dialog" aria-modal="true" aria-label="Add dependency">
    <div class="dh"><h2>Add a dependency</h2><div class="sp"><button class="iconbtn" data-close>${icon("x")}</button></div></div>
    <div class="db">
      <div class="hlp">${esc(t.id)} — ${esc(t.title)}</div>
      <div class="field"><label for="dp-desc">What's needed, or what must happen first?</label>
        <textarea class="inp" id="dp-desc" rows="2" placeholder="e.g. Need the new hero banner design before I can build the page"></textarea></div>
      <div class="field"><label for="dp-owner">Mention who can help</label>
        <select class="inp" id="dp-owner"><option value="">Not a specific person</option>
          ${S.employees.filter(e => e.active !== false).map(e => `<option value="${esc(e.id)}">${esc(e.name)}</option>`).join("")}</select>
        <div class="hlp">They'll get a notification that they're needed on this task.</div></div>
      <div id="dp-err"></div>
    </div>
    <div class="df"><span></span>
      <div class="sp"><button class="btn" data-close>Cancel</button><button class="btn pri" data-savedep="${esc(t.id)}">Add dependency</button></div></div>
  </div>`;
}
function progressModal(t) {
  return `<div class="modal" role="dialog" aria-modal="true" aria-label="Update progress">
    <div class="dh"><h2>Progress update</h2><div class="sp"><button class="iconbtn" data-close>${icon("x")}</button></div></div>
    <div class="db">
      <div class="hlp">${esc(t.id)} — ${esc(t.title)}</div>
      <div class="field"><span class="lbl">Progress — currently ${t.progress || 0}%</span>
        <div class="chips" id="pg-steps">${PROGRESS_STEPS.map(p => `<button class="chip" data-pg="${p}" aria-pressed="${(t.progress || 0) === p}">${p}%</button>`).join("")}</div></div>
      <div class="frow">
        <div class="field"><label for="pg-status">Status</label>
          <select class="inp" id="pg-status">${statusOptions(t.status)}</select></div>
        <div class="field"><label for="pg-hours">Total hours spent</label>
          <input class="inp" type="number" min="0" step="0.5" id="pg-hours" value="${esc(t.actualHours ?? "")}"></div>
      </div>
      <div class="frow">
        <div class="field"><label for="pg-exp">Expected completion</label><input class="inp" type="date" id="pg-exp" value="${esc(t.expectedCompletion || "")}"></div>
        <div class="field"><label for="pg-due">Due date</label><input class="inp" type="date" id="pg-due" value="${esc(t.dueDate || "")}" ${(isManager() || (isTeamLead() && sameTeamAs(t))) ? "" : "disabled"}>
          ${(isManager() || (isTeamLead() && sameTeamAs(t))) ? "" : `<div class="hlp">Only a manager can move a deadline.</div>`}</div>
      </div>
      <div class="field"><label for="pg-note">What changed? (posted as a comment)</label>
        <textarea class="inp" id="pg-note" rows="2" placeholder="Optional but useful — this is what stops the manager asking."></textarea></div>
    </div>
    <div class="df"><div class="sp"><button class="btn" data-close>Cancel</button><button class="btn pri" data-saveprogress="${esc(t.id)}">Save update</button></div></div>
  </div>`;
}
function employeeModal(e) {
  const isNew = !e;
  e = e || { id: uid("emp"), name: "", username: "", role: "employee", title: "", departmentId: cfg().departments[0] ? cfg().departments[0].id : "", teamId: "", capacityHours: 40, active: true };
  const teams = allTeams();
  // A team lead editing an existing teammate: name/title/capacity only —
  // role, active status, User ID and team assignment stay a manager's call
  // (server mirror: src/routes/admin.js PUT /employees/:id).
  const restricted = !isNew && isTeamLead() && !isManager();
  return `<div class="modal" role="dialog" aria-modal="true" aria-label="${isNew ? "Add person" : "Edit person"}">
    <div class="dh"><h2>${isNew ? "Add a person" : "Edit " + esc(e.name)}</h2><div class="sp"><button class="iconbtn" data-close>${icon("x")}</button></div></div>
    <div class="db">
      <div class="frow">
        <div class="field"><label for="ef-name">Full name</label><input class="inp" id="ef-name" value="${esc(e.name)}"></div>
        <div class="field"><label for="ef-username">User ID</label><input class="inp" type="text" id="ef-username" value="${esc(e.username || "")}" required ${isNew ? "" : 'data-touched="1"'} ${restricted ? "disabled" : ""}>
          <div class="hlp">${restricted ? "Only a manager can change this." : "This is how they sign in."}</div></div>
      </div>
      <div class="frow">
        <div class="field"><label for="ef-title">Job title</label><input class="inp" id="ef-title" value="${esc(e.title || "")}"></div>
        <div class="field"><label for="ef-role">Role in this tool</label>
          <select class="inp" id="ef-role" ${restricted ? "disabled" : ""}>
            <option value="employee" ${e.role === "employee" ? "selected" : ""}>Employee — own work only</option>
            <option value="teamlead" ${e.role === "teamlead" ? "selected" : ""}>Team Lead — manages their own team</option>
            <option value="manager" ${e.role === "manager" ? "selected" : ""}>Manager — full team access</option></select>
          ${restricted ? `<div class="hlp">Only a manager can change this.</div>` : ""}</div>
      </div>
      <div class="frow">
        <div class="field"><label for="ef-team">Department / team</label>
          <select class="inp" id="ef-team" ${restricted ? "disabled" : ""}>${teams.map(x => `<option value="${esc(x.deptId)}|${esc(x.id)}" ${e.departmentId === x.deptId && e.teamId === x.id ? "selected" : ""}>${esc(x.deptName)} / ${esc(x.name)}</option>`).join("")}</select>
          ${restricted ? `<div class="hlp">Only a manager can move someone between teams.</div>` : ""}</div>
        <div class="field"><label for="ef-cap">Weekly capacity (hours)</label><input class="inp" type="number" min="1" max="80" id="ef-cap" value="${e.capacityHours || 40}"></div>
      </div>
      <label style="display:flex;gap:8px;align-items:center;font-size:13px${restricted ? ";opacity:.55" : ""}"><input type="checkbox" id="ef-active" ${e.active !== false ? "checked" : ""} ${restricted ? "disabled" : ""}>Active — include in workload and dashboards</label>
    </div>
    <div class="df">
      ${isNew ? `<span class="hlp">They'll get a temporary password to sign in with.</span>`
              : restricted ? `<span></span>` : `<button class="btn" data-resetpw="${esc(e.id)}">Reset password</button>`}
      <div class="sp"><button class="btn" data-close>Cancel</button><button class="btn pri" data-saveemp="${esc(e.id)}" data-isnew="${isNew}">${isNew ? "Add person" : "Save"}</button></div></div>
  </div>`;
}
function projectModal(p) {
  const isNew = !p;
  p = p || { id: uid("prj"), name: "", code: "", ownerId: meId(), description: "", startDate: todayISO(), targetDate: iso(addDays(new Date(), 60)), status: "ACTIVE" };
  return `<div class="modal" role="dialog" aria-modal="true" aria-label="Project">
    <div class="dh"><h2>${isNew ? "New project" : "Edit project"}</h2><div class="sp"><button class="iconbtn" data-close>${icon("x")}</button></div></div>
    <div class="db">
      <div class="frow"><div class="field"><label for="pf-name">Project name</label><input class="inp" id="pf-name" value="${esc(p.name)}"></div>
        <div class="field"><label for="pf-code">Short code</label><input class="inp" id="pf-code" value="${esc(p.code || "")}" placeholder="SEO"></div></div>
      <div class="field"><label for="pf-desc">Description</label><textarea class="inp" id="pf-desc" rows="2">${esc(p.description || "")}</textarea></div>
      <div class="frow f3">
        <div class="field"><label for="pf-owner">Owner</label><select class="inp" id="pf-owner">${S.employees.map(e => `<option value="${esc(e.id)}" ${p.ownerId === e.id ? "selected" : ""}>${esc(e.name)}</option>`).join("")}</select></div>
        <div class="field"><label for="pf-start">Start</label><input class="inp" type="date" id="pf-start" value="${esc(p.startDate || "")}"></div>
        <div class="field"><label for="pf-target">Target</label><input class="inp" type="date" id="pf-target" value="${esc(p.targetDate || "")}"></div>
      </div>
    </div>
    <div class="df"><div class="sp"><button class="btn" data-close>Cancel</button><button class="btn pri" data-saveproj="${esc(p.id)}" data-isnew="${isNew}">${isNew ? "Create" : "Save"}</button></div></div>
  </div>`;
}
function bulkModal() {
  const n = S.selection.size;
  return `<div class="modal" role="dialog" aria-modal="true" aria-label="Bulk update">
    <div class="dh"><h2>Update ${n} task${n === 1 ? "" : "s"}</h2><div class="sp"><button class="iconbtn" data-close>${icon("x")}</button></div></div>
    <div class="db">
      <div class="hlp">Leave a field on “no change” to keep each task's existing value. Every change is written to each task's activity history.</div>
      <div class="frow">
        <div class="field"><label for="bk-assignee">Reassign to</label><select class="inp" id="bk-assignee"><option value="">No change</option>
          ${S.employees.map(e => `<option value="${esc(e.id)}">${esc(e.name)}</option>`).join("")}</select></div>
        <div class="field"><label for="bk-project">Project</label><select class="inp" id="bk-project"><option value="">No change</option>
          ${S.projects.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("")}</select></div>
      </div>
      <div class="frow f3">
        <div class="field"><label for="bk-priority">Priority</label><select class="inp" id="bk-priority"><option value="">No change</option>
          ${priorityOptions("")}</select></div>
        <div class="field"><label for="bk-status">Status</label><select class="inp" id="bk-status"><option value="">No change</option>
          ${statusOptions("", cfg().statuses.filter(s => s.id !== "BLOCKED"))}</select></div>
        <div class="field"><label for="bk-due">Due date</label><input class="inp" type="date" id="bk-due"></div>
      </div>
      <div class="field"><label for="bk-note">Add a comment to each</label><input class="inp" id="bk-note" placeholder="Optional"></div>
    </div>
    <div class="df"><div class="sp"><button class="btn" data-close>Cancel</button><button class="btn pri" data-savebulk>Apply to ${n}</button></div></div>
  </div>`;
}
function pickerModal(title, tasks, action) {
  return `<div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="dh"><h2>${esc(title)}</h2><div class="sp"><button class="iconbtn" data-close>${icon("x")}</button></div></div>
    <div class="db" style="padding:8px">${tasks.length ? tasks.map(t => `
      <button class="sr-item" data-pick="${esc(action)}:${esc(t.id)}" style="width:100%">
        ${pPill(t.priority)}<span style="flex:1;text-align:left;min-width:0">
          <span class="t" style="display:block">${esc(t.title)}</span>
          <span class="m">${esc(sChip(t.status).replace(/<[^>]+>/g, ""))} · ${t.progress || 0}% · due ${esc(fmtDate(t.dueDate))}</span></span>
      </button>`).join("") : emptyState("Nothing to pick", "You have no open tasks.")}</div>
  </div>`;
}
function breakTypeModal() {
  const used = usedBreakKindsToday(meId());
  return `<div class="modal" role="dialog" aria-modal="true" aria-label="Start a break">
    <div class="dh"><h2>Start a break</h2><div class="sp"><button class="iconbtn" data-close>${icon("x")}</button></div></div>
    <div class="db" style="padding:12px;gap:8px">${BREAK_TYPES.map(t => { const taken = used.has(t.id); return `
      <button class="break-opt" data-startbreak="${esc(t.id)}" ${taken ? "disabled" : ""}>
        <span class="break-opt-ic">${icon(taken ? "check" : "clock")}</span>
        <span style="flex:1;text-align:left;min-width:0">
          <span class="t" style="display:block">${esc(t.label)}</span>
          <span class="m">${taken ? "Already used today" : `${Math.round(t.allottedSec / 60)} min allotted`}</span></span>
      </button>`; }).join("")}</div>
  </div>`;
}
function notifModal() {
  const ns = notifications();
  S.notifSeen = Date.now(); store.set("notifSeen", S.notifSeen);
  markAllNotificationsRead();
  return `<div class="modal" role="dialog" aria-modal="true" aria-label="Notifications">
    <div class="dh"><h2>Notifications</h2><span class="hint">${ns.length}</span><div class="sp"><button class="iconbtn" data-close>${icon("x")}</button></div></div>
    <div class="db" style="padding:8px;display:grid;gap:5px">${ns.length ? ns.map(n => `
      <button class="sr-item notif" data-open="${esc(n.taskId)}" style="width:100%;align-items:flex-start">
        <span style="width:16px;text-align:center">${n.sev === 3 ? "🔴" : n.kind === "comment" ? "💬" : n.kind === "block" ? "⛔" : "•"}</span>
        <span style="flex:1;text-align:left"><span class="t" style="display:block">${esc(n.text)}</span><span class="m">${esc(fmtAgo(n.at))}</span></span>
      </button>`).join("") : emptyState("Nothing new", "You're up to date.")}</div>
  </div>`;
}
/** No close/dismiss affordance on purpose — this has to be responded to, not
 *  dismissed. The only way past it is opening a listed task (data-open),
 *  which replaces this layer with the task drawer; see the layerLocked
 *  guard on closeLayer() in drawer.js. */
function assignPopupModal({ actorName, tasks }) {
  const one = tasks.length === 1;
  return `<div class="modal" role="dialog" aria-modal="true" aria-label="Task assigned">
    <div class="dh"><h2>${one ? "New task assigned" : `${tasks.length} new tasks assigned`}</h2></div>
    <div class="db" style="display:grid;gap:8px">
      <p style="margin:0;font-size:13.5px"><strong>${esc(actorName)}</strong> assigned you ${one ? "this" : "these"} — open it to respond:</p>
      ${tasks.map(t => `<button class="sr-item notif" data-open="${esc(t.id)}" style="width:100%;align-items:flex-start">
        <span style="width:16px;text-align:center">•</span>
        <span style="flex:1;text-align:left"><span class="t" style="display:block">${esc(t.title)}</span></span>
      </button>`).join("")}
    </div>
  </div>`;
}
function accountModal() {
  const e = S.me;
  return `<div class="modal" role="dialog" aria-modal="true" aria-label="Your account">
    <div class="dh"><h2>Your account</h2><div class="sp"><button class="iconbtn" data-close>${icon("x")}</button></div></div>
    <div class="db">
      <div style="display:flex;gap:11px;align-items:center">${av(e, "lg")}
        <div><div style="font-weight:600;font-size:14px">${esc(e.name)}</div>
          <div style="font-size:12px;color:var(--ink-3)">${esc(e.username)} · ${esc(e.role === "manager" ? "Manager" : e.title || "Employee")}</div></div></div>
      <div class="panel"><div class="panel-h"><h2>Change password</h2></div>
        <div class="panel-b" style="display:grid;gap:10px">
          ${e.mustChangePassword ? `<div class="hlp" style="color:var(--warn)">You're using the temporary password you were given. Please set your own.</div>` : ""}
          <div class="field"><label for="pw-cur">Current password</label>
            <input class="inp" type="password" id="pw-cur" autocomplete="current-password"></div>
          <div class="field"><label for="pw-new">New password</label>
            <input class="inp" type="password" id="pw-new" autocomplete="new-password">
            <div class="hlp">At least 10 characters. Changing it signs you out on other devices.</div></div>
          <div class="field"><label for="pw-new2">Repeat new password</label>
            <input class="inp" type="password" id="pw-new2" autocomplete="new-password"></div>
          <div id="pw-err"></div>
          <button class="btn pri" data-savepw style="justify-self:start">Update password</button>
        </div></div>
      <div class="panel"><div class="panel-h"><h2>Your notifications</h2></div>
        <div class="panel-b" style="display:grid;gap:5px">
          ${NOTIFY_LABELS.map(([k, l]) => `<label style="display:flex;gap:8px;align-items:center;font-size:12.5px">
              <input type="checkbox" data-mynotify="${k}" ${(S.myNotifyPrefs || {})[k] !== undefined ? ((S.myNotifyPrefs || {})[k] ? "checked" : "") : ((cfg().notify || {})[k] ? "checked" : "")}>${esc(l)}</label>`).join("")}
          <div class="hlp">Your own setting, on top of the org default. Unchecked here but on org-wide means it's off just for you.</div>
          <label style="display:flex;gap:8px;align-items:center;font-size:12.5px;margin-top:6px;padding-top:6px;border-top:1px solid var(--line)">
            <input type="checkbox" id="desktopNotifsToggle" data-desktopnotifs ${store.get("desktopNotifs", false) ? "checked" : ""}>
            Also show a desktop notification when this tab isn't focused</label>
        </div></div>
    </div>
    <div class="df"><button class="btn dgr" data-logout>${icon("x")}Sign out</button>
      <div class="sp"><button class="btn" data-close>Close</button></div></div>
  </div>`;
}

/** Shown once, when a manager adds someone or resets their password. */
function showTempPassword(person, password) {
  openLayer(`<div class="modal" role="dialog" aria-modal="true" aria-label="Temporary password">
    <div class="dh"><h2>Temporary password for ${esc(person ? person.name : "this person")}</h2>
      <div class="sp"><button class="iconbtn" data-close>${icon("x")}</button></div></div>
    <div class="db">
      <p style="margin:0;font-size:13px">Send this to them along with the address of this site. They'll be asked to
        replace it after signing in. <strong>It is shown once</strong> — if you lose it, reset the password again.</p>
      <div class="mono" style="font-size:19px;letter-spacing:.04em;padding:13px 15px;border:1px dashed var(--accent-line);
        border-radius:var(--r-md);background:var(--accent-soft);color:var(--accent-ink);text-align:center;user-select:all">${esc(password)}</div>
      <div class="dl"><dt>Sign in with</dt><dd class="mono">${esc(person ? person.username : "")}</dd></div>
    </div>
    <div class="df"><div class="sp"><button class="btn" data-copytemp="${esc(password)}">Copy password</button>
      <button class="btn pri" data-close>Done</button></div></div>
  </div>`);
}

/* ==========================================================================
   EXPORTS
   ========================================================================== */
function doExport(kind) {
  const stamp = todayISO();
  if (kind === "tasks" || kind === "overdue" || kind === "completed" || kind === "attention") {
    let rows = visibleTasks();
    if (kind === "tasks") rows = applyFilters(rows);
    if (kind === "overdue") rows = rows.filter(t => isActive(t) && flags(t).overdue);
    if (kind === "completed") rows = rows.filter(t => t.status === "COMPLETED");
    if (kind === "attention") rows = rows.filter(t => isActive(t) && attention(t).length);
    const head = ["Task ID", "Title", "Employee", "Department", "Team", "Project", "Category", "Priority", "Status", "Progress %",
      "Created", "Start", "Due", "Expected", "Completed", "Last updated", "Estimated h", "Actual h", "Remaining h",
      "Overdue days", "Blocked", "Blocker", "Needs manager", "Attention reasons", "Tags"];
    const body = sortTasks(rows).map(t => { const f = flags(t);
      return [t.id, t.title, empName(t.assigneeId), deptName(t.departmentId), teamName(t.departmentId, t.teamId), projName(t.projectId), t.category,
        prio(t.priority).label, stat(t.status).label, t.progress || 0,
        (t.createdAt || "").slice(0, 10), t.startDate || "", t.dueDate || "", t.expectedCompletion || "", (t.completedAt || "").slice(0, 10),
        (t.updatedAt || "").slice(0, 16).replace("T", " "), t.estimatedHours ?? "", t.actualHours ?? "", Math.round(f.remainingHours * 10) / 10,
        f.overdue ? f.daysOverdue : 0, f.blocked ? "Yes" : "No", (t.blocker || {}).reason || "", f.needsManager ? "Yes" : "No",
        attention(t).map(a => a.text).join(" | "), (t.tags || []).join(" ")];
    });
    return downloadCSV(`${kind}-${stamp}.csv`, [head, ...body]);
  }
  if (kind === "workload" || kind === "team" || kind === "working") {
    const head = ["Employee", "Title", "Department", "Team", "Active tasks", "Critical", "High", "Medium", "Low", "Due today", "Overdue", "Blocked",
      "No recent update", "Completed this week", "Remaining hours", "Workload score", "Workload band", "Delivery health", "On-time %", "Current task", "Current status", "Current progress %", "Last update"];
    const body = S.employees.map(e => { const w = workload(e.id), d = delivery(e.id, 4), c = currentTasks(e.id, 1)[0];
      return [e.name, e.title || "", deptName(e.departmentId), teamName(e.departmentId, e.teamId), w.active, w.critical, w.high, w.medium, w.low,
        w.dueToday, w.overdue, w.blocked, w.stale, w.completedWeek, w.remainingHours, w.score, w.band,
        d.score == null ? "" : d.score + (d.reliable ? "" : "*"), d.stats.onTimeRate == null ? "" : d.stats.onTimeRate,
        c ? c.title : "", c ? stat(c.status).label : "", c ? (c.progress || 0) : "", c ? (c.updatedAt || "").slice(0, 16).replace("T", " ") : ""];
    });
    return downloadCSV(`team-workload-${stamp}.csv`, [head, ...body]);
  }
  if (kind === "blockers") {
    const rows = visibleTasks().filter(t => isActive(t) && flags(t).blocked);
    const head = ["Employee", "Task ID", "Task", "Priority", "Project", "Blocker", "Cause", "Responsible", "Blocked since", "Days blocked", "Expected resolution", "Manager action required"];
    return downloadCSV(`blockers-${stamp}.csv`, [head, ...rows.map(t => { const f = flags(t), b = t.blocker || {};
      return [empName(t.assigneeId), t.id, t.title, prio(t.priority).label, projName(t.projectId), b.reason || "", b.cause || "",
        b.ownerId ? empName(b.ownerId) : "", b.since || "", f.blockedDays, b.expectedResolution || "", b.needsManager ? "Yes" : "No"]; })]);
  }
  if (kind === "weekly") {
    const s0 = addDays(startOfWeek(new Date()), S.analyticsWeek * 7), s1 = addDays(s0, 7);
    const ts = visibleTasks();
    const cur = periodStats(s0, s1, ts), prev = periodStats(addDays(s0, -7), s0, ts);
    const out = [["Weekly management report", `${iso(s0)} to ${iso(addDays(s1, -1))}`], [],
      ["Metric", "This week", "Previous week"],
      ["Tasks created", cur.created, prev.created], ["Tasks completed", cur.completed, prev.completed],
      ["Carried forward", cur.carried, prev.carried], ["Overdue", cur.overdue, prev.overdue],
      ["Cancelled", cur.cancelled, prev.cancelled], ["Blocked", cur.blocked, prev.blocked],
      ["Completion rate %", cur.completionRate, prev.completionRate], ["On-time rate %", cur.onTimeRate ?? "", prev.onTimeRate ?? ""],
      ["Avg completion days", cur.avgCycle ?? "", prev.avgCycle ?? ""], ["Avg delay days", cur.avgDelay ?? "", prev.avgDelay ?? ""], [],
      ["Employee", "Created", "Completed", "Break time (min)", "Overdue now", "Blocked now", "Carried", "Completion %", "On-time %", "Avg completion days", "Workload band", "Workload score"]];
    S.employees.forEach(e => { const mine = ts.filter(t => t.assigneeId === e.id), c = periodStats(s0, s1, mine), w = workload(e.id);
      const brkMin = Math.round(totalBreakSeconds(e.id, iso(s0), iso(s1)) / 60);
      out.push([e.name, c.created, c.completed, brkMin, w.overdue, w.blocked, c.carried, c.completionRate, c.onTimeRate ?? "", c.avgCycle ?? "", w.band, w.score]); });
    return downloadCSV(`weekly-report-${iso(s0)}.csv`, out);
  }
  if (kind === "daily") return saveFile(`daily-summary-${stamp}.txt`, summaryText());
}
