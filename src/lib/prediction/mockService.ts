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
): TradingDecision {
  const upP = prediction.upProbability;
  const downP = prediction.downProbability;
  const sideP = prediction.sidewaysProbability;

  const maxP = Math.max(upP, downP, sideP);
  const separation = Math.abs(upP - downP);
  const expectedReturn = prediction.expectedMove;

  // Configurable bounds
  const MIN_PROB = 0.44;
  const MIN_SEPARATION = 0.08;
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
  ridgeReg: RidgeRegression;
  meanUpMove: number;
  meanDownMove: number;
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

  // Generate dataset sequentially
  for (let i = 60; i < n - 1; i++) {
    const hist = candles.slice(0, i + 1);
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

  // 2. Chronological Train-Val Split for Calibration
  // 75% train, 25% val
  const totalSamples = featuresList.length;
  const trainSize = Math.floor(totalSamples * 0.75);

  const X_train = featuresList.slice(0, trainSize);
  const y_train = labels.slice(0, trainSize);
  const ret_train = returnsList.slice(0, trainSize);

  const X_val = featuresList.slice(trainSize);
  const y_val = labels.slice(trainSize);

  // 3. Scaler alignment
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
    ridgeReg,
    meanUpMove,
    meanDownMove,
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

  // Extract features for current candle T (n-1)
  const currentRawFeats = extractFeatures(candles, timeframe);
  const currentFeatsScaled = transformFeatures(currentRawFeats, ensemble.scaler);

  // Query models on current candle features
  const probA = ensemble.modelA.predictProbs(currentFeatsScaled, ensemble.tempA);
  const probB = ensemble.modelB.predictProbs(currentFeatsScaled, ensemble.tempB);
  const probC = ensemble.modelC.predictProbs(currentFeatsScaled, ensemble.tempC);
  const probD = ensemble.modelD.predictProbs(currentFeatsScaled, ensemble.tempD);

  // Ensemble Averaged Probabilities
  const upProbability = (probA[0]! + probB[0]! + probC[0]! + probD[0]!) / 4;
  const downProbability = (probA[1]! + probB[1]! + probC[1]! + probD[1]!) / 4;
  const sidewaysProbability = (probA[2]! + probB[2]! + probC[2]! + probD[2]!) / 4;

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
  dirs.push(getDir(probA), getDir(probB), getDir(probC), getDir(probD));
  const agreementCount = dirs.filter((d) => d === direction).length;
  const modelAgreement = `${agreementCount}/4`;

  // Estimate expected move combining Ridge Regression and Class Probabilities
  const regExpectedMove = ensemble.ridgeReg.predict(currentFeatsScaled);

  const probWeightedMove = upProbability * ensemble.meanUpMove + downProbability * ensemble.meanDownMove;
  // Blend predictions: 60% probability-weighted moves, 40% Ridge regression
  const expectedMove = probWeightedMove * 0.6 + regExpectedMove * 0.4;

  // Calibrate confidence
  const sortedProbs = [...ensembleProbs].sort((a, b) => b - a);
  const margin = sortedProbs[0]! - sortedProbs[1]!;
  // Adjust based on model agreement and margin
  const confidence = Math.max(0.12, Math.min(0.96, margin * 0.7 + (agreementCount === 4 ? 0.20 : 0.0)));

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
    modelId: "dream-softmax-v1",
    modelKind: "ml",
    expectedVolatility,
    regime,
    modelAgreement,
    modelVersion: "v1.0.0",
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

  predictionShell.factors = factors.sort((a, b) => b.weight - a.weight);

  // Apply trading decisions layer
  const decision = makeTradingDecision(predictionShell, price, atrVal);
  predictionShell.signal = decision.signal;

  return predictionShell;
}

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
      pred.modelId = "dream-nifty-50-v1";
      pred.modelVersion = "v1.0.0 (Trained on 4,288 minute candles)";
      return pred;
    }
  }
  const ensemble = trainEnsemble(candles, timeframe, k);
  return predictWithEnsemble(ensemble, candles, asset, timeframe, k);
}

export const mockPredictionService: PredictionService = {
  modelId: "dream-softmax-v1",
  modelKind: "ml",
  async predict({ candles, asset, timeframe }: PredictionRequest): Promise<Prediction> {
    return computePrediction(candles, asset, timeframe);
  },
};

export function getPredictionService(): PredictionService {
  return mockPredictionService;
}
