/**
 * supabase.js — Supabase REST client (no SDK required)
 *
 * Reads user configs and writes execution logs.
 * Uses the service key to bypass RLS (server-side only).
 */

const URL  = process.env.SUPABASE_URL;
const KEY  = process.env.SUPABASE_SERVICE_KEY;

function headers() {
  return {
    apikey:          KEY,
    Authorization:   `Bearer ${KEY}`,
    'Content-Type':  'application/json',
    Accept:          'application/json',
  };
}

/**
 * Load all user configs that have Tradovate slaves configured.
 * Returns array of { userId, tradovateConfig }.
 */
export async function loadActiveUserConfigs() {
  const res = await fetch(
    `${URL}/rest/v1/user_data?select=user_id,payload`,
    { headers: headers() }
  );
  if (!res.ok) throw new Error(`Supabase read failed: HTTP ${res.status}`);

  const rows = await res.json();
  const active = [];

  for (const row of rows) {
    const cfg = row?.payload?.tradovateConfig;
    if (!cfg?.username || !cfg?.password) continue;
    const slaves = (cfg.accounts || []).filter(a => a.role === 'slave');
    const masters = (cfg.accounts || []).filter(a => a.role === 'master');
    if (!slaves.length || !masters.length) continue;
    active.push({ userId: row.user_id, cfg });
  }

  return active;
}

/**
 * Load config for a single user by ID.
 */
export async function loadUserConfig(userId) {
  const res = await fetch(
    `${URL}/rest/v1/user_data?user_id=eq.${encodeURIComponent(userId)}&select=payload`,
    { headers: headers() }
  );
  if (!res.ok) throw new Error(`Supabase user read failed: HTTP ${res.status}`);
  const rows = await res.json();
  return rows?.[0]?.payload?.tradovateConfig ?? null;
}

/**
 * Log a replication event (fire-and-forget friendly).
 */
export async function logExecution({ userId, action, symbol, qty, results }) {
  await fetch(`${URL}/rest/v1/execution_log`, {
    method: 'POST',
    headers: { ...headers(), Prefer: 'return=minimal' },
    body: JSON.stringify({
      user_id:    userId,
      action,
      symbol,
      qty,
      results,
      created_at: new Date().toISOString(),
    }),
  });
}

/**
 * Write copier heartbeat/status to user_data so the UI can show it.
 * Updates the 'copierStatus' field in the payload JSON.
 */
export async function updateCopierStatus(userId, status) {
  // Read current payload first
  const res = await fetch(
    `${URL}/rest/v1/user_data?user_id=eq.${encodeURIComponent(userId)}&select=payload`,
    { headers: headers() }
  );
  if (!res.ok) return;
  const rows = await res.json();
  const payload = rows?.[0]?.payload ?? {};
  payload.copierStatus = { ...status, updatedAt: new Date().toISOString() };

  await fetch(`${URL}/rest/v1/user_data?user_id=eq.${encodeURIComponent(userId)}`, {
    method:  'PATCH',
    headers: { ...headers(), Prefer: 'return=minimal' },
    body:    JSON.stringify({ payload }),
  });
}
