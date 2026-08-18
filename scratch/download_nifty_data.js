import fs from 'fs';

async function downloadNiftyData() {
  const symbol = "^NSEI"; // NIFTY 50 Index
  const interval = "5m";
  const range = "60d"; // maximum range allowed by Yahoo for 5m data
  const yfUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`;

  console.log(`Downloading Nifty 50 historical 5-minute data from Yahoo Finance...`);
  try {
    const response = await fetch(yfUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json",
        "Referer": "https://finance.yahoo.com"
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch Yahoo data: ${response.statusText}`);
    }

    const rawData = await response.json();
    const result = rawData.chart?.result?.[0];
    if (!result) {
      throw new Error("No chart result found in Yahoo response");
    }

    const timestamps = result.timestamp || [];
    const quote = result.indicators.quote[0];
    const opens = quote.open || [];
    const highs = quote.high || [];
    const lows = quote.low || [];
    const closes = quote.close || [];
    const volumes = quote.volume || [];

    const candles = [];
    for (let idx = 0; idx < timestamps.length; idx++) {
      const time = timestamps[idx];
      const open = opens[idx];
      const high = highs[idx];
      const low = lows[idx];
      const close = closes[idx];
      const volume = volumes[idx];

      if (close === null || close <= 0) continue;

      candles.push({
        time,
        open: open ?? close,
        high: high ?? close,
        low: low ?? close,
        close: close,
        volume: volume ?? 0
      });
    }

    // Sort chronologically
    candles.sort((a, b) => a.time - b.time);

    console.log(`Success! Processed ${candles.length} historical candles of Nifty 50 5-minute data.`);
    
    // Save to file
    const destPath = 'src/lib/prediction/nifty_data.json';
    fs.writeFileSync(destPath, JSON.stringify(candles, null, 2));
    console.log(`Saved dataset to ${destPath}`);

  } catch (err) {
    console.error("Error downloading Nifty data:", err.message);
  }
}

downloadNiftyData();
