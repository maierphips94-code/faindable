require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');

const { fetchHtml } = require('./utils/fetcher');
const { analyzeSEO } = require('./analyzer/seo');
const { analyzeGEO } = require('./analyzer/geo');
const { getPageSpeedMetrics } = require('./analyzer/pagespeed');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false, // relax for dev; tighten in prod
}));

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

app.use(cors({
  origin: allowedOrigins.length > 0
    ? (origin, cb) => {
        if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
        cb(new Error('Not allowed by CORS'));
      }
    : true,
  methods: ['GET', 'POST'],
  credentials: false,
}));

app.use(express.json({ limit: '1mb' }));

// ─── Static Files ─────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '..')));

// ─── URL Validation ───────────────────────────────────────────────────────────
function validateUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  let url = rawUrl.trim();
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'https://' + url;
  }
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    if (!parsed.hostname || !parsed.hostname.includes('.')) return null;
    return parsed.href;
  } catch {
    return null;
  }
}

// ─── POST /api/analyze ────────────────────────────────────────────────────────
app.post('/api/analyze', async (req, res) => {
  const rawUrl = req.body?.url;

  if (!rawUrl) {
    return res.status(400).json({ error: 'Bitte gib eine URL ein.' });
  }

  const url = validateUrl(rawUrl);
  if (!url) {
    return res.status(400).json({
      error: 'Bitte gib eine vollständige URL ein (z.B. https://deine-website.de)',
    });
  }

  try {
    console.log(`[Analyze] Starting analysis for: ${url}`);

    // Fetch HTML
    const { html, finalUrl } = await fetchHtml(url);

    // Run PageSpeed once, share with both analyzers
    const pageSpeedData = await getPageSpeedMetrics(finalUrl);

    // Run SEO and GEO analysis in parallel
    const [seoResult, geoResult] = await Promise.all([
      analyzeSEO(html, finalUrl),
      analyzeGEO(html, finalUrl, pageSpeedData),
    ]);

    const seoScore = Math.min(100, seoResult.score);
    const geoScore = Math.min(100, geoResult.score);
    const overall = Math.round((seoScore * 0.5) + (geoScore * 0.5));
    const manualChecks = seoResult.manualChecks + geoResult.manualChecks;

    console.log(`[Analyze] Done — SEO: ${seoScore}, GEO: ${geoScore}, Overall: ${overall}`);

    return res.json({
      seo: seoScore,
      geo: geoScore,
      overall,
      manual_checks: manualChecks,
      analyzed_url: finalUrl,
    });
  } catch (err) {
    console.error('[Analyze] Error:', err.message);

    const userMessage = err.message.includes('nicht erreichbar') ||
      err.message.includes('zu lange') ||
      err.message.includes('vollständige URL')
      ? err.message
      : 'Etwas ist schiefgelaufen. Bitte in Kürze erneut versuchen.';

    return res.status(422).json({ error: userMessage });
  }
});

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/api/health', (_, res) => res.json({ status: 'ok', version: '1.0.0' }));

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 Faindable Server running at http://localhost:${PORT}`);
  console.log(`   PageSpeed API: ${process.env.PAGESPEED_API_KEY ? 'configured ✓' : 'not configured (scores will be partial)'}`);
  console.log(`   CORS origins:  ${process.env.ALLOWED_ORIGINS || 'all (dev mode)'}\n`);
});
