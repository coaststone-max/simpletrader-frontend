/**
 * POST /api/mt5/tick
 *
 * Called by the MT4/MT5 Expert Advisor every N seconds.
 * Uses Supabase Storage — no SQL tables needed.
 *
 * Storage layout in bucket "simpletrader-mt5":
 *   {token}/meta.json          – label, user_id, platform, created_at
 *   {token}/state.json         – live account + positions + last_seen
 *   {token}/cmd.json           – pending command from frontend
 *   {token}/equity_history.json – [{t,eq,bal,pr}] last 2000 points
 *   {token}/rules.json         – active risk rules + daily tracking
 *   {token}/copy.json          – copy trading config (master/follower)
 */

const SUPABASE_URL     = process.env.SUPABASE_URL;
const SUPABASE_SERVICE = process.env.SUPABASE_SERVICE_KEY;
const BUCKET           = 'simpletrader-mt5';
const APP_URL          = 'https://simpletrader.app';

const SBH = () => ({
  'Authorization': `Bearer ${SUPABASE_SERVICE}`,
  'apikey':        SUPABASE_SERVICE,
});

async function storageGet(path) {
  const r = await fetch(
    `${SUPABASE_URL}/storage/v1/object/authenticated/${BUCKET}/${path}`,
    { headers: SBH() }
  );
  if (!r.ok) return null;
  try { return await r.json(); } catch { return null; }
}

async function storagePut(path, data) {
  return fetch(
    `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`,
    {
      method:  'POST',
      headers: { ...SBH(), 'Content-Type': 'application/json', 'x-upsert': 'true', 'Cache-Control': '0' },
      body:    JSON.stringify(data),
    }
  );
}

// ── Equity history ────────────────────────────────────────────────────────────

async function appendEquityHistory(token, account) {
  try {
    let hist = await storageGet(`${token}/equity_history.json`) || [];
    hist.push({
      t:   Date.now(),
      eq:  parseFloat(account.equity  || 0),
      bal: parseFloat(account.balance || 0),
      pr:  parseFloat(account.profit  || 0),
    });
    if (hist.length > 2000) hist = hist.slice(-2000);
    await storagePut(`${token}/equity_history.json`, hist);
  } catch(e) { /* non-critical */ }
}

// ── Push notification (calls our own push endpoint with service key) ──────────

async function sendPush(userId, title, body, tag) {
  if (!userId) return;
  try {
    await fetch(`${APP_URL}/api/notifications/push`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'x-service-key': SUPABASE_SERVICE },
      body:    JSON.stringify({ userId, title, body, url: '/', tag }),
    });
  } catch(e) { /* non-critical */ }
}

// ── Risk rule enforcement ─────────────────────────────────────────────────────

