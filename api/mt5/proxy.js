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
 *   METAAPI_TOKEN — your MetaApi auth token (Settings → API Access in app.metaapi.cloud)
 */

const TOKEN = process.env.METAAPI_TOKEN;

const PROV_BASE = 'https://mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai';
const DATA_BASE = (region) =>
  `https://${region || 'london'}.mt-client-api-v1.agiliumtrade.ai`;

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

  try {
    const fetchOpts = {
      method,
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
    const text = await upstream.text();

    // Try JSON, fall back to raw text
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    // Forward upstream status
    res.status(upstream.ok ? 200 : upstream.status).json(data);

  } catch (err) {
    console.error('[mt5/proxy] Error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
}
