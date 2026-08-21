import type { Candle, Timeframe } from "../market/types";

/** Named numeric feature vector used by the prediction models. */
export type FeatureSet = Record<string, number>;

// ==========================================
// 1. Feature Engineering & Multi-Timeframe
// ==========================================

/** Aggregates lower timeframe candles into higher timeframe candles up to current time (no future leakage) */
export function aggregateCandles(candles: Candle[], targetPeriodSeconds: number): Candle[] {
  if (candles.length === 0) return [];
  const aggregated: Candle[] = [];
  const groups = new Map<number, Candle[]>();

  for (const c of candles) {
    const periodStart = c.time - (c.time % targetPeriodSeconds);
    let list = groups.get(periodStart);
    if (!list) {
      list = [];
      groups.set(periodStart, list);
    }
    list.push(c);
  }

  const sortedKeys = Array.from(groups.keys()).sort((a, b) => a - b);
  for (const t of sortedKeys) {
    const list = groups.get(t)!;
    aggregated.push({
      time: t,
      open: list[0]!.open,
      high: Math.max(...list.map((c) => c.high)),
      low: Math.min(...list.map((c) => c.low)),
      close: list[list.length - 1]!.close,
      volume: list.reduce((sum, c) => sum + c.volume, 0),
    });
  }

  return aggregated;
}

/** Computes local swing points (extrema) over a window */
export function getSwingPoints(candles: Candle[], window = 10): { support: number; resistance: number } {
  if (candles.length < window) {
    const prices = candles.map((c) => c.close);
    return {
      support: prices.length ? Math.min(...prices) : 0,
      resistance: prices.length ? Math.max(...prices) : 0,
    };
  }
  const slice = candles.slice(-window);
  return {
    support: Math.min(...slice.map((c) => c.low)),
    resistance: Math.max(...slice.map((c) => c.high)),
  };
}

