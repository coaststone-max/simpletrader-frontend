/**
 * GET /api/backtest/candles?symbol=NQ=F&interval=5m&range=5d
 *
 * Proxy for Yahoo Finance v8 chart API to avoid CORS.
 * Transforms response into KLineChart-compatible format:
 *   [{ timestamp, open, high, low, close, volume }, ...]
 *
 * Supports: stocks (AAPL), futures (NQ=F, ES=F, GC=F, CL=F),
 *           forex (EURUSD=X), ETFs (SPY, QQQ)
 *
 * interval: 1m | 2m | 5m | 15m | 30m | 60m | 1h | 1d | 1wk | 1mo
 * range:    1d | 5d | 1mo | 3mo | 6mo | 1y | 2y | 5y | max
 */

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { symbol, interval = '5m', range = '5d' } = req.query;

  if (!symbol) return res.status(400).json({ ok: false, error: 'symbol required' });

  // Validate interval/range to prevent injection
  const validIntervals = ['1m','2m','5m','15m','30m','60m','1h','4h','1d','1wk','1mo'];
  const validRanges    = ['1d','2d','5d','1mo','3mo','6mo','1y','2y','5y','10y','max'];
  const safeInterval   = validIntervals.includes(interval) ? interval : '5m';
  const safeRange      = validRanges.includes(range) ? range : '5d';

  // Yahoo Finance doesn't have 4h — map to 1h with longer range
  const yahooInterval  = safeInterval === '4h' ? '1h' : safeInterval;
  const yahooRange     = safeInterval === '4h' ? '3mo' : safeRange;

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${yahooInterval}&range=${yahooRange}&includePrePost=false`;

  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });

    if (!r.ok) {
      const text = await r.text().catch(() => '');
      console.error('Yahoo Finance error:', r.status, text.slice(0, 200));
      return res.status(r.status).json({ ok: false, error: `Yahoo Finance returned ${r.status}` });
    }

    const data = await r.json();
    const result = data?.chart?.result?.[0];

    if (!result) {
      const err = data?.chart?.error;
      return res.status(404).json({ ok: false, error: err?.description || 'Symbol not found or no data' });
    }

    const timestamps = result.timestamp || [];
    const quote      = result.indicators?.quote?.[0] || {};
    const adjClose   = result.indicators?.adjclose?.[0]?.adjclose;

    if (!timestamps.length) {
      return res.status(404).json({ ok: false, error: 'No data returned for this symbol/range' });
    }

    // Build candle array — filter out null/incomplete candles
    const candles = timestamps
      .map((t, i) => ({
        timestamp: t * 1000, // convert seconds → milliseconds
        open:      quote.open?.[i]   ?? null,
        high:      quote.high?.[i]   ?? null,
        low:       quote.low?.[i]    ?? null,
        close:     quote.close?.[i]  ?? null,
        volume:    quote.volume?.[i] ?? 0,
      }))
      .filter(c => c.open !== null && c.high !== null && c.low !== null && c.close !== null && c.open > 0);

    // For 4h simulation: group hourly bars into 4h groups
    let finalCandles = candles;
    if (safeInterval === '4h') {
      const grouped = [];
      for (let i = 0; i < candles.length; i += 4) {
        const chunk = candles.slice(i, i + 4);
        if (!chunk.length) continue;
        grouped.push({
          timestamp: chunk[0].timestamp,
          open:      chunk[0].open,
          high:      Math.max(...chunk.map(c => c.high)),
          low:       Math.min(...chunk.map(c => c.low)),
          close:     chunk[chunk.length - 1].close,
          volume:    chunk.reduce((s, c) => s + c.volume, 0),
        });
      }
      finalCandles = grouped;
    }

    return res.json({
      ok:      true,
      symbol:  result.meta?.symbol || symbol,
      name:    result.meta?.shortName || result.meta?.symbol || symbol,
      currency: result.meta?.currency || 'USD',
      candles: finalCandles,
      total:   finalCandles.length,
    });

  } catch (err) {
    console.error('Candles proxy error:', err.message);
    return res.status(502).json({ ok: false, error: 'Proxy error: ' + err.message });
  }
}
