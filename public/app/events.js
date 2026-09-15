"use strict";
/* ==========================================================================
   EVENTS
   ========================================================================== */
function go(view) { S.view = view; store.set("view", view); S.empDetail = null; S.projDetail = null; closeLayer(); render(); $("#view").focus(); }
function setFilterFromKpi(spec) {
  if (!spec) return;
  const [k, v] = spec.split(":");
  S.filters = { assignee: "", dept: "", team: "", project: "", priority: "", status: "", flag: "", due: "", search: "", completed: "" };
  if (k === "flag") S.filters.flag = v;
  if (k === "due") { S.filters.due = v; S.filters.flag = "active"; }
  if (k === "status") S.filters.status = v;
  if (k === "completed") S.filters.completed = v;
  if (!isManager()) S.filters.assignee = meId();
  go("tasks");
}

document.addEventListener("click", async ev => {
  const el = ev.target.closest("[data-newtask],[data-view],[data-go],[data-kpi],[data-open],[data-close],[data-tab],[data-account],[data-savepw],[data-logout],[data-copytemp],[data-resetpw],[data-emp],[data-proj],[data-projtasks],[data-newfor],[data-newemp],[data-editemp],[data-newproj],[data-delproj],[data-edittask],[data-savetask],[data-deltask],[data-complete],[data-reopen],[data-blockit],[data-saveblocker],[data-unblock],[data-quickprog],[data-saveprogress],[data-pg],[data-setprog],[data-addcmt],[data-addlink],[data-savelink],[data-dellink],[data-delatt],[data-adddep],[data-savedep],[data-toggledep],[data-deldep],[data-saveemp],[data-saveproj],[data-bulk],[data-savebulk],[data-quick],[data-pick],[data-export],[data-week],[data-clearfilters],[data-blockfilter],[data-sort],[data-copysummary],[data-saveupdate],[data-prefill],[data-adddept],[data-deldept],[data-addteam],[data-delteam],[data-addstatus],[data-delstatus],[data-wd]");
  if (!el) return;
  const d = el.dataset;

  /* ---- navigation ---- */
  if ("newtask" in d) return openLayer(taskForm(null, isManager() ? "" : meId()));
  if (d.view) return go(d.view);
  if (d.go) return go(d.go);
  if ("kpi" in d) { if (d.kpi) setFilterFromKpi(d.kpi); return; }
  if ("close" in d) return closeLayer();
  if (d.tab) { drawerTab = d.tab; return renderDrawer(); }
  if ("account" in d) return openLayer(accountModal());
  if ("logout" in d) return logout();
  if (d.resetpw) return resetPassword(d.resetpw);
  if (d.copytemp) {
    try { await navigator.clipboard.writeText(d.copytemp); toast("Password copied"); }
    catch { toast("Select the password and copy it manually.", true); }
    return;
  }
  if ("savepw" in d) {
    const cur = $("#pw-cur").value, a = $("#pw-new").value, b = $("#pw-new2").value;
    const err = m => { $("#pw-err").innerHTML = `<div class="hlp err">${esc(m)}</div>`; };
    if (a.length < 10) return err("Use at least 10 characters.");
    if (a !== b) return err("The two new passwords don't match.");
    const problem = await changePassword(cur, a);
    if (problem) return err(problem);
    S.me.mustChangePassword = false;
    closeLayer(); render(); toast("Password updated");
    return;
  }
  if ("emp" in d) { S.empDetail = d.emp || null; S.view = "team"; store.set("view", "team"); closeLayer(); return render(); }
  if ("proj" in d) { S.projDetail = d.proj || null; S.view = "projects"; store.set("view", "projects"); closeLayer(); return render(); }
  if (d.projtasks) { S.filters = Object.assign({}, S.filters, { project: d.projtasks }); return go("tasks"); }
  if (d.week != null && d.week !== "") {
    S.analyticsWeek = d.week === "0" ? 0 : Math.min(0, S.analyticsWeek + Number(d.week));
    return render();
  }
  if ("clearfilters" in d) { S.filters = { assignee: "", dept: "", team: "", project: "", priority: "", status: "", flag: "", due: "", search: "", completed: "", minProgress: "", maxProgress: "" }; return render(); }
  if (d.blockfilter) { S.filters.flag = S.filters.flag === "manager" ? "" : "manager"; return render(); }
  if (d.sort) { if (S.sort.key === d.sort) S.sort.dir *= -1; else S.sort = { key: d.sort, dir: 1 }; return render(); }
  if (d.export) return doExport(d.export);
  if ("copysummary" in d) {
    try { await navigator.clipboard.writeText(summaryText()); toast("Summary copied to clipboard"); }
    catch { doExport("daily"); }
    return;
  }

  /* ---- task open / create / edit ---- */
  if (d.open) return openTask(d.open);
  if (d.newfor) { openLayer(taskForm(null, d.newfor)); return; }
  if (d.edittask) { const t = S.tasks.find(x => x.id === d.edittask); if (t) openLayer(taskForm(t)); return; }

  if (d.savetask) {
    const isNew = d.isnew === "true";
    const base = isNew ? { id: d.savetask, createdById: meId(), createdAt: nowISO(), comments: [], activity: [], dependencies: [], links: [], blocker: null, reopenCount: 0, tags: [] }
                       : S.tasks.find(x => x.id === d.savetask);
    if (!base) return;
    const t = readTaskForm(base);
    const errs = validateTask(t);
    if (Object.keys(errs).length) { showErrors(errs); return; }
    if (!isNew && !canEdit(base)) { toast("You can only change your own tasks.", true); return; }
    await saveTask(t);
    closeLayer(); toast(isNew ? "Task created — " + t.id : "Saved");
    if (!isNew) openTask(t.id);
    return;
  }
  if (d.deltask) {
    if (!isManager()) return toast("Only a manager can delete a task.", true);
    if (!confirm("Delete this task permanently? Its history goes too.")) return;
    if (await deleteTaskRemote(d.deltask)) { closeLayer(); toast("Task deleted"); }
    return;
  }

  /* ---- status shortcuts ---- */
  if (d.complete) {
    const t = S.tasks.find(x => x.id === d.complete); if (!t) return;
    if (!canComplete(t)) return toast("Only " + empName(t.assigneeId) + " or a manager can complete this task.", true);
    await saveTask(Object.assign(clone(t), { status: "COMPLETED", progress: 100, completedAt: nowISO(), blocker: t.blocker ? Object.assign(clone(t.blocker), { resolvedAt: nowISO() }) : null }));
    closeLayer(); toast("Marked complete"); return;
  }
  if (d.reopen) {
    const t = S.tasks.find(x => x.id === d.reopen); if (!t || !canEdit(t)) return;
    await saveTask(Object.assign(clone(t), { status: "IN_PROGRESS", completedAt: null, progress: Math.min(90, t.progress || 75), reopenCount: (t.reopenCount || 0) + 1 }),
      [logEntry("reopen", null, null, null, "Task reopened after completion")]);
    toast("Reopened"); return openTask(t.id);
  }
  if (d.setprog) {
    const [id, p] = d.setprog.split(":");
    const t = S.tasks.find(x => x.id === id); if (!t || !canEdit(t)) return;
    const patch = { progress: Number(p) };
    if (Number(p) === 100) { patch.status = "COMPLETED"; patch.completedAt = nowISO(); }
    else if (t.status === "NOT_STARTED" && Number(p) > 0) patch.status = "IN_PROGRESS";
    await patchTask(id, patch);
    return renderDrawer();
  }

  /* ---- blocker ---- */
  if (d.blockit) { const t = S.tasks.find(x => x.id === d.blockit); if (t) openLayer(blockerModal(t)); return; }
  if (d.saveblocker) {
    const t = S.tasks.find(x => x.id === d.saveblocker); if (!t) return;
    const reason = $("#bl-reason").value.trim();
    if (!reason) { $("#bl-err").innerHTML = `<div class="hlp err">Explain what is blocking this task — the manager acts on this text.</div>`; $("#bl-reason").classList.add("err"); return; }
    const blocker = { reason, cause: $("#bl-cause").value.trim(), ownerId: $("#bl-owner").value || null,
      since: $("#bl-since").value || todayISO(), expectedResolution: $("#bl-exp").value || null, needsManager: $("#bl-mgr").checked, resolvedAt: null };
    await saveTask(Object.assign(clone(t), { status: "BLOCKED", blocker }),
      [logEntry("block", null, null, null, "Blocker: " + reason + (blocker.needsManager ? " (manager intervention requested)" : ""))]);
    closeLayer(); toast("Blocker recorded — it's on the manager's board now"); return;
  }
  if (d.unblock) {
    const t = S.tasks.find(x => x.id === d.unblock); if (!t || !canEdit(t)) return;
    await saveTask(Object.assign(clone(t), { status: t.progress > 0 ? "IN_PROGRESS" : "NOT_STARTED", blocker: Object.assign(clone(t.blocker || {}), { resolvedAt: nowISO() }) }),
      [logEntry("unblock", null, null, null, "Blocker resolved")]);
    closeLayer(); toast("Blocker cleared"); return;
  }

  /* ---- progress modal ---- */
  if (d.quickprog) { const t = S.tasks.find(x => x.id === d.quickprog); if (t) openLayer(progressModal(t)); return; }
  if (d.pg != null && "pg" in d) { $$("#pg-steps .chip").forEach(c => c.setAttribute("aria-pressed", c.dataset.pg === d.pg)); return; }
  if (d.saveprogress) {
    const t = S.tasks.find(x => x.id === d.saveprogress); if (!t) return;
    const sel = $("#pg-steps .chip[aria-pressed='true']");
    const p = sel ? Number(sel.dataset.pg) : (t.progress || 0);
    const patch = { progress: p, status: $("#pg-status").value, expectedCompletion: $("#pg-exp").value || null };
    if ($("#pg-hours").value !== "") patch.actualHours = Number($("#pg-hours").value);
    if (isManager() && $("#pg-due").value) patch.dueDate = $("#pg-due").value;
    if (patch.status === "COMPLETED") { patch.progress = 100; patch.completedAt = nowISO(); }
    if (patch.status === "BLOCKED" && !(t.blocker && t.blocker.reason)) { toast("Use “Report blocker” so the reason is captured.", true); return; }
    const note = $("#pg-note").value.trim();
    const t2 = Object.assign(clone(t), patch);
    if (note) t2.comments = (t2.comments || []).concat([{ id: uid("c"), authorId: meId(), at: nowISO(), body: note, managerNote: false }]);
    const errs = validateTask(t2);
    if (Object.keys(errs).length) { toast(Object.values(errs)[0], true); return; }
    await saveTask(t2, note ? [logEntry("comment", null, null, null, note)] : []);
    closeLayer(); toast("Progress updated"); return;
  }

  /* ---- comments, links, dependencies ---- */
  if (d.addcmt) {
    const t = S.tasks.find(x => x.id === d.addcmt); if (!t) return;
    const body = $("#cmt-body").value.trim(); if (!body) return;
    const mgrNote = $("#cmt-mgr") ? $("#cmt-mgr").checked : false;
    const t2 = clone(t);
    t2.comments = (t2.comments || []).concat([{ id: uid("c"), authorId: meId(), at: nowISO(), body, managerNote: mgrNote }]);
    await saveTask(t2, [logEntry("comment", null, null, null, body.slice(0, 120))]);
    drawerTab = "comments"; return renderDrawer();
  }
  if (d.addlink) { const t = S.tasks.find(x => x.id === d.addlink); if (t) openLayer(linkModal(t)); return; }
  if (d.savelink) {
    const t = S.tasks.find(x => x.id === d.savelink); if (!t) return;
    const url = $("#lk-url").value.trim();
    if (!url) { $("#lk-err").innerHTML = `<div class="hlp err">Paste a URL first.</div>`; $("#lk-url").classList.add("err"); return; }
    const label = $("#lk-label").value.trim() || url.replace(/^https?:\/\//, "").slice(0, 40);
    const t2 = clone(t); t2.links = (t2.links || []).concat([{ label, url }]);
    await saveTask(t2, [logEntry("resource", null, null, null, "Added link: " + label)]);
    drawerTab = "resources"; return renderDrawer();
  }
  if (d.dellink) {
    const [id, i] = d.dellink.split(":");
    const t = S.tasks.find(x => x.id === id); if (!t) return;
    const t2 = clone(t); const [rm] = t2.links.splice(Number(i), 1);
    await saveTask(t2, [logEntry("resource", null, null, null, "Removed link: " + (rm ? rm.label : ""))]);
    return renderDrawer();
  }
  if (d.delatt) {
    const [id, attId] = d.delatt.split(":");
    if (!confirm("Remove this file? This can't be undone.")) return;
    const ok = await deleteAttachmentRemote(id, attId);
    if (ok) { drawerTab = "resources"; renderDrawer(); }
    return;
  }
  if (d.adddep) { const t = S.tasks.find(x => x.id === d.adddep); if (t) openLayer(dependencyModal(t)); return; }
  if (d.savedep) {
    const t = S.tasks.find(x => x.id === d.savedep); if (!t) return;
    const desc = $("#dp-desc").value.trim();
    if (!desc) { $("#dp-err").innerHTML = `<div class="hlp err">Describe what's needed.</div>`; $("#dp-desc").classList.add("err"); return; }
    const ownerId = $("#dp-owner").value || null;
    const t2 = clone(t);
    t2.dependencies = (t2.dependencies || []).concat([{ description: desc, ownerId, owner: null, status: "OPEN" }]);
    await saveTask(t2, [logEntry("dependency", null, null, null, "Dependency added: " + desc)]);
    toast(ownerId ? `Added — ${empName(ownerId)} will be notified they're needed` : "Dependency added");
    return renderDrawer();
  }
  if (d.toggledep) {
    const [id, i] = d.toggledep.split(":");
    const t = S.tasks.find(x => x.id === id); if (!t) return;
    const t2 = clone(t); const dep = t2.dependencies[Number(i)];
    dep.status = dep.status === "RESOLVED" ? "OPEN" : "RESOLVED";
    await saveTask(t2, [logEntry("dependency", null, null, null, `Dependency ${dep.status.toLowerCase()}: ${dep.description || ""}`)]);
    return renderDrawer();
  }
  if (d.deldep) {
    const [id, i] = d.deldep.split(":");
    const t = S.tasks.find(x => x.id === id); if (!t) return;
    const t2 = clone(t); t2.dependencies.splice(Number(i), 1);
    await saveTask(t2, [logEntry("dependency", null, null, null, "Dependency removed")]);
    return renderDrawer();
  }

  /* ---- people & projects ---- */
  if ("newemp" in d) { if (!canAdmin()) return toast("Managers only.", true); return openLayer(employeeModal(null)); }
  if (d.editemp) { if (!canAdmin()) return toast("Managers only.", true); return openLayer(employeeModal(emp(d.editemp))); }
  if (d.saveemp) {
    const isNew = d.isnew === "true";
    const base = isNew ? { id: d.saveemp } : clone(emp(d.saveemp) || { id: d.saveemp });
    const name = $("#ef-name").value.trim();
    if (!name) { toast("A name is required.", true); return; }
    const [dept, team] = ($("#ef-team").value || "|").split("|");
    Object.assign(base, { name, initials: initials(name), email: $("#ef-email").value.trim(), title: $("#ef-title").value.trim(),
      role: $("#ef-role").value, departmentId: dept, teamId: team, capacityHours: Number($("#ef-cap").value) || 40,
      active: $("#ef-active").checked, color: base.color || avColor(base.id) });
    const saved = await saveEmployee(base);
    if (!saved) return;
    closeLayer();
    if (saved.temporaryPassword) showTempPassword(saved.employee, saved.temporaryPassword);
    else toast(isNew ? "Added " + name : "Saved");
    return;
  }
  if ("newproj" in d) { if (!canAdmin()) return toast("Managers only.", true); return openLayer(projectModal(null)); }
  if (d.saveproj) {
    const isNew = d.isnew === "true";
    const base = isNew ? { id: d.saveproj } : clone(proj(d.saveproj) || { id: d.saveproj });
    const name = $("#pf-name").value.trim(); if (!name) { toast("A project name is required.", true); return; }
    Object.assign(base, { name, code: $("#pf-code").value.trim(), description: $("#pf-desc").value.trim(),
      ownerId: $("#pf-owner").value, startDate: $("#pf-start").value || null, targetDate: $("#pf-target").value || null, status: "ACTIVE" });
    await saveProject(base);
    closeLayer(); toast(isNew ? "Project created" : "Saved"); return;
  }
  if (d.delproj) {
    if (!canAdmin()) return toast("Managers only.", true);
    const p = proj(d.delproj); if (!p) return;
    if (!confirm(`Delete “${p.name}”? Its tasks keep their history but lose the project label.`)) return;
    if (await deleteProjectRemote(d.delproj)) toast("Project deleted");
    return;
  }

  /* ---- bulk ---- */
  if ("bulk" in d) { if (!S.selection.size) return; return openLayer(bulkModal()); }
  if ("savebulk" in d) {
    const patch = {};
    const a = $("#bk-assignee").value, pr = $("#bk-project").value,
          p = $("#bk-priority").value, st = $("#bk-status").value, du = $("#bk-due").value;
    if (a) patch.assigneeId = a;
    if (pr) patch.projectId = pr;
    if (p) patch.priority = p;
    if (st) { patch.status = st; if (st === "COMPLETED") patch.progress = 100; }
    if (du) patch.dueDate = du;
    const note = $("#bk-note").value.trim();
    if (!Object.keys(patch).length && !note) { toast("Nothing selected to change.", true); return; }
    const r = await bulkUpdate(Array.from(S.selection), patch, note);
    if (!r) return;
    S.selection.clear(); closeLayer();
    toast(r.refused.length
      ? `Updated ${r.updated.length}; ${r.refused.length} couldn't be changed (${r.refused[0].reason}).`
      : `Updated ${r.updated.length} task${r.updated.length === 1 ? "" : "s"}`, r.refused.length > 0);
    return;
  }

  /* ---- quick actions ---- */
  if (d.quick) {
    const mine = S.tasks.filter(t => t.assigneeId === meId() && isActive(t)).sort((a, b) => prio(b.priority).weight - prio(a.priority).weight);
    const titles = { progress: "Which task made progress?", complete: "Which task is done?", blocker: "Which task is blocked?" };
    return openLayer(pickerModal(titles[d.quick], mine, d.quick));
  }
  if (d.pick) {
    const [action, id] = d.pick.split(":");
    const t = S.tasks.find(x => x.id === id); if (!t) return;
    if (action === "progress") return openLayer(progressModal(t));
    if (action === "blocker") return openLayer(blockerModal(t));
    if (action === "complete") {
      await saveTask(Object.assign(clone(t), { status: "COMPLETED", progress: 100, completedAt: nowISO() }));
      closeLayer(); toast("Marked complete"); return;
    }
  }

  /* ---- daily update ---- */
  if ("prefill" in d) {
    const done = S.tasks.filter(t => t.assigneeId === meId() && t.status === "COMPLETED" && (t.completedAt || "").slice(0, 10) === todayISO());
    $("#u-completed").value = done.map(t => t.title).join("; ");
    return;
  }
  if ("saveupdate" in d) {
    const entry = { date: todayISO(), at: nowISO(),
      completed: $("#u-completed").value.trim(), current: $("#u-current").value.trim(), next: $("#u-next").value.trim(),
      blocked: $("#u-blocked").value.trim(), help: $("#u-help").value.trim(), note: $("#u-note").value.trim() };
    if (!entry.completed && !entry.current && !entry.next && !entry.blocked) { toast("Fill in at least one answer.", true); return; }
    await saveDailyUpdate(entry);
    toast("Update posted — your manager sees it on the daily summary");
    return go(isManager() ? "cc" : "myday");
  }

  /* ---- settings ---- */
  if ("adddept" in d) { const n = prompt("Department name:"); if (!n) return; cfg().departments.push({ id: uid("dep"), name: n, teams: [] }); return saveConfig(); }
  if (d.deldept != null && "deldept" in d) { if (!confirm("Remove this department?")) return; cfg().departments.splice(Number(d.deldept), 1); return saveConfig(); }
  if ("addteam" in d) { const n = prompt("Team name:"); if (!n) return; const dd = cfg().departments[Number(d.addteam)]; dd.teams = (dd.teams || []).concat([{ id: uid("tm"), name: n }]); return saveConfig(); }
  if ("delteam" in d) { const [i, j] = d.delteam.split("."); cfg().departments[+i].teams.splice(+j, 1); return saveConfig(); }
  if ("addstatus" in d) { const n = prompt("Status label:"); if (!n) return; cfg().statuses.splice(cfg().statuses.length - 1, 0, { id: n.toUpperCase().replace(/[^A-Z0-9]+/g, "_"), label: n, kind: "open" }); return saveConfig(); }
  if ("delstatus" in d) {
    const s = cfg().statuses[Number(d.delstatus)];
    if (S.tasks.some(t => t.status === s.id)) return toast("Tasks still use this status — move them first.", true);
    cfg().statuses.splice(Number(d.delstatus), 1); return saveConfig();
  }
  if ("wd" in d) {
    const n = Number(d.wd), w = cfg().workingDays || [];
    cfg().workingDays = w.includes(n) ? w.filter(x => x !== n) : w.concat([n]).sort();
    return saveConfig();
  }
});

/* ---- topbar ---- */
$("#newTaskBtn").addEventListener("click", () => openLayer(taskForm(null, isManager() ? "" : meId())));
$("#breakBtn").addEventListener("click", () => toggleBreak());
$("#notifBtn").addEventListener("click", () => { openLayer(notifModal()); render(); });
$("#whoBtn").addEventListener("click", () => openLayer(accountModal()));
$("#themeBtn").addEventListener("click", () => {
  const cur = document.documentElement.getAttribute("data-theme");
  const next = cur === "dark" ? "light" : cur === "light" ? "" : (matchMedia("(prefers-color-scheme: dark)").matches ? "light" : "dark");
  if (next) document.documentElement.setAttribute("data-theme", next); else document.documentElement.removeAttribute("data-theme");
  store.set("theme", next);
});

/* ---- delegated change / input ---- */
document.addEventListener("change", ev => {
  const t = ev.target, id = t.id || "";
  if (t.dataset.fileinput) {
    const file = t.files && t.files[0]; t.value = "";
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) { toast("That file is larger than 25MB.", true); return; }
    const taskId = t.dataset.fileinput;
    (async () => {
      const ok = await uploadAttachment(taskId, file);
      if (ok) { toast("Sent " + file.name); drawerTab = "resources"; renderDrawer(); }
    })();
    return;
  }
  const F = S.filters;
  const map = { "f-assignee": "assignee", "f-dept": "dept", "f-team": "team", "f-project": "project", "f-priority": "priority", "f-status": "status", "f-due": "due", "f-flag": "flag", "f-completed": "completed", "f-minp": "minProgress", "f-maxp": "maxProgress" };
  if (map[id]) { F[map[id]] = t.value; return render(); }
  if (id === "selAll") {
    const rows = applyFilters(visibleTasks());
    if (t.checked) rows.forEach(r => S.selection.add(r.id)); else rows.forEach(r => S.selection.delete(r.id));
    return render();
  }
  if (t.dataset.selrow) { t.checked ? S.selection.add(t.dataset.selrow) : S.selection.delete(t.dataset.selrow); return render(); }
  // settings live edits
  const ds = t.dataset;
  if (ds.deptName != null) { cfg().departments[+ds.deptName].name = t.value; return saveConfig(); }
  if (ds.teamName != null) { const [i, j] = ds.teamName.split("."); cfg().departments[+i].teams[+j].name = t.value; return saveConfig(); }
  if (ds.prioW != null) { cfg().priorities[+ds.prioW].weight = Number(t.value) || 1; return saveConfig(); }
  if (ds.prioS != null) { cfg().priorities[+ds.prioS].staleDays = Math.max(1, Number(t.value) || 1); return saveConfig(); }
  if (ds.statusLabel != null) { cfg().statuses[+ds.statusLabel].label = t.value; return saveConfig(); }
  if (ds.statusKind != null) { cfg().statuses[+ds.statusKind].kind = t.value; return saveConfig(); }
  if (ds.wl != null) { cfg().workload[ds.wl] = Number(t.value) || 0; return saveConfig(); }
  if ("defdue" in ds) { cfg().defaultDueDays = Math.max(1, Number(t.value) || 7); return saveConfig(); }
  if ("cats" in ds) { cfg().categories = t.value.split(",").map(s => s.trim()).filter(Boolean); return saveConfig(); }
  if (ds.notify) { cfg().notify = cfg().notify || {}; cfg().notify[ds.notify] = t.checked; return saveConfig(); }
  if (ds.mynotify) return saveMyNotifyPrefs({ [ds.mynotify]: t.checked });
  if ("desktopnotifs" in ds) {
    if (t.checked) { enableDesktopNotifs().then(ok => { t.checked = ok; }); }
    else disableDesktopNotifs();
    return;
  }
});
let searchT;
document.addEventListener("input", ev => {
  if (ev.target.id === "f-search") {
    clearTimeout(searchT);
    const v = ev.target.value;
    searchT = setTimeout(() => { S.filters.search = v; render(); const el = $("#f-search"); if (el) { el.focus(); el.setSelectionRange(v.length, v.length); } }, 220);
  }
  if (ev.target.id === "globalSearch") { S.q = ev.target.value; paintSearch(); }
});

