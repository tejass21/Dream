import type { Candle } from "./types";

export function ema(values: number[], period: number): (number | null)[] {
  const k = 2 / (period + 1);
  const out: (number | null)[] = [];
  let prev: number | null = null;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    if (i < period - 1) {
      sum += v;
      out.push(null);
      continue;
    }
    if (i === period - 1) {
      sum += v;
      prev = sum / period;
      out.push(prev);
      continue;
    }
    prev = v * k + (prev as number) * (1 - k);
    out.push(prev);
  }
  return out;
}

export function rsi(values: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = values[i]! - values[i - 1]!;
    if (diff >= 0) gain += diff;
    else loss -= diff;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  out[period] = 100 - 100 / (1 + (avgLoss === 0 ? 100 : avgGain / avgLoss));
  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i]! - values[i - 1]!;
    const g = diff > 0 ? diff : 0;
    const l = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    out[i] = 100 - 100 / (1 + (avgLoss === 0 ? 100 : avgGain / avgLoss));
  }
  return out;
}

export interface MacdPoint {
  macd: number | null;
  signal: number | null;
  histogram: number | null;
}

export function macd(values: number[], fast = 12, slow = 26, signalPeriod = 9): MacdPoint[] {
  const emaFast = ema(values, fast);
  const emaSlow = ema(values, slow);
  const macdLine = values.map((_, i) =>
    emaFast[i] != null && emaSlow[i] != null ? (emaFast[i] as number) - (emaSlow[i] as number) : null,
  );
  const defined = macdLine.filter((v): v is number => v != null);
  const signalDefined = ema(defined, signalPeriod);
  const offset = macdLine.findIndex((v) => v != null);
  return values.map((_, i) => {
    const m = macdLine[i] ?? null;
    const s = offset >= 0 && i >= offset ? (signalDefined[i - offset] ?? null) : null;
    return {
      macd: m,
      signal: s,
      histogram: m != null && s != null ? m - s : null,
    };
  });
}

export function atr(candles: Candle[], period = 14): (number | null)[] {
  const trs: number[] = candles.map((c, i) => {
    if (i === 0) return c.high - c.low;
    const prevClose = candles[i - 1]!.close;
    return Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose));
  });
  const out: (number | null)[] = new Array(candles.length).fill(null);
  let sum = 0;
  for (let i = 0; i < trs.length; i++) {
    sum += trs[i]!;
    if (i === period - 1) out[i] = sum / period;
    else if (i >= period) out[i] = ((out[i - 1] as number) * (period - 1) + trs[i]!) / period;
  }
  return out;
}

export interface IndicatorSet {
  ema9: (number | null)[];
  ema21: (number | null)[];
  ema50: (number | null)[];
  rsi14: (number | null)[];
  macd: MacdPoint[];
  atr14: (number | null)[];
}

export function computeIndicators(candles: Candle[]): IndicatorSet {
  const closes = candles.map((c) => c.close);
  return {
    ema9: ema(closes, 9),
    ema21: ema(closes, 21),
    ema50: ema(closes, 50),
    rsi14: rsi(closes, 14),
    macd: macd(closes),
    atr14: atr(candles, 14),
  };
}

export function lastDefined(series: (number | null)[]): number | null {
  for (let i = series.length - 1; i >= 0; i--) {
    const v = series[i];
    if (v != null) return v;
  }
  return null;
}

/** Realized volatility of the last n returns, annualization-free (percent). */
export function realizedVolatility(candles: Candle[], n = 20): number {
  const slice = candles.slice(-(n + 1));
  if (slice.length < 3) return 0;
  const rets: number[] = [];
  for (let i = 1; i < slice.length; i++) {
    rets.push(Math.log(slice[i]!.close / slice[i - 1]!.close));
  }
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(variance) * 100;
}
