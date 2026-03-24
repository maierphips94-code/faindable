const axios = require('axios');

const USER_AGENT = 'Mozilla/5.0 (compatible; Faindable-Bot/1.0; +https://faindable.de/bot)';
const TIMEOUT_MS = 10000;
const MAX_REDIRECTS = 3;

/**
 * Fetches the HTML content of a URL.
 * Returns { html, finalUrl, statusCode } or throws with a user-friendly message.
 */
async function fetchHtml(url) {
  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'de,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
      },
      timeout: TIMEOUT_MS,
      maxRedirects: MAX_REDIRECTS,
      responseType: 'text',
      validateStatus: (status) => status < 500,
    });

    if (response.status >= 400) {
      throw new Error(`HTTP ${response.status}: Seite nicht erreichbar`);
    }

    return {
      html: response.data,
      finalUrl: response.request?.res?.responseUrl || url,
      statusCode: response.status,
    };
  } catch (err) {
    if (err.code === 'ECONNABORTED' || err.message.includes('timeout')) {
      throw new Error('Die Analyse hat zu lange gedauert. Bitte versuche es erneut.');
    }
    if (err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED') {
      throw new Error('Diese Seite konnten wir leider nicht erreichen. Bitte prüfe die URL.');
    }
    if (err.response?.status >= 400) {
      throw new Error(`Diese Seite konnten wir leider nicht erreichen (${err.response.status}).`);
    }
    throw new Error(err.message || 'Diese Seite konnten wir leider nicht erreichen.');
  }
}

/**
 * Checks if a path is reachable under the given base URL.
 * Returns { ok: boolean, status: number }
 */
async function checkPath(baseUrl, path) {
  try {
    const url = new URL(path, baseUrl).href;
    const response = await axios.get(url, {
      headers: { 'User-Agent': USER_AGENT },
      timeout: 5000,
      maxRedirects: 2,
      validateStatus: () => true,
    });
    return { ok: response.status < 400, status: response.status };
  } catch {
    return { ok: false, status: 0 };
  }
}

module.exports = { fetchHtml, checkPath };
