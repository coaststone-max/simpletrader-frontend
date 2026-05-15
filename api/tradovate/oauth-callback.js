/**
 * /api/tradovate/oauth-callback.js
 *
 * Recibe el código de autorización de Tradovate, lo intercambia por un token,
 * obtiene la lista de cuentas y lo guarda todo en Supabase (user_data.payload).
 *
 * Flujo completo:
 *   1. Usuario hace clic en "Conectar con Tradovate" en el UI
 *   2. → oauth-start.js redirige a trader.tradovate.com/oauth
 *   3. Usuario introduce sus credenciales EN TRADOVATE (nunca en SimpleTrader)
 *   4. Tradovate redirige aquí con ?code=XXX&state=USER_ID
 *   5. Intercambiamos el code por un access_token
 *   6. Obtenemos la lista de cuentas con ese token
 *   7. Guardamos token + cuentas en Supabase
 *   8. Redirigimos al usuario de vuelta a la app con ?oauth_success=tradovate
 *
 * Env vars necesarias:
 *   TRADOVATE_CID          — Client ID de la app registrada
 *   TRADOVATE_SEC          — Client Secret de la app registrada
 *   SUPABASE_URL           — URL de tu proyecto Supabase
 *   SUPABASE_SERVICE_KEY   — Service key (bypasa RLS, solo en servidor)
 *   APP_URL                — URL base (ej. https://simpletrader.app)
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const CID          = process.env.TRADOVATE_CID;
const SEC          = process.env.TRADOVATE_SEC;

const TV_LIVE = 'https://live.tradovateapi.com/v1';

function sbHeaders() {
  return {
    apikey:         SUPABASE_KEY,
    Authorization:  `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
  };
}

export default async function handler(req, res) {
  const origin = process.env.APP_URL || `https://${req.headers.host}`;

  // ── Error enviado por Tradovate (usuario cancela, etc.) ─────────────────────
  const { code, state: userId, error: oauthError } = req.query;

  if (oauthError) {
    console.warn('[OAuth callback] Error de Tradovate:', oauthError);
    return res.redirect(302, `${origin}?oauth_error=${encodeURIComponent(oauthError)}`);
  }

  if (!code || !userId) {
    return res.redirect(302, `${origin}?oauth_error=missing_params`);
  }

  if (!CID || !SEC) {
    console.error('[OAuth callback] TRADOVATE_CID o TRADOVATE_SEC no configurados');
    return res.redirect(302, `${origin}?oauth_error=not_configured`);
  }

  try {
    const redirectUri = `${origin}/api/tradovate/oauth-callback`;

    // ── 1. Intercambiar code → access_token ────────────────────────────────────
    const tokenRes = await fetch(`${TV_LIVE}/auth/oauthtoken`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    new URLSearchParams({
        grant_type:    'authorization_code',
        code,
        client_id:     CID,
        client_secret: SEC,
        redirect_uri:  redirectUri,
      }),
    });

    if (!tokenRes.ok) {
      const errBody = await tokenRes.text();
      console.error('[OAuth callback] Token exchange falló:', tokenRes.status, errBody);
      return res.redirect(302, `${origin}?oauth_error=token_exchange`);
    }

    const { access_token, refresh_token, expires_in } = await tokenRes.json();
    const expiresAt = new Date(Date.now() + (expires_in || 4800) * 1000).toISOString();

    // ── 2. Obtener lista de cuentas ────────────────────────────────────────────
    const acctRes = await fetch(`${TV_LIVE}/account/list`, {
      headers: { Authorization: `Bearer ${access_token}` },
    });

    const rawAccounts = acctRes.ok ? await acctRes.json() : [];
    const accounts = rawAccounts.map(a => ({
      accountId:  a.id,
      name:       a.name,
      balance:    a.balance || 0,
      role:       'ignore',     // el usuario asigna master/slave desde el UI
      multiplier: 1,
    }));

    console.log(`[OAuth callback] user=${userId} | token ok | ${accounts.length} cuentas`);

    // ── 3. Leer payload actual de Supabase ─────────────────────────────────────
    const readRes = await fetch(
      `${SUPABASE_URL}/rest/v1/user_data?user_id=eq.${encodeURIComponent(userId)}&select=payload`,
      { headers: sbHeaders() }
    );
    const rows    = readRes.ok ? await readRes.json() : [];
    const payload = rows?.[0]?.payload ?? {};

    // ── 4. Guardar OAuth token y cuentas ───────────────────────────────────────
    payload.tradovateOAuth = {
      accessToken:  access_token,
      refreshToken: refresh_token || null,
      expiresAt,
      connectedAt:  new Date().toISOString(),
      accounts,
    };

    // Actualizar tradovateConfig para que el copier + webhook lo lean
    payload.tradovateConfig = {
      ...(payload.tradovateConfig || {}),
      oauth:    true,
      accounts,
      // Borramos la contraseña si existía antes (reemplazada por OAuth)
      password: undefined,
    };

    // ── 5. PATCH en Supabase ───────────────────────────────────────────────────
    const patchRes = await fetch(
      `${SUPABASE_URL}/rest/v1/user_data?user_id=eq.${encodeURIComponent(userId)}`,
      {
        method:  'PATCH',
        headers: { ...sbHeaders(), Prefer: 'return=minimal' },
        body:    JSON.stringify({ payload }),
      }
    );

    if (!patchRes.ok) {
      const errBody = await patchRes.text();
      console.error('[OAuth callback] Supabase PATCH falló:', patchRes.status, errBody);
      return res.redirect(302, `${origin}?oauth_error=supabase_save`);
    }

    // ── 6. Redirigir a la app con éxito ───────────────────────────────────────
    res.redirect(302, `${origin}?oauth_success=tradovate&accounts=${accounts.length}`);

  } catch (err) {
    console.error('[OAuth callback] Error inesperado:', err.message);
    res.redirect(302, `${origin}?oauth_error=server_error`);
  }
}
