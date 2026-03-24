/**
 * Faindable – Browser-seitiger Analyzer
 * Kein Node.js / Express nötig. Läuft direkt mit Live Server.
 *
 * HTML wird via CORS-Proxy (allorigins.win) gefetcht,
 * PageSpeed Insights direkt per API aufgerufen.
 */

'use strict';

// ─── Konstanten ───────────────────────────────────────────────────────────────
const CIRCUMFERENCE = 263.9; // 2 * π * 42

// Proxy-Definitionen: werden der Reihe nach probiert
const _PROXIES = [
  {
    // allorigins: liefert JSON { contents, status }
    build: u => `https://api.allorigins.win/get?url=${encodeURIComponent(u)}`,
    async parse(res, originalUrl) {
      const data     = await res.json();
      const httpCode = data?.status?.http_code ?? 200;
      if (httpCode >= 400) throw new Error(`HTTP ${httpCode}`);
      if (!data.contents)  throw new Error('empty response');
      return { html: data.contents, finalUrl: data?.status?.url || originalUrl };
    },
    async checkOk(res) {
      const data = await res.json();
      return (data?.status?.http_code ?? 200) < 400;
    },
  },
  {
    // corsproxy.io: liefert rohen HTML-Body
    build: u => `https://corsproxy.io/?${encodeURIComponent(u)}`,
    async parse(res, originalUrl) {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      if (!html)  throw new Error('empty response');
      return { html, finalUrl: originalUrl };
    },
    async checkOk(res) {
      return res.ok;
    },
  },
];

// ─── Fetch-Helfer ─────────────────────────────────────────────────────────────

/**
 * Fetcht eine URL via CORS-Proxy mit automatischem Fallback.
 * Gibt { html, finalUrl } zurück.
 */
async function _fetchWithProxy(url) {
  let lastError = null;

  for (const proxy of _PROXIES) {
    const controller = new AbortController();
    const timer      = setTimeout(() => controller.abort(), 25000);

    try {
      const res = await fetch(proxy.build(url), { signal: controller.signal });
      const result = await proxy.parse(res, url);
      clearTimeout(timer);
      return result;
    } catch (err) {
      clearTimeout(timer);
      if (err.name === 'AbortError') {
        lastError = new Error('Die Analyse hat zu lange gedauert. Bitte versuche es erneut.');
      } else if (err.message.includes('HTTP 4')) {
        // 4xx direkt weitergeben, kein Fallback nötig
        throw new Error('Diese Seite konnten wir leider nicht erreichen. Bitte prüfe die URL.');
      } else {
        lastError = err;
      }
      // Nächsten Proxy versuchen
    }
  }

  throw lastError ?? new Error('Diese Seite konnten wir leider nicht erreichen. Bitte prüfe die URL.');
}

/**
 * Prüft ob ein Pfad (z.B. /robots.txt) erreichbar ist.
 * Nutzt den ersten verfügbaren Proxy — ohne Fehler-Propagation.
 */
async function _checkPath(baseUrl, path) {
  try {
    const targetUrl = new URL(path, baseUrl).href;

    for (const proxy of _PROXIES) {
      const controller = new AbortController();
      const timer      = setTimeout(() => controller.abort(), 8000);
      try {
        const res = await fetch(proxy.build(targetUrl), { signal: controller.signal });
        const ok  = await proxy.checkOk(res);
        clearTimeout(timer);
        return { ok };
      } catch {
        clearTimeout(timer);
        // Nächsten Proxy versuchen
      }
    }
  } catch { /* ignore */ }
  return { ok: false };
}

/**
 * Ruft Google PageSpeed Insights auf. Gibt null-Werte zurück wenn kein Key.
 */
