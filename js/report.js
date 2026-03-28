'use strict';

// ── Verbesserungsvorschläge ─────────────────────────────────────────────────

function _suggest(map, score) {
  const tiers = map;
  return (score <= 40 ? tiers[0] : score <= 70 ? tiers[1] : tiers[2]);
}

const SEO_SUGGESTIONS = {
  eeat: [
    'Füge Impressum, Datenschutz und eine Kontaktseite hinzu. HTTPS ist Pflicht und fehlt oder ist nicht korrekt konfiguriert.',
    'Ergänze Schema.org Person-Markup für Autoren und verlinke aktiv auf externe Erwähnungen und Medien.',
    'Stärke externe Backlinks aus autoritären Quellen — Medienerwähnungen und Experteninterviews erhöhen deine E-E-A-T-Signale deutlich.',
  ],
  onPage: [
    'Optimiere deinen Seitentitel (50–60 Zeichen), füge eine Meta-Description (130–160 Zeichen) hinzu und stelle sicher, dass genau ein H1 vorhanden ist.',
    'Verbessere die interne Verlinkungsstruktur und überarbeite nichtssagende Anchor-Texte wie "hier" oder "mehr".',
    'Erweitere deine Inhalte mit semantisch verwandten Begriffen, Synonymen und strukturierten Überschriften-Hierarchien.',
  ],
  tech: [
    'Implementiere Viewport-Meta-Tag, Canonical-URL und vollständige Open-Graph-Tags (Titel, Beschreibung, Bild).',
    'Erstelle eine robots.txt und sitemap.xml. Verbessere deine Core Web Vitals — LCP unter 2,5s ist kritisch.',
    'Optimiere LCP unter 2,5s, halte CLS unter 0,1 und stelle sicher, dass alle Bilder Alt-Texte haben.',
  ],
  local: [
    'Füge LocalBusiness Schema.org-Markup mit Adresse, Telefon und Öffnungszeiten hinzu. Deine Telefonnummer und Adresse fehlen im Seitentext.',
    'Verifiziere deinen Google Business Profile-Eintrag und halte NAP-Daten (Name, Adresse, Telefon) konsistent.',
    'Baue gezielt lokale Erwähnungen auf und sammle mehr Bewertungen auf Google My Business.',
  ],
  user: [
    'Entferne aufdringliche Pop-ups ohne ARIA-Labels, füge mindestens ein Bild hinzu und erweitere den Textinhalt auf mindestens 300 Wörter.',
    'Integriere Bilder und ggf. ein erläuterndes Video. Mehr Inhalt verbessert die Verweildauer nachhaltig.',
    'Optimiere die visuelle Hierarchie für bessere Verweildauer und prüfe, ob Conversion-Elemente klar erkennbar sind.',
  ],
};

