/**
 * POST /api/stripe/webhook
 *
 * Handles Stripe webhook events. Verifies signature, then:
 *  - checkout.session.completed      → upgrade plan in Supabase
 *  - customer.subscription.deleted   → downgrade to Starter
 *  - invoice.payment_failed          → could notify user (logged only)
 *
 * Required env vars:
 *   STRIPE_SECRET_KEY
 *   STRIPE_WEBHOOK_SECRET   (whsec_…  from Stripe → Webhooks → Signing secret)
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_KEY
 *
 * Set up in Stripe Dashboard → Developers → Webhooks:
 *   Endpoint URL: https://simpletrader-frontend.vercel.app/api/stripe/webhook
 *   Events to send:
 *     checkout.session.completed
 *     customer.subscription.deleted
 *     invoice.payment_failed
 */

const STRIPE_SECRET    = process.env.STRIPE_SECRET_KEY;
const WEBHOOK_SECRET   = process.env.STRIPE_WEBHOOK_SECRET;
const SUPABASE_URL     = process.env.SUPABASE_URL;
const SUPABASE_SERVICE = process.env.SUPABASE_SERVICE_KEY;

// Read raw body for signature verification
export const config = { api: { bodyParser: false } };

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(typeof c === 'string' ? Buffer.from(c) : c));
    req.on('end',  () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Stripe signature verification (no SDK needed — pure crypto)
async function verifyStripeSignature(rawBody, sigHeader, secret) {
  const parts   = sigHeader.split(',').reduce((acc, p) => { const [k, v] = p.split('='); acc[k] = v; return acc; }, {});
  const ts      = parts['t'];
  const sig     = parts['v1'];
  if (!ts || !sig) throw new Error('Missing t or v1 in Stripe-Signature header');

  // HMAC-SHA256 using Web Crypto
  const enc       = new TextEncoder();
  const keyData   = enc.encode(secret);
  const msgData   = enc.encode(`${ts}.${rawBody.toString('utf8')}`);
  const cryptoKey = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const hashBuf   = await crypto.subtle.sign('HMAC', cryptoKey, msgData);
  const expected  = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');

  if (expected !== sig) throw new Error('Stripe signature mismatch');

  // Reject events older than 5 minutes
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) throw new Error('Stripe event too old');
}

// Update user plan in Supabase via Admin API
async function updateUserPlan(userId, plan, stripeCustomerId) {
  const meta = { plan };
  if (stripeCustomerId) meta.stripe_customer_id = stripeCustomerId;

  const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${SUPABASE_SERVICE}`,
      'apikey':        SUPABASE_SERVICE,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({ user_metadata: meta }),
  });
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    throw new Error(`Supabase update failed (${r.status}): ${d.message || JSON.stringify(d)}`);
  }
}

// Find user by Stripe customer ID (when subscription.deleted fires — no session ref)
async function findUserByCustomerId(customerId) {
  // We stored stripe_customer_id in user_metadata when they first subscribed
  // Query all users and find the one with matching customer ID
  const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=1000`, {
    headers: { 'Authorization': `Bearer ${SUPABASE_SERVICE}`, 'apikey': SUPABASE_SERVICE },
  });
  if (!r.ok) return null;
  const data = await r.json();
  const users = data.users || data || [];
  return users.find(u => u.user_metadata?.stripe_customer_id === customerId);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const rawBody  = await getRawBody(req);
  const sigHeader = req.headers['stripe-signature'];

  // Verify signature
  if (WEBHOOK_SECRET) {
    try {
      await verifyStripeSignature(rawBody, sigHeader || '', WEBHOOK_SECRET);
    } catch (err) {
      console.error('Stripe signature error:', err.message);
      return res.status(400).json({ error: 'Bad signature: ' + err.message });
    }
  } else {
    console.warn('STRIPE_WEBHOOK_SECRET not set — skipping signature verification');
  }

  let event;
  try {
    event = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  console.log(`Stripe event: ${event.type}`);

  try {
    switch (event.type) {

      case 'checkout.session.completed': {
        const session     = event.data.object;
        const userId      = session.client_reference_id || session.metadata?.userId;
        const plan        = session.metadata?.plan || 'pro';
        const customerId  = session.customer;

        if (!userId) { console.error('No userId in session'); break; }

        await updateUserPlan(userId, capitalise(plan), customerId);
        console.log(`✅ Upgraded user ${userId} to ${plan}`);
        break;
      }

      case 'customer.subscription.deleted': {
        const sub        = event.data.object;
        const customerId = sub.customer;
        const user       = await findUserByCustomerId(customerId);
        if (!user) { console.error('No user found for customer', customerId); break; }

        await updateUserPlan(user.id, 'Starter', customerId);
        console.log(`⬇ Downgraded user ${user.id} to Starter (subscription cancelled)`);
        break;
      }

      case 'invoice.payment_failed': {
        // Just log — optionally send an email here via Resend/SendGrid
        const inv = event.data.object;
        console.warn(`💳 Payment failed for customer ${inv.customer}, attempt ${inv.attempt_count}`);
        break;
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }
  } catch (err) {
    console.error('Webhook handler error:', err);
    return res.status(500).json({ error: err.message });
  }

  return res.json({ received: true });
}

function capitalise(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s;
}
