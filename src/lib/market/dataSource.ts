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

export const mockDataSource: MarketDataSource = new MockMarketDataSource();

/** Swap this for a live provider later; the UI reads it through this getter only. */
export function getMarketDataSource(): MarketDataSource {
  return mockDataSource;
}
