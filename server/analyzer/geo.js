const cheerio = require('cheerio');
const { checkPath } = require('../utils/fetcher');
const { getPageSpeedMetrics } = require('./pagespeed');

/**
 * Analyzes a webpage for GEO (Generative Engine Optimization) signals.
 * @param {string} html - Raw HTML content
 * @param {string} url - Final URL of the page
 * @param {object} [cachedPageSpeed] - Optional pre-fetched PageSpeed data
 * @returns {{ score: number, manualChecks: number }}
 */
async function analyzeGEO(html, url, cachedPageSpeed = null) {
  const $ = cheerio.load(html);
  let manualChecks = 0;

  // ─── CATEGORY 1: STRUCTURED DATA / SCHEMA.ORG (40%) ──────────────────────
  let structuredPoints = 0;
  let structuredMax = 0;

  const jsonLdScripts = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const parsed = JSON.parse($(el).html() || '{}');
      const items = Array.isArray(parsed) ? parsed : [parsed];
      jsonLdScripts.push(...items);
    } catch { /* ignore */ }
  });

  const getSchema = (type) => jsonLdScripts.find(item =>
    (item?.['@type'] === type || (Array.isArray(item?.['@type']) && item['@type'].includes(type)))
  );

  // Organization / LocalBusiness (weight: 15 in final, raw points /100)
  const orgSchema = getSchema('Organization') || getSchema('LocalBusiness') ||
    getSchema('Store') || getSchema('Restaurant') || getSchema('MedicalBusiness');
  structuredMax += 100;
  if (orgSchema) {
    structuredPoints += 20;
    if (orgSchema.name) structuredPoints += 10;
    if (orgSchema.description) structuredPoints += 10;
    if (orgSchema.address) structuredPoints += 15;
    if (orgSchema.telephone) structuredPoints += 10;
    if (orgSchema.url) structuredPoints += 5;
    if (orgSchema.logo) structuredPoints += 10;
    if (orgSchema.sameAs && Array.isArray(orgSchema.sameAs) && orgSchema.sameAs.length > 0) structuredPoints += 10;
    if (orgSchema.openingHours || orgSchema.openingHoursSpecification) structuredPoints += 5;
    if (orgSchema.geo || orgSchema.hasMap) structuredPoints += 5;
  }

  // FAQPage
  const faqSchema = getSchema('FAQPage');
  structuredMax += 50;
  if (faqSchema) {
    structuredPoints += 30;
    const questions = faqSchema.mainEntity || [];
    if (Array.isArray(questions) && questions.length >= 2) structuredPoints += 20;
  }

  // Service or Product
  const serviceSchema = getSchema('Service') || getSchema('Product');
  structuredMax += 30;
  if (serviceSchema) {
    structuredPoints += 20;
    if (serviceSchema.serviceType || serviceSchema.description) structuredPoints += 10;
  }

  // Article / BlogPosting
  const articleSchema = getSchema('Article') || getSchema('BlogPosting') || getSchema('NewsArticle');
  structuredMax += 40;
  if (articleSchema) {
    structuredPoints += 20;
    if (articleSchema.author) structuredPoints += 10;
    if (articleSchema.datePublished) structuredPoints += 10;
  }

  // AggregateRating
  const ratingSchema = getSchema('AggregateRating');
  const hasAggRating = ratingSchema ||
    jsonLdScripts.some(item => item?.aggregateRating);
  structuredMax += 30;
  if (hasAggRating) {
    structuredPoints += 20;
    const ratingData = ratingSchema || jsonLdScripts.find(i => i?.aggregateRating)?.aggregateRating;
    if (ratingData?.ratingValue && ratingData?.reviewCount) structuredPoints += 10;
  }

  const structuredScore = structuredMax > 0
    ? Math.min(100, (structuredPoints / structuredMax) * 100)
    : 0;

  // ─── CATEGORY 2: CONTENT STRUCTURE (25%) ──────────────────────────────────
  let contentPoints = 0;
  const maxContent = 110;

  // Semantic hierarchy
  if ($('h1').length === 1) contentPoints += 15;
  if ($('h2').length >= 2) contentPoints += 10;
  if ($('h3').length > 0) contentPoints += 5;
  if ($('main').length > 0) contentPoints += 10;
  if ($('article, section').length > 0) contentPoints += 10;
  if ($('aside').length > 0) contentPoints += 5;

  // Question-answer structure
  const headings = $('h1, h2, h3, h4').map((_, el) => $(el).text().trim().toLowerCase()).get();
  const wQuestions = headings.filter(h => /^(wer|was|wo|warum|wie|wann|welche|who|what|where|why|how|when|which)/.test(h));
  if (wQuestions.length > 0) contentPoints += 15;

  const bodyText = $('body').text();
  if (/\w+ ist (ein|eine|der|die|das)\b/i.test(bodyText)) contentPoints += 10;

  const numberMatches = bodyText.match(/\b\d+\b/g) || [];
  if (numberMatches.length >= 3) contentPoints += 5;

  // Lists and tables
  if ($('ul, ol').length > 0) contentPoints += 10;
  if ($('table').length > 0) contentPoints += 10;

  // First paragraph length
  const firstP = $('p').first().text().trim().split(/\s+/);
  if (firstP.length > 0 && firstP.length < 50) contentPoints += 5;

  const contentScore = Math.min(100, (contentPoints / maxContent) * 100);

  // ─── CATEGORY 3: ENTITY & AUTHORITY (15%) ─────────────────────────────────
  let entityPoints = 0;
  const maxEntity = 65;

  const allLinks = $('a').map((_, el) => $(el).attr('href') || '').get().join(' ').toLowerCase();
  const allText = bodyText.toLowerCase();

  if (/über uns|team|about us|about|unser team/.test(allLinks + allText)) entityPoints += 20;

  // sameAs links on socials
  const hasSocialLinks = jsonLdScripts.some(item =>
    Array.isArray(item?.sameAs) &&
    item.sameAs.some(s => /linkedin|facebook|instagram|twitter|xing/.test(s))
  );
  const hasSocialLinksInHtml = $('a[href*="linkedin"], a[href*="facebook"], a[href*="instagram"]').length > 0;
  if (hasSocialLinks || hasSocialLinksInHtml) entityPoints += 20;

  // Certificates/awards
  if (/zertifikat|auszeichnung|award|certified|sieger|preisträger|empfohlen von|partner von/i.test(allText)) entityPoints += 15;

  // Wikipedia in sameAs
  const hasWikipedia = jsonLdScripts.some(item =>
    Array.isArray(item?.sameAs) && item.sameAs.some(s => /wikipedia|wikidata/.test(s))
  );
  if (hasWikipedia) entityPoints += 10;

  manualChecks += 2; // NAP consistency, Google Business verification

  const entityScore = Math.min(100, (entityPoints / maxEntity) * 100);

  // ─── CATEGORY 4: CITABILITY (10%) ─────────────────────────────────────────
  let citPoints = 0;
  const maxCit = 100;

  if (/autor|author|von [A-ZÄÖÜ]/i.test(bodyText)) citPoints += 20;

  const hasTimeTag = $('time').length > 0;
  const hasDatePattern = /\b\d{1,2}\.\s*\w+\s*\d{4}\b|\d{4}-\d{2}-\d{2}/.test(bodyText);
  if (hasTimeTag || hasDatePattern) citPoints += 20;

  if (/zuletzt aktualisiert|last updated|stand:|aktualisiert am/i.test(bodyText)) citPoints += 15;

  if (/[\w.-]+@[\w.-]+\.\w{2,}|\+\d[\d\s\-()]{6,}/.test(bodyText)) citPoints += 15;

  const externalLinks = $('a[href^="http"]').filter((_, el) => {
    const href = $(el).attr('href') || '';
    return !href.includes(new URL(url).hostname);
  }).length;
  if (externalLinks > 0) citPoints += 15;

  if (/2024|2025|2026/.test(html)) citPoints += 15;

  const citScore = Math.min(100, (citPoints / maxCit) * 100);

  // ─── CATEGORY 5: TECHNICAL CRAWLABILITY (10%) ─────────────────────────────
  // Reuse same logic as SEO tech category
  let techPoints = 0;
  const maxTech = 100;

  if ($('meta[name="viewport"]').length > 0) techPoints += 15;
  if ($('link[rel="canonical"]').length > 0) techPoints += 10;

  const ogTitle = $('meta[property="og:title"]').attr('content');
  const ogDesc = $('meta[property="og:description"]').attr('content');
  const ogImage = $('meta[property="og:image"]').attr('content');
  if (ogTitle && ogDesc && ogImage) techPoints += 15;
  else if (ogTitle || ogDesc) techPoints += 7;

  const robotsMeta = $('meta[name="robots"]').attr('content') || '';
  if (!/noindex/i.test(robotsMeta)) techPoints += 10;

  const allImages = $('img');
  const imagesWithAlt = $('img[alt]').filter((_, el) => ($(el).attr('alt') || '').trim().length > 0);
  if (allImages.length === 0 || imagesWithAlt.length / allImages.length > 0.8) techPoints += 10;

  const [robotsResult, sitemapResult] = await Promise.all([
    checkPath(url, '/robots.txt'),
    checkPath(url, '/sitemap.xml'),
  ]);
  if (robotsResult.ok) techPoints += 10;
  if (sitemapResult.ok) techPoints += 10;

  const ps = cachedPageSpeed || await getPageSpeedMetrics(url);
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
  if (ps.lcp === null && ps.cls === null && ps.inp === null) {
    techPoints += 15;
  }

  const techScore = Math.min(100, (techPoints / maxTech) * 100);

  // ─── WEIGHTED TOTAL ───────────────────────────────────────────────────────
  let geoScore = Math.round(
    structuredScore * 0.40 +
    contentScore * 0.25 +
    entityScore * 0.15 +
    citScore * 0.10 +
    techScore * 0.10
  );

  // ─── BONUS ────────────────────────────────────────────────────────────────
  let bonus = 0;

  // Video with transcript
  const ytWithTitle = $('iframe[src*="youtube"], iframe[src*="youtu.be"]').filter((_, el) => $(el).attr('title'));
  if (ytWithTitle.length > 0 && /transkript|transcript|untertitel/i.test(bodyText)) bonus += 5;

  // hreflang
  if ($('link[rel="alternate"][hreflang]').length > 0) bonus += 2;

  // Interactive elements
  if ($('canvas, iframe').filter((_, el) => {
    const src = $(el).attr('src') || '';
    return !src.includes('youtube') && !src.includes('vimeo');
  }).length > 0) bonus += 3;

  geoScore = Math.min(110, geoScore + bonus);

  return {
    score: geoScore,
    manualChecks,
    breakdown: {
      structured: Math.round(structuredScore),
      content: Math.round(contentScore),
      entity: Math.round(entityScore),
      citability: Math.round(citScore),
      tech: Math.round(techScore),
      bonus,
    },
  };
}

module.exports = { analyzeGEO };