/** Primary feature extraction pipeline from historical closed candles */
export function extractFeatures(candles: Candle[], timeframe: Timeframe): FeatureSet {
  const features: FeatureSet = {};
  const n = candles.length;
  if (n < 60) return features;

  const last = candles[n - 1]!;
  const price = last.close;

  // --- Category A: Price Structure (Raw Dataset-derived returns) ---
  features["ret1"] = (price - candles[n - 2]!.close) / candles[n - 2]!.close;
  features["ret2"] = (price - candles[n - 3]!.close) / candles[n - 3]!.close;
  features["ret3"] = (price - candles[Math.max(0, n - 4)]!.close) / candles[Math.max(0, n - 4)]!.close;
  features["ret5"] = (price - candles[Math.max(0, n - 6)]!.close) / candles[Math.max(0, n - 6)]!.close;
  features["ret8"] = (price - candles[Math.max(0, n - 9)]!.close) / (candles[Math.max(0, n - 9)]!.close || 1);
  features["ret13"] = (price - candles[Math.max(0, n - 14)]!.close) / (candles[Math.max(0, n - 14)]!.close || 1);
  features["mom6"] = Math.log(price / (candles[Math.max(0, n - 7)]!.close || 1));

  const hlRange = last.high - last.low;
  features["bodyPct"] = hlRange > 0 ? Math.abs(last.close - last.open) / hlRange : 0;
  features["upperWickPct"] = hlRange > 0 ? (last.high - Math.max(last.open, last.close)) / hlRange : 0;
  features["lowerWickPct"] = hlRange > 0 ? (Math.min(last.open, last.close) - last.low) / hlRange : 0;
  features["closeLocation"] = hlRange > 0 ? (last.close - last.low) / hlRange : 0.5;

  const last40 = candles.slice(-40);
  const max40 = Math.max(...last40.map((c) => c.high));
  const min40 = Math.min(...last40.map((c) => c.low));
  features["distRollingHigh40"] = max40 > 0 ? (max40 - price) / price : 0;
  features["distRollingLow40"] = min40 > 0 ? (price - min40) / price : 0;

  // --- Category B: Volume (Raw Dataset scaling) ---
  const volAvg20 = candles.slice(-20).reduce((a, c) => a + c.volume, 0) / 20;
  features["relVolume"] = volAvg20 > 0 ? last.volume / volAvg20 : 1.0;
  features["volChange"] = n > 2 ? (last.volume - candles[n - 2]!.volume) / (candles[n - 2]!.volume || 1) : 0;
  features["priceVolumeInt"] = features["ret1"] * features["relVolume"];

  // --- Category C: Market Structure (Pure Swing points relative to price) ---
  const swings = getSwingPoints(candles, 20);
  features["distSupport"] = price > 0 ? (price - swings.support) / price : 0;
  features["distResistance"] = price > 0 ? (swings.resistance - price) / price : 0;

  let consecutive = 0;
  for (let i = n - 1; i >= Math.max(0, n - 6); i--) {
    const isBull = candles[i]!.close >= candles[i]!.open;
    if (i === n - 1) {
      consecutive = isBull ? 1 : -1;
    } else {
      if (isBull && consecutive > 0) consecutive++;
      else if (!isBull && consecutive < 0) consecutive--;
      else break;
    }
  }
  features["consecutiveDir"] = consecutive;

  // --- Category D: Time of Day ---
  const date = new Date(last.time * 1000);
  features["hour"] = date.getUTCHours() / 24;
  features["dayOfWeek"] = date.getUTCDay() / 7;
  features["minuteOfHour"] = date.getUTCMinutes() / 60;

  // --- Category E: Volatility normalisation (risk-adjusted returns) ---
  // True range based ATR gives us a scale-free unit for every price move,
  // which is what makes features comparable across regimes and assets.
  let trSum = 0;
  for (let i = n - 14; i < n; i++) {
    const c = candles[i]!;
    const prevClose = candles[i - 1]?.close ?? c.open;
    trSum += Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose));
  }
  const atr14 = trSum / 14 || price * 0.001;
  features["atrPct"] = atr14 / price;
  features["ret1Atr"] = ((price - candles[n - 2]!.close) / atr14) * 0.5;
  features["ret5Atr"] = ((price - candles[n - 6]!.close) / atr14) * 0.25;
  features["rangeAtr"] = hlRange / atr14;

  // short vs long realised volatility -> volatility regime / expansion
  const logRets: number[] = [];
  for (let i = Math.max(1, n - 51); i < n; i++) {
    logRets.push(Math.log(candles[i]!.close / candles[i - 1]!.close));
  }
  const stdOf = (arr: number[]) => {
    if (arr.length < 2) return 0;
    const m = arr.reduce((a, b) => a + b, 0) / arr.length;
    return Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / (arr.length - 1));
  };
  const volShort = stdOf(logRets.slice(-10));
  const volLong = stdOf(logRets.slice(-40)) || 1e-9;
  features["volRatio"] = volShort / volLong;
  features["volShort"] = volShort * 100;

  // --- Category F: Trend structure (EMA slopes, z-score mean reversion) ---
  const ema = (period: number) => {
    const alpha = 2 / (period + 1);
    let e = candles[Math.max(0, n - period * 3)]!.close;
    for (let i = Math.max(0, n - period * 3) + 1; i < n; i++) {
      e = candles[i]!.close * alpha + e * (1 - alpha);
    }
    return e;
  };
  const ema9 = ema(9);
  const ema21 = ema(21);
  const ema50 = ema(50);
  features["emaFast"] = (price - ema9) / atr14;
  features["emaSpread"] = (ema9 - ema21) / atr14;
  features["emaTrend"] = (ema21 - ema50) / atr14;

  const closes50 = candles.slice(-50).map((c) => c.close);
  const mean50 = closes50.reduce((a, b) => a + b, 0) / closes50.length;
  const sd50 =
    Math.sqrt(closes50.reduce((a, b) => a + (b - mean50) ** 2, 0) / (closes50.length - 1)) || 1e-9;
  features["zScore50"] = (price - mean50) / sd50;

  // Wilder RSI (14) — normalised to [-1, 1]
  let gains = 0;
  let losses = 0;
  for (let i = n - 14; i < n; i++) {
    const diff = candles[i]!.close - candles[i - 1]!.close;
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  const rs = losses === 0 ? 100 : gains / losses;
  features["rsi14"] = (100 - 100 / (1 + rs)) / 50 - 1;

  // return autocorrelation: tells the model whether to trend-follow or mean-revert
  const acRets = logRets.slice(-30);
  if (acRets.length > 6) {
    const m = acRets.reduce((a, b) => a + b, 0) / acRets.length;
    let num = 0;
    let den = 0;
    for (let i = 1; i < acRets.length; i++) {
      num += (acRets[i]! - m) * (acRets[i - 1]! - m);
    }
    for (const r of acRets) den += (r - m) ** 2;
    features["autocorr1"] = den > 0 ? num / den : 0;
  } else {
    features["autocorr1"] = 0;
  }

  // --- Category G: Multi-timeframe alignment (no look-ahead: aggregates only closed bars) ---
  const htf = aggregateCandles(candles, timeframeSeconds(timeframe) * 5);
  if (htf.length >= 6) {
    const h = htf[htf.length - 1]!;
    const hPrev = htf[htf.length - 2]!;
    const h5 = htf[htf.length - 6]!;
    features["htfRet1"] = (h.close - hPrev.close) / (hPrev.close || 1);
    features["htfRet5"] = (h.close - h5.close) / (h5.close || 1);
    const hRange = h.high - h.low;
    features["htfCloseLocation"] = hRange > 0 ? (h.close - h.low) / hRange : 0.5;
  } else {
    features["htfRet1"] = 0;
    features["htfRet5"] = 0;
    features["htfCloseLocation"] = 0.5;
  }

  // --- Category H: Volume microstructure proxies ---
  const volAvg50 = candles.slice(-50).reduce((a, c) => a + c.volume, 0) / 50 || 1;
  features["volZ"] = (last.volume - volAvg50) / volAvg50;
  let signedVol = 0;
  let absVol = 0;
  for (let i = n - 10; i < n; i++) {
    const c = candles[i]!;
    const dir = c.close >= c.open ? 1 : -1;
    signedVol += dir * c.volume;
    absVol += c.volume;
  }
  // order-flow imbalance proxy (buy vs sell pressure over last 10 bars)
  features["flowImbalance"] = absVol > 0 ? signedVol / absVol : 0;

  return features;
}