/* ---- global search ---- */
function paintSearch() {
  const pop = $("#searchPop"), q = S.q.trim().toLowerCase();
  if (!q || !S.me) { pop.hidden = true; pop.className = ""; return; }
  const tasks = visibleTasks().filter(t => (t.id + " " + t.title + " " + (t.description || "") + " " + (t.tags || []).join(" ")).toLowerCase().includes(q)).slice(0, 8);
  const people = isManager() ? S.employees.filter(e => (e.name + " " + (e.title || "") + " " + (e.email || "")).toLowerCase().includes(q)).slice(0, 5) : [];
  const projects = S.projects.filter(p => (p.name + " " + (p.code || "")).toLowerCase().includes(q)).slice(0, 5);
  const statuses = cfg().statuses.filter(s => s.label.toLowerCase().includes(q)).slice(0, 3);
  const prios = cfg().priorities.filter(p => p.label.toLowerCase().includes(q)).slice(0, 3);
  const parts = [];
  if (tasks.length) parts.push(`<div class="sr-group">Tasks</div>` + tasks.map(t => `<div class="sr-item" data-open="${esc(t.id)}">
    ${pPill(t.priority)}<span style="flex:1;min-width:0"><span class="t">${esc(t.title)}</span><span class="m">${esc(t.id)} · ${esc(empName(t.assigneeId))} · ${esc(stat(t.status).label)} · due ${esc(fmtDate(t.dueDate))}</span></span></div>`).join(""));
  if (people.length) parts.push(`<div class="sr-group">People</div>` + people.map(e => `<div class="sr-item" data-emp="${esc(e.id)}">
    ${av(e, "sm")}<span style="flex:1"><span class="t">${esc(e.name)}</span><span class="m">${esc(e.title || "")} · ${workload(e.id).active} active</span></span></div>`).join(""));
  if (projects.length) parts.push(`<div class="sr-group">Projects</div>` + projects.map(p => `<div class="sr-item" data-proj="${esc(p.id)}">
    ${icon("folder")}<span style="flex:1"><span class="t">${esc(p.name)}</span><span class="m">${projectStats(p.id).progress}% complete</span></span></div>`).join(""));
  if (statuses.length || prios.length) parts.push(`<div class="sr-group">Filters</div>` +
    statuses.map(s => `<div class="sr-item" data-kpi="status:${esc(s.id)}">${icon("list")}<span class="t">All tasks with status ${esc(s.label)}</span></div>`).join("") +
    prios.map(p => `<div class="sr-item" data-kpi="flag:${p.id === "CRITICAL" ? "critical" : "active"}">${icon("flag")}<span class="t">All ${esc(p.label)} priority work</span></div>`).join(""));
  pop.className = "searchpop";
  pop.innerHTML = parts.join("") || `<div class="empty" style="padding:16px">No match for “${esc(S.q)}”.</div>`;
  pop.hidden = false;
}
document.addEventListener("click", e => {
  if (!e.target.closest(".searchwrap")) { const p = $("#searchPop"); if (p) { p.hidden = true; } }
  if (e.target.closest("[data-open],[data-emp],[data-proj],[data-kpi]")) { const p = $("#searchPop"); if (p) p.hidden = true; }
});
document.addEventListener("keydown", e => {
  if (e.key === "Escape") { if (L().innerHTML) closeLayer(); const p = $("#searchPop"); if (p) p.hidden = true; }
  if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); $("#globalSearch").focus(); $("#globalSearch").select(); }
});

