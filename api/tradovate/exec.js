/**
 * POST /api/tradovate/exec
 *
 * Places a single market order on a Tradovate account.
 * You can pass either:
 *   a) username + password  → the handler authenticates and places the order
 *   b) token               → uses the pre-obtained access token directly
 *
 * Body: { username, password, token, accountSpec, accountId, action, symbol, qty }
 *
 * Required env vars: TRADOVATE_CID, TRADOVATE_SEC  (only when authenticating)
 *
 * Returns: { ok, orderId, side, symbol, qty }
 */

const TRADOVATE_BASE = 'https://live.tradovateapi.com/v1';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const { username, password, token: providedToken, accountSpec, accountId, action, symbol, qty } = req.body || {};

  if (!accountSpec || !accountId || !action || !symbol || !qty) {
    return res.status(400).json({ ok: false, error: 'Required: accountSpec, accountId, action, symbol, qty' });
  }

  // ── Get access token ───────────────────────────────────────────────────────
  let accessToken = providedToken;

  if (!accessToken) {
    const CID = process.env.TRADOVATE_CID;
    const SEC = process.env.TRADOVATE_SEC;
    if (!CID || !SEC) return res.status(500).json({ ok: false, error: 'TRADOVATE_CID / TRADOVATE_SEC not configured' });
    if (!username || !password) return res.status(400).json({ ok: false, error: 'Provide either token or username+password' });

    try {
      const authRes = await fetch(`${TRADOVATE_BASE}/auth/accesstokenrequest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: username, password, appId: 'SimpleTrader', appVersion: '1.0', cid: Number(CID), sec: SEC, deviceId: 'simpletrader-srv' }),
      });
      const authData = await authRes.json();
      if (!authData?.accessToken) return res.status(401).json({ ok: false, error: 'Auth failed', detail: authData?.errorText });
      accessToken = authData.accessToken;
    } catch (err) {
      return res.status(502).json({ ok: false, error: 'Tradovate unreachable: ' + String(err) });
    }
  }

  // ── Place order ────────────────────────────────────────────────────────────
  const side = (action || '').toLowerCase().startsWith('buy') || action.toLowerCase() === 'long' ? 'Buy' : 'Sell';

  try {
    const orderRes = await fetch(`${TRADOVATE_BASE}/order/placeorder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ accountSpec, accountId: Number(accountId), action: side, symbol: String(symbol).toUpperCase(), orderQty: Math.max(1, Number(qty)), orderType: 'Market', isAutomated: true }),
    });
    const data = await orderRes.json();
    const orderId = data?.orderId ?? data?.id;
    if (orderId) return res.json({ ok: true, orderId, side, symbol, qty: Number(qty) });
    return res.status(400).json({ ok: false, error: data?.errorText || 'Order rejected', detail: data });
  } catch (err) {
    return res.status(502).json({ ok: false, error: 'Order request failed: ' + String(err) });
  }
}
