/**
 * Faindable – Alpine.js Haupt-Komponente
 * Material Design 3 Dark Theme · 3-State Hero Machine
 */

'use strict';

function faindable() {
  return {
    // ── State ───────────────────────────────────────────────────────────────
    url: '',
    urlError: '',
    analyzedUrl: '',

    // 3-State Hero: 'initial' | 'scanning' | 'result'
    heroState: 'initial',

    results: {
      seo: 0,
      geo: 0,
      overall: 0,
      manual_checks: 0,
    },

    // Scan-Schritte
    scanSteps: [
      { label: 'Verbinde mit Server ...', code: 'TCP_HANDSHAKE_OK',          progress: 12 },
      { label: 'Crawle Metadaten ...',    code: 'EXTRACTING_DOM_RESOURCES',   progress: 25 },
      { label: 'Berechne SEO-Score ...',  code: 'RANKING_FACTOR_EVAL',        progress: 45 },
      { label: 'Berechne GEO-Score ...',  code: 'GEO_ENGINE_SCANNING',        progress: 70 },
      { label: 'Erstelle Report ...',     code: 'FINALIZING_RESULTS',         progress: 92 },
      { label: 'Fertig!',                code: 'SUCCESS',                    progress: 100 },
    ],
    currentScanStep: 0,
    scanProgress: 15,

    // Modal
    modalOpen: false,
    formSent: false,
    formSubmitting: false,
    form: { name: '', email: '', website: '', message: '' },

    // ── Init ─────────────────────────────────────────────────────────────────
    init() {
      this._setupScrollReveal();
      this.$watch('analyzedUrl', val => {
        if (val && !this.form.website) this.form.website = val;
      });
    },

    // ── Scroll Reveal ────────────────────────────────────────────────────────
    _setupScrollReveal() {
      const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            entry.target.classList.add('revealed');
            observer.unobserve(entry.target);
          }
        });
      }, { threshold: 0.12 });

      document.querySelectorAll('[data-fade]').forEach(el => observer.observe(el));
    },

    // ── Validierung ──────────────────────────────────────────────────────────
    validateUrl(raw) {
      if (!raw?.trim()) return 'Bitte gib eine URL ein.';

      let u = raw.trim();
      if (!u.startsWith('http://') && !u.startsWith('https://')) {
        u = 'https://' + u;
        this.url = u;
      }
      try {
        const parsed = new URL(u);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
          return 'Bitte gib eine vollständige URL ein (z.B. https://deine-website.de)';
        }
        if (!parsed.hostname.includes('.')) return 'Bitte gib eine gültige Domain ein.';
        return null;
      } catch {
        return 'Bitte gib eine vollständige URL ein (z.B. https://deine-website.de)';
      }
    },

    // ── Analyse ──────────────────────────────────────────────────────────────
    async analyze() {
      this.urlError = '';

      const err = this.validateUrl(this.url);
      if (err) { this.urlError = err; return; }

      // Scanning-State aktivieren
      this.heroState = 'scanning';
      this.currentScanStep = 0;
      this.scanProgress = this.scanSteps[0].progress;

      // Roboter starten (kurze DOM-Settle-Pause)
      await this._sleep(60);
      window.analysisRobot?.enter();
      window.analysisRobot?.startConnecting();

      // Per-Step-Delays (ms): wie lange bleibt jeder Schritt aktiv bevor der nächste kommt
      // SEO (Index 2) und GEO (Index 3) dauern am längsten
      const stepDelays = [450, 500, 2100, 2200];

      let stepIndex = 0;

      // Animation läuft parallel zur API — stoppt bei Index 3
      const animPromise = new Promise(resolve => {
        const advance = idx => {
          setTimeout(() => {
            stepIndex = idx + 1;
            this.currentScanStep = stepIndex;
            this.scanProgress = this.scanSteps[stepIndex].progress;
            // Roboter-Phasen an Schritt koppeln
            if (stepIndex === 1) window.analysisRobot?.startScanning();
            if (stepIndex === 3) window.analysisRobot?.startProcessing();
            if (idx + 1 < stepDelays.length) advance(idx + 1);
            else resolve();
          }, stepDelays[idx]);
        };
        advance(0);
      });

      try {
        // Warte auf API UND darauf, dass die Animation mindestens Schritt 3 erreicht hat
        const [data] = await Promise.all([analyzeUrl(this.url), animPromise]);

        // Schritt 4: "Erstelle Report..." nur kurz aufblitzen
        this.currentScanStep = 4;
        this.scanProgress = this.scanSteps[4].progress;
        await this._sleep(180);

        // Schritt 5: "Fertig!" — Roboter wechselt auf grün
        this.currentScanStep = this.scanSteps.length - 1;
        this.scanProgress = 100;
        this.analyzedUrl = data.analyzed_url || this.url;
        window.analysisRobot?.showComplete();

        await this._sleep(600);
        window.analysisRobot?.exit();   // Roboter verlässt die Bühne
        this.heroState = 'result';

        // Score-Animationen gestaffelt
        await this._sleep(300);
        await this._animateScore('seo',     data.seo);
        await this._sleep(120);
        await this._animateScore('geo',     data.geo);
        await this._sleep(120);
        await this._animateScore('overall', data.overall);

        this.results.manual_checks = data.manual_checks ?? 0;

        // Scroll zu Ergebnis
        await this._sleep(300);
        const el = document.getElementById('hero');
        if (el) {
          window.scrollTo({ top: el.offsetTop - 80, behavior: 'smooth' });
        }

      } catch (err) {
        console.error('[Faindable]', err);
        this.heroState = 'initial';
        const known = /nicht erreichbar|zu lange gedauert|vollständige URL|gültige Domain/;
        this.urlError = known.test(err?.message)
          ? err.message
          : 'Etwas ist schiefgelaufen. Bitte in Kürze erneut versuchen.';
      }
    },

    // ── Reset ────────────────────────────────────────────────────────────────
    resetAnalysis() {
      this.heroState = 'initial';
      this.results = { seo: 0, geo: 0, overall: 0, manual_checks: 0 };
      this.url = '';
      this.urlError = '';
      this.analyzedUrl = '';
      this.currentScanStep = 0;
      this.scanProgress = 15;
      window.analysisRobot?._hardReset();
    },

    // ── Score-Hints ──────────────────────────────────────────────────────────
    getSeoHints(score) {
      if (score == null) return [];
      const hints = [];
      if (score >= 80) {
        hints.push({ type: 'success', text: 'Title & Meta-Description optimal' });
        hints.push({ type: 'success', text: 'E-E-A-T-Signale vorhanden' });
      } else if (score >= 60) {
        hints.push({ type: 'success', text: 'Grundstruktur solide' });
        hints.push({ type: 'warning', text: 'Meta-Tags optimierbar' });
      } else if (score >= 40) {
        hints.push({ type: 'warning', text: 'Title oder Description fehlt/zu kurz' });
        hints.push({ type: 'warning', text: 'H1-Struktur verbessern' });
      } else {
        hints.push({ type: 'error', text: 'Kritische SEO-Faktoren fehlen' });
        hints.push({ type: 'warning', text: 'Keine Structured Data gefunden' });
      }
      return hints;
    },

    getGeoHints(score) {
      if (score == null) return [];
      const hints = [];
      if (score >= 80) {
        hints.push({ type: 'success', text: 'Schema.org vollständig' });
        hints.push({ type: 'success', text: 'KI-Crawler können Inhalte einordnen' });
      } else if (score >= 60) {
        hints.push({ type: 'success', text: 'Basis-Schema vorhanden' });
        hints.push({ type: 'warning', text: 'Entity-Verknüpfungen ergänzen' });
      } else if (score >= 40) {
        hints.push({ type: 'warning', text: 'Schema.org nur teilweise' });
        hints.push({ type: 'warning', text: 'FAQPage oder Article fehlt' });
      } else {
        hints.push({ type: 'error', text: 'Kein Schema.org gefunden' });
        hints.push({ type: 'error', text: 'Für KI-Suche nicht optimiert' });
      }
      return hints;
    },

    // ── Score-Animation (0 → Ziel, Ease-Out-Cubic) ──────────────────────────
    _animateScore(key, target) {
      return new Promise(resolve => {
        const DURATION = 1200;
        const start    = performance.now();

        const tick = now => {
          const p     = Math.min((now - start) / DURATION, 1);
          const eased = 1 - Math.pow(1 - p, 3);
          this.results[key] = Math.round(eased * target);

          if (p < 1) requestAnimationFrame(tick);
          else { this.results[key] = target; resolve(); }
        };

        requestAnimationFrame(tick);
      });
    },

    // ── SVG-Offset für Kreis-Fortschritt ────────────────────────────────────
    scoreToOffset(score) {
      const CIRC = 263.9; // 2 * π * 42
      if (score == null) return CIRC;
      return CIRC - (Math.max(0, Math.min(100, score)) / 100) * CIRC;
    },

    // ── Score-Farbe ──────────────────────────────────────────────────────────
    getScoreColor(score) {
      if (score == null) return '#6b7280';
      if (score >= 80)   return '#34d399';  // grün
      if (score >= 60)   return '#a78bfa';  // violet
      if (score >= 40)   return '#fbbf24';  // gelb
      return                    '#f87171';  // rot
    },

    // ── Score-Label ──────────────────────────────────────────────────────────
    getScoreLabel(score) {
      if (score == null) return '...';
      if (score >= 80)   return 'Gut optimiert';
      if (score >= 60)   return 'Solide Basis';
      if (score >= 40)   return 'Verbesserungsbedarf';
      return 'Hier ist Potenzial';
    },

    // ── Score-Insight ────────────────────────────────────────────────────────
    getScoreInsight(type, score) {
      if (score == null) return '';
      const copy = {
        seo: {
          high:   'Deine Website ist gut für Google aufgestellt.',
          solid:  'Solide Basis — gezielte Maßnahmen holen mehr heraus.',
          medium: 'Mehrere SEO-Faktoren haben noch Luft nach oben.',
          low:    'Viel Potenzial — hier schlummern echte Wachstumschancen.',
        },
        geo: {
          high:   'KI-Suchmaschinen können deine Inhalte gut einordnen.',
          solid:  'Guter Start für KI-Sichtbarkeit — mit mehr Struktur besser.',
          medium: 'KI-Systeme haben Schwierigkeiten, deine Seite einzuordnen.',
          low:    'Für KI-Suche noch kaum optimiert — jetzt ist der Zeitpunkt.',
        },
        overall: {
          high:   'Deine Website ist insgesamt sehr gut aufgestellt.',
          solid:  'Gute Basis — mit den richtigen Hebeln noch mehr Sichtbarkeit.',
          medium: 'Noch nicht da, wo du sein könntest — aber das ist lösbar.',
          low:    'Viel ungenutztes Potenzial. Lass uns das gemeinsam angehen.',
        },
      };
      const tier = score >= 80 ? 'high' : score >= 60 ? 'solid' : score >= 40 ? 'medium' : 'low';
      return copy[type]?.[tier] ?? '';
    },

    // ── Modal ────────────────────────────────────────────────────────────────
    openModal() {
      if (this.analyzedUrl && !this.form.website) this.form.website = this.analyzedUrl;
      this.modalOpen = true;
      document.body.style.overflow = 'hidden';
    },

    closeModal() {
      this.modalOpen = false;
      document.body.style.overflow = '';
    },

    // ── Formular ─────────────────────────────────────────────────────────────
    async submitForm() {
      if (!this.form.name || !this.form.email || !this.form.website) return;
      this.formSubmitting = true;

      try {
        try {
          const res = await fetch('/api/contact', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(this.form),
          });
          if (!res.ok) throw new Error('no endpoint');
        } catch {
          const subject = encodeURIComponent('Analysereport-Anfrage via Faindable');
          const body    = encodeURIComponent(
            `Name: ${this.form.name}\nE-Mail: ${this.form.email}\n` +
            `Website: ${this.form.website || '—'}\n\nNachricht:\n${this.form.message || '—'}`
          );
          window.location.href = `mailto:info@faindable.de?subject=${subject}&body=${body}`;
        }
        this.formSent = true;
      } catch (err) {
        console.error('[Form]', err);
      } finally {
        this.formSubmitting = false;
      }
    },

    // ── Util ─────────────────────────────────────────────────────────────────
    _sleep(ms) { return new Promise(r => setTimeout(r, ms)); },
  };
}
