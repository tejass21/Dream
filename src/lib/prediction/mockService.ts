import { computeIndicators, lastDefined, realizedVolatility } from "../market/indicators";
import type { Candle } from "../market/types";
import type {
  Direction,
  Prediction,
  PredictionFactor,
  PredictionRequest,
  PredictionService,
} from "./types";

function softmax(scores: number[], temperature = 1): number[] {
  const max = Math.max(...scores);
  const exps = scores.map((s) => Math.exp((s - max) / temperature));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / sum);
}

function round(value: number, digits = 4): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

/**
 * Feature-based heuristic stand-in for a trained model. It is explicitly NOT an
 * ML model: it computes technical features, scores them, and normalises the
 * scores into class probabilities so the UI contract matches a future
 * Python/FastAPI model response 1:1.
 */
export function computePrediction(candles: Candle[], asset: string, timeframe: PredictionRequest["timeframe"]): Prediction {
  const ind = computeIndicators(candles);
  const last = candles[candles.length - 1]!;
  const price = last.close;

  const ema9 = lastDefined(ind.ema9) ?? price;
  const ema21 = lastDefined(ind.ema21) ?? price;
  const ema50 = lastDefined(ind.ema50) ?? price;
  const rsiValue = lastDefined(ind.rsi14) ?? 50;
  const rsiPrev = ind.rsi14[ind.rsi14.length - 4] ?? rsiValue;
  const macdLast = ind.macd[ind.macd.length - 1] ?? { macd: null, signal: null, histogram: null };
  const macdPrev = ind.macd[ind.macd.length - 2] ?? macdLast;
  const atrValue = lastDefined(ind.atr14) ?? price * 0.005;
  const vol = realizedVolatility(candles, 20);

  const recent = candles.slice(-6);
  const momentum = recent.length > 1 ? recent[recent.length - 1]!.close / recent[0]!.close - 1 : 0;
  const volAvgOld =
    candles.slice(-20, -5).reduce((a, c) => a + c.volume, 0) / Math.max(candles.slice(-20, -5).length, 1);
  const volAvgNew = candles.slice(-5).reduce((a, c) => a + c.volume, 0) / 5;
  const volumeTrend = volAvgOld > 0 ? volAvgNew / volAvgOld - 1 : 0;

  const highs = candles.slice(-40).map((c) => c.high);
  const lows = candles.slice(-40).map((c) => c.low);
  const resistance = Math.max(...highs);
  const support = Math.min(...lows);
  const nearResistance = (resistance - price) / (atrValue || 1) < 1.2;
  const nearSupport = (price - support) / (atrValue || 1) < 1.2;

  const atrPct = (atrValue / price) * 100;
  const factors: PredictionFactor[] = [];
  let bull = 0;
  let bear = 0;
  let flat = 0.35;

  const momScore = Math.max(-1, Math.min(1, momentum / (atrValue / price || 0.005) / 2));
  bull += Math.max(0, momScore) * 1.15;
  bear += Math.max(0, -momScore) * 1.15;
  factors.push({
    label: `Short-term momentum is ${momScore >= 0 ? "positive" : "negative"}`,
    impact: momScore >= 0 ? "positive" : "negative",
    weight: Math.min(1, Math.abs(momScore)),
    detail: `6-bar return ${(momentum * 100).toFixed(2)}%`,
  });

  const emaFast = ema9 > ema21;
  (emaFast ? (bull += 0.85) : (bear += 0.85));
  factors.push({
    label: `EMA 9 is ${emaFast ? "above" : "below"} EMA 21`,
    impact: emaFast ? "positive" : "negative",
    weight: Math.min(1, Math.abs(ema9 - ema21) / (atrValue || 1)),
    detail: `EMA9 ${ema9.toFixed(2)} vs EMA21 ${ema21.toFixed(2)}`,
  });

  const aboveTrend = price > ema50;
  (aboveTrend ? (bull += 0.5) : (bear += 0.5));
  factors.push({
    label: `Price is ${aboveTrend ? "above" : "below"} EMA 50 trend baseline`,
    impact: aboveTrend ? "positive" : "negative",
    weight: Math.min(1, Math.abs(price - ema50) / (atrValue * 3 || 1)),
  });

  const volUp = volumeTrend > 0.03;
  if (volUp) bull += 0.35;
  else flat += 0.3;
  factors.push({
    label: `Volume is ${volUp ? "increasing" : "flat or declining"}`,
    impact: volUp ? "positive" : "neutral",
    weight: Math.min(1, Math.abs(volumeTrend) * 2),
    detail: `${(volumeTrend * 100).toFixed(1)}% vs 15-bar average`,
  });

  const rsiImproving = rsiValue > rsiPrev;
  (rsiImproving ? (bull += 0.4) : (bear += 0.4));
  factors.push({
    label: `RSI momentum is ${rsiImproving ? "improving" : "deteriorating"}`,
    impact: rsiImproving ? "positive" : "negative",
    weight: Math.min(1, Math.abs(rsiValue - rsiPrev) / 12),
    detail: `RSI(14) ${rsiValue.toFixed(1)}`,
  });

  if (rsiValue > 70) {
    bear += 0.55;
    factors.push({
      label: "RSI is in overbought territory",
      impact: "negative",
      weight: Math.min(1, (rsiValue - 70) / 20),
    });
  } else if (rsiValue < 30) {
    bull += 0.55;
    factors.push({
      label: "RSI is in oversold territory",
      impact: "positive",
      weight: Math.min(1, (30 - rsiValue) / 20),
    });
  }

  const histRising = (macdLast.histogram ?? 0) > (macdPrev.histogram ?? 0);
  (histRising ? (bull += 0.45) : (bear += 0.45));
  factors.push({
    label: `MACD histogram is ${histRising ? "expanding" : "contracting"}`,
    impact: histRising ? "positive" : "negative",
    weight: 0.5,
    detail: `hist ${(macdLast.histogram ?? 0).toFixed(3)}`,
  });

  const volElevated = vol > 0.55;
  if (volElevated) {
    flat -= 0.15;
    factors.push({
      label: "Volatility is elevated",
      impact: "negative",
      weight: Math.min(1, vol / 1.5),
      detail: `Realised vol ${vol.toFixed(2)}% / bar, ATR ${atrPct.toFixed(2)}%`,
    });
  } else {
    flat += 0.35;
    factors.push({
      label: "Volatility is compressed",
      impact: "neutral",
      weight: 0.4,
      detail: `Realised vol ${vol.toFixed(2)}% / bar`,
    });
  }

  if (nearResistance) {
    bear += 0.5;
    factors.push({
      label: "Price is near recent resistance",
      impact: "negative",
      weight: 0.6,
      detail: `Resistance ${resistance.toFixed(2)}`,
    });
  }
  if (nearSupport) {
    bull += 0.5;
    factors.push({
      label: "Price is near recent support",
      impact: "positive",
      weight: 0.6,
      detail: `Support ${support.toFixed(2)}`,
    });
  }

  const [upProbability, downProbability, sidewaysProbability] = softmax(
    [bull, bear, flat],
    0.85,
  ) as [number, number, number];

  const probs: Array<[Direction, number]> = [
    ["UP", upProbability],
    ["DOWN", downProbability],
    ["SIDEWAYS", sidewaysProbability],
  ];
  probs.sort((a, b) => b[1] - a[1]);
  const direction = probs[0]![0];
  const topProb = probs[0]![1];
  const margin = topProb - probs[1]![1];
  const confidence = Math.max(0.08, Math.min(0.97, topProb * 0.6 + margin * 0.8));

  const edge = upProbability - downProbability;
  const expectedMove = edge * (atrValue / price) * 0.85;

  return {
    id: `${asset}-${timeframe}-${last.time}`,
    asset,
    timeframe,
    timestamp: last.time,
    currentPrice: price,
    direction,
    upProbability: round(upProbability),
    downProbability: round(downProbability),
    sidewaysProbability: round(sidewaysProbability),
    confidence: round(confidence),
    expectedMove: round(expectedMove, 6),
    factors: factors.sort((a, b) => b.weight - a.weight),
    modelId: "candleai-heuristic-v0",
    modelKind: "heuristic-mock",
  };
}

export const mockPredictionService: PredictionService = {
  modelId: "candleai-heuristic-v0",
  modelKind: "heuristic-mock",
  async predict({ candles, asset, timeframe }: PredictionRequest): Promise<Prediction> {
    return computePrediction(candles, asset, timeframe);
  },
};

/**
 * Replace with an HTTP-backed service (Python/FastAPI) later — the UI only ever
 * touches this getter and the PredictionService interface.
 */
export function getPredictionService(): PredictionService {
  return mockPredictionService;
}
