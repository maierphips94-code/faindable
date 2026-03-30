'use strict';

// ── Verbesserungsvorschläge ─────────────────────────────────────────────────

function _suggest(map, score) {
  return score <= 40 ? map[0] : score <= 70 ? map[1] : map[2];
}

const SEO_SUGGESTIONS = {
  eeat: [
    'Füge Impressum, Datenschutz und eine Kontaktseite hinzu. HTTPS ist Pflicht.',
    'Ergänze Schema.org Person-Markup für Autoren und verweise aktiv auf externe Erwähnungen.',
    'Stärke externe Backlinks aus autoritären Quellen — Medienerwähnungen erhöhen deine E-E-A-T-Signale.',
  ],
  onPage: [
    'Optimiere Seitentitel (50–60 Zeichen), Meta-Description (130–160 Zeichen) und stelle sicher, dass genau ein H1 vorhanden ist.',
    'Verbessere die interne Verlinkungsstruktur und überarbeite nichtssagende Anchor-Texte wie "hier" oder "mehr".',
    'Erweitere Inhalte mit semantisch verwandten Begriffen und strukturierten Überschriften-Hierarchien.',
  ],
  tech: [
    'Implementiere Viewport-Meta-Tag, Canonical-URL und vollständige Open-Graph-Tags (Titel, Beschreibung, Bild).',
    'Erstelle robots.txt und sitemap.xml. Verbessere Core Web Vitals — LCP unter 2,5s ist entscheidend.',
    'Optimiere LCP unter 2,5s, CLS unter 0,1 und stelle sicher, dass alle Bilder Alt-Texte haben.',
  ],
  local: [
    'Füge LocalBusiness Schema.org-Markup mit Adresse, Telefon und Öffnungszeiten hinzu.',
    'Verifiziere deinen Google Business Profile-Eintrag und halte NAP-Daten konsistent.',
    'Baue gezielt lokale Erwähnungen auf und sammle mehr Bewertungen auf Google Business.',
  ],
  user: [
    'Entferne aufdringliche Pop-ups, füge Bilder hinzu und erweitere Textinhalt auf mindestens 300 Wörter.',
    'Integriere Bilder und ggf. ein erklärendes Video. Mehr Inhalt verbessert die Verweildauer.',
    'Optimiere die visuelle Hierarchie für bessere Verweildauer und klarere Conversion-Elemente.',
  ],
};

const GEO_SUGGESTIONS = {
  structured: [
    'Implementiere Organization-Schema mit allen 12 Pflichtfeldern (Name, Beschreibung, Adresse, Telefon, E-Mail, Logo, Bild, Geo, Öffnungszeiten, sameAs, URL, Preisklasse). Kein Schema.org-Markup gefunden.',
    'Füge FAQPage-Schema mit mindestens 3 W-Fragen hinzu und stelle sicher, dass Antworten mind. 50 Wörter haben und auch als sichtbarer HTML-Text erscheinen.',
    'Ergänze HowTo-Schema für Dienstleistungsseiten und vervollständige AggregateRating mit mind. 5 Bewertungen.',
  ],
  content: [
    'Strukturiere Inhalte mit W-Fragen als Überschriften. Füge einen TL;DR-Block am Seitenanfang hinzu. KI-Systeme bevorzugen direkte, scannbare Antworten.',
    'Ergänze zitierbare Statistiken mit Quellenangabe ("Laut Studie X..."). Hebe Kernaussagen mit <strong> oder <blockquote> hervor.',
    'Baue Vergleichsinhalte und interne Verlinkung zu Unterthemen aus. Breadcrumb-Navigation stärkt die topische Autorität.',
  ],
  entity: [
    'Verknüpfe Social-Media-Profile via sameAs in Schema.org, füge Telefon- und E-Mail-Link hinzu und erstelle eine vollständige Über-uns-Seite mit Team-Fotos.',
    'Dokumentiere Methodik und Referenzprojekte — das sind starke Zitier-Signale für Claude und ChatGPT.',
    'Verlinke auf Google Business Profile in sameAs und ergänze Einträge in Branchenverzeichnissen (Gelbe Seiten, Yelp etc.).',
  ],
  citation: [
    'Füge Autorenangaben mit Expertenbeschreibung, Publikationsdatum und Kontaktinformationen auf jeder Seite hinzu.',
    'Verlinke auf externe Quellen für Fakten und Zahlen. Füge ein "Zuletzt aktualisiert"-Datum mit HTML <time>-Tag hinzu.',
    'Ergänze eigene Studiendaten oder Umfrageergebnisse — Originalquellen werden von Perplexity bevorzugt zitiert.',
  ],
  tech: [
    'Stelle sicher, dass HTTPS aktiv ist, robots.txt und sitemap.xml erreichbar sind und alle Seiten einen Viewport-Meta-Tag haben.',
    'Vervollständige Open-Graph-Tags (og:title, og:description, og:image) und setze Canonical-URLs auf allen Seiten.',
    'Stelle sicher, dass über 80% aller Bilder Alt-Texte haben und keine noindex-Direktiven gesetzt sind.',
  ],
  llm: [
    'Integriere How-To-Strukturen mit Schritt-für-Schritt-Anleitungen (ChatGPT), hebe Kernaussagen mit <strong>/<blockquote> hervor (Perplexity) und dokumentiere deinen Arbeitsprozess (Claude).',
    'Füge "Laut unserer Analyse..."-Formulierungen hinzu, erstelle mindestens ein Fallbeispiel mit messbarem Ergebnis und achte auf sachlichen, professionellen Ton.',
    'Ergänze Region/Marke in der H1-Überschrift für lokale Sichtbarkeit und stelle sicher, dass das Format scannbar ist (viele H2s + Listen).',
  ],
};

