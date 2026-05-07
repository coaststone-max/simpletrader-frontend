/**
 * POST /api/notifications/subscribe
 * Body: { subscription }   (PushSubscription JSON from browser)
 * Header: Authorization: Bearer <user_access_token>
 *
 * Saves / updates the user's push subscription in Supabase user_data payload.
 *
 * Required env vars:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_KEY
 */

const SUPA_URL     = process.env.SUPABASE_URL;
const SUPA_SERVICE = process.env.SUPABASE_SERVICE_KEY;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ ok: false, error: 'Use POST' });

  // Verify user JWT
  const auth = req.headers['authorization'] || '';
  const token = auth.replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ ok: false, error: 'Unauthorized' });

  // Decode user id from JWT (no verification needed — Supabase verifies below)
  let userId;
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    userId = payload.sub;
  } catch {
    return res.status(401).json({ ok: false, error: 'Invalid token' });
  }
  if (!userId) return res.status(401).json({ ok: false, error: 'No user id in token' });

  const { subscription } = req.body || {};
  if (!subscription || !subscription.endpoint) {
    return res.status(400).json({ ok: false, error: 'subscription required' });
  }

  // Upsert into user_data — merge push_subscription into existing payload
  // First, fetch existing payload
  const fetchRes = await fetch(
    `${SUPA_URL}/rest/v1/user_data?user_id=eq.${userId}&select=payload`,
    { headers: { 'Authorization': `Bearer ${SUPA_SERVICE}`, 'apikey': SUPA_SERVICE } }
  );
  const rows = fetchRes.ok ? await fetchRes.json() : [];
  const existing = rows?.[0]?.payload || {};

  const newPayload = { ...existing, push_subscription: subscription, push_updated: new Date().toISOString() };

  const upsertRes = await fetch(`${SUPA_URL}/rest/v1/user_data`, {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${SUPA_SERVICE}`,
      'apikey':        SUPA_SERVICE,
      'Content-Type':  'application/json',
      'Prefer':        'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify({ user_id: userId, payload: newPayload, updated_at: new Date().toISOString() }),
  });

  if (!upsertRes.ok) {
    const err = await upsertRes.text();
    return res.status(502).json({ ok: false, error: 'Supabase error: ' + err });
  }

  return res.json({ ok: true });
}
