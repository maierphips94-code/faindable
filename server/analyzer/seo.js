const cheerio = require('cheerio');
const { checkPath } = require('../utils/fetcher');
const { getPageSpeedMetrics } = require('./pagespeed');

/**
 * Analyzes a webpage for SEO signals.
 * @param {string} html - Raw HTML content
 * @param {string} url - Final URL of the page
 * @returns {{ score: number, manualChecks: number }}
 */
async function analyzeSEO(html, url) {
  const $ = cheerio.load(html);
  let manualChecks = 0;

  // ─── CATEGORY 1: E-E-A-T & CONTENT AUTHORITY (35%) ───────────────────────
  let eeatPoints = 0;
  const maxEeat = 60; // automated checkable max

  // HTTPS
  if (url.startsWith('https://')) eeatPoints += 20;

  // Legal links
  const allLinks = $('a').map((_, el) => $(el).attr('href') || '').get().join(' ').toLowerCase();
  const allText = $('body').text().toLowerCase();
  if (/impressum|datenschutz|agb|legal|privacy|cookie/.test(allLinks + allText)) eeatPoints += 15;

  // Author bio
  if (/autor|author|über mich|about me|team/.test(allLinks + allText)) eeatPoints += 10;

  // Contact page
  if (/kontakt|contact/.test(allLinks)) eeatPoints += 10;

  // JSON-LD with Author type
  let hasAuthorSchema = false;
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const parsed = JSON.parse($(el).html() || '{}');
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of items) {
        if (item?.author || item?.['@type'] === 'Person') hasAuthorSchema = true;
      }
    } catch { /* ignore */ }
  });
  if (hasAuthorSchema) eeatPoints += 5;

  // Manual checks (backlinks, news mentions)
  manualChecks += 2;

  const eeatScore = Math.min(100, (eeatPoints / maxEeat) * 100);

  // ─── CATEGORY 2: ON-PAGE & SEMANTICS (25%) ────────────────────────────────
  let onPagePoints = 0;
  const maxOnPage = 100;

  const title = $('title').text().trim();
  if (title) {
    onPagePoints += 15;
    if (title.length >= 50 && title.length <= 60) onPagePoints += 10;
  }

  const metaDesc = $('meta[name="description"]').attr('content') || '';
  if (metaDesc) {
    onPagePoints += 10;
    if (metaDesc.length >= 130 && metaDesc.length <= 160) onPagePoints += 5;
  }

  const h1Count = $('h1').length;
  if (h1Count === 1) onPagePoints += 15;

  const h2Count = $('h2').length;
  if (h2Count >= 2) onPagePoints += 10;
  if ($('h3').length > 0) onPagePoints += 5;

  const internalLinks = $('a[href]').filter((_, el) => {
    const href = $(el).attr('href') || '';
    return href.startsWith('/') || href.includes(new URL(url).hostname);
  }).length;
  if (internalLinks > 3) onPagePoints += 10;

  // Anchor text quality heuristic
  const anchorTexts = $('a').map((_, el) => $(el).text().trim().toLowerCase()).get();
  const badAnchors = anchorTexts.filter(t => /^(hier|here|more|click|mehr|weiter|link|read more)$/.test(t));
  if (anchorTexts.length > 0 && badAnchors.length / anchorTexts.length < 0.3) onPagePoints += 10;

  // Clean URL (no ?p= style)
  if (!/[?&]p=\d+/.test(url)) onPagePoints += 5;

  // Favicon
  if ($('link[rel*="icon"]').length > 0) onPagePoints += 5;

  const onPageScore = Math.min(100, (onPagePoints / maxOnPage) * 100);

  // ─── CATEGORY 3: TECHNICAL SEO (20%) ──────────────────────────────────────
  let techPoints = 0;
  const maxTech = 100;

  if ($('meta[name="viewport"]').length > 0) techPoints += 15;
  if ($('link[rel="canonical"]').length > 0) techPoints += 10;

  // Open Graph
  const ogTitle = $('meta[property="og:title"]').attr('content');
  const ogDesc = $('meta[property="og:description"]').attr('content');
  const ogImage = $('meta[property="og:image"]').attr('content');
  if (ogTitle && ogDesc && ogImage) techPoints += 15;
  else if (ogTitle || ogDesc) techPoints += 7;

  // Robots meta
  const robotsMeta = $('meta[name="robots"]').attr('content') || '';
  if (!/noindex/i.test(robotsMeta)) techPoints += 10;

  // Images with alt
  const allImages = $('img');
  const imagesWithAlt = $('img[alt]').filter((_, el) => ($(el).attr('alt') || '').trim().length > 0);
  if (allImages.length > 0 && imagesWithAlt.length / allImages.length > 0.8) techPoints += 10;
  else if (allImages.length === 0) techPoints += 10; // no images = no problem

  // robots.txt & sitemap.xml
  const [robotsResult, sitemapResult] = await Promise.all([
    checkPath(url, '/robots.txt'),
    checkPath(url, '/sitemap.xml'),
  ]);

  if (robotsResult.ok) techPoints += 10;
  if (sitemapResult.ok) techPoints += 10;

  // PageSpeed metrics
  const ps = await getPageSpeedMetrics(url);

  if (ps.lcp !== null) {
    if (ps.lcp < 2.5) techPoints += 10;
    else if (ps.lcp < 4) techPoints += 5;
  }
  if (ps.cls !== null) {
    if (ps.cls < 0.1) techPoints += 10;
    else if (ps.cls < 0.25) techPoints += 5;
  }
  if (ps.inp !== null) {
    if (ps.inp < 200) techPoints += 10;
    else if (ps.inp < 500) techPoints += 5;
  }

  // If no PageSpeed data, estimate partial credit
  if (ps.lcp === null && ps.cls === null && ps.inp === null) {
    techPoints += 15; // partial neutral credit for unverified
  }

  const techScore = Math.min(100, (techPoints / maxTech) * 100);

  // ─── CATEGORY 4: LOCAL SEO (10%) ──────────────────────────────────────────
  let localPoints = 0;
  const maxLocal = 70;

  // LocalBusiness or Organization schema
  let hasLocalSchema = false;
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const parsed = JSON.parse($(el).html() || '{}');
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of items) {
        if (['LocalBusiness', 'Organization', 'Store', 'Restaurant'].includes(item?.['@type'])) {
          hasLocalSchema = true;
        }
      }
    } catch { /* ignore */ }
  });
  if (hasLocalSchema) localPoints += 30;

  const bodyText = $('body').text();
  if (/\+49|\(0\d+\)|☎|tel:|fon:/.test(bodyText)) localPoints += 20;
  if (/straße|str\.|strasse|platz|weg|allee|avenue|road|street/i.test(bodyText)) localPoints += 20;

  manualChecks += 2; // Google Business, NAP in directories

  const localScore = Math.min(100, (localPoints / maxLocal) * 100);

  // ─── CATEGORY 5: USER SIGNALS (10%) ───────────────────────────────────────
  let userPoints = 0;
  const maxUser = 80;

  // Heuristic: no fullscreen overlay without aria
  const fixedDivs = $('div').filter((_, el) => {
    const style = $(el).attr('style') || '';
    const cls = $(el).attr('class') || '';
    return /fixed|z-\[9|z-50|z-\[99/.test(cls) || /position:\s*fixed/.test(style);
  });
  const badOverlays = fixedDivs.filter((_, el) => {
    const aria = $(el).attr('aria-label') || $(el).attr('role') || '';
    return !aria;
  });
  if (badOverlays.length === 0 || badOverlays.length < 2) userPoints += 20;

  if ($('img').length > 0) userPoints += 20;
  if ($('iframe[src*="youtube"], iframe[src*="vimeo"], iframe[src*="youtu.be"]').length > 0) userPoints += 20;

  const words = bodyText.replace(/\s+/g, ' ').trim().split(' ').filter(w => w.length > 2).length;
  if (words > 300) userPoints += 20;

  manualChecks += 2; // bounce rate, dwell time

  const userScore = Math.min(100, (userPoints / maxUser) * 100);

  // ─── WEIGHTED TOTAL ───────────────────────────────────────────────────────
  let seoScore = Math.round(
    eeatScore * 0.35 +
    onPageScore * 0.25 +
    techScore * 0.20 +
    localScore * 0.10 +
    userScore * 0.10
  );

  // ─── BONUS ────────────────────────────────────────────────────────────────
  let bonus = 0;

  // YouTube with title attribute
  const yt = $('iframe[src*="youtube"], iframe[src*="youtu.be"]');
  if (yt.length > 0 && yt.attr('title')) bonus += 5;

  // AggregateRating schema
  let hasAggRating = false;
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const parsed = JSON.parse($(el).html() || '{}');
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of items) {
        if (item?.['@type'] === 'AggregateRating' || item?.aggregateRating) hasAggRating = true;
      }
    } catch { /* ignore */ }
  });
  if (hasAggRating) bonus += 3;

  // Current content
  if (/2024|2025|2026/.test(html)) bonus += 2;

  seoScore = Math.min(110, seoScore + bonus);

  return {
    score: seoScore,
    manualChecks,
    breakdown: {
      eeat: Math.round(eeatScore),
      onPage: Math.round(onPageScore),
      tech: Math.round(techScore),
      local: Math.round(localScore),
      user: Math.round(userScore),
      bonus,
    },
  };
}

module.exports = { analyzeSEO };
