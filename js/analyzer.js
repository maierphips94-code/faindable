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
  // GEO v2 — 6 Kategorien, max 100 Punkte + Bonus

  analyzeGEO(ps, pathChecks) {
    let manualChecks = 0;
    const schemas  = this._getSchemas();
    const html     = this.html;
    const C        = {};

    const hasType = (type) => schemas.some(s =>
      s?.['@type'] === type ||
      (Array.isArray(s?.['@type']) && s['@type'].includes(type))
    );

    // ── K1: Structured Data (max 35 Pkt) ─────────────────────────────────
    let k1 = 0;

    // Organization / LocalBusiness (12 Pkt)
    const orgSchema = this._getSchema('Organization') ||
                      this._getSchema('LocalBusiness') ||
                      this._getSchema('Store')         ||
                      this._getSchema('Restaurant');
    C.orgSchema    = !!orgSchema;
    C.orgName      = !!orgSchema?.name;
    C.orgDesc      = !!orgSchema?.description;
    C.orgAddress   = !!orgSchema?.address;
    C.orgPhone     = !!orgSchema?.telephone;
    C.orgEmail     = !!orgSchema?.email;
    C.orgUrl       = !!orgSchema?.url;
    C.orgLogo      = !!orgSchema?.logo;
    C.orgImage     = !!orgSchema?.image;
    C.orgGeo       = !!(orgSchema?.geo || orgSchema?.hasMap);
    C.orgHours     = !!(orgSchema?.openingHours || orgSchema?.openingHoursSpecification);
    C.orgSameAs    = Array.isArray(orgSchema?.sameAs) && orgSchema.sameAs.length >= 2;
    C.orgPriceRange = !!orgSchema?.priceRange;
    const orgFields = ['orgName','orgDesc','orgAddress','orgPhone','orgEmail','orgLogo','orgImage','orgGeo','orgHours','orgSameAs','orgUrl','orgPriceRange'];
    k1 += orgFields.filter(f => C[f]).length; // max 12

    // FAQPage (9 Pkt)
    const faqSchema = this._getSchema('FAQPage');
    C.faqSchema       = !!faqSchema;
    const faqEntities = faqSchema?.mainEntity ?? [];
    C.faqItems3       = faqEntities.length >= 3;
    C.faqItems2       = faqEntities.length >= 2 && !C.faqItems3;
    C.faqLongAnswers  = faqEntities.filter(q => (q?.acceptedAnswer?.text ?? '').split(/\s+/).length >= 50).length >= 2;
    C.faqWQuestions   = faqEntities.filter(q => /^(wer|was|wie|wo|warum|wann|welche)/i.test(q?.name ?? '')).length >= 2;
    const firstQ = faqEntities[0]?.name ?? '';
    C.faqVisibleText  = firstQ.length > 0 && html.includes(firstQ.substring(0, 20));
    if (C.faqSchema) {
      if (C.faqItems3) k1 += 3; else if (C.faqItems2) k1 += 1;
      if (C.faqLongAnswers)  k1 += 2;
      if (C.faqWQuestions)   k1 += 2;
      if (C.faqVisibleText)  k1 += 2;
    }

    // Service/Product (7 Pkt)
    const serviceSchema = this._getSchema('Service') || this._getSchema('Product');
    C.serviceSchema = !!serviceSchema;
    C.serviceDesc   = !!(serviceSchema?.serviceType || serviceSchema?.description || serviceSchema?.areaServed);
    if (C.serviceSchema) { k1 += 4; if (C.serviceDesc) k1 += 3; }

    // HowTo (3 Pkt)
    C.howToSchema = hasType('HowTo');
    if (C.howToSchema) k1 += 3;

    // Article/BlogPosting (2 Pkt)
    const articleSchema = this._getSchema('Article') ||
                          this._getSchema('BlogPosting') ||
                          this._getSchema('NewsArticle');
    C.articleSchema = !!articleSchema;
    C.articleFull   = !!(articleSchema?.headline && articleSchema?.author && articleSchema?.datePublished);
    if (C.articleSchema) { k1 += 1; if (C.articleFull) k1 += 1; }

    // AggregateRating (2 Pkt)
    const aggRating = this._getSchema('AggregateRating') ||
                      schemas.find(s => s?.aggregateRating);
    C.ratingSchema = !!aggRating;
    const rv = aggRating?.aggregateRating ?? aggRating;
    C.ratingFull   = !!(rv?.ratingValue && rv?.reviewCount && Number(rv?.reviewCount) >= 5);
    if (C.ratingSchema) { k1 += 1; if (C.ratingFull) k1 += 1; }

    k1 = Math.min(k1, 35);

    // ── K2: Content-Struktur (max 22 Pkt) ────────────────────────────────
    let k2 = 0;

    const h1Count = this.qa('h1').length;
    const h2Count = this.qa('h2').length;
    const h3Count = this.qa('h3').length;
    const headingTexts = this.qa('h1, h2, h3, h4').map(h => h.textContent.trim().toLowerCase());

    // Semantische HTML-Hierarchie (5 Pkt)
    C.geoH1      = h1Count === 1;          if (C.geoH1)      k2 += 1;
    C.geoH2      = h2Count >= 2;           if (C.geoH2)      k2 += 1;
    C.geoH3      = h3Count > 0;            if (C.geoH3)      k2 += 1;
    C.mainTag    = !!this.q('main');
    C.sectionTag = this.qa('article, section').length > 0;
    if (C.mainTag || C.sectionTag)         k2 += 2;

    // Frage-Antwort-Struktur (5 Pkt)
    C.wQuestions = headingTexts.filter(h =>
      /^(wer|was|wo|warum|wie|wann|welche|who|what|where|why|how|when|which)/.test(h)
    ).length >= 2;
    if (C.wQuestions) k2 += 2;
    C.directAnswer = headingTexts.some(h =>
      /^(wer|was|wo|warum|wie|wann|welche)/.test(h)
    ) && /\bis (ein|eine|der|die|das|eine)\b/i.test(
      (() => {
        const headEls = this.qa('h2, h3');
        for (const h of headEls) {
          const next = h.nextElementSibling;
          if (next && next.tagName === 'P') return next.textContent;
        }
        return '';
      })()
    );
    if (C.directAnswer) k2 += 1;
    C.definition = /\w+ ist (ein|eine|der|die|das)\b/i.test(this.bodyText);
    if (C.definition) k2 += 1;
    C.convoHeadings = headingTexts.some(h => h.endsWith('?'));
    if (C.convoHeadings) k2 += 1;

    // Quotable Statements (4 Pkt)
    C.tldr       = /tl;dr|zusammenfassung|auf einen blick|das wichtigste/i.test(html);
    if (C.tldr) k2 += 1;
    const hasStats = (html.match(/laut (studie|umfrage|analyse|unserer|daten)/gi) ?? []).length >= 1;
    C.quotableStats = hasStats;
    if (C.quotableStats) k2 += 2;
    C.highlighted = this.qa('strong, em, blockquote').some(el => el.textContent.length >= 30);
    if (C.highlighted) k2 += 1;

    // Topical Authority (4 Pkt)
    try {
      const host = new URL(this.url).hostname;
      C.internalLinks2 = this.qa('a[href]').filter(a => {
        const h = a.getAttribute('href') ?? '';
        return h.startsWith('/') || h.includes(host);
      }).length >= 2;
    } catch { C.internalLinks2 = false; }
    if (C.internalLinks2) k2 += 1;
    C.hasComparison = /vs\.|vergleich|unterschied|gegenüber/i.test(html);
    if (C.hasComparison) k2 += 1;
    C.breadcrumb = html.includes('breadcrumb') || hasType('BreadcrumbList');
    if (C.breadcrumb) k2 += 1;
    C.hasGuide = /leitfaden|ratgeber|guide|alles was|umfassend/i.test(html);
    if (C.hasGuide) k2 += 1;

    // Listen, Tabellen & Positionierung (4 Pkt)
    C.lists  = this.qa('ul, ol').length > 0;
    C.table  = !!this.q('table');
    if (C.lists)  k2 += 2;
    if (C.table)  k2 += 1;
    const firstP = this.q('p')?.textContent ?? '';
    C.shortParagraph = firstP.trim().split(/\s+/).length > 80;
    if (C.shortParagraph) k2 += 1;

    k2 = Math.min(k2, 22);

    // ── K3: Entity & Authority (max 15 Pkt) ──────────────────────────────
    let k3 = 0;

    // Autoritätssignale (7 Pkt)
    C.aboutPage    = /href="[^"]*?(ueber-uns|about|team|unternehmen)[^"]*"/i.test(html);
    if (C.aboutPage) k3 += 1;
    C.authorSchema = schemas.some(s => s?.author?.['@type'] === 'Person' && s.author.url);
    if (C.authorSchema) k3 += 1;
    C.certificates = /zertifikat|auszeichnung|award|certified|preisträger|mitglied.*verband/i.test(html);
    if (C.certificates) k3 += 1;
    C.caseStudy    = /case.?study|fallbeispiel|referenz|erfolgsgeschichte|projekt/i.test(html);
    if (C.caseStudy) k3 += 2;
    C.methodology  = /methodik|unser.{0,10}ansatz|so.{0,10}arbeiten.{0,10}wir|vorgehen|unser.{0,10}prozess/i.test(html);
    if (C.methodology) k3 += 2;
    manualChecks += 2;

    // NAP-Konsistenz (4 Pkt)
    C.napTel     = html.includes('tel:');
    C.napEmail   = html.includes('mailto:');
    C.napAddress = !!(html.includes('itemprop="address"') || orgSchema?.address);
    const sameAsLinks = schemas.flatMap(s => Array.isArray(s?.sameAs) ? s.sameAs : (s?.sameAs ? [s.sameAs] : []));
    C.napSameAs  = sameAsLinks.length >= 2;
    if (C.napTel)     k3 += 1;
    if (C.napEmail)   k3 += 1;
    if (C.napAddress) k3 += 1;
    if (C.napSameAs)  k3 += 1;

    // Externe Entity-Verknüpfungen (4 Pkt)
    C.gbpLink   = sameAsLinks.some(l => /google\.com\/maps|g\.page/.test(l));
    C.wikipedia  = sameAsLinks.some(l => l.includes('wikipedia.org'));
    C.wikidata   = sameAsLinks.some(l => l.includes('wikidata.org'));
    C.directoryLink = sameAsLinks.some(l => /gelbeseiten|yelp|cylex|meinestadt|11880/.test(l));
    if (C.gbpLink)        k3 += 1;
    if (C.wikipedia)      k3 += 1;
    if (C.wikidata)       k3 += 1;
    if (C.directoryLink)  k3 += 1;

    k3 = Math.min(k3, 15);

    // ── K4: Zitierfähigkeit (max 10 Pkt) ─────────────────────────────────
    let k4 = 0;

    // Transparenz & Authorship (4 Pkt)
    C.authorVisible = html.includes('"author"') || html.includes('itemprop="author"') || html.includes('rel="author"');
    if (C.authorVisible) k4 += 2;
    C.authorBio = /biografie|über den autor|about the author|autorin|über mich/i.test(html);
    if (C.authorBio) k4 += 1;
    try {
      const host = new URL(this.url).hostname;
      const extLinkCount = this.qa('a[href^="http"]').filter(a => !(a.getAttribute('href') ?? '').includes(host)).length;
      C.sourcedFacts = extLinkCount >= 2;
    } catch { C.sourcedFacts = false; }
    if (C.sourcedFacts) k4 += 1;

    // Datenqualität (3 Pkt)
    C.statsWithSource = (html.match(/\d+\s*%[^<]*(?:laut|quelle|studie|nach|gemäß)/gi) ?? []).length >= 1;
    if (C.statsWithSource) k4 += 2;
    C.originalData = /eigene (studie|umfrage|analyse|daten|erhebung)/i.test(html);
    if (C.originalData) k4 += 1;

    // Content-Frische (3 Pkt)
    C.timeTag     = !!this.q('time[datetime], time[datePublished]') || (!!this.q('time') && html.includes('datePublished'));
    if (C.timeTag) k4 += 1;
    C.lastUpdated = /zuletzt aktualisiert|last updated|stand:|aktualisiert am/i.test(html);
    if (C.lastUpdated) k4 += 1;
    C.recentYear  = /202[4-6]/.test(html);
    if (C.recentYear) k4 += 1;

    k4 = Math.min(k4, 10);

    // ── K5: Technische Crawlbarkeit (max 8 Pkt) ──────────────────────────
    let k5 = 0;
    const techChecks = this._calcTech(ps, pathChecks).checks;

    // Grundlagen (4 Pkt)
    C.geoHttps    = this.url.startsWith('https://');  if (C.geoHttps)    k5 += 1;
    C.geoViewport = techChecks.viewport;              if (C.geoViewport)  k5 += 1;
    C.geoRobots   = techChecks.robotsTxt;             if (C.geoRobots)    k5 += 1;
    C.geoSitemap  = techChecks.sitemapXml;            if (C.geoSitemap)   k5 += 1;

    // Meta-Daten (4 Pkt)
    const ogTitle = !!this.q('meta[property="og:title"]');
    const ogDesc  = !!this.q('meta[property="og:description"]');
    const ogImg   = !!this.q('meta[property="og:image"]');
    C.geoOgTags   = ogTitle && ogDesc;               if (C.geoOgTags)    k5 += 1;
    C.geoOgImage  = ogImg;                            if (C.geoOgImage)   k5 += 1;
    C.geoImgAlt   = techChecks.imgAlt;               if (C.geoImgAlt)    k5 += 1;
    C.geoCanonical = techChecks.canonical;            if (C.geoCanonical) k5 += 1;

    k5 = Math.min(k5, 8);

    // ── K6: LLM-Plattform-Optimierung (max 10 Pkt) ───────────────────────
    let k6 = 0;

    // ChatGPT-Faktoren (3 Pkt)
    C.regionInH1 = /<h1[^>]*>[^<]*(münchen|berlin|hamburg|köln|nürnberg|[a-zäöü]+er\b)/i.test(html);
    if (C.regionInH1) k6 += 1;
    C.accordingTo = /laut|gemäß|nach angaben|wie.*berichtet|studie.*(zeigt|belegt)/i.test(html);
    if (C.accordingTo) k6 += 1;
    C.howToStructure = /<h[2-3][^>]*>[^<]*(so (geht|funktioniert)|schritt|anleitung|guide)/i.test(html);
    if (C.howToStructure) k6 += 1;

    // Perplexity-Faktoren (4 Pkt)
    C.prominentAuthor = /<(span|div|p)[^>]*author[^>]*>/i.test(html) || html.includes('itemprop="author"');
    if (C.prominentAuthor) k6 += 1;
    C.quotableStatement = this.qa('strong, em, blockquote').some(el => {
      const len = el.textContent.length;
      return len >= 30 && len <= 150;
    });
    if (C.quotableStatement) k6 += 1;
    C.researchContent = /studie|umfrage|analyse|whitepaper|forschung|daten zeigen/i.test(html);
    if (C.researchContent) k6 += 1;
    C.scannableFormat = h2Count >= 4 && (this.qa('ul, ol').length > 0);
    if (C.scannableFormat) k6 += 1;

    // Claude-Faktoren (3 Pkt)
    C.methodologyContent = /methodik|unser.{0,10}prozess|so.{0,10}arbeiten.{0,10}wir|our.{0,10}approach/i.test(html);
    if (C.methodologyContent) k6 += 1;
    C.caseStudyContent = /case.?study|fallstudie|ergebnis.*%|resultat|erfolg.*kunden/i.test(html);
    if (C.caseStudyContent) k6 += 1;
    C.sachlicherTon = (html.match(/\b(beste|einzigartig|revolutionär|unschlagbar|#1)\b/gi) ?? []).length < 5;
    if (C.sachlicherTon) k6 += 1;

    k6 = Math.min(k6, 10);

    // ── Bonus ─────────────────────────────────────────────────────────────
    let bonus = 0;
    C.llmsTxt = html.includes('llms.txt');
    if (C.llmsTxt) bonus += 5;
    const hasTranscript = this.qa('iframe[src*="youtube"], iframe[src*="youtu.be"]').some(el => el.getAttribute('title')) &&
                          /transkript|transcript|untertitel/i.test(html);
    C.hasTranscript = hasTranscript;
    if (C.hasTranscript) bonus += 3;
    C.hreflang = this.qa('link[rel="alternate"][hreflang]').length > 0;
    if (C.hreflang) bonus += 2;

    // ── Gesamt-Score ──────────────────────────────────────────────────────
    const geoScore = Math.min(110, k1 + k2 + k3 + k4 + k5 + k6 + bonus);

    return {
      score: geoScore,
      manualChecks,
      bonus,
      cats: {
        structured: Math.round((k1 / 35) * 100),
        content:    Math.round((k2 / 22) * 100),
        entity:     Math.round((k3 / 15) * 100),
        citation:   Math.round((k4 / 10) * 100),
        tech:       Math.round((k5 / 8)  * 100),
        llm:        Math.round((k6 / 10) * 100),
      },
      raw: { k1, k2, k3, k4, k5, k6, bonus },
      checks: C,
    };
  }
}
