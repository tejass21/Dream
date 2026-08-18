const assets = ["NIFTY", "BANKNIFTY", "RELIANCE"];
const timeframes = ["1m", "5m", "15m", "1h", "4h", "1d"];

function getYahooSymbol(symbol) {
  if (symbol === "NIFTY") return "^NSEI";
  if (symbol === "BANKNIFTY") return "^NSEBANK";
  if (symbol === "RELIANCE") return "RELIANCE.NS";
  return symbol;
}

function mapYahooTimeframe(timeframe) {
  switch (timeframe) {
    case "1m":
      return { interval: "1m", range: "1d" };
    case "5m":
      return { interval: "5m", range: "5d" };
    case "15m":
      return { interval: "15m", range: "5d" };
    case "1h":
      return { interval: "1h", range: "1mo" };
    case "4h":
      return { interval: "1h", range: "3mo" };
    case "1d":
      return { interval: "1d", range: "1y" };
    default:
      return { interval: "5m", range: "5d" };
  }
}

async function testAll() {
  for (const asset of assets) {
    const yahooSymbol = getYahooSymbol(asset);
    console.log(`\n=== Testing Asset: ${asset} (Yahoo: ${yahooSymbol}) ===`);
    for (const tf of timeframes) {
      const { interval, range } = mapYahooTimeframe(tf);
      const yfUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=${interval}&range=${range}`;
      try {
        const response = await fetch(yfUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "application/json",
            "Referer": "https://finance.yahoo.com"
          }
        });
        if (!response.ok) {
          console.log(`  TF ${tf}: FAILED status ${response.status} (${response.statusText})`);
          continue;
        }
        const rawData = await response.json();
        const result = rawData.chart?.result?.[0];
        if (!result) {
          console.log(`  TF ${tf}: FAILED no chart result`);
          continue;
        }
        const timestamps = result.timestamp || [];
        const quote = result.indicators.quote[0];
        const opens = quote.open || [];
        const highs = quote.high || [];
        const lows = quote.low || [];
        const closes = quote.close || [];
        const volumes = quote.volume || [];

        const step =
          interval === "1m"
            ? 60
            : interval === "5m"
              ? 300
              : interval === "15m"
                ? 900
                : interval === "1h"
                  ? 3600
                  : interval === "1d"
                    ? 86400
                    : 300;

        const candlesMap = new Map();
        for (let idx = 0; idx < timestamps.length; idx++) {
          const time = timestamps[idx];
          const open = opens[idx];
          const high = highs[idx];
          const low = lows[idx];
          const close = closes[idx];
          const volume = volumes[idx];

          if (close === null || close <= 0) continue;

          const alignedTime = time - (time % step);
          const existing = candlesMap.get(alignedTime);

          if (!existing) {
            candlesMap.set(alignedTime, {
              time: alignedTime,
              open: open ?? close,
              high: high ?? close,
              low: low ?? close,
              close: close,
              volume: volume ?? 0,
            });
          } else {
            existing.high = Math.max(existing.high, high ?? close);
            existing.low = Math.min(existing.low, low ?? close);
            existing.close = close;
            existing.volume += volume ?? 0;
          }
        }

        const candles = Array.from(candlesMap.values()).sort((a, b) => a.time - b.time);

        // Check if there are any non-aligned timestamps in result
        const nonAlignedCount = candles.filter(c => c.time % step !== 0).length;

        console.log(`  TF ${tf} (${interval}, ${range}): SUCCESS.`);
        console.log(`    Raw timestamps: ${timestamps.length}, Processed candles: ${candles.length}`);
        console.log(`    Non-aligned candles count: ${nonAlignedCount}`);
        
        // Print the last 2 candles to check alignment
        if (candles.length > 0) {
          const lastCandles = candles.slice(-2);
          console.log(`    Last 2 candles:`, lastCandles.map(c => ({
            time: c.time,
            date: new Date(c.time * 1000).toISOString(),
            open: c.open,
            close: c.close
          })));
        }
      } catch (err) {
        console.log(`  TF ${tf}: ERROR:`, err.message);
      }
    }
  }
}

testAll();


