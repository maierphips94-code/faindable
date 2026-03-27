'use strict';

class AnalysisRobot {
  constructor() {
    this.wrapper        = null;
    this.body           = null;
    this.lensMain       = null;
    this.lensesSm       = null;
    this.antennaLed     = null;
    this.scanBeam       = null;
    this.particles      = null;
    this.dataBits       = null;
    this.checkmark      = null;
    this._pInterval     = null;
    this._dInterval     = null;
    this._ready         = false;
    this._init();
  }

  _init() {
    this.wrapper    = document.getElementById('analysis-robot');
    if (!this.wrapper) return;
    this.body       = document.getElementById('robot-body');
    this.lensMain   = document.getElementById('lens-main');
    this.lensesSm   = Array.from(document.querySelectorAll('.lens-sm'));
    this.antennaLed = document.getElementById('antenna-led');
    this.scanBeam   = document.getElementById('scan-beam');
    this.particles  = document.getElementById('particles');
    this.dataBits   = document.getElementById('data-bits');
    this.checkmark  = document.getElementById('robot-checkmark');
    this._ready     = true;
  }

  // ── Phase 0: Roboter erscheint ────────────────────────────────────────────
  enter() {
    if (!this._ready) return;
    this.reset();
    this.wrapper.style.display = 'flex';
    this.wrapper.style.animation = 'robotEnter 800ms ease-out forwards';
  }

  // ── Phase 1: Verbindung aufbauen ──────────────────────────────────────────
  startConnecting() {
    if (!this._ready) return;
    this.lensesSm.forEach((l, i) => {
      l.style.animation = `lensPulse 1s ease-in-out ${i * 200}ms infinite`;
    });
    this.antennaLed.style.animation = 'lensPulse 0.75s ease-in-out infinite';
    this.body.style.animation = 'robotVibrate 0.22s ease-in-out infinite';
  }

  // ── Phase 2: Scanning ─────────────────────────────────────────────────────
  startScanning() {
    if (!this._ready) return;
    this.body.style.animation = 'robotSway 3s ease-in-out infinite';
    this.lensMain.style.boxShadow =
      'inset 0 0 14px rgba(160,120,255,.40), 0 0 22px rgba(160,120,255,.45)';
    this.scanBeam.style.opacity = '1';
    this.scanBeam.style.animationPlayState = 'running';
    this._spawnParticles(3, 1100);
  }

  // ── Phase 3: Processing ───────────────────────────────────────────────────
  startProcessing() {
    if (!this._ready) return;
    this.body.style.animation = 'robotProcess 0.85s ease-in-out infinite';
    this.lensesSm.forEach(l => {
      l.style.boxShadow = '0 0 14px rgba(5,102,217,.60)';
      l.style.animation = 'lensPulse 0.5s ease-in-out infinite';
    });
    this.lensMain.style.boxShadow =
      'inset 0 0 14px rgba(160,120,255,.45), 0 0 30px rgba(160,120,255,.70)';
    this._spawnParticles(6, 550);
    this._spawnDataBits();
  }

  // ── Phase 4: Fertig ───────────────────────────────────────────────────────
  showComplete() {
    if (!this._ready) return;
    clearInterval(this._pInterval);
    clearInterval(this._dInterval);

    this.body.style.animation = 'robotNod 420ms ease-in-out';

    const greenBg = 'radial-gradient(circle at 35% 35%,#052e16 0%,#065f46 50%,#10b981 100%)';
    this.lensMain.style.background  = greenBg;
    this.lensMain.style.boxShadow   = 'inset 0 0 12px rgba(16,185,129,.35), 0 0 24px rgba(16,185,129,.55)';
    this.lensMain.style.animation   = 'none';
    this.lensesSm.forEach(l => {
      l.style.background = greenBg;
      l.style.boxShadow  = '0 0 14px rgba(16,185,129,.50)';
      l.style.animation  = 'none';
    });
    this.antennaLed.style.background  = '#10b981';
    this.antennaLed.style.boxShadow   = '0 0 12px rgba(16,185,129,.70)';
    this.antennaLed.style.animation   = 'none';
    this.scanBeam.style.opacity = '0';

    setTimeout(() => {
      this.checkmark.classList.add('visible');
    }, 180);
  }

  // ── Phase 5: Roboter verlässt die Bühne ───────────────────────────────────
  exit() {
    if (!this._ready) return;
    this.wrapper.style.animation = 'robotExit 500ms ease-in forwards';
    setTimeout(() => {
      this.wrapper.style.display = 'none';
      this._hardReset();
    }, 510);
  }

  // ── Partikel ──────────────────────────────────────────────────────────────
  _spawnParticles(count, interval) {
    clearInterval(this._pInterval);
    this._pInterval = setInterval(() => {
      for (let i = 0; i < count; i++) {
        const p = document.createElement('div');
        p.className = 'robot-particle';
        const endY = (Math.random() - 0.5) * 44;
        p.style.cssText = `
          left: -18px;
          top: ${42 + Math.random() * 40}%;
          --end-y: ${endY}px;
          background: ${Math.random() > 0.5 ? '#d0bcff' : '#adc6ff'};
          animation: particleFly ${480 + Math.random() * 480}ms ease-in forwards;
          animation-delay: ${Math.random() * 180}ms;
        `;
        this.particles.appendChild(p);
        p.addEventListener('animationend', () => p.remove(), { once: true });
      }
    }, interval);
  }

  // ── Daten-Bits ────────────────────────────────────────────────────────────
  _spawnDataBits() {
    const pool = ['0', '1', '{', '}', '<', '/', '>'];
    clearInterval(this._dInterval);
    this._dInterval = setInterval(() => {
      const b = document.createElement('div');
      b.className = 'robot-data-bit';
      b.textContent = pool[Math.floor(Math.random() * pool.length)];
      b.style.cssText = `
        left: ${12 + Math.random() * 110}px;
        top:  ${18 + Math.random() * 55}%;
        animation: dataFloat 1.4s ease-out forwards;
      `;
      this.dataBits.appendChild(b);
      b.addEventListener('animationend', () => b.remove(), { once: true });
    }, 320);
  }

  // ── Reset ─────────────────────────────────────────────────────────────────
  reset() {
    if (!this._ready) return;
    clearInterval(this._pInterval);
    clearInterval(this._dInterval);
    this.checkmark.classList.remove('visible');
    this.wrapper.style.animation = '';
    this.body.style.cssText = '';
    this.lensMain.style.cssText = '';
    this.antennaLed.style.cssText = '';
    this.scanBeam.style.cssText = '';
    this.lensesSm.forEach(l => (l.style.cssText = ''));
    this.particles.innerHTML = '';
    this.dataBits.innerHTML  = '';
  }

  _hardReset() {
    this.reset();
    this.wrapper.style.display = 'none';
  }
}

window.analysisRobot = new AnalysisRobot();
