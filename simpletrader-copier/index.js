/**
 * SimpleTrader Copier — index.js
 *
 * Entry point for the Railway microservice.
 * Reads user configs from Supabase every CONFIG_REFRESH_MS,
 * then runs the Tradovate polling loop.
 *
 * Required env vars:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_KEY
 *   TRADOVATE_CID
 *   TRADOVATE_SEC
 *
 * Optional:
 *   POLL_MS              (default: 2500) — how often to check master fills
 *   CONFIG_REFRESH_MS    (default: 30000) — how often to reload user configs
 *   SIMPLETRADER_USER_ID — if set, only watches this one user (single-tenant mode)
 *   LOG_LEVEL            (default: info)
 */

// ── Validate env ────────────────────────────────────────────────────────────
const REQUIRED = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'TRADOVATE_CID', 'TRADOVATE_SEC'];
const missing  = REQUIRED.filter(k => !process.env[k]);
if (missing.length) {
  console.error('Missing required environment variables:', missing.join(', '));
  console.error('Set them in Railway → Variables, then redeploy.');
  process.exit(1);
}

import { loadActiveUserConfigs, loadUserConfig } from './supabase.js';
import { startCopierLoop } from './copier.js';

const CONFIG_REFRESH_MS = Number(process.env.CONFIG_REFRESH_MS) || 30_000;
const SINGLE_USER_ID    = process.env.SIMPLETRADER_USER_ID || null;

// ── Config loader — refreshed periodically ───────────────────────────────────
let cachedConfigs  = [];
let lastConfigLoad = 0;

async function getUserConfigs() {
  const now = Date.now();
  if (now - lastConfigLoad < CONFIG_REFRESH_MS) return cachedConfigs;

  try {
    if (SINGLE_USER_ID) {
      const cfg = await loadUserConfig(SINGLE_USER_ID);
      cachedConfigs = cfg ? [{ userId: SINGLE_USER_ID, cfg }] : [];
    } else {
      cachedConfigs = await loadActiveUserConfigs();
    }
    lastConfigLoad = now;
    console.log(`Config refreshed — ${cachedConfigs.length} active user(s)`);
  } catch (err) {
    console.warn('Config refresh failed:', err.message);
  }

  return cachedConfigs;
}

// ── HTTP health check (Railway expects a bound port) ─────────────────────────
import { createServer } from 'http';

const PORT = Number(process.env.PORT) || 3000;

createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok:           true,
      service:      'simpletrader-copier',
      version:      '1.0.0',
      activeUsers:  cachedConfigs.length,
      uptime:       Math.floor(process.uptime()),
      lastConfig:   new Date(lastConfigLoad).toISOString(),
    }));
  } else {
    res.writeHead(404);
    res.end('SimpleTrader Copier — /health for status');
  }
}).listen(PORT, () => {
  console.log(`Health endpoint listening on port ${PORT}`);
});

// ── Start ────────────────────────────────────────────────────────────────────
console.log('═══════════════════════════════════════');
console.log('  SimpleTrader Copier v1.0.0');
console.log(`  Mode: ${SINGLE_USER_ID ? 'single-user (' + SINGLE_USER_ID + ')' : 'multi-user'}`);
console.log(`  Poll interval: ${process.env.POLL_MS || 2500}ms`);
console.log('═══════════════════════════════════════');

startCopierLoop(getUserConfigs);
