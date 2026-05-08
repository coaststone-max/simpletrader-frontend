/**
 * POST /api/notifications/email
 * Body: { to?, subject?, type, data }
 * Header: Authorization: Bearer <user_access_token>   (optional if to/userId provided)
 *
 * Sends transactional emails via Resend with responsive dark-mode templates.
 *
 * Types: welcome | dd_alert | payment_success | payment_failed
 *
 * Required env vars:
 *   RESEND_API_KEY
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_KEY
 *   SITE_URL
 *   EMAIL_FROM
 */

const RESEND_KEY   = process.env.RESEND_API_KEY;
const SUPA_URL     = process.env.SUPABASE_URL;
const SUPA_SERVICE = process.env.SUPABASE_SERVICE_KEY;
const FROM         = process.env.EMAIL_FROM || 'SimpleTrader <hola@simpletrader.app>';
const APP_URL      = process.env.SITE_URL   || 'https://simpletrader-frontend.vercel.app';

// ── Shared wrapper ────────────────────────────────────────────────────────────
function layout(preheader, body) {
  const accent = '#5B7CF7';
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="dark">
  <title>SimpleTrader</title>
  <!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
</head>
<body style="margin:0;padding:0;background:#07090f;-webkit-text-size-adjust:100%">

<!-- Preheader (hidden) -->
<span style="display:none;max-height:0;overflow:hidden;opacity:0">${preheader}&nbsp;‌​‍‎‏﻿</span>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#07090f;min-height:100vh">
<tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:580px">

  <!-- TOP LOGO BAR -->
  <tr><td style="background:linear-gradient(135deg,#0d1221 0%,#141928 100%);border-radius:20px 20px 0 0;padding:24px 36px;border-bottom:1px solid #1c2338">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td>
          <a href="${APP_URL}" style="text-decoration:none">
            <span style="font-size:26px;font-weight:900;letter-spacing:-0.8px;color:#fff">
              <span style="color:${accent}">Simple</span>Trader
            </span>
          </a>
        </td>
        <td align="right">
          <span style="font-size:10px;font-weight:700;color:#3d4e6e;background:#0a0e1a;padding:4px 12px;border-radius:20px;border:1px solid #1c2338;letter-spacing:0.5px;text-transform:uppercase">Pro Platform</span>
        </td>
      </tr>
    </table>
  </td></tr>

  <!-- BODY -->
  <tr><td style="background:#0f1320;padding:36px 36px 28px">
    ${body}
  </td></tr>

  <!-- FOOTER -->
  <tr><td style="background:#090d18;border-radius:0 0 20px 20px;padding:20px 36px;border-top:1px solid #1c2338">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="font-size:11px;color:#2d3748;line-height:1.8">
          © 2025 SimpleTrader · Plataforma para prop traders<br>
          <a href="${APP_URL}" style="color:#3d4e6e;text-decoration:none">Abrir app</a>
          &nbsp;·&nbsp;
          <a href="mailto:hola@simpletrader.app" style="color:#3d4e6e;text-decoration:none">Soporte</a>
        </td>
        <td align="right">
          <a href="${APP_URL}" style="text-decoration:none">
            <span style="font-size:18px;font-weight:900;color:#1c2338">
              <span style="color:${accent}22">S</span>T
            </span>
          </a>
        </td>
      </tr>
    </table>
  </td></tr>

</table>
</td></tr>
</table>
</body></html>`;
}

// ── Button helper ─────────────────────────────────────────────────────────────
function btn(text, url, color = '#5B7CF7') {
  return `<table role="presentation" cellpadding="0" cellspacing="0">
    <tr><td style="border-radius:10px;background:${color}">
      <a href="${url}" style="display:inline-block;padding:13px 28px;font-size:14px;font-weight:700;color:#fff;text-decoration:none;letter-spacing:0.2px">${text}</a>
    </td></tr>
  </table>`;
}

// ── KV row helper ─────────────────────────────────────────────────────────────
function kv(label, value, valueColor = '#e2e8f0') {
  return `<tr>
    <td style="padding:8px 0;font-size:12px;color:#4a5568;border-bottom:1px solid #1a2035">${label}</td>
    <td style="padding:8px 0;font-size:12px;font-weight:700;color:${valueColor};text-align:right;border-bottom:1px solid #1a2035">${value}</td>
  </tr>`;
}

// ── Templates ─────────────────────────────────────────────────────────────────

function tplWelcome(data) {
  const name  = data.name  || 'trader';
  const plan  = data.plan  || 'Starter';
  const first = name.split(' ')[0];
  const accent = '#5B7CF7';

  const features = [
    ['📊', 'Journal inteligente',   'Registra cada trade con setup, notas y R:R. Estadísticas en tiempo real.'],
    ['📈', 'Dashboard de cuentas',  'Conecta tus cuentas de fondeo y monitoriza drawdown, P&L y reglas.'],
    ['⚡', 'Señales automáticas',   'Recibe alertas de TradingView y ejecútalas automáticamente en tu broker.'],
    ['🛡️', 'Gestión de riesgo',     'Define tus reglas personales y recibe alertas antes de cruzarlas.'],
  ];

  const body = `
    <!-- Hero -->
    <div style="text-align:center;margin-bottom:32px">
      <div style="width:72px;height:72px;background:linear-gradient(135deg,${accent},#8B5CF6);border-radius:20px;display:inline-flex;align-items:center;justify-content:center;font-size:32px;margin-bottom:16px">🚀</div>
      <h1 style="margin:0 0 10px;font-size:26px;font-weight:900;color:#fff;letter-spacing:-0.5px">
        Bienvenido, ${first} 👋
      </h1>
      <p style="margin:0;font-size:15px;color:#64748b;line-height:1.5">
        Tu cuenta SimpleTrader está lista. <strong style="color:#94a3b8">Plan ${plan}</strong>.
      </p>
    </div>

    <!-- Confirm bar -->
    <div style="background:linear-gradient(90deg,#0d1a3a,#0f2044);border:1px solid ${accent}44;border-radius:12px;padding:18px 22px;margin-bottom:28px;display:block">
      <p style="margin:0 0 12px;font-size:13px;color:#93c5fd;font-weight:600">⚡ Un paso antes de empezar</p>
      <p style="margin:0 0 14px;font-size:13px;color:#64748b;line-height:1.6">
        Confirma tu email haciendo clic en el enlace del email de verificación de Supabase que también has recibido. Después ya puedes entrar a la app.
      </p>
      ${btn('Abrir SimpleTrader →', APP_URL, accent)}
    </div>

    <!-- Features grid -->
    <p style="margin:0 0 16px;font-size:12px;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:0.8px">Qué puedes hacer</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px">
      ${features.map(([icon, title, desc]) => `
      <tr><td style="padding:10px 0;border-bottom:1px solid #141c2e">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td style="width:40px;padding-right:12px">
            <div style="width:36px;height:36px;background:#141c2e;border:1px solid #1c2740;border-radius:9px;text-align:center;line-height:36px;font-size:17px">${icon}</div>
          </td>
          <td>
            <div style="font-size:13px;font-weight:700;color:#e2e8f0;margin-bottom:2px">${title}</div>
            <div style="font-size:11.5px;color:#4a5568;line-height:1.5">${desc}</div>
          </td>
        </tr></table>
      </td></tr>`).join('')}
    </table>

    <!-- CTA -->
    <div style="text-align:center;padding:8px 0">
      ${btn('Entrar a la plataforma →', APP_URL, `linear-gradient(90deg,${accent},#8B5CF6)`)}
      <p style="margin:14px 0 0;font-size:11px;color:#2d3748">
        ¿Necesitas ayuda? Escríbenos a <a href="mailto:hola@simpletrader.app" style="color:${accent};text-decoration:none">hola@simpletrader.app</a>
      </p>
    </div>`;

  return layout(`Bienvenido, ${first}. Tu cuenta SimpleTrader está lista.`, body);
}

function tplDDAlert(data) {
  const pct    = parseFloat(data.pct)  || 0;
  const color  = pct >= 90 ? '#ef4444' : pct >= 80 ? '#f59e0b' : '#eab308';
  const emoji  = pct >= 90 ? '🚨' : '⚠️';
  const accent = '#5B7CF7';

  const body = `
    <!-- Alert header -->
    <div style="background:${color}14;border:1px solid ${color}44;border-radius:12px;padding:20px 22px;margin-bottom:24px">
      <div style="font-size:28px;margin-bottom:8px">${emoji}</div>
      <h2 style="margin:0 0 6px;font-size:20px;font-weight:800;color:${color}">Drawdown al ${pct}%</h2>
      <p style="margin:0;font-size:13px;color:#94a3b8;line-height:1.5">
        Tu cuenta <strong style="color:#e2e8f0">${data.account || '—'}</strong> está acercándose al límite máximo de drawdown.
        ${pct >= 90 ? '<strong style="color:'+color+'"> Considera detener operaciones inmediatamente.</strong>' : 'Revisa tu posición.'}
      </p>
    </div>

    <!-- KV table -->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px">
      ${kv('Cuenta', data.account || '—')}
      ${kv('P&L hoy', `$${data.pnl || 0}`, color)}
      ${kv('Drawdown máximo', `$${data.maxDD || 0}`, '#e2e8f0')}
      ${kv('% utilizado', `${pct}%`, color)}
    </table>

    <!-- Progress bar -->
    <div style="background:#0a0e1a;border-radius:8px;height:10px;overflow:hidden;margin-bottom:24px;border:1px solid #1c2338">
      <div style="background:linear-gradient(90deg,${color}cc,${color});width:${Math.min(pct,100)}%;height:100%;border-radius:8px;transition:width .3s"></div>
    </div>

    ${btn('Ver mis cuentas →', APP_URL, color)}`;

  return layout(`${emoji} Drawdown al ${pct}% en ${data.account}`, body);
}

function tplPaymentSuccess(data) {
  const plan   = data.plan || 'Pro';
  const accent = '#5B7CF7';

  const body = `
    <div style="text-align:center;margin-bottom:28px">
      <div style="font-size:52px;margin-bottom:12px">🎉</div>
      <h1 style="margin:0 0 8px;font-size:24px;font-weight:900;color:#fff">¡Suscripción activada!</h1>
      <p style="margin:0;font-size:14px;color:#64748b">
        Tu plan <strong style="color:${accent}">${plan}</strong> está ahora activo.
      </p>
    </div>

    <div style="background:#0d1a0d;border:1px solid #166534;border-radius:12px;padding:18px 22px;margin-bottom:24px">
      <p style="margin:0;font-size:13px;color:#4ade80;line-height:1.6">
        ✓ &nbsp;Acceso completo a todas las funciones del plan <strong>${plan}</strong><br>
        ✓ &nbsp;Facturación automática vía Stripe<br>
        ✓ &nbsp;Puedes gestionar o cancelar desde el portal de facturación
      </p>
    </div>

    <div style="text-align:center">
      ${btn('Abrir SimpleTrader →', APP_URL, `linear-gradient(90deg,${accent},#22c55e)`)}
    </div>`;

  return layout(`Tu plan ${plan} ya está activo en SimpleTrader.`, body);
}

function tplPaymentFailed(data) {
  const body = `
    <div style="text-align:center;margin-bottom:28px">
      <div style="font-size:48px;margin-bottom:12px">💳</div>
      <h1 style="margin:0 0 8px;font-size:22px;font-weight:800;color:#fff">Problema con tu pago</h1>
      <p style="margin:0;font-size:13px;color:#64748b;line-height:1.6">
        No hemos podido cobrar tu suscripción. Actualiza tu método de pago para no perder el acceso.
      </p>
    </div>

    <div style="background:#1a0d0d;border:1px solid #7f1d1d;border-radius:12px;padding:16px 20px;margin-bottom:24px">
      <p style="margin:0;font-size:12px;color:#fca5a5;line-height:1.7">
        ⚠ &nbsp;Tu plan se mantendrá activo durante un período de gracia, pero necesitas actualizar el pago para continuar con acceso completo.
      </p>
    </div>

    <div style="text-align:center">
      ${btn('Actualizar método de pago →', APP_URL, '#ef4444')}
      <p style="margin:14px 0 0;font-size:11px;color:#374151">
        ¿Necesitas ayuda? <a href="mailto:hola@simpletrader.app" style="color:#5B7CF7;text-decoration:none">Contáctanos</a>
      </p>
    </div>`;

  return layout('Tu pago falló — actualiza tu método de pago.', body);
}

function tplWeeklyRecap(data) {
  const name    = data.name   || 'trader';
  const first   = name.split(' ')[0];
  const pnl     = parseFloat(data.pnl)     || 0;
  const trades  = parseInt(data.trades)    || 0;
  const winRate = parseFloat(data.winRate) || 0;
  const bestDay = data.bestDay  || '—';
  const rr      = parseFloat(data.rr)      || 0;
  const accent  = '#5B7CF7';
  const pnlColor = pnl >= 0 ? '#22c55e' : '#ef4444';
  const pnlSign  = pnl >= 0 ? '+' : '';

  const grade = winRate >= 65 ? { icon: '🏆', text: 'Semana excelente', color: '#22c55e' }
              : winRate >= 50 ? { icon: '📈', text: 'Semana positiva',  color: accent }
              :                 { icon: '📉', text: 'Semana para revisar', color: '#f59e0b' };

  const body = `
    <!-- Header -->
    <div style="text-align:center;margin-bottom:28px">
      <p style="margin:0 0 4px;font-size:11px;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:1px">Resumen semanal</p>
      <h1 style="margin:0 0 6px;font-size:24px;font-weight:900;color:#fff">${first}, aquí está tu semana</h1>
      <p style="margin:0;font-size:13px;color:#4a5568">${data.weekLabel || 'Semana en curso'}</p>
    </div>

    <!-- Grade badge -->
    <div style="background:${grade.color}14;border:1px solid ${grade.color}44;border-radius:12px;padding:14px 20px;text-align:center;margin-bottom:24px">
      <span style="font-size:22px">${grade.icon}</span>
      <span style="font-size:14px;font-weight:700;color:${grade.color};margin-left:8px">${grade.text}</span>
    </div>

    <!-- Stats grid (2x2) -->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px">
      <tr>
        <td width="48%" style="padding:12px 16px;background:#0d1221;border:1px solid #1c2338;border-radius:10px;text-align:center">
          <div style="font-size:26px;font-weight:900;color:${pnlColor}">${pnlSign}$${Math.abs(pnl).toLocaleString('es-ES')}</div>
          <div style="font-size:10px;color:#374151;text-transform:uppercase;letter-spacing:0.5px;margin-top:2px">P&amp;L neto</div>
        </td>
        <td width="4%"></td>
        <td width="48%" style="padding:12px 16px;background:#0d1221;border:1px solid #1c2338;border-radius:10px;text-align:center">
          <div style="font-size:26px;font-weight:900;color:#e2e8f0">${winRate}%</div>
          <div style="font-size:10px;color:#374151;text-transform:uppercase;letter-spacing:0.5px;margin-top:2px">Win rate</div>
        </td>
      </tr>
      <tr><td colspan="3" style="height:8px"></td></tr>
      <tr>
        <td width="48%" style="padding:12px 16px;background:#0d1221;border:1px solid #1c2338;border-radius:10px;text-align:center">
          <div style="font-size:26px;font-weight:900;color:#e2e8f0">${trades}</div>
          <div style="font-size:10px;color:#374151;text-transform:uppercase;letter-spacing:0.5px;margin-top:2px">Trades</div>
        </td>
        <td width="4%"></td>
        <td width="48%" style="padding:12px 16px;background:#0d1221;border:1px solid #1c2338;border-radius:10px;text-align:center">
          <div style="font-size:26px;font-weight:900;color:${accent}">${rr > 0 ? rr.toFixed(2) : '—'}</div>
          <div style="font-size:10px;color:#374151;text-transform:uppercase;letter-spacing:0.5px;margin-top:2px">R:R medio</div>
        </td>
      </tr>
    </table>

    <!-- Best day -->
    ${bestDay !== '—' ? `
    <div style="background:#0a0e1a;border:1px solid #1c2338;border-radius:10px;padding:12px 18px;margin-bottom:24px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td style="font-size:12px;color:#4a5568">🌟 Mejor día</td>
        <td align="right" style="font-size:12px;font-weight:700;color:#22c55e">${bestDay}</td>
      </tr></table>
    </div>` : ''}

    <!-- CTA -->
    <div style="text-align:center;margin-top:8px">
      ${btn('Ver journal completo →', APP_URL, accent)}
      <p style="margin:14px 0 0;font-size:11px;color:#2d3748">
        Recibís este resumen cada lunes · <a href="${APP_URL}" style="color:#3d4e6e;text-decoration:none">Gestionar notificaciones</a>
      </p>
    </div>`;

  return layout(`Tu semana: ${pnlSign}$${Math.abs(pnl).toLocaleString('es-ES')} · ${winRate}% win rate`, body);
}

function tplTip(data) {
  const name  = data.name  || 'trader';
  const first = name.split(' ')[0];
  const accent = '#5B7CF7';
  const day   = parseInt(data.day) || 1;

  const tips = {
    3: {
      icon: '📊',
      title: '¿Ya registraste tu primer trade?',
      body: 'Los traders rentables revisan sus operaciones. Empieza a construir tu edge registrando cada entrada en el journal — setup, notas, resultado.',
      cta: 'Abrir journal →',
      extra: `<div style="background:#0d1221;border:1px solid #1c2338;border-radius:10px;padding:14px 18px;margin-bottom:20px">
        <p style="margin:0;font-size:12px;color:#64748b;line-height:1.7">
          💡 <strong style="color:#94a3b8">Tip:</strong> Añade siempre el setup y el motivo de la entrada. En 30 días verás patrones que no sabías que tenías.
        </p>
      </div>`,
    },
    7: {
      icon: '⚡',
      title: 'Automatiza tus alertas de TradingView',
      body: 'Conecta SimpleTrader con TradingView y ejecuta señales automáticamente en tu broker. Sin latencia, sin emociones.',
      cta: 'Ver configuración →',
      extra: `<div style="background:#0d1221;border:1px solid #1c2338;border-radius:10px;padding:14px 18px;margin-bottom:20px">
        <p style="margin:0;font-size:12px;color:#64748b;line-height:1.7">
          💡 <strong style="color:#94a3b8">Tip:</strong> Usa el webhook de SimpleTrader en tus alertas de Pine Script para ejecución automática 24/7.
        </p>
      </div>`,
    },
    14: {
      icon: '🛡️',
      title: 'Define tus reglas de riesgo',
      body: 'Los mejores traders tienen reglas escritas. Configura tu drawdown máximo diario y SimpleTrader te avisará antes de cruzarlo.',
      cta: 'Configurar riesgo →',
      extra: '',
    },
  };

  const tip = tips[day] || tips[3];

  const body = `
    <div style="text-align:center;margin-bottom:24px">
      <div style="width:56px;height:56px;background:#141c2e;border:1px solid #1c2740;border-radius:14px;display:inline-flex;align-items:center;justify-content:center;font-size:26px;margin-bottom:14px">${tip.icon}</div>
      <p style="margin:0 0 4px;font-size:11px;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:1px">Día ${day} con SimpleTrader</p>
      <h1 style="margin:0;font-size:21px;font-weight:900;color:#fff;line-height:1.3">${tip.title}</h1>
    </div>

    <p style="font-size:14px;color:#94a3b8;line-height:1.7;margin:0 0 20px">${first}, ${tip.body}</p>

    ${tip.extra}

    <div style="text-align:center">
      ${btn(tip.cta, APP_URL, accent)}
      <p style="margin:14px 0 0;font-size:11px;color:#2d3748">
        SimpleTrader · <a href="${APP_URL}" style="color:#3d4e6e;text-decoration:none">Abrir plataforma</a>
      </p>
    </div>`;

  return layout(`${tip.title}`, body);
}

function tplAccountExpiry(data) {
  const name    = data.name    || 'trader';
  const first   = name.split(' ')[0];
  const account = data.account || 'tu cuenta';
  const days    = parseInt(data.days) || 7;
  const color   = days <= 3 ? '#ef4444' : '#f59e0b';
  const emoji   = days <= 3 ? '🚨' : '⏰';

  const body = `
    <div style="background:${color}14;border:1px solid ${color}44;border-radius:12px;padding:22px;text-align:center;margin-bottom:24px">
      <div style="font-size:36px;margin-bottom:10px">${emoji}</div>
      <h2 style="margin:0 0 8px;font-size:20px;font-weight:800;color:${color}">
        ${days === 1 ? 'Vence mañana' : `Vence en ${days} días`}
      </h2>
      <p style="margin:0;font-size:13px;color:#94a3b8">
        La cuenta <strong style="color:#e2e8f0">${account}</strong> ${days <= 1 ? 'vence mañana' : `vence en ${days} días`}.
        ${days <= 3 ? 'Revisa tus reglas y asegura el objetivo.' : 'Planifica bien esta semana.'}
      </p>
    </div>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px">
      ${kv('Cuenta', account)}
      ${kv('Días restantes', `${days} días`, color)}
      ${data.target ? kv('Objetivo', `$${data.target}`, '#22c55e') : ''}
      ${data.currentPnl != null ? kv('P&L actual', `$${data.currentPnl}`, parseFloat(data.currentPnl) >= 0 ? '#22c55e' : '#ef4444') : ''}
    </table>

    <div style="text-align:center">
      ${btn('Ver mis cuentas →', APP_URL, color)}
      <p style="margin:14px 0 0;font-size:11px;color:#2d3748">
        ${first} · SimpleTrader · <a href="${APP_URL}" style="color:#3d4e6e;text-decoration:none">Abrir plataforma</a>
      </p>
    </div>`;

  return layout(`${emoji} ${account} vence en ${days} día${days === 1 ? '' : 's'}`, body);
}

function buildTemplate(type, data) {
  switch(type) {
    case 'welcome':          return tplWelcome(data);
    case 'dd_alert':         return tplDDAlert(data);
    case 'payment_success':  return tplPaymentSuccess(data);
    case 'payment_failed':   return tplPaymentFailed(data);
    case 'weekly_recap':     return tplWeeklyRecap(data);
    case 'tip':              return tplTip(data);
    case 'account_expiry':   return tplAccountExpiry(data);
    default:
      return layout(data.subject || 'Notificación de SimpleTrader', `
        <h2 style="color:#fff;font-size:20px;margin:0 0 12px">${data.subject || 'Notificación'}</h2>
        <p style="color:#94a3b8;font-size:14px;line-height:1.6">${data.message || ''}</p>
        <br>${btn('Abrir app →', APP_URL)}`);
  }
}

// ── Supabase helpers ──────────────────────────────────────────────────────────

async function getUserEmail(userId) {
  const r = await fetch(`${SUPA_URL}/auth/v1/admin/users/${userId}`, {
    headers: { 'Authorization': `Bearer ${SUPA_SERVICE}`, 'apikey': SUPA_SERVICE },
  });
  if (!r.ok) return null;
  const u = await r.json();
  return u.email || null;
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ ok: false, error: 'Use POST' });

  if (!RESEND_KEY) return res.status(500).json({ ok: false, error: 'RESEND_API_KEY not configured' });

  const auth  = req.headers['authorization'] || '';
  const token = auth.replace('Bearer ', '').trim();
  const body  = req.body || {};

  let to = body.to;

  // Derive email from JWT if not explicit
  if (!to && token) {
    try {
      const pl = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
      to = pl.email || (pl.sub ? await getUserEmail(pl.sub) : null);
    } catch { /* ignore */ }
  }

  // Allow internal service calls with userId (stripe webhook, etc.)
  if (!to && body.userId) {
    to = await getUserEmail(body.userId);
  }

  if (!to) return res.status(400).json({ ok: false, error: 'Cannot determine recipient email' });

  const { type = 'generic', subject, data = {} } = body;

  const html = body.html || buildTemplate(type, { ...data, subject });

  const first = (data.name || '').split(' ')[0] || 'trader';
  const subj = subject || {
    welcome:         `👋 Bienvenido a SimpleTrader, ${first}`,
    dd_alert:        `${parseFloat(data.pct) >= 90 ? '🚨' : '⚠️'} Drawdown al ${data.pct}% — ${data.account}`,
    payment_success: `🎉 Plan ${data.plan} activado — SimpleTrader`,
    payment_failed:  '💳 Problema con tu pago — SimpleTrader',
    weekly_recap:    `📊 Tu semana: ${data.pnl >= 0 ? '+' : ''}$${Math.abs(data.pnl || 0).toLocaleString('es-ES')} · ${data.winRate || 0}% win rate`,
    tip:             { 3: '📊 ¿Ya registraste tu primer trade?', 7: '⚡ Automatiza tus alertas de TradingView', 14: '🛡️ Define tus reglas de riesgo' }[data.day] || '💡 Tip de SimpleTrader',
    account_expiry:  `${parseInt(data.days) <= 3 ? '🚨' : '⏰'} ${data.account} vence en ${data.days} día${data.days == 1 ? '' : 's'}`,
  }[type] || 'Notificación de SimpleTrader';

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to, subject: subj, html }),
  });

  const result = await r.json();
  if (!r.ok) {
    console.error('Resend error:', result);
    return res.status(502).json({ ok: false, error: result.message || 'Resend error' });
  }

  return res.json({ ok: true, id: result.id });
}