// ==========================================
// 2. Chronological Standardization Scaler
// ==========================================

export interface Scaler {
  means: Record<string, number>;
  stds: Record<string, number>;
}

export function fitScaler(X: FeatureSet[]): Scaler {
  const means: Record<string, number> = {};
  const stds: Record<string, number> = {};
  if (X.length === 0) return { means, stds };

  const keys = Object.keys(X[0]!);
  for (const key of keys) {
    const values = X.map((x) => x[key] ?? 0);
    const mean = values.reduce((sum, v) => sum + v, 0) / X.length;
    const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / Math.max(1, X.length - 1);
    const std = Math.sqrt(variance);
    means[key] = mean;
    stds[key] = std === 0 ? 1 : std;
  }
  return { means, stds };
}

export function transformFeatures(x: FeatureSet, scaler: Scaler): FeatureSet {
  const out: FeatureSet = {};
  for (const key of Object.keys(scaler.means)) {
    const mean = scaler.means[key] ?? 0;
    const std = scaler.stds[key] ?? 1;
    out[key] = ((x[key] ?? 0) - mean) / std;
  }
  return out;
}

// ==========================================
// 3. Machine Learning Models
// ==========================================

/** Multiclass Softmax Regression (Logistic Regression for 3 classes: UP=0, DOWN=1, SIDEWAYS=2) */
export class SoftmaxRegression {
  private W: number[][] = []; // 3 classes x D features
  private b: number[] = [0, 0, 0];
  private featureKeys: string[] = [];

  constructor(featureKeys: string[]) {
    this.featureKeys = featureKeys;
    const D = featureKeys.length;
    // Initialize weights to tiny random values
    for (let c = 0; c < 3; c++) {
      const row: number[] = [];
      for (let j = 0; j < D; j++) {
        row.push((Math.random() - 0.5) * 0.01);
      }
      this.W.push(row);
    }
  }

  private getVector(x: FeatureSet): number[] {
    return this.featureKeys.map((k) => x[k] ?? 0);
  }

  public predictRaw(x: FeatureSet): number[] {
    const vec = this.getVector(x);
    const scores = [0, 0, 0];
    for (let c = 0; c < 3; c++) {
      let score = this.b[c]!;
      const row = this.W[c]!;
      for (let j = 0; j < vec.length; j++) {
        score += row[j]! * vec[j]!;
      }
      scores[c] = score;
    }
    return scores;
  }

  public predictProbs(x: FeatureSet, temperature = 1.0): number[] {
    const scores = this.predictRaw(x);
    const scaled = scores.map((s) => s / temperature);
    const max = Math.max(...scaled);
    const exps = scaled.map((s) => Math.exp(s - max));
    const sum = exps.reduce((a, b) => a + b, 0);
    return exps.map((e) => e / (sum || 1));
  }