const GEO_SUGGESTIONS = {
  structured: [
    'Implementiere Organization- oder LocalBusiness-Schema mit Name, Beschreibung, Adresse, Logo und Telefon. Kein Schema.org-Markup gefunden.',
    'Füge FAQPage-Schema mit mindestens zwei häufig gestellten Fragen hinzu. Das verbessert direkt die Sichtbarkeit in KI-Antworten.',
    'Ergänze AggregateRating-Schema für Social Proof. Verknüpfe alle Social-Media-Profile per sameAs-Property.',
  ],
  content: [
    'Strukturiere Inhalte mit W-Fragen als Überschriften (Wer, Was, Warum, Wie, Wann). KI-Systeme bevorzugen klar beantwortbare Fragen.',
    'Füge Listen, Tabellen und präzise Definitionen im ersten Absatz hinzu. Konkretes Zahlenmaterial stärkt die Autorität.',
    'Erweitere mit semantischen Erklärungen und Schlüsselbegriffen, die KI-Systeme für die Einordnung deiner Inhalte benötigen.',
  ],
  entity: [
    'Verknüpfe Social-Media-Profile via sameAs in Schema.org und füge eine vollständige About/Über-uns-Seite hinzu.',
    'Ergänze Auszeichnungen, Zertifikate und Partnerlogos mit entsprechendem Markup. Das stärkt deine digitale Identität.',
    'Verweise auf Wikipedia- oder Wikidata-Einträge als sameAs-Link für maximale Entity-Stärke bei KI-Systemen.',
  ],
  citation: [
    'Füge Autorenangaben, ein sichtbares Veröffentlichungsdatum und Kontaktinformationen (E-Mail oder Telefon) hinzu.',
    'Aktualisiere Inhalte regelmäßig und kennzeichne Aktualisierungen mit dem time-HTML-Tag und "Zuletzt aktualisiert"-Hinweisen.',
    'Verlinke auf externe Quellen und Studien, um Zitierwürdigkeit zu signalisieren — KI-Systeme werten externe Referenzen stark.',
  ],
  tech: [
    'Implementiere Viewport-Meta-Tag, Canonical-URL und Open-Graph-Tags. robots.txt und sitemap.xml fehlen.',
    'Erstelle eine sitemap.xml und stelle sicher, dass Inhalte ohne JavaScript indexierbar sind. Core Web Vitals optimieren.',
    'Stelle sicher, dass Hauptinhalte im serverseitig gerenderten HTML stehen und die Seite keine noindex-Direktiven enthält.',
  ],
};

// ── Hilfsfunktionen ─────────────────────────────────────────────────────────

