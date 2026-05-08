/**
 * /api/mt5/manage — Unified MT5 management endpoint (Supabase Storage backend)
 *
 * NO SQL TABLES NEEDED — uses Supabase Storage bucket "simpletrader-mt5"
 *
 * GET  ?action=state&token=xxx          → latest account state
 * GET  ?action=equity_history&token=xxx → equity history array
 * GET  ?action=get_rules&token=xxx      → active risk rules + violations
 * GET  ?action=get_copy&token=xxx       → copy trading config
 * POST {action:"register", ...}         → creates new connection token
 * POST {action:"command", token, command} → queues a command for the EA
 * POST {action:"bind_rules", token, rules} → binds risk rules to connection
 * POST {action:"set_copy", token, ...}  → configure copy trading
 * POST {action:"list", userId}          → lists all tokens for a user
 */

const SUPABASE_URL     = process.env.SUPABASE_URL;
const SUPABASE_SERVICE = process.env.SUPABASE_SERVICE_KEY;
const BUCKET           = 'simpletrader-mt5';

// Extract userId from a Supabase JWT (no signature verification needed — Supabase already validates)
function userIdFromBearer(authHeader) {
  try {
    const token = (authHeader || '').replace('Bearer ', '').trim();
    if (!token) return null;
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    return payload.sub || null;
  } catch { return null; }
}

// Verify a token belongs to the requesting user (or user is anonymous → skip check)
async function assertOwnership(meta, authHeader) {
  if (!meta.user_id) return true;          // token has no owner (legacy) → allow
  const uid = userIdFromBearer(authHeader);
  if (!uid) return false;                   // no auth header → deny
  return uid === meta.user_id;
}

const SBH = () => ({
  'Authorization': `Bearer ${SUPABASE_SERVICE}`,
  'apikey':        SUPABASE_SERVICE,
});

// ── Storage helpers ───────────────────────────────────────────────────────────

async function storagePut(path, data) {
  const r = await fetch(
    `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`,
    {
      method:  'POST',
      headers: { ...SBH(), 'Content-Type': 'application/json', 'x-upsert': 'true', 'Cache-Control': '0' },
      body:    JSON.stringify(data),
    }
  );
  return r;
}

async function storageGet(path) {
  const r = await fetch(
    `${SUPABASE_URL}/storage/v1/object/authenticated/${BUCKET}/${path}`,
    { headers: SBH() }
  );
  if (!r.ok) return null;
  try { return await r.json(); } catch { return null; }
}

async function ensureBucket() {
  const r = await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
    method:  'POST',
    headers: { ...SBH(), 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      id:               BUCKET,
      name:             BUCKET,
      public:           false,
      allowedMimeTypes: ['application/json'],
    }),
  });
  return r.status < 500;
}

