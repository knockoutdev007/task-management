"use strict";
/* ==========================================================================
   COMPLAINT WALL — a sibling feature to Good Vibes Wall: its own data
   (S.complaints), its own data-cb* namespace (events.js), so it never
   cross-triggers Good Vibes or the Task Board.

   Anyone can submit a complaint; it sits in a manager-only inbox until a
   manager publishes it. Published complaints are always anonymous on the
   board, whether or not they have a poll running — only a manager ever
   sees who filed one. A poll asks everyone "do you believe this happened
   as described"; the running total is visible to all, individual votes
   only to managers.
   ========================================================================== */

function viewComplaints() {
  const mgr = isManager();
  const filter = S.complaintFilter.status;
  const rows = mgr ? S.complaints.filter(c => !filter || c.status === filter) : S.complaints;
  const counts = mgr ? {
    pending: S.complaints.filter(c => c.status === "pending").length,
    published: S.complaints.filter(c => c.status === "published").length,
    archived: S.complaints.filter(c => c.status === "archived").length
  } : null;
  return `
  <div class="ph"><div><h1>Complaint Wall</h1>
    <div class="sub">${mgr
      ? "Review what comes in, publish what the team should see, and run a poll when you want a read on it."
      : "Submitted anonymously — even to you once it's published. Vote yes or no on whether you believe a published complaint happened as described."}</div></div>
    <div class="sp"><button class="btn pri" data-newcomplaint>${icon("plus")}Submit a complaint</button></div></div>
  ${mgr ? `<section class="panel" style="margin-bottom:12px"><div class="panel-b" style="padding:9px 11px">
      <div class="seg-tabs">
        <button class="seg-tab" data-cbfilter="" aria-selected="${!filter}">All</button>
        <button class="seg-tab" data-cbfilter="pending" aria-selected="${filter === "pending"}">Pending (${counts.pending})</button>
        <button class="seg-tab" data-cbfilter="published" aria-selected="${filter === "published"}">Published (${counts.published})</button>
        <button class="seg-tab" data-cbfilter="archived" aria-selected="${filter === "archived"}">Archived (${counts.archived})</button>
      </div>
    </div></section>` : ""}
  <div style="display:grid;gap:10px">
    ${rows.map(c => complaintCard(c, mgr)).join("") || emptyState("No complaints here", mgr ? "Nothing in this view yet." : "Nothing has been published yet.")}
  </div>`;
}

function complaintCard(c, mgr) {
  const author = mgr ? (emp(c.employeeId) ? empName(c.employeeId) : "Unknown") : "Anonymous";
  const statusPill = mgr ? `<span class="tag">${esc(c.status)}</span>` : "";
  const canPublish = mgr && c.status !== "published";
  const canArchive = mgr && c.status !== "archived";
  const canReopen = mgr && c.status !== "pending";
  const pollBtn = mgr && c.status === "published"
    ? `<button class="btn sm" data-cbpoll="${esc(c.id)}" data-pollon="${c.pollEnabled ? "0" : "1"}">${c.pollEnabled ? "Stop poll" : "Start poll"}</button>`
    : "";
  const voteBlock = (!mgr && c.status === "published" && c.pollEnabled)
    ? `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <span class="hlp">Do you believe this happened as described?</span>
        <button class="btn sm${c.myVote === true ? " on" : ""}" data-cbvote="${esc(c.id)}" data-believe="1">Yes</button>
        <button class="btn sm${c.myVote === false ? " on" : ""}" data-cbvote="${esc(c.id)}" data-believe="0">No</button>
      </div>` : "";
  const tally = (c.status === "published" && (c.pollEnabled || c.totalVotes > 0))
    ? `<div class="hlp">${c.yesVotes} believe it happened · ${c.noVotes} don't${c.totalVotes ? "" : " · no votes yet"}</div>`
    : "";
  return `<article class="panel"><div class="panel-b" style="display:grid;gap:8px">
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
      <span class="cellname">${av(mgr ? emp(c.employeeId) : null, "sm")}<span class="tx" style="font-weight:600">${esc(author)}</span></span>
      ${statusPill}
      <span class="hlp" style="margin-left:auto">${esc(fmtDT(c.createdAt))}</span>
    </div>
    <div style="font-size:13.5px;white-space:pre-wrap">${esc(c.body)}</div>
    ${tally}
    ${voteBlock}
    ${mgr ? `<div style="display:flex;gap:7px;flex-wrap:wrap;border-top:1px solid var(--line-soft);padding-top:8px">
        ${canPublish ? `<button class="btn sm" data-cbstatus="${esc(c.id)}" data-status="published">Publish</button>` : ""}
        ${pollBtn}
        ${canReopen ? `<button class="btn sm" data-cbstatus="${esc(c.id)}" data-status="pending">Move to inbox</button>` : ""}
        ${canArchive ? `<button class="btn sm dgr" data-cbstatus="${esc(c.id)}" data-status="archived">Archive</button>` : ""}
      </div>` : ""}
  </div></article>`;
}
