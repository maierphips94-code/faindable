/**
 * Faindable – Alpine.js Haupt-Komponente
 * Läuft komplett im Browser (Live Server, kein Node.js nötig).
 * Analyse-Logik: js/analyzer.js
 */

'use strict';

function faindable() {
  return {
    // ── State ───────────────────────────────────────────────────────────────
    url: '',
    loading: false,
    showResults: false,
    urlError: '',
    analyzedUrl: '',

    results: {
      seo: null,
      geo: null,
      overall: null,
      manual_checks: 0,
    },

    // Modal
    modalOpen: false,
    formSent: false,
    formSubmitting: false,
    form: { name: '', email: '', website: '', message: '' },

    // ── Init ─────────────────────────────────────────────────────────────────
    init() {
      this.$watch('analyzedUrl', val => {
        if (val && !this.form.website) this.form.website = val;
      });
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

      this.loading     = true;
      this.showResults = false;
      this.results     = { seo: 0, geo: 0, overall: 0, manual_checks: 0 };

      // Sofort zur Lade-Animation scrollen
      await this.$nextTick();
      document.getElementById('loading-section')
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });

      try {
        // analyzeUrl kommt aus js/analyzer.js
        const data = await analyzeUrl(this.url);

        this.analyzedUrl = data.analyzed_url || this.url;

        // Alle Schritte als erledigt markieren
        document.querySelectorAll('[x-data*="loadingSteps"]').forEach(el => {
          if (el._x_dataStack) {
            const comp = el._x_dataStack[0];
            if (comp?.steps) {
              comp.steps.forEach((s, i) => {
                s.state = 'done';
                if (!s.duration) s.duration = 800 + i * 200;
              });
            }
          }
        });

        await this._sleep(400);
        this.loading = false;    // Loading-Section erst wegblenden …
        this.showResults = true; // … dann Ergebnisse einblenden

        // Warten bis beide Transitionen abgeschlossen sind (leave 200ms + enter 500ms)
        await this._sleep(600);
        const el = document.getElementById('results');
        if (el) {
          const top = el.getBoundingClientRect().top + window.scrollY - 24;
          window.scrollTo({ top, behavior: 'smooth' });
        }

        // Score-Animationen gestaffelt starten
        await this._sleep(200);
        await this._animateScore('seo',     data.seo);
        await this._sleep(150);
        await this._animateScore('geo',     data.geo);
        await this._sleep(150);
        await this._animateScore('overall', data.overall);

        this.results.manual_checks = data.manual_checks ?? 0;

      } catch (err) {
        console.error('[Faindable]', err);
        const known = /nicht erreichbar|zu lange gedauert|vollständige URL|gültige Domain/;
        this.urlError = known.test(err?.message)
          ? err.message
          : 'Etwas ist schiefgelaufen. Bitte in Kürze erneut versuchen.';
      } finally {
        this.loading = false;
      }
    },

    // ── Score-Animation (0 → Ziel, Ease-Out-Cubic) ──────────────────────────
    _animateScore(key, target) {
      return new Promise(resolve => {
        const DURATION = 1400;
        const start    = performance.now();

        const tick = now => {
          const p       = Math.min((now - start) / DURATION, 1);
          const eased   = 1 - Math.pow(1 - p, 3);
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
    getScoreColor(score, alpha = 1) {
      if (score == null) return `rgba(100,116,139,${alpha})`;
      if (score >= 80)   return `rgba(16,185,129,${alpha})`;   // grün
      if (score >= 60)   return `rgba(30,58,95,${alpha})`;   // violet
      if (score >= 40)   return `rgba(245,158,11,${alpha})`;   // gelb
      return                    `rgba(239,68,68,${alpha})`;    // rot
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
          high:   'Deine Website ist gut für Google aufgestellt. Kleine Optimierungen holen noch mehr heraus.',
          solid:  'Solide Basis — mit gezielten Maßnahmen erreichst du bessere Positionen.',
          medium: 'Mehrere SEO-Faktoren haben noch Luft nach oben. Das lässt sich gezielt beheben.',
          low:    'Viel Potenzial für Verbesserungen — hier schlummern echte Wachstumschancen.',
        },
        geo: {
          high:   'KI-Suchmaschinen können deine Inhalte gut verstehen und einordnen.',
          solid:  'Guter Start für KI-Sichtbarkeit — mit mehr Struktur noch besser.',
          medium: 'KI-Systeme haben Schwierigkeiten, deine Website einzuordnen.',
          low:    'Für KI-Suche noch kaum optimiert — jetzt ist der richtige Zeitpunkt.',
        },
        overall: {
          high:   'Deine Website ist insgesamt sehr gut aufgestellt. Weiter so!',
          solid:  'Gute Basis — mit Fokus auf die richtigen Hebel noch mehr Sichtbarkeit.',
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
      if (!this.form.name || !this.form.email) return;
      this.formSubmitting = true;

      try {
        // Eigenen Backend-Endpoint hier eintragen, sonst Mailto-Fallback
        try {
          const res = await fetch('/api/contact', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(this.form),
          });
          if (!res.ok) throw new Error('no endpoint');
        } catch {
          // Mailto-Fallback
          const subject = encodeURIComponent('Erstgespräch-Anfrage via Faindable');
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

// ─── Loading Steps Komponente ─────────────────────────────────────────────────
function loadingSteps() {
  const STEPS = [
    {
      label:      'Website wird geladen',
      activeText: 'HTML & Ressourcen werden abgerufen …',
      doneText:   'Seite erfolgreich geladen',
      icon:       '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.4"/><path d="M8 5v3l2 2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
      delay: 0,
      duration: 0,
    },
    {
      label:      'SEO-Signale analysieren',
      activeText: 'E-E-A-T, On-Page, Technical SEO …',
      doneText:   'SEO-Score berechnet',
      icon:       '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="7" cy="7" r="5" stroke="currentColor" stroke-width="1.4"/><path d="M11 11L14 14" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
      delay: 3000,
      duration: 0,
    },
    {
      label:      'GEO-Faktoren prüfen',
      activeText: 'Schema.org, Structured Data, Entity …',
      doneText:   'GEO-Score berechnet',
      icon:       '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 2s-4 4-4 7a4 4 0 0 0 8 0c0-3-4-7-4-7z" stroke="currentColor" stroke-width="1.4"/><circle cx="8" cy="9" r="1.5" stroke="currentColor" stroke-width="1.2"/></svg>',
      delay: 6000,
      duration: 0,
    },
    {
      label:      'PageSpeed & Core Web Vitals',
      activeText: 'LCP, CLS, INP via Google API …',
      doneText:   'Performance-Daten geladen',
      icon:       '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 12L6 7l3 3 2-4 3 4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      delay: 9000,
      duration: 0,
    },
    {
      label:      'Gesamtscore berechnen',
      activeText: 'Gewichtung & Auswertung …',
      doneText:   'Fertig!',
      icon:       '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 2l1.8 3.6L14 6.3l-3 2.9.7 4.1L8 11.4l-3.7 1.9.7-4.1L2 6.3l4.2-.7z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>',
      delay: 13000,
      duration: 0,
    },
  ];

  return {
    steps: STEPS.map(s => ({ ...s, state: 'pending' })),
    _timers: [],

    init() {
      // Schritte zeitgestaffelt aktivieren
      STEPS.forEach((step, i) => {
        const t = setTimeout(() => {
          // Vorherigen Schritt abschließen
          if (i > 0 && this.steps[i - 1].state === 'active') {
            const prev = this.steps[i - 1];
            prev.duration = Math.round(step.delay - STEPS[i - 1].delay - 200 + Math.random() * 400);
            prev.state = 'done';
          }
          if (this.steps[i]) this.steps[i].state = 'active';
        }, step.delay);
        this._timers.push(t);
      });
    },

    destroy() {
      this._timers.forEach(t => clearTimeout(t));
    },
  };
}
