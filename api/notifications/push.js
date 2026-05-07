/**
 * POST /api/notifications/push
 * Body: { userId, title, body, url, tag, icon }
 * Header: Authorization: Bearer <user_access_token>  OR  X-Service-Key: <SUPA_SERVICE>
 *
 * Sends a Web Push notification to the user's registered subscription.
 *
 * Required env vars:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_KEY
 *   VAPID_PUBLIC_KEY
 *   VAPID_PRIVATE_KEY
 *   VAPID_MAILTO         (e.g. mailto:hola@simpletrader.app)
 */

import webpush from 'web-push';

const SUPA_URL     = process.env.SUPABASE_URL;
const SUPA_SERVICE = process.env.SUPABASE_SERVICE_KEY;

webpush.setVapidDetails(
  process.env.VAPID_MAILTO || 'mailto:hola@simpletrader.app',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

async function getSubscription(userId) {
  const r = await fetch(
    `${SUPA_URL}/rest/v1/user_data?user_id=eq.${userId}&select=payload`,
    { headers: { 'Authorization': `Bearer ${SUPA_SERVICE}`, 'apikey': SUPA_SERVICE } }
  );
  if (!r.ok) return null;
  const rows = await r.json();
  return rows?.[0]?.payload?.push_subscription || null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ ok: false, error: 'Use POST' });

  // Auth: accept user JWT or internal service key header
  const serviceKey = req.headers['x-service-key'];
  const auth       = req.headers['authorization'] || '';
  const token      = auth.replace('Bearer ', '').trim();

  let userId = req.body?.userId;

  // If not service-key call, derive userId from JWT
  if (!serviceKey && token && !userId) {
    try {
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
      userId = payload.sub;
    } catch { /* ignore */ }
  }

  if (!userId) return res.status(400).json({ ok: false, error: 'userId required' });

  const { title = 'SimpleTrader', body = '', url = '/', tag = 'st', icon } = req.body || {};

  const sub = await getSubscription(userId);
  if (!sub) return res.status(404).json({ ok: false, error: 'No push subscription for user' });

  try {
    await webpush.sendNotification(sub, JSON.stringify({ title, body, url, tag, icon: icon || '/icon-192.png' }));
    return res.json({ ok: true });
  } catch (err) {
    console.error('webpush error:', err.statusCode, err.message);
    // 410 Gone = subscription expired / user unsubscribed
    if (err.statusCode === 410) {
      // Clean up expired subscription
      const fetchRes = await fetch(`${SUPA_URL}/rest/v1/user_data?user_id=eq.${userId}&select=payload`,
        { headers: { 'Authorization': `Bearer ${SUPA_SERVICE}`, 'apikey': SUPA_SERVICE } });
      if (fetchRes.ok) {
        const rows = await fetchRes.json();
        const payload = rows?.[0]?.payload || {};
        delete payload.push_subscription;
        await fetch(`${SUPA_URL}/rest/v1/user_data`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${SUPA_SERVICE}`, 'apikey': SUPA_SERVICE,
                     'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify({ user_id: userId, payload, updated_at: new Date().toISOString() }),
        });
      }
      return res.status(410).json({ ok: false, error: 'Subscription expired — removed' });
    }
    return res.status(502).json({ ok: false, error: err.message });
  }
}
