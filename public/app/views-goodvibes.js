"use strict";
/* ==========================================================================
   VIEW · GOOD VIBES WALL
   One active employee is assigned each working day, on a fair rotating
   basis (src/db.js ensureAssignmentsThrough / src/domain.js's pure rotation
   math). Everyone can read/like/comment; managers can manage the rotation
   and moderate posts — a sibling feature, not a mode, of Task Board: its
   own data (public/app/api.js's S.goodVibes), its own data-* namespace
   (public/app/events.js), so it never cross-triggers the Board/Task Board.
   ========================================================================== */
function viewGoodVibes() {
  const gv = S.goodVibes;
  const today = gv.today;
  const cat = S.goodVibesFilter.category;
  const posts = (gv.posts || []).filter(p => !cat || p.category === cat);
  const myTurn = !!(today && !today.post && today.employeeId === meId());
  const upcoming = gv.upcoming || [];

  return `
  <div class="ph"><div><h1>Good Vibes Wall</h1><div class="sub">One person shares something good each working day.</div></div>
    ${isManagerOrTeamLead() ? `<div class="sp"><button class="btn" data-gvmanage>${icon("cog")}Manage rotation</button></div>` : ""}</div>

  ${gvTodayPanel(today, myTurn)}

  ${upcoming.length ? `<section class="panel" style="margin-bottom:12px"><div class="panel-h"><h2>Up next</h2></div>
    <div class="panel-b" style="display:flex;gap:14px;flex-wrap:wrap">
      ${upcoming.map(id => `<span class="cellname">${av(emp(id), "sm")}<span class="tx">${esc(empName(id))}</span></span>`).join("")}
    </div></section>` : ""}

  <section class="panel" style="margin-bottom:12px"><div class="panel-b" style="padding:9px 11px">
    <div class="seg-tabs">
      <button class="seg-tab" data-gvfilter="" aria-selected="${!cat}">All</button>
      ${GOOD_VIBES_CATEGORIES.map(c => `<button class="seg-tab" data-gvfilter="${esc(c.id)}" aria-selected="${cat === c.id}">${c.emoji} ${esc(c.label)}</button>`).join("")}
    </div>
  </div></section>

  <div style="display:grid;gap:12px">
    ${posts.map(p => gvPostCard(p)).join("") || emptyState("No posts yet", cat ? "Nothing in this category yet." : "The wall is waiting for its first post.")}
  </div>`;
}

function gvTodayPanel(today, myTurn) {
  if (!today) {
    return `<section class="panel" style="margin-bottom:12px"><div class="panel-b">
      <div class="empty">Today isn't a working day — check back on the next one.</div></div></section>`;
  }
  const contributor = emp(today.employeeId);
  const mine = today.employeeId === meId();
  return `<section class="panel" style="margin-bottom:12px${myTurn ? ";border-color:var(--ok-line)" : ""}">
    <div class="panel-h"${myTurn ? ' style="background:var(--ok-soft)"' : ""}><h2>Today's Contributor</h2></div>
    <div class="panel-b" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
      <span class="cellname">${av(contributor, "lg")}<span class="tx" style="font-weight:600">${esc(mine ? "You" : empName(today.employeeId))}</span></span>
      ${myTurn
        ? `<div style="display:flex;gap:10px;align-items:center;flex:1;min-width:220px">
             <strong style="color:var(--ok)">It's your turn today!</strong>
             <button class="btn pri" data-newgvpost style="margin-left:auto">${icon("plus")}Share Today's Post</button>
           </div>`
        : today.post ? `<span class="hlp">Already posted today.</span>`
        : `<span class="hlp">Waiting on ${esc(empName(today.employeeId))} to post.</span>`}
    </div>
    ${today.post ? gvPostCard(today.post) : ""}
  </section>`;
}

function gvPostCard(p) {
  const e = emp(p.employeeId);
  const c = goodVibesCategory(p.category);
  const canModerate = isManager();
  return `<article class="panel" data-gvpost="${esc(p.id)}">
    <div class="panel-b" style="display:grid;gap:8px">
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <span class="cellname">${av(e, "sm")}<span class="tx" style="font-weight:600">${esc(e ? e.name : "Unknown")}</span></span>
        <span class="pill p-${esc(c.id)}">${c.emoji} ${esc(c.label)}</span>
        <span class="hlp" style="margin-left:auto">${esc(fmtDT(p.createdAt))}</span>
      </div>
      <div style="font-size:13.5px;white-space:pre-wrap">${esc(p.body)}</div>
      <div style="display:flex;gap:10px;align-items:center">
        <button class="btn sm${p.likedByMe ? " on" : ""}" data-gvlike="${esc(p.id)}">${icon("heart")}${p.likeCount || 0}</button>
        ${canModerate ? `<button class="btn sm dgr" data-gvhidepost="${esc(p.id)}" style="margin-left:auto">Hide post</button>` : ""}
      </div>
      <div style="display:grid;gap:7px;border-top:1px solid var(--line-soft);padding-top:9px">
        ${(p.comments || []).map(cm => gvCommentRow(cm, p.id, canModerate)).join("") || `<div class="hlp">No comments yet.</div>`}
        <div style="display:flex;gap:8px;align-items:flex-end">
          <textarea class="inp" data-gvcmtinput="${esc(p.id)}" rows="1" placeholder="Add a comment…" style="flex:1"></textarea>
          <button class="btn sm" data-gvaddcmt="${esc(p.id)}">Post</button>
        </div>
      </div>
    </div>
  </article>`;
}
function gvCommentRow(c, postId, canModerate) {
  const e = emp(c.authorId);
  return `<div class="cmt">${av(e, "sm")}<div>
    <div class="ch"><span class="cn">${esc(e ? e.name : "Unknown")}</span><span class="ct">${esc(fmtDT(c.at))}</span></div>
    <div class="cb">${esc(c.body)}</div>
    ${canModerate ? `<button class="btn sm dgr" data-gvhidecmt="${esc(postId)}:${esc(c.id)}" style="margin-top:4px">Hide</button>` : ""}
  </div></div>`;
}
