/**
 * copier.js — Core copy-trading logic
 *
 * For each user with active masters + slaves:
 *   1. Poll master account fills every POLL_MS
 *   2. On new fill → place same trade on all slave accounts (with multiplier)
 *   3. Log result to Supabase
 *
 * Strategy: fill-based (reacts to new executions, not position diffs).
 * This means it captures every trade as it happens, even scalps.
 */

import { getToken, invalidateToken, getFillsSince, placeMarketOrder } from './tradovate.js';
import { logExecution, updateCopierStatus } from './supabase.js';

// State per user: { userId → { lastFillTs, masterToken, slaveTokens } }
const state = new Map();

const POLL_MS = Number(process.env.POLL_MS) || 2500;  // default 2.5s

// ── Symbol normalization ────────────────────────────────────────────────────
// Tradovate uses contract-specific symbols like "NQM5".
// Fills already have the right symbol — we pass it through directly.

// ── Copy ONE fill to all slave accounts ─────────────────────────────────────

async function copyFillToSlaves({ userId, fill, slaves, masterUsername, masterPassword }) {
  const action = fill.action === 'Buy' ? 'Buy' : 'Sell';
  const symbol  = fill.contractId ? String(fill.contractId) : (fill.symbol || 'UNKNOWN');
  const baseQty = Math.abs(fill.qty || 1);
  const results = [];

  await Promise.allSettled(
    slaves.map(async (slave) => {
      const slaveQty = Math.max(1, Math.round(baseQty * (slave.multiplier || 1)));
      try {
        // Each slave may have its own credentials, or share the master credentials
        // (common case: same Tradovate login, different sub-accounts)
        const slaveUsername = slave.username || masterUsername;
        const slavePassword = slave.password || masterPassword;
        const token = await getToken(slaveUsername, slavePassword);

        const order = await placeMarketOrder({
          token,
          accountSpec: slave.accountSpec || slaveUsername,
          accountId:   slave.accountId,
          action,
          symbol,
          qty:         slaveQty,
        });

        results.push({ account: slave.name, accountId: slave.accountId, ok: true, orderId: order.orderId, qty: slaveQty });
        console.log(`  ✅ ${slave.name} → ${action} ${slaveQty} ${symbol} (orderId: ${order.orderId})`);
      } catch (err) {
        results.push({ account: slave.name, accountId: slave.accountId, ok: false, error: String(err.message) });
        console.warn(`  ❌ ${slave.name} → ${err.message}`);
      }
    })
  );

  // Log to Supabase (fire-and-forget)
  logExecution({ userId, action, symbol, qty: baseQty, results }).catch(() => {});
  return results;
}

// ── Poll ONE user ────────────────────────────────────────────────────────────

export async function pollUser({ userId, cfg }) {
  const { username, password } = cfg;
  const masters = (cfg.accounts || []).filter(a => a.role === 'master');
  const slaves  = (cfg.accounts || []).filter(a => a.role === 'slave');

  if (!masters.length || !slaves.length) return;

  if (!state.has(userId)) {
    state.set(userId, { lastFillTs: Date.now() });
  }
  const userState = state.get(userId);

  let token;
  try {
    token = await getToken(username, password);
  } catch (err) {
    console.warn(`[${userId}] Auth error: ${err.message}`);
    invalidateToken(username);
    return;
  }

  for (const master of masters) {
    let fills;
    try {
      fills = await getFillsSince(token, master.accountId, userState.lastFillTs);
    } catch (err) {
      console.warn(`[${userId}] Fill fetch error on master ${master.name}: ${err.message}`);
      continue;
    }

    if (!fills.length) continue;

    console.log(`[${userId}] ${fills.length} new fill(s) on master "${master.name}" — copying to ${slaves.length} slave(s)`);

    for (const fill of fills) {
      await copyFillToSlaves({ userId, fill, slaves, masterUsername: username, masterPassword: password });
    }

    // Advance lastFillTs to the most recent fill timestamp
    const latestTs = Math.max(...fills.map(f => new Date(f.timestamp || f.tradeDate || 0).getTime()));
    if (latestTs > userState.lastFillTs) userState.lastFillTs = latestTs;
  }

  // Heartbeat
  updateCopierStatus(userId, {
    running:     true,
    lastPollAt:  new Date().toISOString(),
    masters:     masters.length,
    slaves:      slaves.length,
    totalFills:  (userState.totalFills || 0),
  }).catch(() => {});
}

// ── Main polling loop ────────────────────────────────────────────────────────

export function startCopierLoop(getUserConfigs) {
  console.log(`SimpleTrader Copier started — polling every ${POLL_MS}ms`);

  async function tick() {
    let users;
    try {
      users = await getUserConfigs();
    } catch (err) {
      console.warn(`Config load error: ${err.message}`);
      users = [];
    }

    if (!users.length) {
      console.log('No active users with masters + slaves — waiting…');
    }

    await Promise.allSettled(
      users.map(u => pollUser({ userId: u.userId, cfg: u.cfg }).catch(err =>
        console.warn(`[${u.userId}] Poll error: ${err.message}`)
      ))
    );
  }

  // Run immediately, then on interval
  tick();
  const handle = setInterval(tick, POLL_MS);

  // Graceful shutdown
  process.on('SIGTERM', () => { clearInterval(handle); process.exit(0); });
  process.on('SIGINT',  () => { clearInterval(handle); process.exit(0); });
}