// ── Hilfsfunktionen ─────────────────────────────────────────────────────────

function _scoreColor(score) {
  if (score >= 70) return [34, 197, 94];
  if (score >= 40) return [251, 146, 60];
  return [239, 68, 68];
}

function _scoreLabel(score) {
  if (score >= 80) return 'Sehr gut';
  if (score >= 65) return 'Gut';
  if (score >= 45) return 'Ausbaufähig';
  return 'Kritisch';
}

// ── PDF-Generierung ─────────────────────────────────────────────────────────

window.generateFaindableReport = function(data) {
  if (!window.jspdf) {
    alert('PDF-Bibliothek noch nicht geladen. Bitte kurz warten und erneut versuchen.');
    return;
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  const PW = 210;
  const PH = 297;
  const ML = 16;
  const MR = 16;
  const CW = PW - ML - MR;  // 178mm

  const C_BG      = [249, 250, 252];
  const C_HEADER  = [55,  28, 110];
  const C_WHITE   = [255, 255, 255];
  const C_TEXT    = [22,  28,  46];
  const C_MUTED   = [107, 104, 128];
  const C_BORDER  = [220, 216, 235];
  const C_SEO_BG  = [245, 242, 255];
  const C_GEO_BG  = [240, 245, 255];
  const C_SEO_ACC = [124,  58, 237];
  const C_GEO_ACC = [37,  99, 235];

  let y = 0;

  const newPage = () => {
    doc.addPage();
    doc.setFillColor(...C_BG);
    doc.rect(0, 0, PW, PH, 'F');
    y = 20;
  };

  const checkY = (needed) => { if (y + needed > 270) newPage(); };

  const drawBar = (x, barY, w, h, score, r = 2) => {
    doc.setFillColor(220, 215, 235);
    doc.roundedRect(x, barY, w, h, r, r, 'F');
    if (score > 0) {
      doc.setFillColor(..._scoreColor(score));
      doc.roundedRect(x, barY, Math.max(w * score / 100, r * 2), h, r, r, 'F');
    }
  };

  const drawCheckItem = (label, passed, indent) => {
    checkY(5);
    const ix = ML + (indent ? 6 : 2);
    const dotColor = passed ? [34, 197, 94] : [239, 68, 68];
    doc.setFillColor(...dotColor);
    doc.circle(ix, y - 0.8, 1.1, 'F');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...(passed ? [40, 100, 60] : [150, 50, 50]));
    doc.text(label, ix + 3.5, y);
    y += 4;
  };

  const drawCategoryBlock = (name, weight, score, checkItems, suggestion) => {
    const estimatedHeight = 14 + checkItems.length * 4 + 16;
    checkY(estimatedHeight);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(...C_TEXT);
    doc.text(name, ML + 2, y + 4);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...C_MUTED);
    doc.text(weight, ML + 2, y + 9);

    const lightBadge = _scoreColor(score).map(v => Math.round(v * 0.12 + 255 * 0.88));
    doc.setFillColor(...lightBadge);
    doc.roundedRect(PW - MR - 20, y, 20, 10, 2, 2, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(..._scoreColor(score));
    doc.text(`${score}`, PW - MR - 10, y + 6.5, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(...C_MUTED);
    doc.text(_scoreLabel(score), PW - MR - 10, y + 9.5, { align: 'center' });

    y += 12;
    drawBar(ML, y, CW - 24, 4, score);
    y += 7;

    checkItems.forEach(item => {
      if (item.value === null) return;
      drawCheckItem(item.label, item.value, item.indent ?? false);
    });

    y += 2;

    // Suggestion mit garantiertem Zeilenumbruch
    const sugFontSize = 7.5;
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(sugFontSize);
    const sugText = 'Verbesserung: ' + suggestion;
    const sugX = ML + 2;
    const maxSugW = PW - MR - sugX - 4;
    const lines = doc.splitTextToSize(sugText, maxSugW);
    const lh = sugFontSize * 0.52;
    const sugBlockH = lines.length * lh + 8;
    checkY(sugBlockH);
    doc.setTextColor(...C_MUTED);
    lines.forEach((line, i) => doc.text(line, sugX, y + i * lh));
    y += sugBlockH;

    doc.setDrawColor(...C_BORDER);
    doc.setLineWidth(0.2);
    doc.line(ML, y, PW - MR, y);
    y += 5;
  };

  // ── Seite 1: Header ───────────────────────────────────────────────────────
  doc.setFillColor(...C_BG);
  doc.rect(0, 0, PW, PH, 'F');

  doc.setFillColor(...C_HEADER);
  doc.rect(0, 0, PW, 36, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(...C_WHITE);
  doc.text('faindable', ML, 15);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(200, 185, 240);
  doc.text('SEO & GEO Analysereport', ML, 23);

  doc.setFontSize(8);
  doc.setTextColor(200, 185, 240);
  doc.text(data.date, PW - MR, 15, { align: 'right' });

  doc.setFillColor(80, 40, 140);
  doc.roundedRect(PW - MR - 32, 20, 32, 8, 2, 2, 'F');
  doc.setFontSize(7);
  doc.setTextColor(...C_WHITE);
  doc.text('100% kostenlos', PW - MR - 16, 25.5, { align: 'center' });

  y = 44;

  // URL-Chip
  doc.setFillColor(235, 230, 248);
  doc.roundedRect(ML, y, CW, 10, 2, 2, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(...C_MUTED);
  doc.text('Analysierte URL', ML + 3, y + 6.5);
  doc.setFont('courier', 'normal');
  doc.setTextColor(...C_TEXT);
  const urlDisplay = data.url.length > 68 ? data.url.substring(0, 65) + '...' : data.url;
  doc.text(urlDisplay, ML + 38, y + 6.5);
  y += 16;

  // Score-Karten
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...C_MUTED);
  doc.text('GESAMTBEWERTUNG', ML, y);
  y += 5;

  const cardW = (CW - 8) / 3;
  [
    { label: 'SEO-Score',  score: data.seo     },
    { label: 'GEO-Score',  score: data.geo     },
    { label: 'Gesamt',     score: data.overall },
  ].forEach((card, i) => {
    const cx = ML + i * (cardW + 4);
    doc.setFillColor(...C_WHITE);
    doc.roundedRect(cx, y, cardW, 22, 3, 3, 'F');
    doc.setDrawColor(...C_BORDER);
    doc.setLineWidth(0.3);
    doc.roundedRect(cx, y, cardW, 22, 3, 3, 'S');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...C_MUTED);
    doc.text(card.label, cx + cardW / 2, y + 6, { align: 'center' });
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.setTextColor(..._scoreColor(card.score));
    doc.text(`${card.score}`, cx + cardW / 2 - 4, y + 16, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...C_MUTED);
    doc.text('/100', cx + cardW / 2 + 7, y + 16, { align: 'center' });
    drawBar(cx + 4, y + 18.5, cardW - 8, 2, card.score, 1);
  });
  y += 28;

  doc.setDrawColor(...C_BORDER);
  doc.setLineWidth(0.3);
  doc.line(ML, y, PW - MR, y);
  y += 8;

  // ── SEO-Sektion ───────────────────────────────────────────────────────────
  checkY(16);
  doc.setFillColor(...C_SEO_BG);
  doc.roundedRect(ML, y, CW, 12, 3, 3, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...C_SEO_ACC);
  doc.text('SEO-ANALYSE', ML + 4, y + 8.5);
  doc.setTextColor(..._scoreColor(data.seo));
  doc.text(`${data.seo}/100  ·  ${_scoreLabel(data.seo)}`, PW - MR - 4, y + 8.5, { align: 'right' });
  y += 16;

  const sc = data.seoData?.cats ?? {};
  const sx = data.seoData?.checks ?? {};

  drawCategoryBlock('E-E-A-T & Vertrauen', 'Gewichtung 35 %', sc.eeat ?? 0, [
    { label: 'HTTPS aktiv',                         value: sx.https        ?? null },
    { label: 'Impressum / Datenschutz vorhanden',   value: sx.legal        ?? null },
    { label: 'Autorenangaben / Team-Seite',         value: sx.author       ?? null },
    { label: 'Kontaktmöglichkeit verlinkt',         value: sx.contact      ?? null },
    { label: 'Schema.org Person-Markup',            value: sx.personSchema ?? null },
  ], _suggest(SEO_SUGGESTIONS.eeat, sc.eeat ?? 0));

  drawCategoryBlock('On-Page & Semantik', 'Gewichtung 25 %', sc.onPage ?? 0, [
    { label: 'Seitentitel vorhanden',                       value: sx.titleExists    ?? null },
    { label: 'Titel-Länge optimal (50–60 Zeichen)',         value: sx.titleLen       ?? null },
    { label: 'Meta-Description vorhanden',                  value: sx.metaDescExists ?? null },
    { label: 'Meta-Description optimal (130–160 Zeichen)',  value: sx.metaDescLen    ?? null },
    { label: 'Genau ein H1-Tag',                            value: sx.h1Single       ?? null },
    { label: 'Mindestens zwei H2-Tags',                     value: sx.h2Multiple     ?? null },
    { label: 'H3-Tags vorhanden',                           value: sx.h3Present      ?? null },
    { label: 'Interne Verlinkung ausreichend (> 3)',         value: sx.intLinks       ?? null },
    { label: 'Anchor-Texte qualitativ',                     value: sx.anchorQuality  ?? null },
    { label: 'Favicon eingebunden',                         value: sx.favicon        ?? null },
  ], _suggest(SEO_SUGGESTIONS.onPage, sc.onPage ?? 0));

  drawCategoryBlock('Technical SEO', 'Gewichtung 20 %', sc.tech ?? 0, [
    { label: 'Viewport-Meta-Tag',                    value: sx.viewport   ?? null },
    { label: 'Canonical-URL',                        value: sx.canonical  ?? null },
    { label: 'Open Graph Tags vollständig',          value: sx.ogFull     ?? null },
    { label: 'Keine noindex-Direktive',              value: sx.noindex    ?? null },
    { label: 'Bilder mit Alt-Texten (> 80 %)',       value: sx.imgAlt     ?? null },
    { label: 'robots.txt erreichbar',                value: sx.robotsTxt  ?? null },
    { label: 'sitemap.xml erreichbar',               value: sx.sitemapXml ?? null },
    { label: 'LCP < 2,5 s (Core Web Vitals)',        value: sx.lcpGood    ?? null },
    { label: 'CLS < 0,1 (Core Web Vitals)',          value: sx.clsGood    ?? null },
    { label: 'INP / TBT < 200 ms (Core Web Vitals)', value: sx.inpGood   ?? null },
  ], _suggest(SEO_SUGGESTIONS.tech, sc.tech ?? 0));

  drawCategoryBlock('Lokales SEO', 'Gewichtung 10 %', sc.local ?? 0, [
    { label: 'LocalBusiness / Organization Schema', value: sx.localSchema ?? null },
    { label: 'Telefonnummer im Seitentext',         value: sx.phone       ?? null },
    { label: 'Adresse im Seitentext',               value: sx.address     ?? null },
  ], _suggest(SEO_SUGGESTIONS.local, sc.local ?? 0));

  drawCategoryBlock('User Signals', 'Gewichtung 10 %', sc.user ?? 0, [
    { label: 'Keine aufdringlichen Overlays',        value: sx.noOverlays ?? null },
    { label: 'Bilder vorhanden',                     value: sx.hasImages  ?? null },
    { label: 'Video eingebunden (YouTube / Vimeo)',  value: sx.hasVideo   ?? null },
    { label: 'Ausreichend Textinhalt (> 300 Wörter)', value: sx.contentLen ?? null },
  ], _suggest(SEO_SUGGESTIONS.user, sc.user ?? 0));

  y += 4;

  // ── GEO-Sektion ───────────────────────────────────────────────────────────
  checkY(16);
  doc.setFillColor(...C_GEO_BG);
  doc.roundedRect(ML, y, CW, 12, 3, 3, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...C_GEO_ACC);
  doc.text('GEO-ANALYSE  (Generative Engine Optimization)', ML + 4, y + 8.5);
  doc.setTextColor(..._scoreColor(data.geo));
  doc.text(`${data.geo}/100  ·  ${_scoreLabel(data.geo)}`, PW - MR - 4, y + 8.5, { align: 'right' });
  y += 16;

  const gc = data.geoData?.cats ?? {};
  const gx = data.geoData?.checks ?? {};
  const gr = data.geoData?.raw ?? {};

  // K1: Structured Data
  drawCategoryBlock('Structured Data / Schema.org', 'Gewichtung 35 % · ' + (gr.k1 ?? 0) + '/35 Punkte', gc.structured ?? 0, [
    { label: 'Organization / LocalBusiness Schema',     value: gx.orgSchema     ?? null },
    { label: '— Name',                                  value: gx.orgName       ?? null, indent: true },
    { label: '— Beschreibung',                          value: gx.orgDesc       ?? null, indent: true },
    { label: '— Adresse',                               value: gx.orgAddress    ?? null, indent: true },
    { label: '— Telefon',                               value: gx.orgPhone      ?? null, indent: true },
    { label: '— E-Mail',                                value: gx.orgEmail      ?? null, indent: true },
    { label: '— Logo',                                  value: gx.orgLogo       ?? null, indent: true },
    { label: '— Bild (image)',                          value: gx.orgImage      ?? null, indent: true },
    { label: '— Geo-Koordinaten',                       value: gx.orgGeo        ?? null, indent: true },
    { label: '— Öffnungszeiten',                        value: gx.orgHours      ?? null, indent: true },
    { label: '— sameAs (mind. 2 Links)',                value: gx.orgSameAs     ?? null, indent: true },
    { label: '— URL & Preisklasse',                     value: (gx.orgUrl && gx.orgPriceRange) ?? null, indent: true },
    { label: 'FAQPage Schema',                          value: gx.faqSchema     ?? null },
    { label: '— Mind. 3 FAQ-Einträge',                  value: gx.faqItems3     ?? null, indent: true },
    { label: '— Antworten mind. 50 Wörter',             value: gx.faqLongAnswers ?? null, indent: true },
    { label: '— W-Fragen als FAQ',                      value: gx.faqWQuestions ?? null, indent: true },
    { label: '— FAQ auch als sichtbarer HTML-Text',     value: gx.faqVisibleText ?? null, indent: true },
    { label: 'Service / Product Schema',                value: gx.serviceSchema ?? null },
    { label: 'HowTo Schema',                            value: gx.howToSchema   ?? null },
    { label: 'Article / BlogPosting Schema',            value: gx.articleSchema ?? null },
    { label: 'AggregateRating (mind. 5 Bewertungen)',   value: gx.ratingFull    ?? null },
  ], _suggest(GEO_SUGGESTIONS.structured, gc.structured ?? 0));

  // K2: Content-Struktur
  drawCategoryBlock('Content-Struktur für LLM-Parsing', 'Gewichtung 22 % · ' + (gr.k2 ?? 0) + '/22 Punkte', gc.content ?? 0, [
    { label: 'Genau ein H1-Tag',                          value: gx.geoH1         ?? null },
    { label: 'Mindestens zwei H2-Tags',                   value: gx.geoH2         ?? null },
    { label: 'H3-Tags vorhanden',                         value: gx.geoH3         ?? null },
    { label: 'Semantisches <main> oder <article>-Element', value: gx.mainTag || gx.sectionTag ? true : (gx.geoH1 != null ? false : null) },
    { label: 'W-Fragen als Überschriften (mind. 2)',       value: gx.wQuestions    ?? null },
    { label: 'Definition-Pattern ("X ist ein/eine...")',   value: gx.definition    ?? null },
    { label: 'Konversationelle Überschriften (Frageform)', value: gx.convoHeadings ?? null },
    { label: 'TL;DR / Summary-Block vorhanden',           value: gx.tldr          ?? null },
    { label: 'Zitierbare Statistiken mit Quellenangabe',  value: gx.quotableStats ?? null },
    { label: 'Hervorgehobene Schlüsselaussagen',          value: gx.highlighted   ?? null },
    { label: 'Interne Verlinkung (mind. 2)',              value: gx.internalLinks2 ?? null },
    { label: 'Vergleichsinhalt vorhanden',                value: gx.hasComparison ?? null },
    { label: 'Breadcrumb-Navigation',                     value: gx.breadcrumb    ?? null },
    { label: 'Ratgeber / Guide erkennbar',                value: gx.hasGuide      ?? null },
    { label: 'Listen (ul/ol) vorhanden',                  value: gx.lists         ?? null },
    { label: 'Tabellen vorhanden',                        value: gx.table         ?? null },
  ], _suggest(GEO_SUGGESTIONS.content, gc.content ?? 0));

  // K3: Entity & Authority
  drawCategoryBlock('Entity & Authority Signals', 'Gewichtung 15 % · ' + (gr.k3 ?? 0) + '/15 Punkte', gc.entity ?? 0, [
    { label: 'Über-uns / Team-Seite verlinkt',              value: gx.aboutPage    ?? null },
    { label: 'Autor-Schema mit LinkedIn-Link',              value: gx.authorSchema ?? null },
    { label: 'Zertifikate / Auszeichnungen erwähnt',        value: gx.certificates ?? null },
    { label: 'Case Study / Referenz vorhanden',             value: gx.caseStudy    ?? null },
    { label: 'Methodology / "So arbeiten wir" dokumentiert', value: gx.methodology ?? null },
    { label: 'Telefon-Link (tel:) vorhanden',               value: gx.napTel       ?? null },
    { label: 'E-Mail-Link (mailto:) vorhanden',             value: gx.napEmail     ?? null },
    { label: 'Adresse im HTML (itemprop oder Schema)',       value: gx.napAddress   ?? null },
    { label: 'sameAs-Links in Schema (mind. 2)',            value: gx.napSameAs    ?? null },
    { label: 'Google Business Profile in sameAs',           value: gx.gbpLink      ?? null },
    { label: 'Wikipedia-Link in sameAs',                    value: gx.wikipedia    ?? null },
    { label: 'Wikidata-Link in sameAs',                     value: gx.wikidata     ?? null },
    { label: 'Branchenverzeichnis in sameAs',               value: gx.directoryLink ?? null },
  ], _suggest(GEO_SUGGESTIONS.entity, gc.entity ?? 0));

  // K4: Zitierfähigkeit
  drawCategoryBlock('Zitierfähigkeit & Quellenqualität', 'Gewichtung 10 % · ' + (gr.k4 ?? 0) + '/10 Punkte', gc.citation ?? 0, [
    { label: 'Autorenangabe vorhanden',                   value: gx.authorVisible  ?? null },
    { label: 'Autorenbiografie mit Expertise-Nachweis',   value: gx.authorBio      ?? null },
    { label: 'Externe Quellenlinks (mind. 2)',             value: gx.sourcedFacts   ?? null },
    { label: 'Statistiken mit Quellenangabe',              value: gx.statsWithSource ?? null },
    { label: 'Eigene Studie / Originaldaten erwähnt',      value: gx.originalData   ?? null },
    { label: '<time>-Tag mit Datum',                       value: gx.timeTag        ?? null },
    { label: '"Zuletzt aktualisiert"-Hinweis',             value: gx.lastUpdated    ?? null },
    { label: 'Aktuelles Jahr im Inhalt',                   value: gx.recentYear     ?? null },
  ], _suggest(GEO_SUGGESTIONS.citation, gc.citation ?? 0));

  // K5: Technische Crawlbarkeit
  drawCategoryBlock('Technische Crawlbarkeit', 'Gewichtung 8 % · ' + (gr.k5 ?? 0) + '/8 Punkte', gc.tech ?? 0, [
    { label: 'HTTPS aktiv',                          value: gx.geoHttps    ?? null },
    { label: 'Viewport-Meta-Tag',                    value: gx.geoViewport ?? null },
    { label: 'robots.txt erreichbar',                value: gx.geoRobots   ?? null },
    { label: 'sitemap.xml erreichbar',               value: gx.geoSitemap  ?? null },
    { label: 'Open Graph Tags (og:title + og:desc)', value: gx.geoOgTags   ?? null },
    { label: 'OG:Image vorhanden',                   value: gx.geoOgImage  ?? null },
    { label: 'Alt-Tags bei > 80% der Bilder',        value: gx.geoImgAlt   ?? null },
    { label: 'Canonical-URL gesetzt',                value: gx.geoCanonical ?? null },
  ], _suggest(GEO_SUGGESTIONS.tech, gc.tech ?? 0));

  // K6: LLM-Plattform-Optimierung
  drawCategoryBlock('LLM-Plattform-Optimierung', 'Gewichtung 10 % · ' + (gr.k6 ?? 0) + '/10 Punkte', gc.llm ?? 0, [
    { label: 'Region / Marke in H1 (ChatGPT-Faktor)',          value: gx.regionInH1       ?? null },
    { label: '"Laut..."-Formulierungen vorhanden (ChatGPT)',    value: gx.accordingTo      ?? null },
    { label: 'How-To-Struktur erkennbar (ChatGPT)',             value: gx.howToStructure   ?? null },
    { label: 'Autor prominent sichtbar (Perplexity)',           value: gx.prominentAuthor  ?? null },
    { label: 'Zitierbare Kernaussage hervorgehoben (Perplexity)', value: gx.quotableStatement ?? null },
    { label: 'Research-backed Content (Perplexity)',            value: gx.researchContent  ?? null },
    { label: 'Scannable Formatting: H2 ≥ 4 + Listen (Perplexity)', value: gx.scannableFormat ?? null },
    { label: 'Methodology-Dokumentation vorhanden (Claude)',    value: gx.methodologyContent ?? null },
    { label: 'Case Study mit Ergebnis (Claude)',                value: gx.caseStudyContent ?? null },
    { label: 'Sachlicher Ton ohne Übertreibungen (Claude)',     value: gx.sachlicherTon    ?? null },
  ], _suggest(GEO_SUGGESTIONS.llm, gc.llm ?? 0));

  // ── Footer ────────────────────────────────────────────────────────────────
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFillColor(230, 225, 245);
    doc.rect(0, PH - 12, PW, 12, 'F');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...C_MUTED);
    doc.text('Erstellt mit faindable.de · Kostenlose SEO & GEO Analyse', ML, PH - 4.5);
    doc.text(`Seite ${p} / ${totalPages}`, PW - MR, PH - 4.5, { align: 'right' });
  }

  // ── Download ──────────────────────────────────────────────────────────────
  try {
    const host = new URL(data.url).hostname.replace(/^www\./, '');
    const dateSlug = data.date.replace(/\./g, '-');
    doc.save(`faindable-report-${host}-${dateSlug}.pdf`);
  } catch {
    doc.save('faindable-report.pdf');
  }
};
