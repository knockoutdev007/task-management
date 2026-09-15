"use strict";
/* ==========================================================================
   LAYERS — drawer, modals
   ========================================================================== */
const L = () => $("#layer");
/** True while the open layer must be responded to, not dismissed (the
 *  assignment popup) — closeLayer() becomes a no-op until something replaces
 *  the layer outright (opening a task calls openLayer() directly, which
 *  clears the lock), so Escape, the scrim, nav clicks etc. can't skip it. */
let layerLocked = false;
function closeLayer() {
  if (layerLocked) return;
  L().innerHTML = ""; document.body.style.overflow = ""; S.openTask = null; maybeShowAssignPopup();
}
function openLayer(html, locked = false) {
  layerLocked = !!locked;
  L().innerHTML = `<div class="scrim"${locked ? "" : " data-close"}></div>${html}`;
  document.body.style.overflow = "hidden";
  const first = L().querySelector("input,select,textarea,button:not([data-close])");
  if (first) setTimeout(() => first.focus(), 30);
}

/** A task-assignment popup stays open until the person responds to it —
 *  see layerLocked above — so it's queued rather than shown as a toast, and
 *  held back if some other layer (an edit form, another modal) is already
 *  open, so it can't clobber unsaved work. Multiple assignments while away
 *  are queued and shown one at a time. */
function queueAssignPopup(actorName, tasks) {
  S.assignQueue.push({ actorName, tasks });
  maybeShowAssignPopup();
}
function maybeShowAssignPopup() {
  if (L().innerHTML || !S.assignQueue.length) return;
  openLayer(assignPopupModal(S.assignQueue.shift()), true);
}