  public train(X: FeatureSet[], y: number[], epochs = 150, lr = 0.05, lambda = 0.02) {
    const N = X.length;
    if (N === 0) return;
    const D = this.featureKeys.length;

    const Xvecs = X.map((x) => this.getVector(x));

    for (let epoch = 0; epoch < epochs; epoch++) {
      // Gradients
      const dW = [new Array(D).fill(0), new Array(D).fill(0), new Array(D).fill(0)];
      const db = [0, 0, 0];

      // Compute gradients over dataset
      for (let i = 0; i < N; i++) {
        const vec = Xvecs[i]!;
        const label = y[i]!;

        // Predict probs
        const scores = [0, 0, 0];
        for (let c = 0; c < 3; c++) {
          let score = this.b[c] as number;
          const row = this.W[c]!;
          for (let j = 0; j < D; j++) {
            score += (row[j] as number) * vec[j]!;
          }
          scores[c] = score;
        }

        const max = Math.max(...scores);
        const exps = scores.map((s) => Math.exp(s - max));
        const sum = exps.reduce((a, b) => a + b, 0);
        const probs = exps.map((e) => e / (sum || 1));

        for (let c = 0; c < 3; c++) {
          const target = c === label ? 1.0 : 0.0;
          const error = probs[c]! - target;
          db[c] = (db[c] as number) + error;
          const dW_c = dW[c]!;
          for (let j = 0; j < D; j++) {
            dW_c[j] = (dW_c[j] as number) + error * vec[j]!;
          }
        }
      }

      // Update weights with L2 regularization
      for (let c = 0; c < 3; c++) {
        this.b[c] = (this.b[c] as number) - (lr * (db[c] as number)) / N;
        const row = this.W[c]!;
        const dW_c = dW[c]!;
        for (let j = 0; j < D; j++) {
          row[j] = (row[j] as number) - lr * ((dW_c[j] as number) / N + lambda * (row[j] as number));
        }
      }
    }
  }
}

/** Ridge Regression model for expecting numerical return value */
export class RidgeRegression {
  private w: number[] = [];
  private b = 0;
  private featureKeys: string[] = [];

  constructor(featureKeys: string[]) {
    this.featureKeys = featureKeys;
    this.w = new Array(featureKeys.length).fill(0).map(() => (Math.random() - 0.5) * 0.01);
  }

  private getVector(x: FeatureSet): number[] {
    return this.featureKeys.map((k) => x[k] ?? 0);
  }

  public predict(x: FeatureSet): number {
    const vec = this.getVector(x);
    let pred = this.b;
    for (let j = 0; j < vec.length; j++) {
      pred += this.w[j]! * vec[j]!;
    }
    return pred;
  }

  public train(X: FeatureSet[], y: number[], epochs = 100, lr = 0.05, lambda = 0.05) {
    const N = X.length;
    if (N === 0) return;
    const D = this.featureKeys.length;
    const Xvecs = X.map((x) => this.getVector(x));

    for (let epoch = 0; epoch < epochs; epoch++) {
      let db = 0;
      const dw = new Array(D).fill(0);

      for (let i = 0; i < N; i++) {
        const vec = Xvecs[i]!;
        const target = y[i]!;

        let pred = this.b;
        for (let j = 0; j < D; j++) {
          pred += (this.w[j] as number) * vec[j]!;
        }

        const error = pred - target;
        db += error;
        for (let j = 0; j < D; j++) {
          dw[j] = (dw[j] as number) + error * vec[j]!;
        }
      }

      this.b -= (lr * db) / N;
      for (let j = 0; j < D; j++) {
        this.w[j] = (this.w[j] as number) - lr * ((dw[j] as number) / N + lambda * (this.w[j] as number));
      }
    }
  }
}

// ==========================================
// 4. Probability Temperature Calibration
// ==========================================

/** Tunes temperature scaling parameter T on validation set to minimize cross-entropy loss */
export function tuneTemperature(model: SoftmaxRegression, X_val: FeatureSet[], y_val: number[]): number {
  if (X_val.length === 0) return 1.0;

  let bestT = 1.0;
  let minLoss = Infinity;

  // Grid search T from 0.2 to 3.0
  for (let T = 0.2; T <= 3.0; T += 0.05) {
    let loss = 0;
    for (let i = 0; i < X_val.length; i++) {
      const probs = model.predictProbs(X_val[i]!, T);
      const act = y_val[i]!;
      loss -= Math.log(Math.max(1e-15, probs[act]!));
    }
    loss = loss / X_val.length;
    if (loss < minLoss) {
      minLoss = loss;
      bestT = T;
    }
  }

  return bestT;
}
