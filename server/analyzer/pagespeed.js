const axios = require('axios');

const PAGESPEED_ENDPOINT = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';

/**
 * Fetches PageSpeed Insights data for a URL (mobile strategy).
 * Returns { lcp, inp, cls, performanceScore } — all null on failure.
 */
async function getPageSpeedMetrics(url) {
  const apiKey = process.env.PAGESPEED_API_KEY;

  if (!apiKey || apiKey === 'dein_api_key_hier') {
    console.warn('[PageSpeed] No API key configured — skipping PageSpeed metrics.');
    return { lcp: null, inp: null, cls: null, performanceScore: null };
  }

  try {
    const response = await axios.get(PAGESPEED_ENDPOINT, {
      params: {
        url,
        strategy: 'mobile',
        key: apiKey,
        category: 'performance',
      },
      timeout: 30000,
    });

    const data = response.data;
    const audits = data?.lighthouseResult?.audits || {};
    const categories = data?.lighthouseResult?.categories || {};

    // LCP in seconds
    const lcpMs = audits['largest-contentful-paint']?.numericValue || null;
    const lcp = lcpMs !== null ? lcpMs / 1000 : null;

    // INP in ms (fallback: TBT or FID)
    const inpMs =
      audits['interaction-to-next-paint']?.numericValue ||
      audits['total-blocking-time']?.numericValue ||
      null;
    const inp = inpMs !== null ? inpMs : null;

    // CLS score (unitless)
    const cls = audits['cumulative-layout-shift']?.numericValue ?? null;

    // Performance score 0–100
    const performanceScore =
      categories?.performance?.score !== undefined && categories.performance.score !== null
        ? Math.round(categories.performance.score * 100)
        : null;

    return { lcp, inp, cls, performanceScore };
  } catch (err) {
    console.warn('[PageSpeed] API error:', err.message);
    return { lcp: null, inp: null, cls: null, performanceScore: null };
  }
}

module.exports = { getPageSpeedMetrics };