/* --------------------------------------------------------- task drawer */
let drawerTab = "details";
function openTask(id, tab) {
  const t = S.tasks.find(x => x.id === id); if (!t) return;
  S.openTask = id; if (tab) drawerTab = tab;
  renderDrawer();
}
function renderDrawer() {
  const t = S.tasks.find(x => x.id === S.openTask); if (!t) return closeLayer();
  const f = flags(t), a = attention(t), editable = canEdit(t);
  const body = {
    details: drawerDetails, activity: drawerActivity, comments: drawerComments, resources: drawerResources
  }[drawerTab](t, f, editable);
  openLayer(`<aside class="drawer" role="dialog" aria-modal="true" aria-label="${esc(t.title)}">
    <div class="dh">
      <div style="min-width:0">
        <div style="display:flex;gap:7px;align-items:center;flex-wrap:wrap">
          <span class="mono" style="font-size:10.5px;color:var(--ink-4)">${esc(t.id)}</span>${pPill(t.priority)}${sChip(t.status)}
        </div>
        <h2 style="margin-top:3px">${esc(t.title)}</h2>
      </div>
      <div class="sp">
        ${editable ? `<button class="btn" data-edittask="${esc(t.id)}">${icon("edit")}Edit</button>` : `<span class="tag">read only</span>`}
        <button class="iconbtn" data-close aria-label="Close">${icon("x")}</button>
      </div>
    </div>
    ${a.length ? `<div style="padding:9px 16px;background:var(--crit-soft);border-bottom:1px solid var(--crit-line)">
      ${a.map(r => `<div class="reason r${r.sev}"><span class="ic">${r.ic}</span><span>${esc(r.text)}</span></div>`).join("")}</div>` : ""}
    <div class="tabs" style="padding:0 16px;background:var(--surface)">
      ${[["details", "Details"], ["activity", `Activity (${(t.activity || []).length})`], ["comments", `Comments (${(t.comments || []).length})`], ["resources", `Resources (${(t.links || []).length + (t.attachments || []).length})`]]
        .map(([k, l]) => `<button class="tab" data-tab="${k}" aria-selected="${drawerTab === k}">${esc(l)}</button>`).join("")}
    </div>
    <div class="db">${body}</div>
    ${editable && !isClosed(t) ? `<div class="df">
      <button class="btn" data-quickprog="${esc(t.id)}">${icon("chart")}Update progress</button>
      <button class="btn" data-blockit="${esc(t.id)}">${icon("ban")}${f.blocked ? "Edit blocker" : "Report blocker"}</button>
      <div class="sp">${canComplete(t) ? `<button class="btn pri" data-complete="${esc(t.id)}">${icon("check")}Mark complete</button>` : ""}</div>
    </div>` : isClosed(t) && editable ? `<div class="df"><span class="hlp">Completed ${esc(fmtDate(t.completedAt, { absolute: true }))}</span>
      <div class="sp"><button class="btn" data-reopen="${esc(t.id)}">Reopen</button></div></div>` : ""}
  </aside>`);
}
function drawerDetails(t, f, editable) {
  const dep = t.dependencies || [];
  return `
  <div class="panel"><div class="panel-b" style="display:grid;gap:12px">
    <div>${t.description ? `<div style="font-size:13px;white-space:pre-wrap;color:var(--ink-2)">${esc(t.description)}</div>` : `<div class="hlp">No description.</div>`}</div>
    <div style="display:flex;gap:10px;align-items:center">${pBar(t)}
      ${editable && !isClosed(t) ? `<div class="chips" style="margin-left:auto">${PROGRESS_STEPS.map(p => `<button class="chip" data-setprog="${t.id}:${p}" aria-pressed="${(t.progress || 0) === p}">${p}%</button>`).join("")}</div>` : ""}</div>
  </div></div>

  <div class="panel"><div class="panel-h"><h2>Assignment</h2></div><div class="panel-b">
    <dl class="dl" style="grid-template-columns:130px 1fr">
      <dt>Assigned to</dt><dd>${personCell(t.assigneeId)}</dd>
      <dt>Created by</dt><dd>${esc(empName(t.createdById))} · ${esc(fmtDate(t.createdAt, { absolute: true }))}</dd>
      <dt>Department</dt><dd>${esc(deptName(t.departmentId))} / ${esc(teamName(t.departmentId, t.teamId))}</dd>
      <dt>Project</dt><dd>${esc(projName(t.projectId))}</dd>
      <dt>Category</dt><dd>${esc(t.category || "—")}</dd>
      <dt>Tags</dt><dd>${(t.tags || []).length ? t.tags.map(g => `<span class="tag">${esc(g)}</span>`).join(" ") : "—"}</dd>
    </dl></div></div>

  <div class="panel"><div class="panel-h"><h2>Schedule and effort</h2></div><div class="panel-b">
    <dl class="dl" style="grid-template-columns:130px 1fr">
      <dt>Start</dt><dd>${esc(fmtDate(t.startDate, { absolute: true }))}</dd>
      <dt>Due</dt><dd style="${f.overdue ? "color:var(--crit);font-weight:600" : ""}">${esc(fmtDate(t.dueDate, { absolute: true }))}${f.overdue ? ` · ${f.daysOverdue} day${f.daysOverdue === 1 ? "" : "s"} overdue` : f.dueToday ? " · today" : ""}</dd>
      <dt>Expected completion</dt><dd style="${f.expectedPassed ? "color:var(--warn)" : ""}">${esc(fmtDate(t.expectedCompletion, { absolute: true }))}</dd>
      <dt>Actual completion</dt><dd>${esc(fmtDate(t.completedAt, { absolute: true }))}</dd>
      <dt>Last updated</dt><dd style="${f.stale ? "color:var(--warn);font-weight:600" : ""}">${esc(fmtAgo(t.updatedAt))} — ${esc(fmtDT(t.updatedAt))}</dd>
      <dt>Estimated effort</dt><dd class="mono">${fmtH(t.estimatedHours)}</dd>
      <dt>Time spent</dt><dd class="mono">${fmtH(t.actualHours)}${f.overrun ? ` <span style="color:var(--warn)">· ${f.overrun}% over</span>` : ""}</dd>
      <dt>Remaining</dt><dd class="mono">${fmtH(f.remainingHours)}</dd>
    </dl></div></div>

  ${f.blocked && t.blocker ? `<div class="panel" style="border-color:var(--block-line)">
    <div class="panel-h" style="background:var(--block-soft)"><h2 style="color:var(--block)">Blocker</h2>
      <div class="sp"><button class="btn sm" data-unblock="${esc(t.id)}">Resolve</button></div></div>
    <div class="panel-b"><dl class="dl" style="grid-template-columns:130px 1fr">
      <dt>What</dt><dd>${esc(t.blocker.reason || "")}</dd>
      <dt>Caused by</dt><dd>${esc(t.blocker.cause || (t.blocker.ownerId ? empName(t.blocker.ownerId) : "—"))}</dd>
      <dt>Since</dt><dd>${esc(fmtDate(t.blocker.since, { absolute: true }))} · ${f.blockedDays} day${f.blockedDays === 1 ? "" : "s"}</dd>
      <dt>Expected clear</dt><dd>${esc(fmtDate(t.blocker.expectedResolution, { absolute: true }))}</dd>
      <dt>Manager needed</dt><dd>${t.blocker.needsManager ? `<span class="pill p-CRITICAL">Yes</span>` : "No"}</dd>
    </dl></div></div>` : ""}

  <div class="panel"><div class="panel-h"><h2>Dependencies</h2>
    ${editable ? `<div class="sp"><button class="btn sm" data-adddep="${esc(t.id)}">${icon("plus")}Add</button></div>` : ""}</div>
    <div class="panel-b flush">${dep.length ? `<table class="t"><thead><tr><th>Depends on</th><th>Owner</th><th>Status</th><th></th></tr></thead><tbody>
      ${dep.map((d, i) => `<tr><td>${d.taskId && S.tasks.find(x => x.id === d.taskId) ? taskLink(S.tasks.find(x => x.id === d.taskId)) : esc(d.description || "—")}</td>
        <td style="font-size:11.5px">${esc(d.ownerId ? empName(d.ownerId) : d.owner || "—")}</td>
        <td><span class="pill ${d.status === "RESOLVED" ? "p-LOW" : "p-HIGH"}">${esc(d.status === "RESOLVED" ? "Resolved" : "Open")}</span></td>
        <td class="r">${editable ? `<button class="btn sm" data-toggledep="${t.id}:${i}">${d.status === "RESOLVED" ? "Reopen" : "Resolve"}</button>
          <button class="btn sm dgr" data-deldep="${t.id}:${i}">${icon("x")}</button>` : ""}</td></tr>`).join("")}
      </tbody></table>` : `<div class="empty" style="padding:14px">Nothing blocking this task's start.</div>`}</div></div>`;
}
function drawerActivity(t) {
  const acts = (t.activity || []).slice().reverse();
  return `<div class="panel"><div class="panel-h"><h2>Activity history</h2><span class="hint">${acts.length} recorded change${acts.length === 1 ? "" : "s"}</span></div>
    <div class="panel-b"><div class="tl">${acts.map(a => `
      <div class="tl-i k-${esc(a.kind)}"><div class="tl-d"></div><div class="tl-c">
        <div class="ts">${esc(fmtDT(a.at))}</div>
        <div class="ln"><strong>${esc(a.byName || empName(a.byId) || "System")}</strong>
          ${a.field ? ` changed ${esc(FIELD_LABELS[a.field] || a.field)}` : a.kind === "create" ? " created this task" : a.kind === "comment" ? " commented" : ` · ${esc(a.kind)}`}</div>
        ${a.field ? `<div class="chg"><span class="from">${esc(fmtVal(a.field, a.from))}</span> → <span class="to">${esc(fmtVal(a.field, a.to))}</span></div>` : ""}
        ${a.note ? `<div style="font-size:12px;color:var(--ink-3)">${esc(a.note)}</div>` : ""}
      </div></div>`).join("") || `<div class="empty">No recorded changes.</div>`}</div></div></div>`;
}
function fmtVal(field, v) {
  if (v == null || v === "") return "empty";
  if (field === "assigneeId") return empName(v);
  if (field === "projectId") return projName(v);
  if (field === "priority") return prio(v).label;
  if (field === "status") return stat(v).label;
  if (field === "progress") return v + "%";
  if (/Date|Completion/.test(field)) return fmtDate(v, { absolute: true });
  return String(v).length > 60 ? String(v).slice(0, 60) + "…" : String(v);
}
function drawerComments(t) {
  const cs = t.comments || [];
  return `<div class="panel"><div class="panel-h"><h2>Comments</h2></div>
    <div class="panel-b">
      ${cs.map(c => {
        const e = emp(c.authorId);
        const body = esc(c.body).replace(/@([A-Za-z][\w.'-]*(?:\s[A-Z][\w.'-]*)?)/g, (m, n) => S.employees.some(x => x.name.toLowerCase().startsWith(n.toLowerCase())) ? `<span class="mention">@${n}</span>` : m);
        return `<div class="cmt ${c.managerNote ? "mgr" : ""}">${av(e, "sm")}<div>
          <div class="ch"><span class="cn">${esc(e ? e.name : "Unknown")}</span><span class="ct">${esc(fmtDT(c.at))}</span>${c.managerNote ? `<span class="tag">manager note</span>` : ""}</div>
          <div class="cb">${body}</div></div></div>`;
      }).join("") || `<div class="empty" style="padding:14px">No comments yet.</div>`}
      <div style="display:grid;gap:7px;margin-top:11px;border-top:1px solid var(--line-soft);padding-top:11px">
        <div style="position:relative">
          <textarea class="inp" id="cmt-body" rows="2" placeholder="Add a comment. Type @ to mention someone." style="width:100%"></textarea>
          <div id="mentionPop" class="searchpop" hidden></div>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          ${isManager() ? `<label style="font-size:11.5px;display:flex;gap:5px;align-items:center"><input type="checkbox" id="cmt-mgr">Flag as manager note</label>` : ""}
          <button class="btn pri" data-addcmt="${esc(t.id)}" style="margin-left:auto">Post comment</button>
        </div>
      </div>
    </div></div>`;
}
function drawerResources(t) {
  const links = t.links || [];
  const files = t.attachments || [];
  return `<div class="panel"><div class="panel-h"><h2>Links</h2>
    ${canEdit(t) ? `<div class="sp"><button class="btn sm" data-addlink="${esc(t.id)}">${icon("plus")}Add link</button></div>` : ""}</div>
    <div class="panel-b flush">${links.length ? links.map((l, i) => `<div class="sr-item" style="border-radius:0;border-bottom:1px solid var(--line-soft)">
      <span style="flex:1;min-width:0"><span class="t"><a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.label || l.url)}</a></span>
      <span class="m" style="word-break:break-all">${esc(l.url)}</span></span>
      ${canEdit(t) ? `<button class="btn sm dgr" data-dellink="${t.id}:${i}">${icon("x")}</button>` : ""}</div>`).join("")
      : `<div class="empty" style="padding:16px">No links yet. Paste a Drive doc, a ticket, a screenshot URL or a staging link.</div>`}</div></div>

  <div class="panel"><div class="panel-h"><h2>Attachments</h2>
    <div class="sp"><label class="btn sm" style="cursor:pointer">${icon("plus")}Send a file
      <input type="file" data-fileinput="${esc(t.id)}" style="position:absolute;width:1px;height:1px;opacity:0;overflow:hidden"></label></div></div>
    <div class="panel-b flush">${files.length ? files.map(f => `<div class="sr-item" style="border-radius:0;border-bottom:1px solid var(--line-soft)">
      <span style="flex:1;min-width:0"><span class="t">${esc(f.name)}</span>
      <span class="m">${fmtBytes(f.size)} · ${esc(empName(f.uploadedById))} · ${esc(fmtDate(f.uploadedAt, { absolute: true }))}</span></span>
      <a class="btn sm" href="/api/tasks/${esc(t.id)}/attachments/${esc(f.id)}" target="_blank" rel="noopener noreferrer">${icon("dl")}</a>
      ${(f.uploadedById === meId() || canEdit(t)) ? `<button class="btn sm dgr" data-delatt="${t.id}:${f.id}">${icon("x")}</button>` : ""}</div>`).join("")
      : `<div class="empty" style="padding:16px">No files yet. Images, PDFs, docs, sheets, slides, text, zip, audio or video — up to 25MB.</div>`}</div></div>`;
}

