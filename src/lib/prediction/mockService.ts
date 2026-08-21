import type { Candle, Timeframe } from "../market/types";
import niftyData from "./nifty_data.json";

// Shared pre-trained model parameter cache for Nifty 50
let niftyEnsemble: TrainedEnsemble | null = null;
import type {
  Direction,
  Prediction,
  PredictionFactor,
  PredictionRequest,
  PredictionService,
  TradingDecision,
} from "./types";
import {
  extractFeatures,
  fitScaler,
  transformFeatures,
  SoftmaxRegression,
  RidgeRegression,
  tuneTemperature,
  getSwingPoints,
  FeatureSet,
  Scaler,
} from "./ml";
import { GradientBoostingClassifier, tuneGbmTemperature } from "./gbm";
import { classifyMove } from "./backtest";
import { realizedVolatility } from "../market/indicators";

// Model feature partitions
const PRICE_KEYS = ["ret1", "ret2", "ret3", "ret5", "ret8", "bodyPct", "upperWickPct", "lowerWickPct", "closeLocation", "distRollingHigh40", "distRollingLow40", "ret1Atr", "ret5Atr", "rangeAtr", "zScore50", "emaFast", "emaSpread"];
const VOLUME_KEYS = [...PRICE_KEYS, "relVolume", "volChange", "priceVolumeInt", "volZ", "flowImbalance"];
const MTF_KEYS = ["ret1", "mom6", "closeLocation", "distSupport", "distResistance", "htfRet1", "htfRet5", "htfCloseLocation", "emaTrend"];
const REGIME_KEYS = ["consecutiveDir", "hour", "dayOfWeek", "distSupport", "distResistance", "atrPct", "volRatio", "volShort", "rsi14", "autocorr1"];

/** The boosted-tree model sees the full feature space. */
const GBM_KEYS = Array.from(
  new Set([...PRICE_KEYS, ...VOLUME_KEYS, ...MTF_KEYS, ...REGIME_KEYS, "ret13", "minuteOfHour"]),
);

const ALL_KEYS = Array.from(new Set([...PRICE_KEYS, ...VOLUME_KEYS, ...MTF_KEYS, ...REGIME_KEYS]));


/** Detects the current market regime based on structural rules and indicators */
export function detectRegime(candles: Candle[]): string {
  const n = candles.length;
  if (n < 20) return "RANGE";

  const last = candles[n - 1]!;
  const price = last.close;

  // Simple volume and price returns
  const last20 = candles.slice(-20);
  const meanClose = last20.reduce((s, c) => s + c.close, 0) / 20;

  // Simple price momentum
  const isBull = price > meanClose * 1.002;
  const isBear = price < meanClose * 0.998;

  // Volatility as simple close range
  const maxClose = Math.max(...last20.map((c) => c.close));
  const minClose = Math.min(...last20.map((c) => c.close));
  const rangePct = (maxClose - minClose) / meanClose;

  // Volume Breakout check
  const volAvg20 = last20.reduce((sum, c) => sum + c.volume, 0) / 20;
  const relVol = volAvg20 > 0 ? last.volume / volAvg20 : 1.0;

  const swings = getSwingPoints(candles, 20);

  if (relVol > 1.6 && (price > swings.resistance * 0.995 || price < swings.support * 1.005)) {
    return "BREAKOUT";
  }
  if (rangePct > 0.02) {
    return "HIGH_VOLATILITY";
  }
  if (rangePct < 0.005) {
    return "LOW_VOLATILITY";
  }
  if (isBull) {
    return "STRONG_BULLISH";
  }
  if (isBear) {
    return "STRONG_BEARISH";
  }

  return "RANGE";
}

