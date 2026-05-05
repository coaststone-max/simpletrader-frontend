/**
 * POST /api/tradovate/accounts
 *
 * Authenticates with Tradovate and returns all accounts linked to that user.
 * Called from the frontend when the user connects their Tradovate credentials.
 *
 * Body: { username, password }
 *
 * Returns:
 *   { ok: true, accounts: [{ accountId, accountSpec, name, balance, status }] }
 *   { ok: false, error }
 *
 * Required env vars: TRADOVATE_CID, TRADOVATE_SEC
 */

const TRADOVATE_BASE = 'https://live.tradovateapi.com/v1';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const CID = process.env.TRADOVATE_CID;
  const SEC = process.env.TRADOVATE_SEC;

  if (!CID || !SEC) {
    return res.status(500).json({
      ok: false,
      error: 'TRADOVATE_CID / TRADOVATE_SEC not set — add them in Vercel → Settings → Environment Variables',
    });
  }

  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ ok: false, error: 'username and password are required' });
  }

  // ── Step 1: Authenticate ─────────────────────────────────────────────────
  let authData;
  try {
    const authRes = await fetch(`${TRADOVATE_BASE}/auth/accesstokenrequest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name:       username,
        password,
        appId:      'SimpleTrader',
        appVersion: '1.0',
        cid:        Number(CID),
        sec:        SEC,
        deviceId:   'simpletrader-srv',
      }),
    });
    authData = await authRes.json();
  } catch (err) {
    return res.status(502).json({ ok: false, error: 'Cannot reach Tradovate API: ' + String(err) });
  }

  if (!authData?.accessToken) {
    // Tradovate returns errorText on bad credentials
    const reason = authData?.errorText || authData?.p || 'Check your username and password';
    return res.status(401).json({ ok: false, error: 'Authentication failed — ' + reason });
  }

  const token = authData.accessToken;

  // ── Step 2: Fetch all accounts ────────────────────────────────────────────
  let accountList;
  try {
    const listRes = await fetch(`${TRADOVATE_BASE}/account/list`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    accountList = await listRes.json();
  } catch (err) {
    return res.status(502).json({ ok: false, error: 'Failed to fetch account list: ' + String(err) });
  }

  if (!Array.isArray(accountList)) {
    return res.status(502).json({ ok: false, error: 'Unexpected response from Tradovate', raw: accountList });
  }

  // ── Step 3: Fetch balances (optional — may 404 on demo/eval accounts) ────
  let cashBalances = [];
  try {
    const cashRes = await fetch(`${TRADOVATE_BASE}/cashBalance/list`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (cashRes.ok) cashBalances = await cashRes.json();
  } catch (_) { /* non-fatal */ }

  const balanceByAccount = {};
  if (Array.isArray(cashBalances)) {
    for (const cb of cashBalances) {
      if (cb.accountId) balanceByAccount[cb.accountId] = cb.cashBalance ?? cb.totalCashValue ?? 0;
    }
  }

  // ── Step 4: Shape the response ────────────────────────────────────────────
  const accounts = accountList.map((acc) => ({
    accountId:   acc.id,
    accountSpec: username,          // Tradovate uses the login email as account spec
    name:        acc.name || acc.nickname || `Account ${acc.id}`,
    balance:     balanceByAccount[acc.id] ?? acc.initialBalance ?? 0,
    status:      acc.active ? 'active' : 'inactive',
    legalStatus: acc.legalStatus || '',   // e.g. "Trader", "Funded"
  }));

  return res.json({ ok: true, accounts, username });
}