function generateToken() {
  const arr = new Uint8Array(24);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── Main handler ──────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!SUPABASE_URL || !SUPABASE_SERVICE) {
    return res.status(500).json({ ok: false, error: 'Server misconfigured — env vars missing' });
  }

  // ── GET requests ────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const { action, token } = req.query;
    res.setHeader('Cache-Control', 'no-store');

    // GET state (default / backwards-compat)
    if (!action || action === 'state') {
      if (!token) return res.status(400).json({ ok: false, error: 'token required' });

      try {
        const [meta, state] = await Promise.all([
          storageGet(`${token}/meta.json`),
          storageGet(`${token}/state.json`),
        ]);
        if (!meta) return res.status(404).json({ ok: false, error: 'Token not found' });

        const lastSeen = state?.last_seen ? new Date(state.last_seen) : null;
        const isOnline = lastSeen ? (Date.now() - lastSeen.getTime()) < 30_000 : false;

        return res.json({
          ok:         true,
          isOnline,
          platform:   state?.platform   || meta.platform  || 'MT5',
          label:      meta.label        || 'Cuenta MT5',
          account:    state?.account_info || {},
          positions:  state?.positions  || [],
          last_seen:  state?.last_seen  || null,
          created_at: meta.created_at,
        });
      } catch(err) {
        return res.status(500).json({ ok: false, error: err.message });
      }
    }

    // GET equity_history
    if (action === 'equity_history') {
      if (!token) return res.status(400).json({ ok: false, error: 'token required' });
      try {
        const hist = await storageGet(`${token}/equity_history.json`) || [];
        return res.json({ ok: true, history: hist });
      } catch(err) {
        return res.status(500).json({ ok: false, error: err.message });
      }
    }

    // GET rules
    if (action === 'get_rules') {
      if (!token) return res.status(400).json({ ok: false, error: 'token required' });
      try {
        const rulesData = await storageGet(`${token}/rules.json`);
        return res.json({ ok: true, rules: rulesData?.rules || [], violations: rulesData?.last_violations || [] });
      } catch(err) {
        return res.status(500).json({ ok: false, error: err.message });
      }
    }

    // GET copy config
    if (action === 'get_copy') {
      if (!token) return res.status(400).json({ ok: false, error: 'token required' });
      try {
        const copyData = await storageGet(`${token}/copy.json`);
        return res.json({ ok: true, copy: copyData || { role: null } });
      } catch(err) {
        return res.status(500).json({ ok: false, error: err.message });
      }
    }

    return res.status(400).json({ ok: false, error: `Unknown GET action: ${action}` });
  }

  // ── POST requests ────────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    let body;
    try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}); }
    catch { return res.status(400).json({ ok: false, error: 'Invalid JSON' }); }

    const { action } = body;

    // ── register ──────────────────────────────────────────────────────────────
    if (action === 'register') {
      const { userId, label, platform } = body;
      const token = generateToken();

      try {
        await ensureBucket();

        const meta = { token, user_id: userId || null, label: label || 'Mi cuenta MT5', platform: platform || 'MT5', created_at: new Date().toISOString() };
        const r = await storagePut(`${token}/meta.json`, meta);

        if (!r.ok) {
          const txt = await r.text().catch(() => '');
          console.error('storagePut meta error:', r.status, txt.slice(0, 200));
          if (r.status === 404 || r.status === 400) {
            await ensureBucket();
            await storagePut(`${token}/meta.json`, meta);
          }
        }

        await storagePut(`${token}/state.json`, {
          account_info: {}, positions: [], is_online: false, last_seen: null,
        });

        return res.json({ ok: true, token });

      } catch(err) {
        console.error('register error:', err.message);
        return res.status(500).json({ ok: false, error: err.message });
      }
    }

    // ── command ───────────────────────────────────────────────────────────────
    if (action === 'command') {
      const { token, command } = body;
      if (!token)   return res.status(400).json({ ok: false, error: 'token required' });
      if (!command) return res.status(400).json({ ok: false, error: 'command required' });

      try {
        const meta = await storageGet(`${token}/meta.json`);
        if (!meta) return res.status(404).json({ ok: false, error: 'Token not found' });
        if (!await assertOwnership(meta, req.headers['authorization']))
          return res.status(403).json({ ok: false, error: 'Forbidden' });

        await storagePut(`${token}/cmd.json`, { command, issued_at: new Date().toISOString() });
        return res.json({ ok: true, message: 'Command queued. EA will execute on next tick.' });

      } catch(err) {
        return res.status(500).json({ ok: false, error: err.message });
      }
    }

    // ── bind_rules — save risk rules linked to this connection ────────────────
    if (action === 'bind_rules') {
      const { token, rules } = body;
      if (!token) return res.status(400).json({ ok: false, error: 'token required' });

      try {
        const meta = await storageGet(`${token}/meta.json`);
        if (!meta) return res.status(404).json({ ok: false, error: 'Token not found' });
        if (!await assertOwnership(meta, req.headers['authorization']))
          return res.status(403).json({ ok: false, error: 'Forbidden' });

        const existing = await storageGet(`${token}/rules.json`) || {};

        await storagePut(`${token}/rules.json`, {
          ...existing,
          rules:       rules || [],
          updated_at:  new Date().toISOString(),
          // Reset daily tracking when rules are re-saved
          daily_loss_date:     null,
          daily_loss_baseline: null,
          notified_violations: {},
        });

        return res.json({ ok: true, message: 'Rules saved.' });

      } catch(err) {
        return res.status(500).json({ ok: false, error: err.message });
      }
    }

    // ── set_copy — configure copy trading ─────────────────────────────────────
    if (action === 'set_copy') {
      const { token, role, master_token, ratio, enabled } = body;
      if (!token) return res.status(400).json({ ok: false, error: 'token required' });

      try {
        const meta = await storageGet(`${token}/meta.json`);
        if (!meta) return res.status(404).json({ ok: false, error: 'Token not found' });
        if (!await assertOwnership(meta, req.headers['authorization']))
          return res.status(403).json({ ok: false, error: 'Forbidden' });

        if (role === 'follower' && master_token) {
          // Verify master exists
          const masterMeta = await storageGet(`${master_token}/meta.json`);
          if (!masterMeta) return res.status(404).json({ ok: false, error: 'Master token not found' });
        }

        const existing = await storageGet(`${token}/copy.json`) || {};

        await storagePut(`${token}/copy.json`, {
          ...existing,
          role:         role   || null,
          master_token: master_token || null,
          ratio:        parseFloat(ratio || 1.0),
          enabled:      enabled !== false,
          ticket_map:   role === 'follower' ? {} : (existing.ticket_map || {}),
          updated_at:   new Date().toISOString(),
        });

        return res.json({ ok: true, message: 'Copy config saved.' });

      } catch(err) {
        return res.status(500).json({ ok: false, error: err.message });
      }
    }

    // ── list ──────────────────────────────────────────────────────────────────
    if (action === 'list') {
      const { userId } = body;
      try {
        const r = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${BUCKET}`, {
          method:  'POST',
          headers: { ...SBH(), 'Content-Type': 'application/json' },
          body:    JSON.stringify({ limit: 100, offset: 0, prefix: '', sortBy: { column: 'created_at', order: 'desc' } }),
        });
        if (!r.ok) return res.json({ ok: true, tokens: [] });

        const objects = await r.json();
        const folders = [...new Set(
          (objects || []).map(o => o.name?.split('/')[0]).filter(Boolean)
        )];

        const tokens = [];
        for (const folder of folders.slice(0, 20)) {
          const meta = await storageGet(`${folder}/meta.json`);
          if (meta && (!userId || meta.user_id === userId)) {
            tokens.push({ token: folder, label: meta.label, platform: meta.platform, created_at: meta.created_at });
          }
        }
        return res.json({ ok: true, tokens });
      } catch(err) {
        return res.json({ ok: true, tokens: [] });
      }
    }

    return res.status(400).json({ ok: false, error: `Unknown action: ${action}` });
  }

  return res.status(405).json({ ok: false, error: 'Method not allowed' });
}