function _scoreColor(score) {
  if (score >= 70) return [34, 197, 94];   // grün
  if (score >= 40) return [251, 146, 60];  // orange
  return [239, 68, 68];                    // rot
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

  const PW      = 210;   // page width mm
  const PH      = 297;   // page height mm
  const ML      = 16;    // margin left
  const MR      = 16;    // margin right
  const CW      = PW - ML - MR;  // content width

  // Palette
  const C_BG      = [249, 250, 252];
  const C_HEADER  = [55,  28, 110];   // deep purple
  const C_WHITE   = [255, 255, 255];
  const C_TEXT    = [22,  28,  46];
  const C_MUTED   = [107, 104, 128];
  const C_BORDER  = [220, 216, 235];
  const C_SEO_BG  = [245, 242, 255];
  const C_GEO_BG  = [240, 245, 255];
  const C_SEO_ACC = [124,  58, 237];
  const C_GEO_ACC = [37,  99, 235];

  let y = 0;

  // ── Hilfsfunktionen ──────────────────────────────────────────────────────

  const newPage = () => {
    doc.addPage();
    doc.setFillColor(...C_BG);
    doc.rect(0, 0, PW, PH, 'F');
    y = 20;
  };

  const checkY = (needed) => { if (y + needed > 268) newPage(); };

  const drawBar = (x, barY, w, h, score, r = 2) => {
    doc.setFillColor(220, 215, 235);
    doc.roundedRect(x, barY, w, h, r, r, 'F');
    if (score > 0) {
      doc.setFillColor(..._scoreColor(score));
      doc.roundedRect(x, barY, Math.max(w * score / 100, r * 2), h, r, r, 'F');
    }
  };

  // ── Seite 1: Header ───────────────────────────────────────────────────────

  // Hintergrund
  doc.setFillColor(...C_BG);
  doc.rect(0, 0, PW, PH, 'F');

  // Header-Box
  doc.setFillColor(...C_HEADER);
  doc.rect(0, 0, PW, 36, 'F');

  // Logo-Text
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(...C_WHITE);
  doc.text('faindable', ML, 15);

  // Subtitle
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(200, 185, 240);
  doc.text('SEO & GEO Analysereport', ML, 23);

  // Datum (rechts)
  doc.setFontSize(8);
  doc.setTextColor(200, 185, 240);
  doc.text(data.date, PW - MR, 15, { align: 'right' });

  // Kostenlos-Label
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
  const urlDisplay = data.url.length > 65 ? data.url.substring(0, 62) + '...' : data.url;
  doc.text(urlDisplay, ML + 35, y + 6.5);
  y += 16;

  // ── Gesamt-Score-Übersicht ────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...C_MUTED);
  doc.text('GESAMTBEWERTUNG', ML, y);
  y += 5;

  // Score-Karten nebeneinander (3 Spalten)
  const cardW = (CW - 8) / 3;
  const cards = [
    { label: 'SEO-Score',  score: data.seo,     color: C_SEO_ACC },
    { label: 'GEO-Score',  score: data.geo,     color: C_GEO_ACC },
    { label: 'Gesamt',     score: data.overall, color: _scoreColor(data.overall) },
  ];

  cards.forEach((card, i) => {
    const cx = ML + i * (cardW + 4);
    doc.setFillColor(...C_WHITE);
    doc.roundedRect(cx, y, cardW, 22, 3, 3, 'F');
    doc.setDrawColor(...C_BORDER);
    doc.setLineWidth(0.3);
    doc.roundedRect(cx, y, cardW, 22, 3, 3, 'S');

    // Kategorie-Label
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...C_MUTED);
    doc.text(card.label, cx + cardW / 2, y + 6, { align: 'center' });

    // Score-Zahl
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.setTextColor(..._scoreColor(card.score));
    doc.text(`${card.score}`, cx + cardW / 2, y + 16, { align: 'center' });

    // /100
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...C_MUTED);
    doc.text('/100', cx + cardW / 2 + 8, y + 16, { align: 'center' });

    // Mini-Bar
    drawBar(cx + 4, y + 18.5, cardW - 8, 2, card.score, 1);
  });
  y += 28;

  // ── Trennlinie ────────────────────────────────────────────────────────────
  doc.setDrawColor(...C_BORDER);
  doc.setLineWidth(0.3);
  doc.line(ML, y, PW - MR, y);
  y += 8;

  // ── Kategorie-Zeile ───────────────────────────────────────────────────────
  const drawCategoryRow = (name, weight, score, suggestion) => {
    checkY(28);

    const rowColor = _scoreColor(score);

    // Kategorie-Name + Gewichtung
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(...C_TEXT);
    doc.text(name, ML + 2, y + 4);

    // Gewichtung
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...C_MUTED);
    doc.text(weight, ML + 2, y + 9);

    // Score-Badge (rechts)
    const badgeColor = rowColor;
    doc.setFillColor(badgeColor[0], badgeColor[1], badgeColor[2], 0.12);
    // Approximate transparent fill using light version
    const lightBadge = [
      Math.round(badgeColor[0] * 0.15 + 255 * 0.85),
      Math.round(badgeColor[1] * 0.15 + 255 * 0.85),
      Math.round(badgeColor[2] * 0.15 + 255 * 0.85),
    ];
    doc.setFillColor(...lightBadge);
    doc.roundedRect(PW - MR - 18, y, 18, 9, 2, 2, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...rowColor);
    doc.text(`${score}`, PW - MR - 9, y + 6.2, { align: 'center' });

    // Label
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(...C_MUTED);
    doc.text(_scoreLabel(score), PW - MR - 9, y + 9, { align: 'center' });

    y += 12;

    // Fortschrittsbalken
    drawBar(ML, y, CW - 22, 4, score);
    y += 7;

    // Verbesserungsvorschlag
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(7.5);
    doc.setTextColor(...C_MUTED);
    const lines = doc.splitTextToSize('→ ' + suggestion, CW - 6);
    doc.text(lines, ML + 2, y);
    y += lines.length * 4 + 5;

    // Subtile Trennlinie
    doc.setDrawColor(...C_BORDER);
    doc.setLineWidth(0.2);
    doc.line(ML, y, PW - MR, y);
    y += 5;
  };

  // ── SEO-Sektion ───────────────────────────────────────────────────────────
  checkY(18);
  doc.setFillColor(...C_SEO_BG);
  doc.roundedRect(ML, y, CW, 12, 3, 3, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...C_SEO_ACC);
  doc.text('SEO-ANALYSE', ML + 4, y + 8.5);
  const seoScoreColor = _scoreColor(data.seo);
  doc.setTextColor(...seoScoreColor);
  doc.text(`${data.seo}/100  ·  ${_scoreLabel(data.seo)}`, PW - MR - 4, y + 8.5, { align: 'right' });
  y += 17;

  const sc = data.seoData?.cats ?? {};
  drawCategoryRow('E-E-A-T & Vertrauen',       'Gewichtung 35 %', sc.eeat   ?? 0, _suggest(SEO_SUGGESTIONS.eeat,   sc.eeat   ?? 0));
  drawCategoryRow('On-Page & Semantik',         'Gewichtung 25 %', sc.onPage ?? 0, _suggest(SEO_SUGGESTIONS.onPage, sc.onPage ?? 0));
  drawCategoryRow('Technical SEO',              'Gewichtung 20 %', sc.tech   ?? 0, _suggest(SEO_SUGGESTIONS.tech,   sc.tech   ?? 0));
  drawCategoryRow('Lokales SEO',                'Gewichtung 10 %', sc.local  ?? 0, _suggest(SEO_SUGGESTIONS.local,  sc.local  ?? 0));
  drawCategoryRow('User Signals',               'Gewichtung 10 %', sc.user   ?? 0, _suggest(SEO_SUGGESTIONS.user,   sc.user   ?? 0));

  y += 4;

  // ── GEO-Sektion ───────────────────────────────────────────────────────────
  checkY(18);
  doc.setFillColor(...C_GEO_BG);
  doc.roundedRect(ML, y, CW, 12, 3, 3, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...C_GEO_ACC);
  doc.text('GEO-ANALYSE  (Generative Engine Optimization)', ML + 4, y + 8.5);
  const geoScoreColor = _scoreColor(data.geo);
  doc.setTextColor(...geoScoreColor);
  doc.text(`${data.geo}/100  ·  ${_scoreLabel(data.geo)}`, PW - MR - 4, y + 8.5, { align: 'right' });
  y += 17;

  const gc = data.geoData?.cats ?? {};
  drawCategoryRow('Structured Data / Schema.org', 'Gewichtung 40 %', gc.structured ?? 0, _suggest(GEO_SUGGESTIONS.structured, gc.structured ?? 0));
  drawCategoryRow('Content-Struktur',              'Gewichtung 25 %', gc.content    ?? 0, _suggest(GEO_SUGGESTIONS.content,    gc.content    ?? 0));
  drawCategoryRow('Entity & Authority',            'Gewichtung 15 %', gc.entity     ?? 0, _suggest(GEO_SUGGESTIONS.entity,     gc.entity     ?? 0));
  drawCategoryRow('Zitierfähigkeit',               'Gewichtung 10 %', gc.citation   ?? 0, _suggest(GEO_SUGGESTIONS.citation,   gc.citation   ?? 0));
  drawCategoryRow('Technische Crawlbarkeit',       'Gewichtung 10 %', gc.tech       ?? 0, _suggest(GEO_SUGGESTIONS.tech,       gc.tech       ?? 0));

  // ── Footer auf allen Seiten ────────────────────────────────────────────────
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFillColor(230, 225, 245);
    doc.rect(0, PH - 12, PW, 12, 'F');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...C_MUTED);
    doc.text('Erstellt mit faindable.de · Kostenlose SEO & GEO Analyse für Unternehmen', ML, PH - 4.5);
    doc.text(`Seite ${p} / ${totalPages}`, PW - MR, PH - 4.5, { align: 'right' });
  }

  // ── Datei-Download ────────────────────────────────────────────────────────
  try {
    const host = new URL(data.url).hostname.replace(/^www\./, '');
    const dateSlug = data.date.replace(/\./g, '-');
    doc.save(`faindable-report-${host}-${dateSlug}.pdf`);
  } catch {
    doc.save('faindable-report.pdf');
  }
};
