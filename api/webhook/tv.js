/**
 * POST /api/webhook/tv?uid={SUPABASE_USER_ID}
 *
 * TradingView webhook receiver.
 *
 * Authenticates with Tradovate ONCE using the user's stored credentials,
 * then places orders in parallel on all slave accounts.
 *
 * TradingView Alert → Message field JSON:
 *   {
 *     "secret":  "YOUR_WEBHOOK_SECRET",
 *     "action":  "{{strategy.order.action}}",   ← "buy" or "sell"
 *     "symbol":  "NQU5",                        ← exact Tradovate symbol
 *     "qty":     1
 *   }
 *
 * Required env vars:
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY, TRADOVATE_CID, TRADOVATE_SEC
 *
 * Required Supabase table (run once in Supabase SQL Editor):
 *   create table if not exists public.execution_log (
 *     id          bigserial primary key,
 *     user_id     uuid not null,
 *     action      text,
 *     symbol      text,
 *     qty         numeric,
 *     results     jsonb,
 *     created_at  timestamptz default now()
 *   );
 *   alter table public.execution_log enable row level security;
 *   create policy "Users see own logs" on public.execution_log
 *     for select using (auth.uid() = user_id);
 *
 * Returns:
 *   { ok, executed, total, results[] }
 */

const SUPABASE_URL  = process.env.SUPABASE_URL;
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_KEY;
const TRADOVATE_BASE = 'https://live.tradovateapi.com/v1';

// TradingView ticker → Tradovate front-month contract (update each quarter)
// Users can also just send the exact Tradovate symbol (e.g. "NQU5") from their alert.
const TV_TO_TRADOVATE = {
  'NQ1!': 'NQU5',  NQ: 'NQU5',  US100: 'NQU5', NAS100: 'NQU5', USTEC: 'NQU5',
  'MNQ1!': 'MNQU5', MNQ: 'MNQU5', NDXM: 'MNQU5',
  'ES1!': 'ESU5',  ES: 'ESU5',  US500: 'ESU5',  SPX500: 'ESU5',
  'MES1!': 'MESU5', MES: 'MESU5',
  'YM1!': 'YMU5',  YM: 'YMU5',  US30: 'YMU5',
  'GC1!': 'GCQ5',  GC: 'GCQ5',  GOLD: 'GCQ5',  XAUUSD: 'GCQ5',
  'CL1!': 'CLN5',  CL: 'CLN5',  USOIL: 'CLN5', WTI: 'CLN5',
  'BTC1!': 'BTCQ5', BTCUSD: 'BTCQ5',
};

function normalizeSymbol(raw) {
  const s = (raw || '').trim().toUpperCase().replace(/[^A-Z0-9!]/g, '');
  return TV_TO_TRADOVATE[s] || raw.trim().toUpperCase();
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(200).end();
  }
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Use POST' });

  const uid = req.query.uid;
  if (!uid) return res.status(400).json({ ok: false, error: 'Missing ?uid= parameter' });

  if (!SUPABASE_URL || !SERVICE_KEY) {
    return res.status(500).json({ ok: false, error: 'Server not configured (SUPABASE_URL / SUPABASE_SERVICE_KEY)' });
  }

  // ── Parse body ─────────────────────────────────────────────────────────────
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ ok: false, error: 'Invalid JSON body' }); }
  }
  const { secret, action, symbol, qty = 1 } = body || {};
  if (!secret || !action || !symbol) {
    return res.status(400).json({ ok: false, error: 'Required: secret, action, symbol' });
  }

  // ── Read user_data from Supabase ────────────────────────────────────────────
  const dbRes = await fetch(
    `${SUPABASE_URL}/rest/v1/user_data?user_id=eq.${encodeURIComponent(uid)}&select=payload`,
    { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, Accept: 'application/json' } }
  );
  if (!dbRes.ok) return res.status(502).json({ ok: false, error: 'DB read failed', status: dbRes.status });

  const rows  = await dbRes.json();
  const cfg   = rows?.[0]?.payload?.tradovateConfig;

  if (!cfg?.webhookSecret) {
    return res.status(403).json({ ok: false, error: 'Webhook not configured — set it up in SimpleTrader → Replicador' });
  }
  if (cfg.webhookSecret !== secret) {
    return res.status(403).json({ ok: false, error: 'Invalid webhook secret' });
  }

  const { username, password } = cfg;
  if (!username || !password) {
    return res.status(400).json({ ok: false, error: 'Tradovate credentials not saved — connect your account in SimpleTrader first' });
  }

  // Slave accounts = accounts with role 'slave'
  const slaves = (cfg.accounts || []).filter(a => a.role === 'slave');
  if (!slaves.length) {
    return res.json({ ok: true, executed: 0, total: 0, message: 'No slave accounts configured' });
  }

  // ── Authenticate ONCE with Tradovate ────────────────────────────────────────
  const CID = process.env.TRADOVATE_CID;
  const SEC = process.env.TRADOVATE_SEC;

  let accessToken;
  try {
    const authRes = await fetch(`${TRADOVATE_BASE}/auth/accesstokenrequest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: username, password,
        appId: 'SimpleTrader', appVersion: '1.0',
        cid: Number(CID), sec: SEC,
        deviceId: 'simpletrader-webhook',
      }),
    });
    const authData = await authRes.json();
    if (!authData?.accessToken) {
      return res.status(401).json({ ok: false, error: 'Tradovate auth failed — check credentials in SimpleTrader', detail: authData?.errorText });
    }
    accessToken = authData.accessToken;
  } catch (err) {
    return res.status(502).json({ ok: false, error: 'Tradovate unreachable: ' + String(err) });
  }

  // ── Place orders in parallel on all slave accounts ──────────────────────────
  const tradovateSymbol = normalizeSymbol(symbol);
  const side = (action || '').toLowerCase().startsWith('buy') || action.toLowerCase() === 'long' ? 'Buy' : 'Sell';

  const results = await Promise.allSettled(
    slaves.map(async (slave) => {
      const slaveQty = Math.max(1, Math.round(Number(qty) * (slave.multiplier || 1)));
      const orderRes = await fetch(`${TRADOVATE_BASE}/order/placeorder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          accountSpec: slave.accountSpec,
          accountId:   Number(slave.accountId),
          action:      side,
          symbol:      tradovateSymbol,
          orderQty:    slaveQty,
          orderType:   'Market',
          isAutomated: true,
        }),
      });
      const data = await orderRes.json();
      const orderId = data?.orderId ?? data?.id;
      if (!orderId) throw new Error(data?.errorText || 'Order rejected');
      return { account: slave.name, accountId: slave.accountId, orderId, qty: slaveQty };
    })
  );

  const summary = results.map((r, i) => ({
    account: r.value?.account ?? slaves[i]?.name,
    accountId: slaves[i]?.accountId,
    ok:      r.status === 'fulfilled',
    orderId: r.value?.orderId ?? null,
    qty:     r.value?.qty ?? null,
    error:   r.status === 'rejected' ? String(r.reason?.message ?? r.reason) : null,
  }));

  // ── Log to Supabase (fire-and-forget) ───────────────────────────────────────
  fetch(`${SUPABASE_URL}/rest/v1/execution_log`, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ user_id: uid, action, symbol: tradovateSymbol, qty: Number(qty), results: summary, created_at: new Date().toISOString() }),
  }).catch(() => {});

  const executed = summary.filter(r => r.ok).length;
  return res.json({ ok: true, executed, total: slaves.length, symbol: tradovateSymbol, action, results: summary });
}
