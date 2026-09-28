"use strict";
/* ==========================================================================
   VIEW · WEBSITE UPDATES
   Manager-only. Two sites (Live = lghomecomfort.ca, Staging =
   staging.lghomecomfort.ca) each with two sections — Blog Post (wp/v2/posts)
   and Guides (wp/v2/guides). Everything is always fetched live
   (public/app/api.js's loadWebsitePosts/loadWebsiteGuides/loadStagingPosts/
   loadStagingGuides, triggered from go("website") in events.js and the
   shared Refresh button here). No client- or server-side caching.
   ========================================================================== */
function viewWebsiteUpdates() {
  const all = [S.websitePosts, S.websiteGuides, S.stagingPosts, S.stagingGuides];
  const busy = all.some(w => w.status === "loading");
  return `
  <div class="ph"><div><h1>Website Updates</h1><div class="sub">Latest content from lghomecomfort.ca, fetched live.</div></div>
    <div class="sp"><button class="btn sm" data-refreshwebsite ${busy ? "disabled" : ""}>${icon("clock")}Refresh</button></div></div>

  ${websiteSiteGroup("Live", S.websitePosts, S.websiteGuides)}
  ${websiteSiteGroup("Staging", S.stagingPosts, S.stagingGuides, true)}`;
}
function websiteSiteGroup(label, posts, guides, isStaging) {
  return `
  <h2 style="font-size:13px;margin:20px 0 10px;color:var(--ink-3);display:flex;gap:8px;align-items:center">
    ${esc(label)}${isStaging ? `<span class="tag" title="Not the public website — for internal preview only">Preview, not public</span>` : ""}
  </h2>
  <div class="cols-2">
    ${websiteSection("Blog Post", posts)}
    ${websiteSection("Guides", guides)}
  </div>`;
}
function websiteSection(title, w) {
  return `<section class="panel"><div class="panel-h"><h2>${esc(title)}</h2></div>
    <div class="panel-b" style="display:grid;gap:10px">
      ${w.status === "loading" ? emptyState("Loading…", `Fetching the latest ${esc(title.toLowerCase())} from the website.`)
        : w.status === "error" ? `<div class="hlp err">Couldn't load ${esc(title.toLowerCase())}: ${esc(w.error || "Unknown error")}</div>`
        : w.posts.length ? w.posts.map(p => `<div style="display:flex;gap:10px;align-items:flex-start;border-bottom:1px solid var(--line-soft);padding-bottom:9px">
            ${p.image ? `<img src="${esc(p.image.url)}" alt="${esc(p.image.alt)}" width="72" height="40" style="width:72px;height:40px;object-fit:cover;border-radius:var(--r-sm);flex:none;background:var(--surface-2)">` : ""}
            <div style="min-width:0">
              <a class="linkish" href="${esc(p.link)}" target="_blank" rel="noopener noreferrer" style="font-weight:600;font-size:13.5px">${esc(p.title)}</a>
              <div class="hlp">${esc(fmtDate(p.date, { absolute: true }))}</div>
            </div>
          </div>`).join("")
        : emptyState(`No ${esc(title.toLowerCase())} found`, "")}
    </div></section>`;
}
