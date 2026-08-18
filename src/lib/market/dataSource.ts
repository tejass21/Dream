import { createServerFn } from "@tanstack/react-start";
import { getAsset, timeframeSeconds, type Candle, type Timeframe } from "./types";

/**
 * Abstraction over any market data provider. The mock provider below is used for
 * the demo; a real REST/websocket provider can implement the same interface
 * without any frontend changes.
 */
export interface MarketDataSource {
  readonly id: string;
  readonly isLive: boolean;
  getCandles(symbol: string, timeframe: Timeframe, limit?: number): Promise<Candle[]>;
  /** Streams updates for the forming candle. Returns an unsubscribe function. */
  subscribe(
    symbol: string,
    timeframe: Timeframe,
    onUpdate: (candle: Candle, isNewCandle: boolean) => void,
  ): () => void;
}

/** Deterministic PRNG so demo data is stable across reloads and SSR. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function generateCandles(symbol: string, timeframe: Timeframe, count = 400): Candle[] {
  const asset = getAsset(symbol);
  const step = timeframeSeconds(timeframe);
  const rand = mulberry32(hashSeed(`${symbol}:${timeframe}`));
  const now = Math.floor(Date.now() / 1000);
  const lastOpen = now - (now % step);
  const startTime = lastOpen - (count - 1) * step;

  // per-bar volatility scaled by timeframe
  const sigma = 0.0016 * asset.vol * Math.sqrt(step / 60);
  let price = asset.basePrice * (0.94 + rand() * 0.12);
  let drift = 0;
  const candles: Candle[] = [];

  for (let i = 0; i < count; i++) {
    // slow-moving regime drift creates trends / ranges
    if (i % 24 === 0) drift = (rand() - 0.48) * sigma * 0.55;
    const shock = (rand() + rand() + rand() + rand() - 2) * sigma;
    const open = price;
    const close = Math.max(open * (1 + drift + shock), asset.basePrice * 0.3);
    const wick = Math.abs(shock) + sigma * (0.3 + rand() * 0.8);
    const high = Math.max(open, close) * (1 + wick * 0.55);
    const low = Math.min(open, close) * (1 - wick * 0.55);
    const body = Math.abs(close - open) / (open * sigma || 1);
    const baseVol = asset.kind === "crypto" ? 900 : 240000;
    const volume = Math.round(baseVol * (0.5 + rand() + body * 0.35) * (step / 60));
    candles.push({ time: startTime + i * step, open, high, low, close, volume });
    price = close;
  }
  return candles;
}

class MockMarketDataSource implements MarketDataSource {
  readonly id = "mock";
  readonly isLive = false;
  private cache = new Map<string, Candle[]>();

  private key(symbol: string, timeframe: Timeframe) {
    return `${symbol}|${timeframe}`;
  }

  async getCandles(symbol: string, timeframe: Timeframe, limit = 400): Promise<Candle[]> {
    const key = this.key(symbol, timeframe);
    let candles = this.cache.get(key);
    if (!candles) {
      candles = generateCandles(symbol, timeframe, Math.max(limit, 400));
      this.cache.set(key, candles);
    }
    return candles.slice(-limit);
  }

  subscribe(
    symbol: string,
    timeframe: Timeframe,
    onUpdate: (candle: Candle, isNewCandle: boolean) => void,
  ): () => void {
    const key = this.key(symbol, timeframe);
    const asset = getAsset(symbol);
    const step = timeframeSeconds(timeframe);
    const rand = mulberry32(hashSeed(key) ^ 0x9e3779b9);

    const tick = () => {
      const candles = this.cache.get(key);
      if (!candles || candles.length === 0) return;
      const now = Math.floor(Date.now() / 1000);
      const currentOpen = now - (now % step);
      let last = candles[candles.length - 1]!;

      if (currentOpen > last.time) {
        const fresh: Candle = {
          time: currentOpen,
          open: last.close,
          high: last.close,
          low: last.close,
          close: last.close,
          volume: 0,
        };
        candles.push(fresh);
        if (candles.length > 900) candles.shift();
        last = fresh;
        onUpdate(fresh, true);
        return;
      }

      const sigma = 0.0004 * asset.vol;
      const move = (rand() + rand() - 1) * sigma;
      const close = last.close * (1 + move);
      const updated: Candle = {
        ...last,
        close,
        high: Math.max(last.high, close),
        low: Math.min(last.low, close),
        volume: last.volume + Math.round((asset.kind === "crypto" ? 12 : 3200) * (0.4 + rand())),
      };
      candles[candles.length - 1] = updated;
      onUpdate(updated, false);
    };

    const interval = setInterval(tick, 1200);
    return () => clearInterval(interval);
  }
}

// Map timeframe to Binance interval string
function mapBinanceInterval(timeframe: Timeframe): string {
  switch (timeframe) {
    case "1m":
      return "1m";
    case "5m":
      return "5m";
    case "15m":
      return "15m";
    case "1h":
      return "1h";
    case "4h":
      return "4h";
    case "1d":
      return "1d";
    default:
      return "5m";
  }
}

// Fetch historical candles from Binance
async function fetchBinanceCandles(symbol: string, timeframe: Timeframe, limit = 400): Promise<Candle[]> {
  const binanceSymbol = symbol.replace("/", "").toUpperCase();
  const interval = mapBinanceInterval(timeframe);
  const url = `https://api.binance.com/api/v3/klines?symbol=${binanceSymbol}&interval=${interval}&limit=${limit}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Binance API error: ${response.statusText}`);
  }
  const data = await response.json();

  return data.map((d: any) => ({
    time: Math.floor(d[0] / 1000), // convert ms to seconds
    open: parseFloat(d[1]),
    high: parseFloat(d[2]),
    low: parseFloat(d[3]),
    close: parseFloat(d[4]),
    volume: parseFloat(d[5]),
  }));
}

// Subscribe to real-time candles from Binance Websocket
function subscribeBinance(
  symbol: string,
  timeframe: Timeframe,
  onUpdate: (candle: Candle, isNewCandle: boolean) => void,
): () => void {
  const binanceSymbol = symbol.replace("/", "").toLowerCase();
  const interval = mapBinanceInterval(timeframe);
  const wsUrl = `wss://stream.binance.com:9443/ws/${binanceSymbol}@kline_${interval}`;

  const ws = new WebSocket(wsUrl);
  let lastCandleTime = 0;

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.e === "kline") {
        const k = data.k;
        const candle: Candle = {
          time: Math.floor(k.t / 1000),
          open: parseFloat(k.o),
          high: parseFloat(k.h),
          low: parseFloat(k.l),
          close: parseFloat(k.c),
          volume: parseFloat(k.v),
        };

        const isNew = lastCandleTime > 0 && candle.time > lastCandleTime;
        lastCandleTime = candle.time;

        onUpdate(candle, isNew);
      }
    } catch (err) {
      console.error("Error parsing Binance WS message:", err);
    }
  };

  ws.onerror = (err) => {
    console.error("Binance WebSocket connection error:", err);
  };

  return () => {
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close();
    }
  };
}

// Map local symbols to Yahoo Finance symbols
function getYahooSymbol(symbol: string): string {
  if (symbol === "NIFTY") return "^NSEI";
  if (symbol === "BANKNIFTY") return "^NSEBANK";
  if (symbol === "RELIANCE") return "RELIANCE.NS";
  return symbol;
}

// Map timeframe to Yahoo interval and range options
function mapYahooTimeframe(timeframe: Timeframe): { interval: string; range: string } {
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
      return { interval: "1h", range: "3mo" }; // We aggregate 1h to 4h
    case "1d":
      return { interval: "1d", range: "1y" };
    default:
      return { interval: "5m", range: "5d" };
  }
}

const fetchYahooDirect = createServerFn({ method: "GET" })
  .validator((d: { symbol: string; timeframe: Timeframe }) => d)
  .handler(async (ctx) => {
    const { symbol, timeframe } = ctx.data;
    const yahooSymbol = getYahooSymbol(symbol);
    const { interval, range } = mapYahooTimeframe(timeframe);
    const yfUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=${interval}&range=${range}`;

    const response = await fetch(yfUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json",
        "Referer": "https://finance.yahoo.com",
      },
    });
    if (!response.ok) {
      throw new Error(`Yahoo Finance API error: ${response.statusText}`);
    }
    const rawData = await response.json();
    return rawData;
  });

// Fetch historical candles from Yahoo Finance via server function
async function fetchYahooCandles(symbol: string, timeframe: Timeframe): Promise<Candle[]> {
  const rawData: any = await fetchYahooDirect({ data: { symbol, timeframe } });

  if (!rawData.chart?.result?.[0]) {
    throw new Error("Invalid Yahoo Finance response");
  }

  const result = rawData.chart.result[0];
  const timestamps = result.timestamp || [];
  const quote = result.indicators.quote[0];
  const opens = quote.open || [];
  const highs = quote.high || [];
  const lows = quote.low || [];
  const closes = quote.close || [];
  const volumes = quote.volume || [];

  const { interval } = mapYahooTimeframe(timeframe);
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

  // Align and deduplicate/merge candles by interval timestamp
  const candlesMap = new Map<number, Candle>();

  for (let idx = 0; idx < timestamps.length; idx++) {
    const time = timestamps[idx];
    const open = opens[idx];
    const high = highs[idx];
    const low = lows[idx];
    const close = closes[idx];
    const volume = volumes[idx];

    // Skip empty or invalid data points
    if (close === null || close <= 0) {
      continue;
    }

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
      // Merge: keep first open, take highest high, lowest low, latest close, and add volume
      existing.high = Math.max(existing.high, high ?? close);
      existing.low = Math.min(existing.low, low ?? close);
      existing.close = close;
      existing.volume += volume ?? 0;
    }
  }

  const candles = Array.from(candlesMap.values()).sort((a, b) => a.time - b.time);

  // Aggregate 1-hour candles into 4-hour candles if timeframe is 4h
  if (timeframe === "4h") {
    const aggregated: Candle[] = [];
    const step4h = 4 * 3600;
    for (let i = 0; i < candles.length; i++) {
      const c = candles[i];
      if (!c) continue;
      const periodStart = c.time - (c.time % step4h);
      let group = aggregated.find((g) => g.time === periodStart);
      if (!group) {
        group = {
          time: periodStart,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume,
        };
        aggregated.push(group);
      } else {
        group.high = Math.max(group.high, c.high);
        group.low = Math.min(group.low, c.low);
        group.close = c.close;
        group.volume += c.volume;
      }
    }
    return aggregated;
  }

  return candles;
}

// Subscribe/Poll Yahoo Finance candles every 12 seconds
function subscribeYahoo(
  symbol: string,
  timeframe: Timeframe,
  onUpdate: (candle: Candle, isNewCandle: boolean) => void,
): () => void {
  let lastCandleTime = 0;

  const tick = async () => {
    try {
      const candles = await fetchYahooCandles(symbol, timeframe);
      if (candles.length === 0) return;

      const last = candles[candles.length - 1];
      if (last) {
        const isNew = lastCandleTime > 0 && last.time > lastCandleTime;
        lastCandleTime = last.time;
        onUpdate(last, isNew);
      }
    } catch (e) {
      console.warn("Yahoo subscription polling error:", e);
    }
  };

  void tick();
  const interval = setInterval(tick, 12000);

  return () => {
    clearInterval(interval);
  };
}

class HybridMarketDataSource implements MarketDataSource {
  readonly id = "live-hybrid";
  readonly isLive = true;
  private mockSource = new MockMarketDataSource();
  private liveCache = new Map<string, Candle[]>();

  private isCrypto(symbol: string): boolean {
    const asset = getAsset(symbol);
    return asset.kind === "crypto";
  }

  async getCandles(symbol: string, timeframe: Timeframe, limit = 400): Promise<Candle[]> {
    try {
      let candles: Candle[];
      if (this.isCrypto(symbol)) {
        candles = await fetchBinanceCandles(symbol, timeframe, limit);
      } else {
        candles = await fetchYahooCandles(symbol, timeframe);
      }

      this.liveCache.set(`${symbol}|${timeframe}`, candles);
      return candles.slice(-limit);
    } catch (e) {
      console.warn(`Failed to fetch live candles for ${symbol}, falling back to mock:`, e);
      return this.mockSource.getCandles(symbol, timeframe, limit);
    }
  }

  subscribe(
    symbol: string,
    timeframe: Timeframe,
    onUpdate: (candle: Candle, isNewCandle: boolean) => void,
  ): () => void {
    const key = `${symbol}|${timeframe}`;
    let lastCandleTime = 0;

    // Retrieve initial last candle time from cache if present
    const cached = this.liveCache.get(key);
    if (cached && cached.length > 0) {
      const lastCandle = cached[cached.length - 1];
      if (lastCandle) {
        lastCandleTime = lastCandle.time;
      }
    }

    const handleUpdate = (candle: Candle, isNew: boolean) => {
      // Keep cache in sync for getCandles calls
      const candles = this.liveCache.get(key) || [];
      if (candles.length > 0) {
        if (isNew) {
          candles.push(candle);
          if (candles.length > 900) candles.shift();
        } else {
          candles[candles.length - 1] = candle;
        }
        this.liveCache.set(key, candles);
      } else {
        this.liveCache.set(key, [candle]);
      }

      onUpdate(candle, isNew);
    };

    if (this.isCrypto(symbol)) {
      return subscribeBinance(symbol, timeframe, handleUpdate);
    } else {
      return subscribeYahoo(symbol, timeframe, handleUpdate);
    }
  }
}

export const liveDataSource: MarketDataSource = new HybridMarketDataSource();

/** Swap this for a live provider later; the UI reads it through this getter only. */
export function getMarketDataSource(): MarketDataSource {
  return liveDataSource;
}
