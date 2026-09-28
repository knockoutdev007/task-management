/**
 * Website Updates: the latest content from lghomecomfort.ca's WordPress
 * site — blog posts and guides, from both the live site and staging —
 * each fetched live (no caching) each time a manager opens the page.
 * Manager-only — informational, not part of team/task data.
 */
import * as store from "../db.js";
import { wrap } from "../wrap.js";

// Whitelisted, not user-suppliable: req.params only ever selects one of
// these, never builds a URL from caller input (no SSRF surface).
const SITES = {
  live: "https://lghomecomfort.ca/wp-json/wp/v2",
  staging: "https://staging.lghomecomfort.ca/wp-json/wp/v2"
};
const TYPES = new Set(["posts", "guides"]);

/** Pick a reasonably small thumbnail from a WP media object's generated
 *  sizes, falling back to the next-largest available, then the original. */
function pickImage(media) {
  if (!media) return null;
  const sizes = (media.media_details || {}).sizes || {};
  const src = (sizes.medium || sizes.medium_large || sizes.thumbnail || {}).source_url || media.source_url;
  return src ? { url: src, alt: media.alt_text || "" } : null;
}

/** WordPress's title.rendered is HTML-entity-encoded (e.g. "&#8217;" for an
 *  apostrophe) and occasionally carries inline tags — strip tags, then
 *  decode the handful of entities WP actually emits in a plain post title.
 *  No HTML-parsing dependency for this one field. */
function decodeWpTitle(html) {
  const noTags = String(html || "").replace(/<[^>]*>/g, "");
  return noTags
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&nbsp;/g, " ")
    .trim();
}

/** Shared fetch for any WP REST post-type collection on either site:
 *  latest 3, title/date/link/image, an 8s timeout, and errors normalized
 *  to a short message a manager can actually read instead of a stack trace. */
async function fetchWpItems(base, postType) {
  let r;
  try {
    // No _fields filter here: WP's dot-notation field paths don't reach into
    // _embedded on this install (tested), so the only reliable way to get
    // the featured image is to fetch the full embedded object and pick what
    // we need ourselves below — still server-side only, never forwarded raw.
    r = await fetch(`${base}/${postType}?per_page=3&_embed=wp:featuredmedia`, {
      headers: { "User-Agent": "TeamControlCenter/1.0" }, signal: AbortSignal.timeout(8000)
    });
  } catch {
    return { error: "Couldn't reach the website." };
  }
  if (!r.ok) return { error: "The website returned an error." };
  let raw;
  try { raw = await r.json(); } catch { return { error: "The website sent back something unexpected." }; }
  return {
    items: (Array.isArray(raw) ? raw : []).slice(0, 3).map(p => ({
      id: p.id, link: p.link, date: p.date, title: decodeWpTitle(p.title && p.title.rendered),
      image: pickImage((p._embedded && p._embedded["wp:featuredmedia"] || [])[0])
    }))
  };
}

export function mountWebsite(app, requireUser, requireManager) {
  /** A manager can switch the whole feature off from Settings > "Features"
   *  (cfg().featureFlags.website) — enforced here, not just hidden from
   *  the nav, so a direct API call can't bypass it either. */
  app.use("/api/website", wrap(async (req, res, next) => {
    const cfg = await store.getConfig();
    if ((cfg.featureFlags || {}).website === false) return res.status(404).json({ error: "Website Updates is turned off." });
    next();
  }));

  app.get("/api/website/:site/:type", requireUser, requireManager, wrap(async (req, res) => {
    const base = SITES[req.params.site];
    if (!base || !TYPES.has(req.params.type)) return res.status(404).json({ error: "No such endpoint." });
    const { items, error } = await fetchWpItems(base, req.params.type);
    if (error) return res.status(502).json({ error });
    res.json({ items });
  }));
}
