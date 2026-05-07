/**
 * POST /api/stripe/portal
 * Body: { customerId }
 *
 * Creates a Stripe Customer Portal session so the user can:
 *   - Cancel their subscription
 *   - Change plan
 *   - Download invoices
 *   - Update payment method
 *
 * Required env vars:
 *   STRIPE_SECRET_KEY
 *   SITE_URL
 */

const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY;
const SITE_URL      = process.env.SITE_URL || 'https://simpletrader-frontend.vercel.app';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ ok: false, error: 'Use POST' });

  if (!STRIPE_SECRET) {
    return res.status(500).json({ ok: false, error: 'STRIPE_SECRET_KEY not configured' });
  }

  const { customerId } = req.body || {};
  if (!customerId) {
    return res.status(400).json({ ok: false, error: 'customerId required' });
  }

  try {
    const r = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${STRIPE_SECRET}`,
        'Content-Type':  'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        customer:   customerId,
        return_url: `${SITE_URL}/simpletrader.html`,
      }).toString(),
    });

    const session = await r.json();
    if (!r.ok || !session.url) {
      throw new Error(session.error?.message || 'Stripe error ' + r.status);
    }

    return res.json({ ok: true, url: session.url });
  } catch (err) {
    return res.status(502).json({ ok: false, error: String(err.message || err) });
  }
}
