/**
 * /api/tradovate/oauth-start.js
 *
 * Redirige al usuario a la página de autorización de Tradovate.
 * El usuario introduce sus credenciales en tradovate.com (nunca en SimpleTrader).
 *
 * Query params:
 *   user_id  — ID del usuario en Supabase (para recuperarlo en el callback)
 *   mode     — "live" (default) | "demo"
 *
 * ⚠️  PENDIENTE: añadir TRADOVATE_CID en Vercel → Settings → Environment Variables
 *     Se obtiene en: trader.tradovate.com/account/developer → Create App
 *     Coste: ~$25/mes (un solo CID para toda la plataforma)
 *
 * Env vars necesarias:
 *   TRADOVATE_CID       — Client ID de tu app registrada en Tradovate
 *   APP_URL             — URL base de producción (ej. https://simpletrader.app)
 *                         Si no está, se auto-detecta del header Host
 */

export default function handler(req, res) {
  const CID = process.env.TRADOVATE_CID;

  // ── Sin CID configurado todavía ────────────────────────────────────────────
  if (!CID) {
    return res.status(503).json({
      ok:      false,
      pending: true,
      error:   'OAuth no configurado aún. Añade TRADOVATE_CID en Vercel → Settings → Environment Variables.',
      docs:    'https://trader.tradovate.com/account/developer',
    });
  }

  const { user_id, mode = 'live' } = req.query;

  if (!user_id) {
    return res.status(400).json({ ok: false, error: 'Falta el parámetro user_id' });
  }

  const origin      = process.env.APP_URL || `https://${req.headers.host}`;
  const redirectUri = `${origin}/api/tradovate/oauth-callback`;

  // Tradovate OAuth — siempre en trader.tradovate.com independiente del entorno
  const params = new URLSearchParams({
    response_type: 'code',
    client_id:     CID,
    redirect_uri:  redirectUri,
    state:         user_id,   // se devuelve en el callback para identificar al usuario
  });

  // En demo usamos el subdominio demo; en live, el principal
  const baseAuth = mode === 'demo'
    ? 'https://trader-d.tradovateapi.com/oauth'
    : 'https://trader.tradovate.com/oauth';

  const authUrl = `${baseAuth}?${params}`;

  console.log(`[OAuth] Redirigiendo user ${user_id} → ${baseAuth}`);
  res.redirect(302, authUrl);
}