/* ---- drag and drop on the board ---- */
let dragId = null;
document.addEventListener("dragstart", e => {
  const c = e.target.closest(".kcard"); if (!c) return;
  dragId = c.dataset.card; c.classList.add("dragging");
  e.dataTransfer.effectAllowed = "move";
  try { e.dataTransfer.setData("text/plain", dragId); } catch {}
});
document.addEventListener("dragend", e => { const c = e.target.closest(".kcard"); if (c) c.classList.remove("dragging"); dragId = null; $$(".kcol.over").forEach(x => x.classList.remove("over")); });
document.addEventListener("dragover", e => {
  const col = e.target.closest(".kcol"); if (!col || !dragId) return;
  e.preventDefault(); e.dataTransfer.dropEffect = "move";
  $$(".kcol.over").forEach(x => { if (x !== col) x.classList.remove("over"); });
  col.classList.add("over");
});
document.addEventListener("drop", async e => {
  const col = e.target.closest(".kcol"); if (!col || !dragId) return;
  e.preventDefault();
  const status = col.dataset.col, id = dragId; dragId = null;
  $$(".kcol.over").forEach(x => x.classList.remove("over"));
  const t = S.tasks.find(x => x.id === id); if (!t || t.status === status) return;
  if (!canEdit(t)) return toast("You can only move your own tasks.", true);
  if (status === "BLOCKED") { openLayer(blockerModal(t)); return; }
  if (status === "COMPLETED" && !canComplete(t)) return toast("Only " + empName(t.assigneeId) + " or a manager can complete this.", true);
  const patch = { status };
  if (status === "COMPLETED") { patch.progress = 100; patch.completedAt = nowISO(); }
  else if (t.status === "COMPLETED") { patch.completedAt = null; patch.reopenCount = (t.reopenCount || 0) + 1; if (t.progress === 100) patch.progress = 90; }
  if (status === "IN_PROGRESS" && (t.progress || 0) === 0) patch.progress = 10;
  if (t.blocker && !t.blocker.resolvedAt && status !== "BLOCKED") patch.blocker = Object.assign(clone(t.blocker), { resolvedAt: nowISO() });
  await patchTask(id, patch);
});

document.addEventListener("submit", async ev => {
  if (ev.target.id !== "loginForm") return;
  ev.preventDefault();
  const btn = $("#li-go"), email = $("#li-email").value.trim(), pw = $("#li-pw").value;
  const err = m => { const e = $("#li-err"); if (e) e.innerHTML = `<div class="hlp err">${esc(m)}</div>`; };
  if (!email || !pw) return err("Enter your email and password.");
  btn.disabled = true; btn.textContent = "Signing in…";
  const problem = await login(email, pw);
  if (problem) {
    const b = $("#li-go");
    if (b) { b.disabled = false; b.textContent = "Sign in"; }
    err(problem);
  }
});

/* ==========================================================================
   BOOT
   ========================================================================== */
(function boot() {
  const th = store.get("theme", "");
  if (th) document.documentElement.setAttribute("data-theme", th);
  render();
  initData();
  setInterval(() => { if (S.ready && S.me && !L().innerHTML) render(); }, 120000);  // keep relative times honest
  setInterval(() => { if (S.me && openBreakFor(meId())) render(); }, 1000);         // tick the running break timer
})();
