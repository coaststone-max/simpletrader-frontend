/**
 * POST /api/notifications/email
 * Body: { to?, subject, html, type }
 * Header: Authorization: Bearer <user_access_token>
 *
 * Sends a transactional email via Resend.
 * If `to` is omitted, uses the authenticated user's email.
 *
 * Required env vars:
 *   RESEND_API_KEY
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_KEY
 *   EMAIL_FROM  (default: SimpleTrader <hola@simpletrader.app>)
 */

const RESEND_KEY   = process.env.RESEND_API_KEY;
const SUPA_URL     = process.env.SUPABASE_URL;
const SUPA_SERVICE = process.env.SUPABASE_SERVICE_KEY;
const FROM         = process.env.EMAIL_FROM || 'SimpleTrader <hola@simpletrader.app>';

// Pre-built templates
function buildTemplate(type, data) {
  const accent = '#5B7CF7';
  const base = `
    <div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;background:#0f1117;color:#e2e8f0;border-radius:12px;overflow:hidden">
      <div style="background:linear-gradient(135deg,#1a1f2e,#0f1117);padding:28px 32px;border-bottom:1px solid #1e2433">
        <span style="font-size:22px;font-weight:800;letter-spacing:-0.5px">
          <span style="color:${accent}">Simple</span>Trader
        </span>
      </div>
      <div style="padding:28px 32px">__BODY__</div>
      <div style="padding:16px 32px;background:#0a0d14;border-top:1px solid #1e2433;font-size:11px;color:#4a5568;text-align:center">
        © 2025 SimpleTrader · <a href="https://simpletrader-frontend.vercel.app" style="color:${accent};text-decoration:none">Abrir app</a>
      </div>
    </div>`;

  if (type === 'dd_alert') {
    const color = data.pct >= 90 ? '#ef4444' : '#f59e0b';
    const emoji = data.pct >= 90 ? '🚨' : '⚠️';
    return base.replace('__BODY__', `
      <h2 style="margin:0 0 12px;font-size:18px">${emoji} Alerta de Drawdown — ${data.account}</h2>
      <p style="margin:0 0 16px;color:#94a3b8;font-size:14px;line-height:1.6">
        Tu cuenta <strong style="color:#e2e8f0">${data.account}</strong> ha alcanzado el
        <strong style="color:${color}">${data.pct}%</strong> del drawdown máximo permitido.
      </p>
      <div style="background:#1a1f2e;border-radius:8px;padding:16px;margin-bottom:16px;border:1px solid ${color}44">
        <div style="display:flex;justify-content:space-between;margin-bottom:8px">
          <span style="color:#64748b;font-size:12px">P&L hoy</span>
          <span style="color:${color};font-weight:700">$${data.pnl}</span>
        </div>
        <div style="display:flex;justify-content:space-between;margin-bottom:8px">
          <span style="color:#64748b;font-size:12px">Drawdown máx.</span>
          <span style="color:#e2e8f0;font-weight:700">$${data.maxDD}</span>
        </div>
        <div style="background:#0a0d14;border-radius:4px;height:8px;overflow:hidden">
          <div style="background:${color};width:${data.pct}%;height:100%;border-radius:4px"></div>
        </div>
      </div>
      <a href="https://simpletrader-frontend.vercel.app" style="display:inline-block;background:${accent};color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">
        Ver mis cuentas →
      </a>`);
  }

  if (type === 'payment_success') {
    return base.replace('__BODY__', `
      <h2 style="margin:0 0 12px;font-size:18px">🎉 ¡Suscripción activada!</h2>
      <p style="margin:0 0 16px;color:#94a3b8;font-size:14px;line-height:1.6">
        Tu plan <strong style="color:#5B7CF7">${data.plan}</strong> está ahora activo.
        Disfruta de todas las funcionalidades de SimpleTrader.
      </p>
      <a href="https://simpletrader-frontend.vercel.app" style="display:inline-block;background:${accent};color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">
        Abrir SimpleTrader →
      </a>`);
  }

  if (type === 'payment_failed') {
    return base.replace('__BODY__', `
      <h2 style="margin:0 0 12px;font-size:18px">💳 Pago fallido</h2>
      <p style="margin:0 0 16px;color:#94a3b8;font-size:14px;line-height:1.6">
        No hemos podido procesar el pago de tu suscripción.
        Por favor actualiza tu método de pago para continuar usando SimpleTrader.
      </p>
      <a href="https://simpletrader-frontend.vercel.app" style="display:inline-block;background:#ef4444;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">
        Actualizar pago →
      </a>`);
  }

  // Generic
  return base.replace('__BODY__', `
    <h2 style="margin:0 0 12px;font-size:18px">${data.subject || 'Notificación'}</h2>
    <p style="color:#94a3b8;font-size:14px;line-height:1.6">${data.message || ''}</p>`);
}

async function getUserEmail(userId) {
  const r = await fetch(`${SUPA_URL}/auth/v1/admin/users/${userId}`, {
    headers: { 'Authorization': `Bearer ${SUPA_SERVICE}`, 'apikey': SUPA_SERVICE },
  });
  if (!r.ok) return null;
  const u = await r.json();
  return u.email || null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ ok: false, error: 'Use POST' });

  if (!RESEND_KEY) return res.status(500).json({ ok: false, error: 'RESEND_API_KEY not set' });

  const auth  = req.headers['authorization'] || '';
  const token = auth.replace('Bearer ', '').trim();
  const body  = req.body || {};

  let to = body.to;

  // If no explicit `to`, derive from JWT
  if (!to && token) {
    try {
      const pl = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
      to = pl.email || (pl.sub ? await getUserEmail(pl.sub) : null);
    } catch { /* ignore */ }
  }

  // Allow internal calls with userId (e.g. from stripe webhook)
  if (!to && body.userId) {
    to = await getUserEmail(body.userId);
  }

  if (!to) return res.status(400).json({ ok: false, error: 'Cannot determine recipient email' });

  const { type, subject, data = {} } = body;
  const html    = body.html || buildTemplate(type, { ...data, subject });
  const subj    = subject || (type === 'dd_alert' ? `⚠️ Drawdown al ${data.pct}% — ${data.account}` :
                              type === 'payment_success' ? `🎉 Plan ${data.plan} activado` :
                              type === 'payment_failed'  ? '💳 Problema con tu pago' :
                              'Notificación de SimpleTrader');

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to, subject: subj, html }),
  });

  const result = await r.json();
  if (!r.ok) return res.status(502).json({ ok: false, error: result.message || 'Resend error' });

  return res.json({ ok: true, id: result.id });
}