async function checkRules(token, meta, account, positions) {
  try {
    const rulesData = await storageGet(`${token}/rules.json`);
    if (!rulesData?.rules?.length) return null;

    const today   = new Date().toISOString().split('T')[0];
    let { rules, daily_loss_date, daily_loss_baseline, peak_balance, notified_violations } = rulesData;
    notified_violations = notified_violations || {};

    const currentBalance = parseFloat(account.balance || 0);
    const currentEquity  = parseFloat(account.equity  || currentBalance);

    // Reset daily tracking at start of new day
    if (daily_loss_date !== today) {
      daily_loss_date      = today;
      daily_loss_baseline  = currentBalance;
      notified_violations  = {}; // reset daily notifications
    }

    // Update peak balance (for trailing DD)
    if (!peak_balance || currentBalance > peak_balance) {
      peak_balance = currentBalance;
    }

    const baseline   = daily_loss_baseline || currentBalance;
    const violations = [];
    let shouldCloseAll = false;

    for (const rule of rules.filter(r => r.on)) {
      const val = parseFloat(rule.val);
      if (isNaN(val) && rule.type !== 'text') continue;

      switch(rule.lbl) {
        case 'Daily Loss Limit': {
          const dailyLoss = baseline - currentEquity;
          if (dailyLoss >= val) {
            violations.push({ rule: rule.lbl, icon: rule.icon, actual: dailyLoss.toFixed(2), limit: val, action: 'close_all' });
            shouldCloseAll = true;
          }
          break;
        }
        case 'Trailing DD Mínimo': {
          if (currentEquity <= val) {
            violations.push({ rule: rule.lbl, icon: rule.icon, actual: currentEquity.toFixed(2), limit: val, action: 'close_all' });
            shouldCloseAll = true;
          }
          break;
        }
        case 'Máx. contratos': {
          const totalVol = positions.reduce((s, p) => s + parseFloat(p.volume || 0), 0);
          if (totalVol > val) {
            violations.push({ rule: rule.lbl, icon: rule.icon, actual: totalVol.toFixed(2), limit: val, action: 'notify' });
          }
          break;
        }
        case 'Profit Target': {
          const dailyProfit = currentEquity - baseline;
          if (dailyProfit >= val) {
            violations.push({ rule: rule.lbl, icon: rule.icon, actual: dailyProfit.toFixed(2), limit: val, action: 'close_all' });
            shouldCloseAll = true;
          }
          break;
        }
        case 'Riesgo por trade': {
          for (const pos of positions) {
            const sl   = parseFloat(pos.sl || 0);
            const open = parseFloat(pos.open_price || 0);
            const vol  = parseFloat(pos.volume || 0);
            if (sl > 0 && open > 0 && vol > 0 && currentBalance > 0) {
              const riskPips   = Math.abs(open - sl);
              const pointValue = 10; // approx $10/pip for standard lot — rough estimate
              const riskUSD    = riskPips * vol * pointValue / 0.0001;
              const riskPct    = (riskUSD / currentBalance) * 100;
              if (riskPct > val) {
                violations.push({ rule: rule.lbl, icon: rule.icon, ticket: pos.ticket, actual: riskPct.toFixed(2), limit: val, action: 'notify' });
              }
            }
          }
          break;
        }
        case 'Pausar tras N pérdidas': {
          // Check positions with negative profit
          const losers = positions.filter(p => parseFloat(p.profit || 0) < 0).length;
          if (losers >= val) {
            violations.push({ rule: rule.lbl, icon: rule.icon, actual: losers, limit: val, action: 'notify' });
          }
          break;
        }
      }
    }

    // Persist updated rule tracking state
    storagePut(`${token}/rules.json`, {
      ...rulesData,
      daily_loss_date,
      daily_loss_baseline: baseline,
      peak_balance,
      notified_violations,
      last_violations: violations,
      last_checked:    new Date().toISOString(),
    }).catch(() => {});

    // Send push notifications for new violations
    if (violations.length > 0 && meta.user_id) {
      for (const v of violations) {
        const notifKey = `${v.rule}-${today}`;
        if (!notified_violations[notifKey]) {
          notified_violations[notifKey] = true;
          const isClose = v.action === 'close_all';
          sendPush(
            meta.user_id,
            `${v.icon || (isClose ? '🚨' : '⚠️')} ${isClose ? 'Regla ejecutada' : 'Alerta'}: ${v.rule}`,
            `${meta.label || 'MT5'} — ${isClose ? 'Posiciones cerradas automáticamente' : `Actual: ${v.actual} | Límite: ${v.limit}`}`,
            `rule-${token}-${v.rule.replace(/\s/g, '-')}`
          );
        }
      }
    }

    return { violations, shouldCloseAll };
  } catch(e) {
    console.error('checkRules error:', e.message);
    return null;
  }
}

// ── Copy trading (follower side) ──────────────────────────────────────────────