/* ------------------------------------------------------------- task form */
function taskForm(existing, presetAssignee) {
  const t = existing || {
    id: nextTaskId(), title: "", description: "", assigneeId: presetAssignee || (isManager() ? "" : meId()),
    createdById: meId(), departmentId: "", teamId: "", projectId: "", category: "",
    priority: "MEDIUM", status: "NOT_STARTED", progress: 0,
    createdAt: nowISO(), startDate: todayISO(), dueDate: iso(addDays(new Date(), cfg().defaultDueDays)),
    expectedCompletion: "", completedAt: null, updatedAt: nowISO(),
    estimatedHours: "", actualHours: "", tags: [], comments: [], activity: [], dependencies: [], links: [], blocker: null, reopenCount: 0
  };
  const isNew = !existing;
  const teams = allTeams();
  return `<div class="modal wide" role="dialog" aria-modal="true" aria-label="${isNew ? "New task" : "Edit task"}">
    <div class="dh"><h2>${isNew ? "New task" : "Edit " + esc(t.id)}</h2>
      <div class="sp"><button class="iconbtn" data-close aria-label="Close">${icon("x")}</button></div></div>
    <div class="db">
      <div class="field"><label for="tf-title">Task title</label>
        <input class="inp" id="tf-title" value="${esc(t.title)}" placeholder="What needs to happen?"></div>
      <div class="field"><label for="tf-desc">Description</label>
        <textarea class="inp" id="tf-desc" rows="3" placeholder="Detail, acceptance criteria, links to context.">${esc(t.description || "")}</textarea></div>
      <div class="frow f3">
        <div class="field"><label for="tf-assignee">Assigned to</label>
          <select class="inp" id="tf-assignee" ${isManager() ? "" : "disabled"}>
            <option value="">Unassigned</option>
            ${S.employees.map(e => `<option value="${esc(e.id)}" ${t.assigneeId === e.id ? "selected" : ""}>${esc(e.name)}</option>`).join("")}</select>
          ${isManager() ? "" : `<div class="hlp">Only a manager can assign work to someone else.</div>`}</div>
        <div class="field"><label for="tf-project">Project</label>
          <select class="inp" id="tf-project"><option value="">None</option>
            ${S.projects.map(p => `<option value="${esc(p.id)}" ${t.projectId === p.id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></div>
        <div class="field"><label for="tf-category">Category</label>
          <select class="inp" id="tf-category"><option value="">—</option>
            ${(cfg().categories || []).map(c => `<option value="${esc(c)}" ${t.category === c ? "selected" : ""}>${esc(c)}</option>`).join("")}</select></div>
      </div>
      <div class="frow f3">
        <div class="field"><label for="tf-team">Department / team</label>
          <select class="inp" id="tf-team">
            <option value="">Follow the assignee</option>
            ${teams.map(x => `<option value="${esc(x.deptId)}|${esc(x.id)}" ${t.departmentId === x.deptId && t.teamId === x.id ? "selected" : ""}>${esc(x.deptName)} / ${esc(x.name)}</option>`).join("")}</select></div>
        <div class="field"><label for="tf-priority">Priority</label>
          <select class="inp" id="tf-priority">${cfg().priorities.map(p => `<option value="${esc(p.id)}" ${t.priority === p.id ? "selected" : ""}>${esc(p.label)}</option>`).join("")}</select></div>
        <div class="field"><label for="tf-status">Status</label>
          <select class="inp" id="tf-status">${cfg().statuses.map(s => `<option value="${esc(s.id)}" ${t.status === s.id ? "selected" : ""}>${esc(s.label)}</option>`).join("")}</select></div>
      </div>
      <div class="frow f3">
        <div class="field"><label for="tf-start">Start date</label><input class="inp" type="date" id="tf-start" value="${esc(t.startDate || "")}"></div>
        <div class="field"><label for="tf-due">Due date</label><input class="inp" type="date" id="tf-due" value="${esc(t.dueDate || "")}"></div>
        <div class="field"><label for="tf-exp">Expected completion</label><input class="inp" type="date" id="tf-exp" value="${esc(t.expectedCompletion || "")}">
          <div class="hlp">Required for critical tasks.</div></div>
      </div>
      <div class="frow f3">
        <div class="field"><label for="tf-est">Estimated effort (hours)</label><input class="inp" type="number" min="0" step="0.5" id="tf-est" value="${esc(t.estimatedHours ?? "")}"></div>
        <div class="field"><label for="tf-act">Time spent (hours)</label><input class="inp" type="number" min="0" step="0.5" id="tf-act" value="${esc(t.actualHours ?? "")}"></div>
        <div class="field"><label for="tf-prog">Progress</label>
          <select class="inp" id="tf-prog">${PROGRESS_STEPS.map(p => `<option value="${p}" ${(t.progress || 0) === p ? "selected" : ""}>${p}%</option>`).join("")}</select></div>
      </div>
      <div class="frow">
        <div class="field"><label for="tf-tags">Tags (comma separated)</label><input class="inp" id="tf-tags" value="${esc((t.tags || []).join(", "))}"></div>
        <div class="field"><label for="tf-completed">Actual completion date</label><input class="inp" type="date" id="tf-completed" value="${esc((t.completedAt || "").slice(0, 10))}">
          <div class="hlp">Set automatically when you mark a task complete.</div></div>
      </div>
      <div id="tf-errors"></div>
    </div>
    <div class="df">
      ${!isNew && isManager() ? `<button class="btn dgr" data-deltask="${esc(t.id)}">Delete task</button>` : ""}
      <div class="sp"><button class="btn" data-close>Cancel</button>
        <button class="btn pri" data-savetask="${esc(t.id)}" data-isnew="${isNew}">${isNew ? "Create task" : "Save changes"}</button></div>
    </div>
  </div>`;
}
function readTaskForm(base) {
  const t = clone(base);
  const teamVal = $("#tf-team").value;
  t.title = $("#tf-title").value.trim();
  t.description = $("#tf-desc").value.trim();
  t.assigneeId = $("#tf-assignee").value;
  t.projectId = $("#tf-project").value;
  t.category = $("#tf-category").value;
  if (teamVal) { const [d, tm] = teamVal.split("|"); t.departmentId = d; t.teamId = tm; }
  else { const e = emp(t.assigneeId); t.departmentId = e ? e.departmentId : ""; t.teamId = e ? e.teamId : ""; }
  t.priority = $("#tf-priority").value;
  t.status = $("#tf-status").value;
  t.startDate = $("#tf-start").value || null;
  t.dueDate = $("#tf-due").value || null;
  t.expectedCompletion = $("#tf-exp").value || null;
  t.estimatedHours = $("#tf-est").value === "" ? null : Number($("#tf-est").value);
  t.actualHours = $("#tf-act").value === "" ? null : Number($("#tf-act").value);
  t.progress = Number($("#tf-prog").value);
  t.tags = $("#tf-tags").value.split(",").map(s => s.trim()).filter(Boolean);
  const cd = $("#tf-completed").value;
  if (t.status === "COMPLETED") { t.progress = 100; t.completedAt = cd ? cd + "T12:00:00.000Z" : nowISO(); }
  else if (cd) t.completedAt = cd + "T12:00:00.000Z";
  else t.completedAt = null;
  if (t.status !== "BLOCKED" && t.blocker && !t.blocker.resolvedAt) t.blocker = null;
  return t;
}
function showErrors(errs) {
  const box = $("#tf-errors"); if (!box) return;
  const keys = Object.keys(errs);
  box.innerHTML = keys.length ? `<div class="banner" style="margin:0">${icon("alert")}<span><strong>Fix these before saving:</strong><br>${keys.map(k => esc(errs[k])).join("<br>")}</span></div>` : "";
  const map = { title: "#tf-title", assigneeId: "#tf-assignee", progress: "#tf-prog", dueDate: "#tf-due", expectedCompletion: "#tf-exp", estimatedHours: "#tf-est" };
  Object.values(map).forEach(s => { const el = $(s); if (el) el.classList.remove("err"); });
  keys.forEach(k => { const el = map[k] && $(map[k]); if (el) el.classList.add("err"); });
}
