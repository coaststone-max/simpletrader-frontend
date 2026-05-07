/**
 * POST /api/stripe/create-checkout
 * Body: { userId, userEmail, plan }
 *
 * Creates a Stripe Checkout Session for the selected plan.
 * On success Stripe redirects to /simpletrader.html?payment=success
 * On cancel  Stripe redirects to /simpletrader.html?payment=cancel
 *
 * Required env vars (Vercel → Settings → Environment Variables):
 *   STRIPE_SECRET_KEY      sk_live_… or sk_test_…
 *   STRIPE_PRICE_PRO       price_… (€29/month)
 *   STRIPE_PRICE_ADVANCED  price_… (€59/month)
 *   STRIPE_PRICE_UNLIMITED price_… (€99/month)
 *   SITE_URL               https://simpletrader-frontend.vercel.app
 */

const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY;
const SITE_URL      = process.env.SITE_URL || 'https://simpletrader-frontend.vercel.app';

const PRICES = {
  pro:              process.env.STRIPE_PRICE_PRO,
  advanced:         process.env.STRIPE_PRICE_ADVANCED,
  unlimited:        process.env.STRIPE_PRICE_UNLIMITED,
  'pro-annual':     process.env.STRIPE_PRICE_PRO_ANNUAL,
  'advanced-annual':process.env.STRIPE_PRICE_ADVANCED_ANNUAL,
  'unlimited-annual':process.env.STRIPE_PRICE_UNLIMITED_ANNUAL,
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ ok: false, error: 'Use POST' });

  if (!STRIPE_SECRET) {
    return res.status(500).json({ ok: false, error: 'STRIPE_SECRET_KEY not configured' });
  }

  const { userId, userEmail, plan } = req.body || {};
  if (!userId || !userEmail || !plan) {
    return res.status(400).json({ ok: false, error: 'Required: userId, userEmail, plan' });
  }

  const priceId = PRICES[plan.toLowerCase()];
  if (!priceId) {
    return res.status(400).json({ ok: false, error: `Unknown plan "${plan}". Use pro, advanced, or unlimited.` });
  }

  try {
    const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${STRIPE_SECRET}`,
        'Content-Type':  'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        'mode':                           'subscription',
        'customer_email':                 userEmail,
        'client_reference_id':            userId,          // used in webhook to identify user
        'line_items[0][price]':           priceId,
        'line_items[0][quantity]':        '1',
        'metadata[userId]':               userId,
        'metadata[plan]':                 plan,
        'success_url':                    `${SITE_URL}/simpletrader.html?payment=success&plan=${plan}`,
        'cancel_url':                     `${SITE_URL}/simpletrader.html?payment=cancel`,
        'allow_promotion_codes':          'true',
        'billing_address_collection':     'auto',
        'subscription_data[metadata][userId]': userId,
        'subscription_data[metadata][plan]':   plan,
      }).toString(),
    });

    const session = await stripeRes.json();
    if (!stripeRes.ok || !session.url) {
      throw new Error(session.error?.message || 'Stripe error ' + stripeRes.status);
    }

    return res.json({ ok: true, url: session.url });
  } catch (err) {
    return res.status(502).json({ ok: false, error: String(err.message || err) });
  }
}