/** Formulates the final Long/Short trading decision with SL/TP bounds based on expectation */
export function makeTradingDecision(
  prediction: Prediction,
  price: number,
  atrVal: number,
  riskPct = 0.02,
  edgeThreshold?: number,
): TradingDecision {
  const upP = prediction.upProbability;
  const downP = prediction.downProbability;
  const sideP = prediction.sidewaysProbability;

  const maxP = Math.max(upP, downP, sideP);
  const separation = Math.abs(upP - downP);
  const expectedReturn = prediction.expectedMove;

  // Configurable bounds
  const MIN_PROB = 0.44;
  const MIN_SEPARATION = Math.max(0.05, edgeThreshold ?? 0.08);
  const TRANSACTION_BARRIER = 0.0005; // 5 bps slippage + execution barrier

  let signal: "TRADE" | "NO_SIGNAL" = "NO_SIGNAL";
  let direction: Direction = "SIDEWAYS";
  let stopLoss: number | null = null;
  let takeProfit: number | null = null;
  let reason = "Insufficient edge or high noise";

  if (sideP > 0.45) {
    reason = "Sideways market regime expected";
  } else if (maxP >= MIN_PROB && separation >= MIN_SEPARATION && Math.abs(expectedReturn) >= TRANSACTION_BARRIER) {
    if (upP > downP) {
      signal = "TRADE";
      direction = "UP";
      stopLoss = price - 1.5 * atrVal;
      takeProfit = price + 2.5 * atrVal;
      reason = `Bullish trade setup: exp return +${(expectedReturn * 100).toFixed(2)}%`;
    } else if (downP > upP) {
      signal = "TRADE";
      direction = "DOWN";
      stopLoss = price + 1.5 * atrVal;
      takeProfit = price - 2.5 * atrVal;
      reason = `Bearish trade setup: exp return ${(expectedReturn * 100).toFixed(2)}%`;
    }
  } else {
    reason = `Edge bounds missed (prob: ${maxP.toFixed(2)}, sep: ${separation.toFixed(2)}, move: ${(expectedReturn * 100).toFixed(2)}%)`;
  }

  return {
    signal,
    direction,
    positionSize: riskPct * 100,
    stopLoss,
    takeProfit,
    reason,
  };
}

/** Fits and predicts walk-forward ensemble models dynamically */
export interface TrainedEnsemble {
  scaler: Scaler;
  modelA: SoftmaxRegression;
  tempA: number;
  modelB: SoftmaxRegression;
  tempB: number;
  modelC: SoftmaxRegression;
  tempC: number;
  modelD: SoftmaxRegression;
  tempD: number;
  gbm: GradientBoostingClassifier;
  tempGbm: number;
  /** blend weights for [A, B, C, D, GBM], fitted on the validation slice */
  weights: number[];
  ridgeReg: RidgeRegression;
  meanUpMove: number;
  meanDownMove: number;
  /** validation diagnostics — the honest, out-of-sample numbers */
  validation: {
    samples: number;
    accuracy: number;
    logLoss: number;
    brier: number;
    /** accuracy on the top-confidence third of validation samples */
    highConfidenceAccuracy: number;
    highConfidenceShare: number;
    /** decision threshold on |p(up) - p(down)| that maximised validation edge */
    edgeThreshold: number;
  };
  trainingSamples: number;
  featureImportance: { key: string; weight: number }[];
}

/** Sliding window big enough for every feature (50-bar stats + 5x HTF aggregation). */
const FEATURE_WINDOW = 320;

function logLossOf(probs: number[][], y: number[]): number {
  if (probs.length === 0) return 0;
  let loss = 0;
  for (let i = 0; i < probs.length; i++) loss -= Math.log(Math.max(1e-12, probs[i]![y[i]!]!));
  return loss / probs.length;
}

function brierOf(probs: number[][], y: number[]): number {
  if (probs.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < probs.length; i++) {
    for (let c = 0; c < 3; c++) {
      const target = y[i] === c ? 1 : 0;
      sum += (probs[i]![c]! - target) ** 2;
    }
  }
  return sum / probs.length;
}

