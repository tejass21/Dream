async function testYahoo() {
  const symbol = "^NSEI";
  const interval = "5m";
  const range = "1d";
  const yfUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=${interval}&range=${range}`;

  console.log("Fetching directly:", yfUrl);
  try {
    const response = await fetch(yfUrl);
    console.log("Response status:", response.status);
    const rawData = await response.json();
    
    if (!rawData.chart?.result?.[0]) {
      console.log("No chart result found, rawData:", rawData);
      return;
    }
    
    const result = rawData.chart.result[0];
    const timestamps = result.timestamp || [];
    console.log(`Found ${timestamps.length} candles.`);
    if (timestamps.length > 0) {
      console.log("Latest candle timestamp:", new Date(timestamps[timestamps.length - 1] * 1000).toLocaleString());
      const quote = result.indicators.quote[0];
      console.log("Latest close:", quote.close[quote.close.length - 1]);
    }
  } catch (err) {
    console.error("Test failed:", err);
  }
}

testYahoo();
