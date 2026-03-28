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
    seoData: seoResult,
    geoData: geoResult,
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
  _calcTech(ps, pathChecks) {
    const C = {};
    let pts = 0;

    C.viewport  = !!this.q('meta[name="viewport"]');  if (C.viewport)  pts += 15;
    C.canonical = !!this.q('link[rel="canonical"]');  if (C.canonical) pts += 10;

    const ogTitle = this.q('meta[property="og:title"]')?.getAttribute('content');
    const ogDesc  = this.q('meta[property="og:description"]')?.getAttribute('content');
    const ogImg   = this.q('meta[property="og:image"]')?.getAttribute('content');
    C.ogFull    = !!(ogTitle && ogDesc && ogImg);
    C.ogPartial = !!(ogTitle || ogDesc) && !C.ogFull;
    if (C.ogFull) pts += 15; else if (C.ogPartial) pts += 7;

    const robotsMeta = this.q('meta[name="robots"]')?.getAttribute('content') ?? '';
    C.noindex = !/noindex/i.test(robotsMeta); if (C.noindex) pts += 10;

    const imgs         = this.qa('img');
    const imgsWithAlt  = imgs.filter(img => (img.getAttribute('alt') ?? '').trim().length > 0);
    C.imgAlt = imgs.length === 0 || imgsWithAlt.length / imgs.length > 0.8; if (C.imgAlt) pts += 10;

    C.robotsTxt  = pathChecks.robots.ok;  if (C.robotsTxt)  pts += 10;
    C.sitemapXml = pathChecks.sitemap.ok; if (C.sitemapXml) pts += 10;

    C.lcpGood = ps.lcp != null ? ps.lcp < 2.5 : null;
    C.clsGood = ps.cls != null ? ps.cls < 0.1 : null;
    C.inpGood = ps.inp != null ? ps.inp < 200  : null;
    if (ps.lcp != null) { if (ps.lcp < 2.5) pts += 10; else if (ps.lcp < 4)    pts += 5; }
    if (ps.cls != null) { if (ps.cls < 0.1) pts += 10; else if (ps.cls < 0.25) pts += 5; }
    if (ps.inp != null) { if (ps.inp < 200) pts += 10; else if (ps.inp < 500)  pts += 5; }
    if (ps.lcp == null && ps.cls == null && ps.inp == null) pts += 15;

    return { score: Math.min(100, pts), checks: C };
  }

  // ══════════════════════════════════════════════════════════ SEO ANALYSE ════

  analyzeSEO(ps, pathChecks) {
    let manualChecks = 0;
    const allLinks = this._allLinksText();
    const text     = this.bodyText.toLowerCase();
    const schemas  = this._getSchemas();
    const C        = {};   // individual check results

    // ── E-E-A-T ────────────────────────────────────────────────────────────
    C.https        = this.url.startsWith('https://');
    C.legal        = /impressum|datenschutz|agb|legal|privacy|cookie/.test(allLinks + text);
    C.author       = /autor|author|über mich|about me|team/.test(allLinks + text);
    C.contact      = /kontakt|contact/.test(allLinks);
    C.personSchema = schemas.some(s => s?.author || s?.['@type'] === 'Person');

    let eeatPts = 0;
    if (C.https)        eeatPts += 20;
    if (C.legal)        eeatPts += 15;
    if (C.author)       eeatPts += 10;
    if (C.contact)      eeatPts += 10;
    if (C.personSchema) eeatPts += 5;
    manualChecks += 2;
    const eeatScore = Math.min(100, (eeatPts / 60) * 100);

    // ── On-Page & Semantik ────────────────────────────────────────────────
    const title    = this.q('title')?.textContent?.trim() ?? '';
    const metaDesc = this.q('meta[name="description"]')?.getAttribute('content') ?? '';
    const h1Count  = this.qa('h1').length;

    C.titleExists    = !!title;
    C.titleLen       = title.length >= 50 && title.length <= 60;
    C.metaDescExists = !!metaDesc;
    C.metaDescLen    = metaDesc.length >= 130 && metaDesc.length <= 160;
    C.h1Single       = h1Count === 1;
    C.h2Multiple     = this.qa('h2').length >= 2;
    C.h3Present      = this.qa('h3').length > 0;

    try {
      const host = new URL(this.url).hostname;
      const intLinks = this.qa('a[href]').filter(a => {
        const href = a.getAttribute('href') ?? '';
        return href.startsWith('/') || href.includes(host);
      }).length;
      C.intLinks = intLinks > 3;
    } catch { C.intLinks = false; }

    const anchorTexts = this.qa('a').map(a => a.textContent.trim().toLowerCase());
    const badAnchors  = anchorTexts.filter(t => /^(hier|here|more|click|mehr|weiter|link|read more)$/.test(t));
    C.anchorQuality   = anchorTexts.length === 0 || badAnchors.length / anchorTexts.length < 0.3;
    C.urlClean        = !/[?&]p=\d+/.test(this.url);
    C.favicon         = !!this.q('link[rel*="icon"]');

    let onPts = 0;
    if (C.titleExists)    onPts += 15;
    if (C.titleLen)       onPts += 10;
    if (C.metaDescExists) onPts += 10;
    if (C.metaDescLen)    onPts += 5;
    if (C.h1Single)       onPts += 15;
    if (C.h2Multiple)     onPts += 10;
    if (C.h3Present)      onPts += 5;
    if (C.intLinks)       onPts += 10;
    if (C.anchorQuality)  onPts += 10;
    if (C.urlClean)       onPts += 5;
    if (C.favicon)        onPts += 5;
    const onPageScore = Math.min(100, (onPts / 100) * 100);

    // ── Technical SEO ─────────────────────────────────────────────────────
    const techResult = this._calcTech(ps, pathChecks);
    const techScore  = techResult.score;
    C.viewport   = techResult.checks.viewport;
    C.canonical  = techResult.checks.canonical;
    C.ogFull     = techResult.checks.ogFull;
    C.ogPartial  = techResult.checks.ogPartial;
    C.noindex    = techResult.checks.noindex;
    C.imgAlt     = techResult.checks.imgAlt;
    C.robotsTxt  = techResult.checks.robotsTxt;
    C.sitemapXml = techResult.checks.sitemapXml;
    C.lcpGood    = techResult.checks.lcpGood;
    C.clsGood    = techResult.checks.clsGood;
    C.inpGood    = techResult.checks.inpGood;

    // ── Lokales SEO ───────────────────────────────────────────────────────
    const localSchema = this._getSchema('LocalBusiness') ||
                        this._getSchema('Organization')  ||
                        this._getSchema('Store')         ||
                        this._getSchema('Restaurant');
    C.localSchema = !!localSchema;
    C.phone       = /\+49|\(0\d+\)|☎|tel:|fon:/i.test(this.bodyText);
    C.address     = /straße|str\.|strasse|platz|weg|allee/i.test(this.bodyText);

    let localPts = 0;
    if (C.localSchema) localPts += 30;
    if (C.phone)       localPts += 20;
    if (C.address)     localPts += 20;
    manualChecks += 2;
    const localScore = Math.min(100, (localPts / 70) * 100);

    // ── User Signals ──────────────────────────────────────────────────────
    const fixedDivs = this.qa('div').filter(el => {
      const style = el.getAttribute('style') ?? '';
      const cls   = el.getAttribute('class') ?? '';
      return /position:\s*fixed/.test(style) || /\b(fixed|sticky)\b/.test(cls);
    });
    const badOverlays = fixedDivs.filter(el => !(el.getAttribute('aria-label') || el.getAttribute('role')));
    const words = this.bodyText.trim().split(/\s+/).filter(w => w.length > 2).length;

    C.noOverlays = badOverlays.length < 2;
    C.hasImages  = this.qa('img').length > 0;
    C.hasVideo   = this.qa('iframe[src*="youtube"], iframe[src*="vimeo"], iframe[src*="youtu.be"]').length > 0;
    C.contentLen = words > 300;

    let userPts = 0;
    if (C.noOverlays) userPts += 20;
    if (C.hasImages)  userPts += 20;
    if (C.hasVideo)   userPts += 20;
    if (C.contentLen) userPts += 20;
    manualChecks += 2;
    const userScore = Math.min(100, (userPts / 80) * 100);

    // ── Gesamt-Score (gewichtet) ───────────────────────────────────────────
    let seoScore = Math.round(
      eeatScore  * 0.35 +
      onPageScore * 0.25 +
      techScore  * 0.20 +
      localScore * 0.10 +
      userScore  * 0.10
    );

    let bonus = 0;
    const ytFrames = this.qa('iframe[src*="youtube"], iframe[src*="youtu.be"]');
    if (ytFrames.length > 0 && ytFrames[0].getAttribute('title')) bonus += 5;
    if (schemas.some(s => s?.['@type'] === 'AggregateRating' || s?.aggregateRating)) bonus += 3;
    if (/202[4-6]/.test(this.html)) bonus += 2;
    seoScore = Math.min(110, seoScore + bonus);

    return {
      score: seoScore,
      manualChecks,
      bonus,
      cats:   { eeat: Math.round(eeatScore), onPage: Math.round(onPageScore), tech: Math.round(techScore), local: Math.round(localScore), user: Math.round(userScore) },
      checks: C,
    };
  }

  // ══════════════════════════════════════════════════════════ GEO ANALYSE ════

  analyzeGEO(ps, pathChecks) {
    let manualChecks = 0;
    const schemas  = this._getSchemas();
    const allLinks = this._allLinksText();
    const text     = this.bodyText.toLowerCase();
    const C        = {};

    // ── Structured Data ───────────────────────────────────────────────────
    let structPts = 0, structMax = 0;

    const orgSchema = this._getSchema('Organization') ||
                      this._getSchema('LocalBusiness') ||
                      this._getSchema('Store')         ||
                      this._getSchema('Restaurant');
    structMax += 100;
    C.orgSchema    = !!orgSchema;
    C.orgName      = !!orgSchema?.name;
    C.orgDesc      = !!orgSchema?.description;
    C.orgAddress   = !!orgSchema?.address;
    C.orgPhone     = !!orgSchema?.telephone;
    C.orgLogo      = !!orgSchema?.logo;
    C.orgSameAs    = Array.isArray(orgSchema?.sameAs) && orgSchema.sameAs.length > 0;
    C.orgHours     = !!(orgSchema?.openingHours || orgSchema?.openingHoursSpecification);
    C.orgGeo       = !!(orgSchema?.geo || orgSchema?.hasMap);
    if (C.orgSchema) {
      structPts += 20;
      if (C.orgName)    structPts += 10;
      if (C.orgDesc)    structPts += 10;
      if (C.orgAddress) structPts += 15;
      if (C.orgPhone)   structPts += 10;
      if (orgSchema?.url)  structPts += 5;
      if (C.orgLogo)    structPts += 10;
      if (C.orgSameAs)  structPts += 10;
      if (C.orgHours)   structPts += 5;
      if (C.orgGeo)     structPts += 5;
    }

    const faqSchema = this._getSchema('FAQPage');
    structMax += 50;
    C.faqSchema = !!faqSchema;
    C.faqItems  = Array.isArray(faqSchema?.mainEntity) && faqSchema.mainEntity.length >= 2;
    if (C.faqSchema) {
      structPts += 30;
      if (C.faqItems) structPts += 20;
    }

    const serviceSchema = this._getSchema('Service') || this._getSchema('Product');
    structMax += 30;
    C.serviceSchema = !!serviceSchema;
    C.serviceDesc   = !!(serviceSchema?.serviceType || serviceSchema?.description);
    if (C.serviceSchema) {
      structPts += 20;
      if (C.serviceDesc) structPts += 10;
    }

    const articleSchema = this._getSchema('Article') ||
                          this._getSchema('BlogPosting') ||
                          this._getSchema('NewsArticle');
    structMax += 40;
    C.articleSchema  = !!articleSchema;
    C.articleAuthor  = !!articleSchema?.author;
    C.articleDate    = !!articleSchema?.datePublished;
    if (C.articleSchema) {
      structPts += 20;
      if (C.articleAuthor) structPts += 10;
      if (C.articleDate)   structPts += 10;
    }

    const aggRating = this._getSchema('AggregateRating') ||
                      schemas.find(s => s?.aggregateRating);
    structMax += 30;
    C.ratingSchema = !!aggRating;
    C.ratingFull   = !!(aggRating?.aggregateRating?.ratingValue && aggRating?.aggregateRating?.reviewCount) ||
                     !!(aggRating?.ratingValue && aggRating?.reviewCount);
    if (C.ratingSchema) {
      structPts += 20;
      if (C.ratingFull) structPts += 10;
    }

    const structuredScore = structMax > 0 ? Math.min(100, (structPts / structMax) * 100) : 0;

    // ── Content-Struktur ──────────────────────────────────────────────────
    let contentPts = 0;

    C.geoH1      = this.qa('h1').length === 1;
    C.geoH2      = this.qa('h2').length >= 2;
    C.geoH3      = this.qa('h3').length > 0;
    C.mainTag    = !!this.q('main');
    C.sectionTag = this.qa('article, section').length > 0;
    C.asideTag   = !!this.q('aside');

    const headingTexts = this.qa('h1, h2, h3, h4').map(h => h.textContent.trim().toLowerCase());
    C.wQuestions = headingTexts.some(h =>
      /^(wer|was|wo|warum|wie|wann|welche|who|what|where|why|how|when|which)/.test(h)
    );
    C.definition = /\w+ ist (ein|eine|der|die|das)\b/i.test(this.bodyText);
    const numbers = this.bodyText.match(/\b\d+\b/g) ?? [];
    C.numbers    = numbers.length >= 3;
    C.lists      = this.qa('ul, ol').length > 0;
    C.table      = !!this.q('table');

    const firstPWords = (this.q('p')?.textContent ?? '').trim().split(/\s+/);
    C.shortIntro = firstPWords.length > 0 && firstPWords.length < 50;

    if (C.geoH1)      contentPts += 15;
    if (C.geoH2)      contentPts += 10;
    if (C.geoH3)      contentPts += 5;
    if (C.mainTag)    contentPts += 10;
    if (C.sectionTag) contentPts += 10;
    if (C.asideTag)   contentPts += 5;
    if (C.wQuestions) contentPts += 15;
    if (C.definition) contentPts += 10;
    if (C.numbers)    contentPts += 5;
    if (C.lists)      contentPts += 10;
    if (C.table)      contentPts += 10;
    if (C.shortIntro) contentPts += 5;
    const contentScore = Math.min(100, (contentPts / 110) * 100);

    // ── Entity & Authority ─────────────────────────────────────────────────
    let entityPts = 0;

    C.aboutPage    = /über uns|team|about us|about|unser team/.test(allLinks + text);
    const hasSocialSchema = schemas.some(s =>
      Array.isArray(s?.sameAs) &&
      s.sameAs.some(link => /linkedin|facebook|instagram|twitter|xing/.test(link))
    );
    const hasSocialHtml = this.qa('a[href*="linkedin"], a[href*="facebook"], a[href*="instagram"]').length > 0;
    C.socialLinks  = hasSocialHtml;
    C.socialSchema = hasSocialSchema;
    C.awards       = /zertifikat|auszeichnung|award|certified|preisträger|empfohlen von|partner von/i.test(this.bodyText);
    C.wikiSameAs   = schemas.some(s =>
      Array.isArray(s?.sameAs) && s.sameAs.some(link => /wikipedia|wikidata/.test(link))
    );

    if (C.aboutPage)                    entityPts += 20;
    if (hasSocialSchema || hasSocialHtml) entityPts += 20;
    if (C.awards)                       entityPts += 15;
    if (C.wikiSameAs)                   entityPts += 10;
    manualChecks += 2;
    const entityScore = Math.min(100, (entityPts / 65) * 100);

    // ── Zitierfähigkeit ────────────────────────────────────────────────────
    let citPts = 0;

    C.authorMention = /autor|author|von [A-ZÄÖÜ]/i.test(this.bodyText);
    const hasTimeTag    = this.q('time') != null;
    const hasDatePattern = /\b\d{1,2}\.\s*\w+\s*\d{4}\b|\d{4}-\d{2}-\d{2}/.test(this.bodyText);
    C.datePresent   = hasTimeTag || hasDatePattern;
    C.timeTag       = hasTimeTag;
    C.lastUpdated   = /zuletzt aktualisiert|last updated|stand:|aktualisiert am/i.test(this.bodyText);
    C.contactInfo   = /[\w.-]+@[\w.-]+\.\w{2,}|\+\d[\d\s\-()]{6,}/.test(this.bodyText);
    C.recentDate    = /202[4-6]/.test(this.html);

    try {
      const host     = new URL(this.url).hostname;
      const extLinks = this.qa('a[href^="http"]').filter(a =>
        !(a.getAttribute('href') ?? '').includes(host)
      );
      C.extLinks = extLinks.length > 0;
    } catch { C.extLinks = false; }

    if (C.authorMention) citPts += 20;
    if (C.datePresent)   citPts += 20;
    if (C.lastUpdated)   citPts += 15;
    if (C.contactInfo)   citPts += 15;
    if (C.extLinks)      citPts += 15;
    if (C.recentDate)    citPts += 15;
    const citScore = Math.min(100, (citPts / 100) * 100);

    // ── Technical Crawlability ────────────────────────────────────────────
    const techResult = this._calcTech(ps, pathChecks);
    const techScore  = techResult.score;
    C.geoViewport   = techResult.checks.viewport;
    C.geoCanonical  = techResult.checks.canonical;
    C.geoOgFull     = techResult.checks.ogFull;
    C.geoNoindex    = techResult.checks.noindex;
    C.geoImgAlt     = techResult.checks.imgAlt;
    C.geoRobotsTxt  = techResult.checks.robotsTxt;
    C.geoSitemapXml = techResult.checks.sitemapXml;
    C.geoLcpGood    = techResult.checks.lcpGood;
    C.geoClsGood    = techResult.checks.clsGood;

    // ── Gesamt-Score (gewichtet) ───────────────────────────────────────────
    let geoScore = Math.round(
      structuredScore * 0.40 +
      contentScore    * 0.25 +
      entityScore     * 0.15 +
      citScore        * 0.10 +
      techScore       * 0.10
    );

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

    return {
      score: geoScore,
      manualChecks,
      bonus,
      cats: {
        structured: Math.round(structuredScore),
        content:    Math.round(contentScore),
        entity:     Math.round(entityScore),
        citation:   Math.round(citScore),
        tech:       Math.round(techScore),
      },
      checks: C,
    };
  }
}