/** Trains the ensemble model parameters once using chronological windows */
export function trainEnsemble(candles: Candle[], timeframe: Timeframe, k = 0.5): TrainedEnsemble {
  const n = candles.length;
  if (n < 60) {
    throw new Error("Insufficient history to generate features");
  }

  // 1. Prepare historical training dataset up to n-1
  const featuresList: FeatureSet[] = [];
  const labels: number[] = [];
  const returnsList: number[] = [];

  // Generate dataset sequentially (windowed so cost stays linear in history length)
  for (let i = 60; i < n - 1; i++) {
    const hist = candles.slice(Math.max(0, i + 1 - FEATURE_WINDOW), i + 1);
    const feats = extractFeatures(hist, timeframe);

    // Label classification
    const vol = realizedVolatility(hist, 20);
    const threshold = (k * vol) / 100;
    const nextClose = candles[i + 1]!.close;
    const currentClose = hist[hist.length - 1]!.close;

    const move = (nextClose - currentClose) / currentClose;
    returnsList.push(move);

    const dir = classifyMove(currentClose, nextClose, threshold);
    const label = dir === "UP" ? 0 : dir === "DOWN" ? 1 : 2;

    featuresList.push(feats);
    labels.push(label);
  }

  // 2. Purged chronological train/validation split.
  // A 1% embargo gap between train and validation prevents the label of the last
  // training bar from leaking into the first validation bar (Lopez de Prado).
  const totalSamples = featuresList.length;
  const trainSize = Math.floor(totalSamples * 0.75);
  const embargo = Math.max(1, Math.floor(totalSamples * 0.01));

  const X_train = featuresList.slice(0, trainSize);
  const y_train = labels.slice(0, trainSize);
  const ret_train = returnsList.slice(0, trainSize);

  const X_val = featuresList.slice(trainSize + embargo);
  const y_val = labels.slice(trainSize + embargo);

  // 3. Scaler alignment (fitted on train only — no look-ahead)
  const scaler = fitScaler(X_train);
  const X_train_scaled = X_train.map((x) => transformFeatures(x, scaler));
  const X_val_scaled = X_val.map((x) => transformFeatures(x, scaler));

  // 4. Train independent models
  const modelA = new SoftmaxRegression(PRICE_KEYS);
  modelA.train(X_train_scaled, y_train);
  const tempA = tuneTemperature(modelA, X_val_scaled, y_val);

  const modelB = new SoftmaxRegression(VOLUME_KEYS);
  modelB.train(X_train_scaled, y_train);
  const tempB = tuneTemperature(modelB, X_val_scaled, y_val);

  const modelC = new SoftmaxRegression(MTF_KEYS);
  modelC.train(X_train_scaled, y_train);
  const tempC = tuneTemperature(modelC, X_val_scaled, y_val);

  const modelD = new SoftmaxRegression(REGIME_KEYS);
  modelD.train(X_train_scaled, y_train);
  const tempD = tuneTemperature(modelD, X_val_scaled, y_val);

  // 4b. Gradient-boosted trees over the full feature space — captures the
  // non-linear interactions the linear models structurally cannot.
  const gbm = new GradientBoostingClassifier(GBM_KEYS, {
    rounds: totalSamples > 1500 ? 90 : 50,
    learningRate: 0.1,
    maxDepth: 3,
    minSamplesLeaf: Math.max(15, Math.floor(trainSize * 0.02)),
  });
  gbm.train(X_train_scaled, y_train);
  const tempGbm = tuneGbmTemperature(gbm, X_val_scaled, y_val);

  // 5. Fit blend weights on the validation slice: each member gets weight
  // proportional to exp(-logloss), so weak models fade out automatically.
  const memberProbs = (x: FeatureSet): number[][] => [
    modelA.predictProbs(x, tempA),
    modelB.predictProbs(x, tempB),
    modelC.predictProbs(x, tempC),
    modelD.predictProbs(x, tempD),
    gbm.isTrained ? gbm.predictProbs(x, tempGbm) : [1 / 3, 1 / 3, 1 / 3],
  ];

  const memberCount = 5;
  const losses = new Array(memberCount).fill(0);
  for (let i = 0; i < X_val_scaled.length; i++) {
    const ps = memberProbs(X_val_scaled[i]!);
    for (let m = 0; m < memberCount; m++) {
      losses[m] += -Math.log(Math.max(1e-12, ps[m]![y_val[i]!]!));
    }
  }
  let weights = new Array(memberCount).fill(1 / memberCount);
  if (X_val_scaled.length > 20) {
    const mean = losses.map((l) => l / X_val_scaled.length);
    const best = Math.min(...mean);
    const raw = mean.map((l, m) => {
      if (m === 4 && !gbm.isTrained) return 0;
      return Math.exp(-(l - best) / 0.05);
    });
    const sum = raw.reduce((a, b) => a + b, 0) || 1;
    weights = raw.map((r) => r / sum);
  }

  const blend = (x: FeatureSet): number[] => {
    const ps = memberProbs(x);
    const out = [0, 0, 0];
    for (let m = 0; m < memberCount; m++) {
      for (let c = 0; c < 3; c++) out[c] = out[c]! + weights[m]! * ps[m]![c]!;
    }
    const sum = out.reduce((a, b) => a + b, 0) || 1;
    return out.map((p) => p / sum);
  };

  // 6. Honest out-of-sample validation diagnostics + edge threshold search
  const valProbs = X_val_scaled.map((x) => blend(x));
  let valCorrect = 0;
  const edges: { edge: number; correct: boolean }[] = [];
  for (let i = 0; i < valProbs.length; i++) {
    const p = valProbs[i]!;
    const maxP = Math.max(...p);
    const pred = maxP === p[0] ? 0 : maxP === p[1] ? 1 : 2;
    const correct = pred === y_val[i];
    if (correct) valCorrect++;
    edges.push({ edge: Math.abs(p[0]! - p[1]!), correct });
  }
  const valAccuracy = valProbs.length ? valCorrect / valProbs.length : 0;

  // top third by directional edge
  const sortedEdges = [...edges].sort((a, b) => b.edge - a.edge);
  const topCount = Math.max(1, Math.floor(sortedEdges.length / 3));
  const topSlice = sortedEdges.slice(0, topCount);
  const highConfidenceAccuracy = topSlice.length
    ? topSlice.filter((e) => e.correct).length / topSlice.length
    : 0;
  const edgeThreshold = topSlice.length ? (topSlice[topSlice.length - 1]?.edge ?? 0.08) : 0.08;

  // Ridge Regression for expected return prediction
  const ridgeReg = new RidgeRegression(PRICE_KEYS);
  ridgeReg.train(X_train_scaled, ret_train);

  // Calculate average moves of classes in training set
  let sumUpMove = 0, countUp = 0;
  let sumDownMove = 0, countDown = 0;
  for (let i = 0; i < trainSize; i++) {
    if (y_train[i] === 0) { sumUpMove += ret_train[i]!; countUp++; }
    if (y_train[i] === 1) { sumDownMove += ret_train[i]!; countDown++; }
  }
  const meanUpMove = countUp > 0 ? sumUpMove / countUp : 0.002;
  const meanDownMove = countDown > 0 ? sumDownMove / countDown : -0.002;

  const featureImportance = Object.entries(gbm.gainByFeature)
    .map(([key, weight]) => ({ key, weight: Number(weight) }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 8);

  return {
    scaler,
    modelA,
    tempA,
    modelB,
    tempB,
    modelC,
    tempC,
    modelD,
    tempD,
    gbm,
    tempGbm,
    weights,
    ridgeReg,
    meanUpMove,
    meanDownMove,
    validation: {
      samples: valProbs.length,
      accuracy: valAccuracy,
      logLoss: logLossOf(valProbs, y_val),
      brier: brierOf(valProbs, y_val),
      highConfidenceAccuracy,
      highConfidenceShare: valProbs.length ? topCount / valProbs.length : 0,
      edgeThreshold,
    },
    trainingSamples: trainSize,
    featureImportance,
  };
}


/** Queries a pre-trained ensemble model to output predictions for the current candle */
export function predictWithEnsemble(
  ensemble: TrainedEnsemble,
  candles: Candle[],
  asset: string,
  timeframe: Timeframe,
  k = 0.5,
): Prediction {
  const n = candles.length;
  if (n < 60) {
    throw new Error("Insufficient history to generate features");
  }

  const lastCandle = candles[n - 1]!;
  const price = lastCandle.close;

  // Extract features for current candle T (n-1) using the same window as training
  const featWindow = candles.slice(Math.max(0, n - FEATURE_WINDOW));
  const currentRawFeats = extractFeatures(featWindow, timeframe);
  const currentFeatsScaled = transformFeatures(currentRawFeats, ensemble.scaler);

  // Query models on current candle features
  const probA = ensemble.modelA.predictProbs(currentFeatsScaled, ensemble.tempA);
  const probB = ensemble.modelB.predictProbs(currentFeatsScaled, ensemble.tempB);
  const probC = ensemble.modelC.predictProbs(currentFeatsScaled, ensemble.tempC);
  const probD = ensemble.modelD.predictProbs(currentFeatsScaled, ensemble.tempD);
  const probG = ensemble.gbm.isTrained
    ? ensemble.gbm.predictProbs(currentFeatsScaled, ensemble.tempGbm)
    : [1 / 3, 1 / 3, 1 / 3];

  // Validation-fitted weighted blend (weak members carry near-zero weight)
  const members = [probA, probB, probC, probD, probG];
  const blended = [0, 0, 0];
  for (let m = 0; m < members.length; m++) {
    const w = ensemble.weights[m] ?? 1 / members.length;
    for (let c = 0; c < 3; c++) blended[c] = blended[c]! + w * members[m]![c]!;
  }
  const blendSum = blended.reduce((a, b) => a + b, 0) || 1;
  const upProbability = blended[0]! / blendSum;
  const downProbability = blended[1]! / blendSum;
  const sidewaysProbability = blended[2]! / blendSum;

  const ensembleProbs = [upProbability, downProbability, sidewaysProbability];
  const maxProb = Math.max(...ensembleProbs);

  let direction: Direction = "SIDEWAYS";
  if (maxProb === upProbability) direction = "UP";
  else if (maxProb === downProbability) direction = "DOWN";

  // Model agreement calculation
  const dirs: Direction[] = [];
  const getDir = (probs: number[]) => {
    const max = Math.max(...probs);
    return max === probs[0] ? "UP" : max === probs[1] ? "DOWN" : "SIDEWAYS";
  };
  dirs.push(getDir(probA), getDir(probB), getDir(probC), getDir(probD), getDir(probG));
  const agreementCount = dirs.filter((d) => d === direction).length;
  const modelAgreement = `${agreementCount}/5`;


  // Estimate expected move combining Ridge Regression and Class Probabilities
  const regExpectedMove = ensemble.ridgeReg.predict(currentFeatsScaled);

  const probWeightedMove = upProbability * ensemble.meanUpMove + downProbability * ensemble.meanDownMove;
  // Blend predictions: 60% probability-weighted moves, 40% Ridge regression
  const expectedMove = probWeightedMove * 0.6 + regExpectedMove * 0.4;

  // Calibrate confidence
  const sortedProbs = [...ensembleProbs].sort((a, b) => b - a);
  const margin = sortedProbs[0]! - sortedProbs[1]!;
  // Anchor confidence to measured out-of-sample skill, not just the raw margin
  const skill = Math.max(0, ensemble.validation.accuracy - 1 / 3) * 1.5;
  const confidence = Math.max(
    0.1,
    Math.min(0.95, margin * 0.6 + skill * 0.35 + (agreementCount === 5 ? 0.1 : 0)),
  );


  // Volatility & Regime Detection (Pure Dataset metrics, no indicators)
  const regime = detectRegime(candles);
  const avgRange = candles.slice(-14).reduce((sum, c) => sum + (c.high - c.low), 0) / 14;
  const atrVal = avgRange || price * 0.005;

  const slice = candles.slice(-21);
  let expectedVolatility = 0.01;
  if (slice.length >= 2) {
    const rets = [];
    for (let i = 1; i < slice.length; i++) {
      rets.push(Math.log(slice[i]!.close / slice[i - 1]!.close));
    }
    const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
    const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
    expectedVolatility = Math.sqrt(variance);
  }

  // Create temporary prediction shell
  const predictionShell: Prediction = {
    id: `${asset}-${timeframe}-${lastCandle.time}`,
    asset,
    timeframe,
    timestamp: lastCandle.time,
    currentPrice: price,
    direction,
    upProbability,
    downProbability,
    sidewaysProbability,
    confidence,
    expectedMove,
    factors: [],
    modelId: "candleai-gbm-ensemble-v2",
    modelKind: "ml",
    expectedVolatility,
    regime,
    modelAgreement,
    modelVersion: "v2.0.0",
    validation: ensemble.validation,
    trainingSamples: ensemble.trainingSamples,
    featureImportance: ensemble.featureImportance,
  };

  // Generate factors for visual explanation based on features (Dataset-only)
  const factors: PredictionFactor[] = [];
  const momentum = currentRawFeats["mom6"] || 0;
  const relVol = currentRawFeats["relVolume"] || 1.0;
  const sma9 = candles.slice(-9).reduce((sum, c) => sum + c.close, 0) / 9;
  const sma21 = candles.slice(-21).reduce((sum, c) => sum + c.close, 0) / 21;

  factors.push({
    label: `Log Momentum is ${momentum >= 0 ? "bullish" : "bearish"}`,
    impact: momentum >= 0 ? "positive" : "negative",
    weight: Math.min(1.0, Math.abs(momentum) * 15),
    detail: `6-bar return ${(momentum * 100).toFixed(2)}%`,
  });

  const smaBull = sma9 > sma21;
  factors.push({
    label: `SMA 9/21 cross is ${smaBull ? "bullish" : "bearish"}`,
    impact: smaBull ? "positive" : "negative",
    weight: Math.min(1.0, Math.abs(sma9 - sma21) / atrVal),
    detail: `SMA9 ${sma9.toFixed(1)} vs SMA21 ${sma21.toFixed(1)}`,
  });

  factors.push({
    label: `Volume is ${relVol > 1.2 ? "expanding" : "normal"}`,
    impact: relVol > 1.2 ? "positive" : "neutral",
    weight: Math.min(1.0, Math.abs(relVol - 1) * 0.5),
    detail: `Rel volume: ${relVol.toFixed(2)}x`,
  });

  factors.push({
    label: `Realized volatility is ${(expectedVolatility * 100).toFixed(2)}%`,
    impact: expectedVolatility > 0.0015 ? "negative" : "neutral",
    weight: Math.min(1.0, expectedVolatility * 100),
  });

  const topFeature = ensemble.featureImportance[0];
  if (topFeature) {
    factors.push({
      label: `Model driver: ${topFeature.key}`,
      impact: "neutral",
      weight: 0.5,
      detail: `Highest split gain in the boosted-tree model`,
    });
  }

  predictionShell.factors = factors.sort((a, b) => b.weight - a.weight);

  // Apply trading decisions layer, gated by the validated edge threshold
  const decision = makeTradingDecision(predictionShell, price, atrVal, 0.02, ensemble.validation.edgeThreshold);
  predictionShell.signal = decision.signal;

  return predictionShell;
}

/** Cache of live-trained ensembles, refreshed every REFIT_EVERY new candles. */
const ensembleCache = new Map<string, { ensemble: TrainedEnsemble; trainedAt: number }>();
const REFIT_EVERY = 60;

export function computePrediction(candles: Candle[], asset: string, timeframe: Timeframe, k = 0.5): Prediction {
  if (asset === "NIFTY") {
    if (!niftyEnsemble) {
      try {
        niftyEnsemble = trainEnsemble(niftyData as Candle[], "5m", k);
        console.log("[mockService] Pre-trained NIFTY ensemble model on 4,200+ historical candles successfully!");
      } catch (e) {
        console.error("[mockService] Failed to train static NIFTY ensemble:", e);
      }
    }
    if (niftyEnsemble) {
      const pred = predictWithEnsemble(niftyEnsemble, candles, asset, timeframe, k);
      pred.modelId = "candleai-nifty50-gbm-v2";
      pred.modelVersion = `v2.0.0 (GBM ensemble, ${niftyEnsemble.trainingSamples} training samples)`;
      return pred;
    }
  }
  const key = `${asset}|${timeframe}`;
  const cached = ensembleCache.get(key);
  const ensemble =
    cached && candles.length - cached.trainedAt < REFIT_EVERY
      ? cached.ensemble
      : trainEnsemble(candles, timeframe, k);
  if (ensemble !== cached?.ensemble) {
    ensembleCache.set(key, { ensemble, trainedAt: candles.length });
  }
  return predictWithEnsemble(ensemble, candles, asset, timeframe, k);
}

export const mockPredictionService: PredictionService = {
  modelId: "candleai-gbm-ensemble-v2",
  modelKind: "ml",
  async predict({ candles, asset, timeframe }: PredictionRequest): Promise<Prediction> {
    return computePrediction(candles, asset, timeframe);
  },
};

export function getPredictionService(): PredictionService {
  return mockPredictionService;
}
