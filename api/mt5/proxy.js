/**
 * /api/mt5/proxy — MetaApi secure proxy
 *
 * Keeps METAAPI_TOKEN server-side (Vercel env var).
 * Frontend sends: { base: 'prov'|'data', region: 'london', path: '/...', method: 'GET'|'POST', body: {} }
 * This function forwards the call to MetaApi and returns the result.
 */

const PROV_URL = 'https://mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai';
const DATA_BASE = 'https://mt-client-api-v1';

export default async function handler(req, res) {
  // CORS — allow requests from your Vercel domain
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = process.env.METAAPI_TOKEN;
  if (!token) {
    return res.status(500).json({ error: 'METAAPI_TOKEN not configured — set it in Vercel dashboard → Settings → Environment Variables' });
  }

  const { base, region, path, method, body } = req.body || {};

  if (!path || !method) {
    return res.status(400).json({ error: 'Missing path or method' });
  }

  // Build target URL
  let targetBase;
  if (base === 'data') {
    targetBase = `${DATA_BASE}.${region || 'london'}.agiliumtrade.ai`;
  } else {
    targetBase = PROV_URL;
  }

  const targetUrl = targetBase + path;

  try {
    const upstream = await fetch(targetUrl, {
      method: method.toUpperCase(),
      headers: {
        'Content-Type': 'application/json',
        'auth-token': token,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const data = await upstream.json().catch(() => ({}));
    return res.status(upstream.status).json(data);
  } catch (err) {
    return res.status(502).json({ error: 'MetaApi unreachable: ' + err.message });
  }
}