async function _getPageSpeed(url) {
  const empty = { lcp: null, inp: null, cls: null, performanceScore: null };
  const apiKey = window.FAINDABLE_CONFIG?.PAGESPEED_API_KEY;
  if (!apiKey) return empty;

  try {
    const endpoint =
      `https://www.googleapis.com/pagespeedonline/v5/runPagespeed` +
      `?url=${encodeURIComponent(url)}&strategy=mobile&category=performance&key=${apiKey}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);

    try {
      const res = await fetch(endpoint, { signal: controller.signal });
      if (!res.ok) return empty;
      const data = await res.json();

      const audits     = data?.lighthouseResult?.audits     ?? {};
      const categories = data?.lighthouseResult?.categories ?? {};

      const lcpMs = audits['largest-contentful-paint']?.numericValue   ?? null;
      const inpMs = audits['interaction-to-next-paint']?.numericValue  ??
                    audits['total-blocking-time']?.numericValue          ?? null;
      const cls   = audits['cumulative-layout-shift']?.numericValue     ?? null;

      const performanceScore = categories?.performance?.score != null
        ? Math.round(categories.performance.score * 100)
        : null;

      return {
        lcp: lcpMs != null ? lcpMs / 1000 : null,
        inp: inpMs,
        cls,
        performanceScore,
      };
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return empty;
  }
}

// ─── Haupt-Einstiegspunkt ─────────────────────────────────────────────────────

/**
 * Analysiert eine URL und gibt { seo, geo, overall, manual_checks, analyzed_url } zurück.
 */
async function analyzeUrl(rawUrl) {
  let url = rawUrl.trim();
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'https://' + url;
  }

  // 1. HTML fetchen
  const { html, finalUrl } = await _fetchWithProxy(url);

  // 2. PageSpeed parallel starten (feuert und wird abgewartet)
  const psPromise = _getPageSpeed(finalUrl);

  // 3. HTML-Analyzer initialisieren
  const analyzer = new PageAnalyzer(html, finalUrl);

  // 4. robots.txt + sitemap.xml parallel prüfen
  const [robotsResult, sitemapResult, psData] = await Promise.all([
    _checkPath(finalUrl, '/robots.txt'),
    _checkPath(finalUrl, '/sitemap.xml'),
    psPromise,
  ]);

  // 5. SEO + GEO parallel berechnen
  const pathChecks = { robots: robotsResult, sitemap: sitemapResult };
  const [seoResult, geoResult] = await Promise.all([
    analyzer.analyzeSEO(psData, pathChecks),
    analyzer.analyzeGEO(psData, pathChecks),
  ]);

  const seo    = Math.min(100, seoResult.score);
  const geo    = Math.min(100, geoResult.score);
  const overall = Math.round(seo * 0.5 + geo * 0.5);

  return {
    seo,
    geo,
    overall,
    manual_checks: seoResult.manualChecks + geoResult.manualChecks,
    analyzed_url: finalUrl,
  };
}

// ─── PageAnalyzer ─────────────────────────────────────────────────────────────

class PageAnalyzer {
  constructor(html, url) {
    this.url  = url;
    this.html = html;

    const parser = new DOMParser();
    this.doc      = parser.parseFromString(html, 'text/html');
    this.bodyText = (this.doc.body?.textContent ?? '').replace(/\s+/g, ' ');
  }

  // ── DOM-Helfer ──────────────────────────────────────────────────────────────
  q(sel)  { return this.doc.querySelector(sel); }
  qa(sel) { return Array.from(this.doc.querySelectorAll(sel)); }

  _allLinksText() {
    return this.qa('a[href]')
      .map(a => (a.getAttribute('href') ?? '') + ' ' + a.textContent.toLowerCase())
      .join(' ');
  }

  // ── Schema.org ──────────────────────────────────────────────────────────────
  _getSchemas() {
    const schemas = [];
    this.qa('script[type="application/ld+json"]').forEach(el => {
      try {
        const parsed = JSON.parse(el.textContent ?? '{}');
        if (Array.isArray(parsed)) schemas.push(...parsed);
        else schemas.push(parsed);
      } catch { /* ignore invalid JSON */ }
    });
    return schemas;
  }

  _getSchema(type) {
    return this._getSchemas().find(s =>
      s?.['@type'] === type ||
      (Array.isArray(s?.['@type']) && s['@type'].includes(type))
    ) ?? null;
  }

  // ── PageSpeed-Tech-Punkte (geteilt zwischen SEO & GEO) ─────────────────────
  _calcTechPoints(ps, pathChecks) {
    let pts = 0;

    if (this.q('meta[name="viewport"]'))  pts += 15;
    if (this.q('link[rel="canonical"]'))  pts += 10;

    const ogTitle = this.q('meta[property="og:title"]')?.getAttribute('content');
    const ogDesc  = this.q('meta[property="og:description"]')?.getAttribute('content');
    const ogImg   = this.q('meta[property="og:image"]')?.getAttribute('content');
    if (ogTitle && ogDesc && ogImg) pts += 15;
    else if (ogTitle || ogDesc)     pts += 7;

    const robotsMeta = this.q('meta[name="robots"]')?.getAttribute('content') ?? '';
    if (!/noindex/i.test(robotsMeta)) pts += 10;

    const imgs       = this.qa('img');
    const imgsWithAlt = imgs.filter(img => (img.getAttribute('alt') ?? '').trim().length > 0);
    if (imgs.length === 0 || imgsWithAlt.length / imgs.length > 0.8) pts += 10;

    if (pathChecks.robots.ok)  pts += 10;
    if (pathChecks.sitemap.ok) pts += 10;

    if (ps.lcp  != null) { if (ps.lcp  < 2.5) pts += 10; else if (ps.lcp  < 4)   pts += 5; }
    if (ps.cls  != null) { if (ps.cls  < 0.1) pts += 10; else if (ps.cls  < 0.25) pts += 5; }
    if (ps.inp  != null) { if (ps.inp  < 200)  pts += 10; else if (ps.inp  < 500)  pts += 5; }

    // Kein PageSpeed-Key → neutrale Teilgutschrift
    if (ps.lcp == null && ps.cls == null && ps.inp == null) pts += 15;

    return Math.min(100, (pts / 100) * 100);
  }

  // ══════════════════════════════════════════════════════════ SEO ANALYSE ════

  analyzeSEO(ps, pathChecks) {
    let manualChecks = 0;
    const allLinks = this._allLinksText();
    const text     = this.bodyText.toLowerCase();

    // ── Kategorie 1: E-E-A-T (35%) ──────────────────────────────────────────
    let eeatPts = 0;

    if (this.url.startsWith('https://'))                                        eeatPts += 20;
    if (/impressum|datenschutz|agb|legal|privacy|cookie/.test(allLinks + text)) eeatPts += 15;
    if (/autor|author|über mich|about me|team/.test(allLinks + text))           eeatPts += 10;
    if (/kontakt|contact/.test(allLinks))                                       eeatPts += 10;

    const schemas = this._getSchemas();
    if (schemas.some(s => s?.author || s?.['@type'] === 'Person'))              eeatPts += 5;

    manualChecks += 2; // Backlinks, Erwähnungen in Medien

    const eeatScore = Math.min(100, (eeatPts / 60) * 100);

    // ── Kategorie 2: On-Page & Semantik (25%) ────────────────────────────────
    let onPts = 0;

    const title = this.q('title')?.textContent?.trim() ?? '';
    if (title)                                   onPts += 15;
    if (title.length >= 50 && title.length <= 60) onPts += 10;

    const metaDesc = this.q('meta[name="description"]')?.getAttribute('content') ?? '';
    if (metaDesc)                                                 onPts += 10;
    if (metaDesc.length >= 130 && metaDesc.length <= 160)         onPts += 5;

    const h1Count = this.qa('h1').length;
    if (h1Count === 1)          onPts += 15;
    if (this.qa('h2').length >= 2) onPts += 10;
    if (this.qa('h3').length > 0)  onPts += 5;

    try {
      const host = new URL(this.url).hostname;
      const intLinks = this.qa('a[href]').filter(a => {
        const href = a.getAttribute('href') ?? '';
        return href.startsWith('/') || href.includes(host);
      }).length;
      if (intLinks > 3) onPts += 10;
    } catch { /* ignore */ }

    const anchorTexts = this.qa('a').map(a => a.textContent.trim().toLowerCase());
    const badAnchors  = anchorTexts.filter(t => /^(hier|here|more|click|mehr|weiter|link|read more)$/.test(t));
    if (anchorTexts.length === 0 || badAnchors.length / anchorTexts.length < 0.3) onPts += 10;

    if (!/[?&]p=\d+/.test(this.url))             onPts += 5;
    if (this.q('link[rel*="icon"]'))              onPts += 5;

    const onPageScore = Math.min(100, (onPts / 100) * 100);

    // ── Kategorie 3: Technical SEO (20%) ────────────────────────────────────
    const techScore = this._calcTechPoints(ps, pathChecks);

    // ── Kategorie 4: Lokales SEO (10%) ───────────────────────────────────────
    let localPts = 0;

    const localSchema = this._getSchema('LocalBusiness') ||
                        this._getSchema('Organization')  ||
                        this._getSchema('Store')         ||
                        this._getSchema('Restaurant');
    if (localSchema) localPts += 30;

    if (/\+49|\(0\d+\)|☎|tel:|fon:/i.test(this.bodyText)) localPts += 20;
    if (/straße|str\.|strasse|platz|weg|allee/i.test(this.bodyText)) localPts += 20;

    manualChecks += 2; // Google Business Profile, NAP

    const localScore = Math.min(100, (localPts / 70) * 100);

    // ── Kategorie 5: User Signals (10%) ──────────────────────────────────────
    let userPts = 0;

    // Heuristik: keine aufdringlichen Overlays
    const fixedDivs = this.qa('div').filter(el => {
      const style = el.getAttribute('style') ?? '';
      const cls   = el.getAttribute('class') ?? '';
      return /position:\s*fixed/.test(style) || /\b(fixed|sticky)\b/.test(cls);
    });
    const badOverlays = fixedDivs.filter(el => !(el.getAttribute('aria-label') || el.getAttribute('role')));
    if (badOverlays.length < 2) userPts += 20;

    if (this.qa('img').length > 0) userPts += 20;
    if (this.qa('iframe[src*="youtube"], iframe[src*="vimeo"], iframe[src*="youtu.be"]').length > 0) userPts += 20;

    const words = this.bodyText.trim().split(/\s+/).filter(w => w.length > 2).length;
    if (words > 300) userPts += 20;

    manualChecks += 2; // Bounce Rate, Dwell Time

    const userScore = Math.min(100, (userPts / 80) * 100);

    // ── Gewichteter Gesamt-Score ─────────────────────────────────────────────
    let seoScore = Math.round(
      eeatScore  * 0.35 +
      onPageScore * 0.25 +
      techScore  * 0.20 +
      localScore * 0.10 +
      userScore  * 0.10
    );

    // ── Bonus ────────────────────────────────────────────────────────────────
    let bonus = 0;

    const ytFrames = this.qa('iframe[src*="youtube"], iframe[src*="youtu.be"]');
    if (ytFrames.length > 0 && ytFrames[0].getAttribute('title')) bonus += 5;

    if (schemas.some(s => s?.['@type'] === 'AggregateRating' || s?.aggregateRating)) bonus += 3;
    if (/202[4-6]/.test(this.html)) bonus += 2;

    seoScore = Math.min(110, seoScore + bonus);

    return { score: seoScore, manualChecks, bonus };
  }

  // ══════════════════════════════════════════════════════════ GEO ANALYSE ════

  analyzeGEO(ps, pathChecks) {
    let manualChecks = 0;
    const schemas    = this._getSchemas();
    const allLinks   = this._allLinksText();
    const text       = this.bodyText.toLowerCase();

    // ── Kategorie 1: Structured Data / Schema.org (40%) ──────────────────────
    let structPts = 0, structMax = 0;

    // Organization / LocalBusiness
    const orgSchema = this._getSchema('Organization') ||
                      this._getSchema('LocalBusiness') ||
                      this._getSchema('Store')         ||
                      this._getSchema('Restaurant');
    structMax += 100;
    if (orgSchema) {
      structPts += 20;
      if (orgSchema.name)        structPts += 10;
      if (orgSchema.description) structPts += 10;
      if (orgSchema.address)     structPts += 15;
      if (orgSchema.telephone)   structPts += 10;
      if (orgSchema.url)         structPts += 5;
      if (orgSchema.logo)        structPts += 10;
      if (Array.isArray(orgSchema.sameAs) && orgSchema.sameAs.length > 0) structPts += 10;
      if (orgSchema.openingHours || orgSchema.openingHoursSpecification)   structPts += 5;
      if (orgSchema.geo || orgSchema.hasMap) structPts += 5;
    }

    // FAQPage
    const faqSchema = this._getSchema('FAQPage');
    structMax += 50;
    if (faqSchema) {
      structPts += 30;
      const qs = faqSchema.mainEntity;
      if (Array.isArray(qs) && qs.length >= 2) structPts += 20;
    }

    // Service / Product
    const serviceSchema = this._getSchema('Service') || this._getSchema('Product');
    structMax += 30;
    if (serviceSchema) {
      structPts += 20;
      if (serviceSchema.serviceType || serviceSchema.description) structPts += 10;
    }

    // Article / BlogPosting
    const articleSchema = this._getSchema('Article') ||
                          this._getSchema('BlogPosting') ||
                          this._getSchema('NewsArticle');
    structMax += 40;
    if (articleSchema) {
      structPts += 20;
      if (articleSchema.author)        structPts += 10;
      if (articleSchema.datePublished) structPts += 10;
    }

    // AggregateRating
    const aggRating = this._getSchema('AggregateRating') ||
                      schemas.find(s => s?.aggregateRating);
    structMax += 30;
    if (aggRating) {
      structPts += 20;
      const rd = aggRating?.aggregateRating ?? aggRating;
      if (rd?.ratingValue && rd?.reviewCount) structPts += 10;
    }

    const structuredScore = structMax > 0 ? Math.min(100, (structPts / structMax) * 100) : 0;

    // ── Kategorie 2: Content-Struktur (25%) ──────────────────────────────────
    let contentPts = 0;

    if (this.qa('h1').length === 1)    contentPts += 15;
    if (this.qa('h2').length >= 2)     contentPts += 10;
    if (this.qa('h3').length > 0)      contentPts += 5;
    if (this.q('main'))                contentPts += 10;
    if (this.qa('article, section').length > 0) contentPts += 10;
    if (this.q('aside'))               contentPts += 5;

    const headingTexts = this.qa('h1, h2, h3, h4').map(h => h.textContent.trim().toLowerCase());
    const wQuestions   = headingTexts.filter(h =>
      /^(wer|was|wo|warum|wie|wann|welche|who|what|where|why|how|when|which)/.test(h)
    );
    if (wQuestions.length > 0) contentPts += 15;

    if (/\w+ ist (ein|eine|der|die|das)\b/i.test(this.bodyText)) contentPts += 10;

    const numbers = this.bodyText.match(/\b\d+\b/g) ?? [];
    if (numbers.length >= 3) contentPts += 5;

    if (this.qa('ul, ol').length > 0) contentPts += 10;
    if (this.q('table'))              contentPts += 10;

    const firstPWords = (this.q('p')?.textContent ?? '').trim().split(/\s+/);
    if (firstPWords.length > 0 && firstPWords.length < 50) contentPts += 5;

    const contentScore = Math.min(100, (contentPts / 110) * 100);

    // ── Kategorie 3: Entity & Authority (15%) ────────────────────────────────
    let entityPts = 0;

    if (/über uns|team|about us|about|unser team/.test(allLinks + text)) entityPts += 20;

    const hasSocialSchema = schemas.some(s =>
      Array.isArray(s?.sameAs) &&
      s.sameAs.some(link => /linkedin|facebook|instagram|twitter|xing/.test(link))
    );
    const hasSocialHtml = this.qa('a[href*="linkedin"], a[href*="facebook"], a[href*="instagram"]').length > 0;
    if (hasSocialSchema || hasSocialHtml) entityPts += 20;

    if (/zertifikat|auszeichnung|award|certified|preisträger|empfohlen von|partner von/i.test(this.bodyText)) entityPts += 15;

    const hasWikiSameAs = schemas.some(s =>
      Array.isArray(s?.sameAs) && s.sameAs.some(link => /wikipedia|wikidata/.test(link))
    );
    if (hasWikiSameAs) entityPts += 10;

    manualChecks += 2; // NAP-Konsistenz, Google Business

    const entityScore = Math.min(100, (entityPts / 65) * 100);

    // ── Kategorie 4: Zitierfähigkeit (10%) ───────────────────────────────────
    let citPts = 0;

    if (/autor|author|von [A-ZÄÖÜ]/i.test(this.bodyText)) citPts += 20;

    const hasTimeTag    = this.q('time') != null;
    const hasDatePattern = /\b\d{1,2}\.\s*\w+\s*\d{4}\b|\d{4}-\d{2}-\d{2}/.test(this.bodyText);
    if (hasTimeTag || hasDatePattern) citPts += 20;

    if (/zuletzt aktualisiert|last updated|stand:|aktualisiert am/i.test(this.bodyText)) citPts += 15;
    if (/[\w.-]+@[\w.-]+\.\w{2,}|\+\d[\d\s\-()]{6,}/.test(this.bodyText))               citPts += 15;

    try {
      const host        = new URL(this.url).hostname;
      const extLinks    = this.qa('a[href^="http"]').filter(a =>
        !(a.getAttribute('href') ?? '').includes(host)
      );
      if (extLinks.length > 0) citPts += 15;
    } catch { /* ignore */ }

    if (/202[4-6]/.test(this.html)) citPts += 15;

    const citScore = Math.min(100, (citPts / 100) * 100);

    // ── Kategorie 5: Technische Crawlbarkeit (10%) ────────────────────────────
    const techScore = this._calcTechPoints(ps, pathChecks);

    // ── Gewichteter Gesamt-Score ─────────────────────────────────────────────
    let geoScore = Math.round(
      structuredScore * 0.40 +
      contentScore    * 0.25 +
      entityScore     * 0.15 +
      citScore        * 0.10 +
      techScore       * 0.10
    );

    // ── Bonus ────────────────────────────────────────────────────────────────
    let bonus = 0;

    const ytWithTitle = this.qa('iframe[src*="youtube"], iframe[src*="youtu.be"]')
      .filter(el => el.getAttribute('title'));
    if (ytWithTitle.length > 0 && /transkript|transcript|untertitel/i.test(this.bodyText)) bonus += 5;

    if (this.qa('link[rel="alternate"][hreflang]').length > 0) bonus += 2;

    const interactiveFrames = this.qa('canvas, iframe').filter(el => {
      const src = el.getAttribute('src') ?? '';
      return !src.includes('youtube') && !src.includes('vimeo');
    });
    if (interactiveFrames.length > 0) bonus += 3;

    geoScore = Math.min(110, geoScore + bonus);

    return { score: geoScore, manualChecks, bonus };
  }
}