async function getCopyCommand(token, currentPositions, currentAccount) {
  try {
    const copyData = await storageGet(`${token}/copy.json`);
    if (!copyData || copyData.role !== 'follower' || !copyData.master_token) return null;

    const masterState = await storageGet(`${copyData.master_token}/state.json`);
    if (!masterState) return null;

    const masterPositions = masterState.positions || [];
    const ratio           = parseFloat(copyData.ratio || 1.0);
    const ticketMap       = copyData.ticket_map || {}; // {master_ticket: follower_ticket}

    // Step 1: Auto-map newly opened follower positions to master positions
    // (follower EA opened a position last tick; find it by symbol+type match)
    let mapUpdated = false;
    for (const masterPos of masterPositions) {
      const mk = String(masterPos.ticket);
      if (ticketMap[mk]) continue; // already mapped
      // Find an unmapped follower position with same symbol + type
      const followerMatch = currentPositions.find(fp =>
        fp.symbol === masterPos.symbol &&
        fp.type   === masterPos.type &&
        !Object.values(ticketMap).includes(String(fp.ticket))
      );
      if (followerMatch) {
        ticketMap[mk] = String(followerMatch.ticket);
        mapUpdated = true;
      }
    }

    // Step 2: Close follower positions whose master was closed
    for (const [mk, fk] of Object.entries(ticketMap)) {
      const masterStillOpen  = masterPositions.some(p => String(p.ticket) === mk);
      const followerStillOpen = currentPositions.some(p => String(p.ticket) === fk);
      if (!masterStillOpen && followerStillOpen) {
        const newMap = { ...ticketMap };
        delete newMap[mk];
        storagePut(`${token}/copy.json`, { ...copyData, ticket_map: newMap }).catch(() => {});
        return { type: 'close_ticket', ticket: parseInt(fk) };
      }
    }

    // Step 3: Open new follower positions for new master positions
    for (const masterPos of masterPositions) {
      const mk = String(masterPos.ticket);
      if (ticketMap[mk]) continue; // already mapped

      // Calculate volume
      let volume = Math.round(parseFloat(masterPos.volume || 0.01) * ratio * 100) / 100;
      volume = Math.max(0.01, volume);

      // Save updated map (optimistically — ticket_map updated when follower reports back)
      if (mapUpdated) {
        storagePut(`${token}/copy.json`, { ...copyData, ticket_map: ticketMap }).catch(() => {});
      }

      return {
        type:       'open_order',
        symbol:     masterPos.symbol,
        order_type: masterPos.type,
        volume,
        sl:         masterPos.sl || 0,
        tp:         masterPos.tp || 0,
        comment:    `Copy#${mk}`,
      };
    }

    if (mapUpdated) {
      storagePut(`${token}/copy.json`, { ...copyData, ticket_map: ticketMap }).catch(() => {});
    }
    return null;
  } catch(e) {
    console.error('getCopyCommand error:', e.message);
    return null;
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ ok: false, error: 'Method not allowed' });

  let body;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}); }
  catch { return res.status(400).json({ ok: false, error: 'Invalid JSON' }); }

  const { token, platform, account, positions } = body;
  if (!token) return res.status(400).json({ ok: false, error: 'token required' });

  if (!SUPABASE_URL || !SUPABASE_SERVICE) {
    return res.status(500).json({ ok: false, error: 'Server misconfigured' });
  }

  try {
    // 1. Verify token exists
    const meta = await storageGet(`${token}/meta.json`);
    if (!meta) {
      return res.status(401).json({ ok: false, error: 'Token not found. Register at simpletrader.app first.' });
    }

    const acct = account   || {};
    const pos  = positions || [];

    // 2. Write live state
    await storagePut(`${token}/state.json`, {
      platform:     platform || meta.platform || 'MT5',
      account_info: acct,
      positions:    pos,
      is_online:    true,
      last_seen:    new Date().toISOString(),
    });

    // 3. Equity history (async, don't block)
    appendEquityHistory(token, acct);

    // 4. Check risk rules
    const ruleCheck = await checkRules(token, meta, acct, pos);

    // 5. Read pending command
    let command = null;
    const cmdData = await storageGet(`${token}/cmd.json`);
    if (cmdData?.command) {
      command = cmdData.command;
      storagePut(`${token}/cmd.json`, { command: null }).catch(() => {});
    }

    // 6. If no pending command, check copy trading
    if (!command) {
      const copyCmd = await getCopyCommand(token, pos, acct);
      if (copyCmd) command = copyCmd;
    }

    // 7. Rule violations override — auto close if needed
    if (ruleCheck?.shouldCloseAll && pos.length > 0 && !command) {
      command = 'close_all';
    }

    return res.json({ ok: true, command });

  } catch (err) {
    console.error('tick error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
