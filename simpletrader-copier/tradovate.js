/**
 * tradovate.js — Tradovate REST API client
 *
 * Handles:
 *   - Authentication (accesstokenrequest) with auto-refresh
 *   - Account listing
 *   - Position / fill polling
 *   - Order placement (market orders)
 *
 * Env required: TRADOVATE_CID, TRADOVATE_SEC
 */

const BASE   = 'https://live.tradovateapi.com/v1';
const CID    = Number(process.env.TRADOVATE_CID);
const SEC    = process.env.TRADOVATE_SEC;

// Cache tokens per user: { username → { token, expiresAt } }
const tokenCache = new Map();

// ─── AUTH ──────────────────────────────────────────────────────────────────

export async function getToken(username, password) {
  const cached = tokenCache.get(username);
  if (cached && Date.now() < cached.expiresAt - 60_000) return cached.token;

  const res  = await tvFetch('/auth/accesstokenrequest', 'POST', null, {
    name:       username,
    password,
    appId:      'SimpleTrader',
    appVersion: '1.0',
    cid:        CID,
    sec:        SEC,
    deviceId:   'simpletrader-copier',
  });

  if (!res.accessToken) {
    throw new Error(`Auth failed for ${username}: ${res.errorText || JSON.stringify(res)}`);
  }

  // Tradovate tokens expire after 80 minutes; cache for 75 min
  tokenCache.set(username, {
    token:     res.accessToken,
    expiresAt: Date.now() + 75 * 60 * 1000,
  });

  return res.accessToken;
}

export function invalidateToken(username) {
  tokenCache.delete(username);
}

// ─── POSITIONS ─────────────────────────────────────────────────────────────

/**
 * Returns current open positions for a Tradovate account.
 * Positions with netPos === 0 are closed — filter them out.
 */
export async function getPositions(token, accountId) {
  const all = await tvFetch('/position/list', 'GET', token);
  if (!Array.isArray(all)) return [];
  return all.filter(p => p.accountId === accountId && p.netPos !== 0);
}

// ─── FILLS (recent executions) ─────────────────────────────────────────────

/**
 * Returns fills (executions) since a given timestamp.
 * Used to detect NEW trades rather than polling positions.
 */
export async function getFillsSince(token, accountId, sinceMs) {
  // Tradovate provides /fill/list — filter by account and timestamp
  const all = await tvFetch('/fill/list', 'GET', token);
  if (!Array.isArray(all)) return [];
  return all.filter(f => {
    if (f.accountId !== accountId) return false;
    const ts = new Date(f.timestamp || f.tradeDate || 0).getTime();
    return ts > sinceMs;
  });
}

// ─── ORDER PLACEMENT ───────────────────────────────────────────────────────

/**
 * Places a market order on a slave account.
 * action: 'Buy' | 'Sell'
 */
export async function placeMarketOrder({ token, accountSpec, accountId, action, symbol, qty }) {
  const data = await tvFetch('/order/placeorder', 'POST', token, {
    accountSpec,
    accountId:   Number(accountId),
    action,
    symbol:      String(symbol).toUpperCase(),
    orderQty:    Math.max(1, Math.round(qty)),
    orderType:   'Market',
    isAutomated: true,
  });
  const orderId = data?.orderId ?? data?.id;
  if (!orderId) {
    throw new Error(data?.errorText || `Order rejected: ${JSON.stringify(data)}`);
  }
  return { orderId, side: action, symbol, qty };
}

/**
 * Closes all positions on a slave account with market orders.
 */
export async function closeAllPositions({ token, accountSpec, accountId }) {
  const positions = await getPositions(token, accountId);
  if (!positions.length) return [];

  return Promise.allSettled(
    positions.map(p => placeMarketOrder({
      token, accountSpec, accountId,
      action: p.netPos > 0 ? 'Sell' : 'Buy',
      symbol: p.contractId ? String(p.contractId) : p.symbol,
      qty:    Math.abs(p.netPos),
    }))
  );
}

// ─── HELPERS ───────────────────────────────────────────────────────────────

async function tvFetch(path, method, token, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Tradovate ${method} ${path} → HTTP ${res.status}: ${text}`);
  }

  return res.json().catch(() => ({}));
}
