/**
 * /api/mt5/proxy.js
 *
 * Secure proxy for MetaApi REST calls.
 * The METAAPI_TOKEN env var never leaves the server.
 *
 * POST {
 *   base:   'prov' | 'data'   — which MetaApi API to call
 *   path:   '/users/current/...'
 *   method: 'GET' | 'POST' | 'DELETE'  (default GET)
 *   body:   object | null
 *   region: 'london' | 'new-york' | 'singapore' | ...  (for data API)
 * }
 *
 * base = 'prov' → https://mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai
 * base = 'data' → https://{region}.mt-client-api-v1.agiliumtrade.ai
 *
 * Required env var:
 *   METAAPI_TOKEN — MetaApi auth token (app.metaapi.cloud → API Access)
 *
 * Note: Vercel Hobby functions timeout at 10 s.
 *       We use an 8 s AbortSignal so errors are clear, not opaque 504s.
 */

const TOKEN = process.env.METAAPI_TOKEN;

// MetaApi REST base URLs
const PROV_BASE = 'https://mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai';
const DATA_BASE = (region) =>
  `https://${region || 'london'}.mt-client-api-v1.agiliumtrade.ai`;

// 8-second timeout — leaves 2 s margin before Vercel's 10-s hard cut
const FETCH_TIMEOUT_MS = 8_000;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ ok: false, error: 'Method not allowed' });

  if (!TOKEN) {
    return res.status(503).json({
      ok:    false,
      error: 'MetaApi no configurado — añade METAAPI_TOKEN en Vercel → Settings → Environment Variables.',
      docs:  'https://app.metaapi.cloud/api-access',
    });
  }

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  } catch {
    return res.status(400).json({ ok: false, error: 'Invalid JSON' });
  }

  const { base, path, method = 'GET', body: reqBody, region = 'london' } = body;

  if (!base || !path) {
    return res.status(400).json({ ok: false, error: 'base and path are required' });
  }
  if (!['prov', 'data'].includes(base)) {
    return res.status(400).json({ ok: false, error: 'base must be prov or data' });
  }

  const baseUrl = base === 'prov' ? PROV_BASE : DATA_BASE(region);
  const url = `${baseUrl}${path}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const fetchOpts = {
      method,
      signal: controller.signal,
      headers: {
        'auth-token':   TOKEN,
        'Content-Type': 'application/json',
      },
    };

    if (reqBody && method !== 'GET' && method !== 'DELETE') {
      fetchOpts.body = JSON.stringify(reqBody);
    }

    console.log(`[mt5/proxy] ${method} ${base}:${path}`);

    const upstream = await fetch(url, fetchOpts);
    clearTimeout(timer);

    const text = await upstream.text();

    // Try JSON, fall back to raw text
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    // Forward upstream status
    res.status(upstream.ok ? 200 : upstream.status).json(data);

  } catch (err) {
    clearTimeout(timer);
    console.error('[mt5/proxy] Error:', err.message);

    // AbortError = our 8-s timeout fired
    if (err.name === 'AbortError') {
      return res.status(504).json({
        ok:      false,
        error:   'MetaApi tardó demasiado en responder (>8s). Inténtalo de nuevo en unos segundos.',
        timeout: true,
      });
    }

    res.status(500).json({ ok: false, error: err.message });
  }
}
