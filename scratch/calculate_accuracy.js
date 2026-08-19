import fs from 'fs';
import path from 'path';

// Standalone JS replication of the updated codebase logic (dataset-only, no technical indicators)

function aggregateCandles(candles, targetPeriodSeconds) {
  if (candles.length === 0) return [];
  const aggregated = [];
  const groups = new Map();

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
    const list = groups.get(t);
    aggregated.push({
      time: t,
      open: list[0].open,
      high: Math.max(...list.map((c) => c.high)),
      low: Math.min(...list.map((c) => c.low)),
      close: list[list.length - 1].close,
      volume: list.reduce((sum, c) => sum + c.volume, 0),
    });
  }

  return aggregated;
}

function getSwingPoints(candles, window = 10) {
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

// Features - Dataset Only
const PRICE_KEYS = ["ret1", "ret2", "ret3", "ret5", "ret8", "bodyPct", "upperWickPct", "lowerWickPct", "closeLocation", "distRollingHigh40", "distRollingLow40"];
const VOLUME_KEYS = [...PRICE_KEYS, "relVolume", "volChange", "priceVolumeInt"];
const MTF_KEYS = ["ret1", "mom6", "closeLocation", "distSupport", "distResistance"];
const REGIME_KEYS = ["consecutiveDir", "hour", "dayOfWeek", "distSupport", "distResistance"];

function extractFeatures(candles, timeframe) {
  const features = {};
  const n = candles.length;
  if (n < 60) return features;

  const last = candles[n - 1];
  const price = last.close;

  // Price Structure
  features["ret1"] = (price - candles[n - 2].close) / candles[n - 2].close;
  features["ret2"] = (price - candles[n - 3].close) / candles[n - 3].close;
  features["ret3"] = (price - candles[Math.max(0, n - 4)].close) / candles[Math.max(0, n - 4)].close;
  features["ret5"] = (price - candles[Math.max(0, n - 6)].close) / candles[Math.max(0, n - 6)].close;
  features["ret8"] = (price - candles[Math.max(0, n - 9)].close) / (candles[Math.max(0, n - 9)].close || 1);
  features["ret13"] = (price - candles[Math.max(0, n - 14)].close) / (candles[Math.max(0, n - 14)].close || 1);
  features["mom6"] = Math.log(price / (candles[Math.max(0, n - 7)].close || 1));

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

  // Volume
  const volAvg20 = candles.slice(-20).reduce((a, c) => a + c.volume, 0) / 20;
  features["relVolume"] = volAvg20 > 0 ? last.volume / volAvg20 : 1.0;
  features["volChange"] = n > 2 ? (last.volume - candles[n - 2].volume) / (candles[n - 2].volume || 1) : 0;
  features["priceVolumeInt"] = features["ret1"] * features["relVolume"];

  // Market Structure
  const swings = getSwingPoints(candles, 20);
  features["distSupport"] = price > 0 ? (price - swings.support) / price : 0;
  features["distResistance"] = price > 0 ? (swings.resistance - price) / price : 0;

  let consecutive = 0;
  for (let i = n - 1; i >= Math.max(0, n - 6); i--) {
    const isBull = candles[i].close >= candles[i].open;
    if (i === n - 1) {
      consecutive = isBull ? 1 : -1;
    } else {
      if (isBull && consecutive > 0) consecutive++;
      else if (!isBull && consecutive < 0) consecutive--;
      else break;
    }
  }
  features["consecutiveDir"] = consecutive;

  // Time of Day
  const date = new Date(last.time * 1000);
  features["hour"] = date.getUTCHours() / 24;
  features["dayOfWeek"] = date.getUTCDay() / 7;

  return features;
}

function detectRegime(candles) {
  const n = candles.length;
  if (n < 20) return "RANGE";

  const last = candles[n - 1];
  const price = last.close;

  const last20 = candles.slice(-20);
  const meanClose = last20.reduce((s, c) => s + c.close, 0) / 20;

  const isBull = price > meanClose * 1.002;
  const isBear = price < meanClose * 0.998;

  const maxClose = Math.max(...last20.map((c) => c.close));
  const minClose = Math.min(...last20.map((c) => c.close));
  const rangePct = (maxClose - minClose) / meanClose;

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

function realizedVolatility(candles, n = 20) {
  const slice = candles.slice(-(n + 1));
  if (slice.length < 3) return 0;
  const rets = [];
  for (let i = 1; i < slice.length; i++) {
    rets.push(Math.log(slice[i].close / slice[i - 1].close));
  }
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / (rets.length - 1);
  return Math.sqrt(variance) * 100;
}

function fitScaler(X) {
  const means = {};
  const stds = {};
  if (X.length === 0) return { means, stds };

  const keys = Object.keys(X[0]);
  for (const key of keys) {
    const values = X.map((x) => x[key] ?? 0);
    const mean = values.reduce((sum, v) => sum + v, 0) / X.length;
    const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / Math.max(1, X.length - 1);
    const std = Math.sqrt(variance);
    means[key] = mean;
    stds[key] = std === 0 ? 1 : std;
  }
  return { means, stds };
}

function transformFeatures(x, scaler) {
  const out = {};
  for (const key of Object.keys(scaler.means)) {
    const mean = scaler.means[key] ?? 0;
    const std = scaler.stds[key] ?? 1;
    out[key] = ((x[key] ?? 0) - mean) / std;
  }
  return out;
}

class SoftmaxRegression {
  constructor(featureKeys) {
    this.featureKeys = featureKeys;
    this.W = [];
    this.b = [0, 0, 0];
    const D = featureKeys.length;
    let seed = 12345;
    const pseudoRand = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    for (let c = 0; c < 3; c++) {
      const row = [];
      for (let j = 0; j < D; j++) {
        row.push((pseudoRand() - 0.5) * 0.01);
      }
      this.W.push(row);
    }
  }

  getVector(x) {
    return this.featureKeys.map((k) => x[k] ?? 0);
  }

  predictRaw(x) {
    const vec = this.getVector(x);
    const scores = [0, 0, 0];
    for (let c = 0; c < 3; c++) {
      let score = this.b[c];
      const row = this.W[c];
      for (let j = 0; j < vec.length; j++) {
        score += row[j] * vec[j];
      }
      scores[c] = score;
    }
    return scores;
  }

  predictProbs(x, temperature = 1.0) {
    const scores = this.predictRaw(x);
    const scaled = scores.map((s) => s / temperature);
    const max = Math.max(...scaled);
    const exps = scaled.map((s) => Math.exp(s - max));
    const sum = exps.reduce((a, b) => a + b, 0);
    return exps.map((e) => e / (sum || 1));
  }

  train(X, y, epochs = 150, lr = 0.05, lambda = 0.02) {
    const N = X.length;
    if (N === 0) return;
    const D = this.featureKeys.length;
    const Xvecs = X.map((x) => this.getVector(x));

    for (let epoch = 0; epoch < epochs; epoch++) {
      const dW = [new Array(D).fill(0), new Array(D).fill(0), new Array(D).fill(0)];
      const db = [0, 0, 0];

      for (let i = 0; i < N; i++) {
        const vec = Xvecs[i];
        const label = y[i];

        const scores = [0, 0, 0];
        for (let c = 0; c < 3; c++) {
          let score = this.b[c];
          const row = this.W[c];
          for (let j = 0; j < D; j++) {
            score += row[j] * vec[j];
          }
          scores[c] = score;
        }

        const max = Math.max(...scores);
        const exps = scores.map((s) => Math.exp(s - max));
        const sum = exps.reduce((a, b) => a + b, 0);
        const probs = exps.map((e) => e / (sum || 1));

        for (let c = 0; c < 3; c++) {
          const target = c === label ? 1.0 : 0.0;
          const error = probs[c] - target;
          db[c] += error;
          const dW_c = dW[c];
          for (let j = 0; j < D; j++) {
            dW_c[j] += error * vec[j];
          }
        }
      }

      for (let c = 0; c < 3; c++) {
        this.b[c] -= (lr * db[c]) / N;
        const row = this.W[c];
        const dW_c = dW[c];
        for (let j = 0; j < D; j++) {
          row[j] -= lr * (dW_c[j] / N + lambda * row[j]);
        }
      }
    }
  }
}

class RidgeRegression {
  constructor(featureKeys) {
    this.featureKeys = featureKeys;
    let seed = 54321;
    const pseudoRand = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    this.w = new Array(featureKeys.length).fill(0).map(() => (pseudoRand() - 0.5) * 0.01);
    this.b = 0;
  }

  getVector(x) {
    return this.featureKeys.map((k) => x[k] ?? 0);
  }

  predict(x) {
    const vec = this.getVector(x);
    let pred = this.b;
    for (let j = 0; j < vec.length; j++) {
      pred += this.w[j] * vec[j];
    }
    return pred;
  }

  train(X, y, epochs = 100, lr = 0.05, lambda = 0.05) {
    const N = X.length;
    if (N === 0) return;
    const D = this.featureKeys.length;
    const Xvecs = X.map((x) => this.getVector(x));

    for (let epoch = 0; epoch < epochs; epoch++) {
      let db = 0;
      const dw = new Array(D).fill(0);

      for (let i = 0; i < N; i++) {
        const vec = Xvecs[i];
        const target = y[i];

        let pred = this.b;
        for (let j = 0; j < D; j++) {
          pred += this.w[j] * vec[j];
        }

        const error = pred - target;
        db += error;
        for (let j = 0; j < D; j++) {
          dw[j] += error * vec[j];
        }
      }

      this.b -= (lr * db) / N;
      for (let j = 0; j < D; j++) {
        this.w[j] -= lr * (dw[j] / N + lambda * this.w[j]);
      }
    }
  }
}

function tuneTemperature(model, X_val, y_val) {
  if (X_val.length === 0) return 1.0;

  let bestT = 1.0;
  let minLoss = Infinity;

  for (let T = 0.2; T <= 3.0; T += 0.05) {
    let loss = 0;
    for (let i = 0; i < X_val.length; i++) {
      const probs = model.predictProbs(X_val[i], T);
      const act = y_val[i];
      loss -= Math.log(Math.max(1e-15, probs[act]));
    }
    loss = loss / X_val.length;
    if (loss < minLoss) {
      minLoss = loss;
      bestT = T;
    }
  }

  return bestT;
}

function classifyMove(currentClose, futureClose, threshold) {
  const move = (futureClose - currentClose) / currentClose;
  if (move > threshold) return "UP";
  if (move < -threshold) return "DOWN";
  return "SIDEWAYS";
}

function trainEnsemble(candles, timeframe, k = 0.5) {
  const n = candles.length;
  if (n < 60) {
    throw new Error("Insufficient history to generate features");
  }

  const featuresList = [];
  const labels = [];
  const returnsList = [];

  for (let i = 60; i < n - 1; i++) {
    const hist = candles.slice(0, i + 1);
    const feats = extractFeatures(hist, timeframe);

    const vol = realizedVolatility(hist, 20);
    const threshold = (k * vol) / 100;
    const nextClose = candles[i + 1].close;
    const currentClose = hist[hist.length - 1].close;

    const move = (nextClose - currentClose) / currentClose;
    returnsList.push(move);

    const dir = classifyMove(currentClose, nextClose, threshold);
    const label = dir === "UP" ? 0 : dir === "DOWN" ? 1 : 2;

    featuresList.push(feats);
    labels.push(label);
  }

  const totalSamples = featuresList.length;
  const trainSize = Math.floor(totalSamples * 0.75);

  const X_train = featuresList.slice(0, trainSize);
  const y_train = labels.slice(0, trainSize);
  const ret_train = returnsList.slice(0, trainSize);

  const X_val = featuresList.slice(trainSize);
  const y_val = labels.slice(trainSize);

  const scaler = fitScaler(X_train);
  const X_train_scaled = X_train.map((x) => transformFeatures(x, scaler));
  const X_val_scaled = X_val.map((x) => transformFeatures(x, scaler));

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

  const ridgeReg = new RidgeRegression(PRICE_KEYS);
  ridgeReg.train(X_train_scaled, ret_train);

  let sumUpMove = 0, countUp = 0;
  let sumDownMove = 0, countDown = 0;
  for (let i = 0; i < trainSize; i++) {
    if (y_train[i] === 0) { sumUpMove += ret_train[i]; countUp++; }
    if (y_train[i] === 1) { sumDownMove += ret_train[i]; countDown++; }
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

function predictWithEnsemble(ensemble, candles, asset, timeframe, k = 0.5) {
  const n = candles.length;
  if (n < 60) {
    throw new Error("Insufficient history to generate features");
  }

  const lastCandle = candles[n - 1];
  const price = lastCandle.close;

  const currentRawFeats = extractFeatures(candles, timeframe);
  const currentFeatsScaled = transformFeatures(currentRawFeats, ensemble.scaler);

  const probA = ensemble.modelA.predictProbs(currentFeatsScaled, ensemble.tempA);
  const probB = ensemble.modelB.predictProbs(currentFeatsScaled, ensemble.tempB);
  const probC = ensemble.modelC.predictProbs(currentFeatsScaled, ensemble.tempC);
  const probD = ensemble.modelD.predictProbs(currentFeatsScaled, ensemble.tempD);

  const upProbability = (probA[0] + probB[0] + probC[0] + probD[0]) / 4;
  const downProbability = (probA[1] + probB[1] + probC[1] + probD[1]) / 4;
  const sidewaysProbability = (probA[2] + probB[2] + probC[2] + probD[2]) / 4;

  const ensembleProbs = [upProbability, downProbability, sidewaysProbability];
  const maxProb = Math.max(...ensembleProbs);

  let direction = "SIDEWAYS";
  if (maxProb === upProbability) direction = "UP";
  else if (maxProb === downProbability) direction = "DOWN";

  return {
    direction,
    upProbability,
    downProbability,
    sidewaysProbability,
  };
}

function evaluateHistory(candles, asset, timeframe, maxSamples = 120, k = 0.5) {
  const minIndex = 60;
  if (candles.length < minIndex + 5) return [];
  const end = candles.length - 2;
  const start = Math.max(minIndex, end - maxSamples + 1);
  const out = [];

  const trainingData = candles.slice(0, end + 1);
  const ensemble = trainEnsemble(trainingData, timeframe, k);

  for (let i = start; i <= end; i++) {
    const window = candles.slice(0, i + 1);
    const volPct = realizedVolatility(window, 20);
    const threshold = (k * volPct) / 100;

    const currentClose = window[window.length - 1].close;
    const next = candles[i + 1];

    const prediction = predictWithEnsemble(ensemble, window, asset, timeframe, k);
    const actualDirection = classifyMove(currentClose, next.close, threshold);
    const actualMove = (next.close - currentClose) / currentClose;

    out.push({
      ...prediction,
      actualDirection,
      actualMove,
      correct: prediction.direction === actualDirection,
    });
  }
  return out.reverse();
}

function computeAccuracy(predictions) {
  const scored = predictions.filter((p) => p.actualDirection != null);
  const total = scored.length;

  let correct = 0;
  const matrix = {
    UP: { UP: 0, DOWN: 0, SIDEWAYS: 0 },
    DOWN: { UP: 0, DOWN: 0, SIDEWAYS: 0 },
    SIDEWAYS: { UP: 0, DOWN: 0, SIDEWAYS: 0 },
  };

  for (const p of scored) {
    matrix[p.direction][p.actualDirection] += 1;
    if (p.correct) correct += 1;
  }

  // Baseline evaluation
  let baselineMajorityCorrect = 0;
  let baselinePrevDirCorrect = 0;
  let baselineRandomCorrect = 0;

  const actualCounts = { UP: 0, DOWN: 0, SIDEWAYS: 0 };
  for (const p of scored) {
    actualCounts[p.actualDirection]++;
  }
  let majorityClass = "SIDEWAYS";
  if (actualCounts.UP > actualCounts.SIDEWAYS && actualCounts.UP > actualCounts.DOWN) {
    majorityClass = "UP";
  } else if (actualCounts.DOWN > actualCounts.SIDEWAYS && actualCounts.DOWN > actualCounts.UP) {
    majorityClass = "DOWN";
  }

  let prevActualDirection = "SIDEWAYS";
  let seed = 42;
  const pseudoRand = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };

  const forwardScored = [...scored].reverse();
  for (let i = 0; i < forwardScored.length; i++) {
    const p = forwardScored[i];
    const act = p.actualDirection;

    if (act === majorityClass) baselineMajorityCorrect++;
    if (act === prevActualDirection) baselinePrevDirCorrect++;
    prevActualDirection = act;

    const r = pseudoRand();
    const randDir = r < 0.33 ? "UP" : r < 0.66 ? "DOWN" : "SIDEWAYS";
    if (act === randDir) baselineRandomCorrect++;
  }

  return {
    total,
    correct,
    accuracy: total ? correct / total : 0,
    matrix,
    baselineMajorityAccuracy: total ? baselineMajorityCorrect / total : 0,
    baselinePrevDirAccuracy: total ? baselinePrevDirCorrect / total : 0,
    baselineRandomAccuracy: total ? baselineRandomCorrect / total : 0,
  };
}

function run() {
  const dataPath = path.resolve('src/lib/prediction/nifty_data.json');
  console.log(`Evaluating history using exact codebase parameters on Nifty 50.`);
  console.log(`Using Pure Dataset Features (No indicators).`);
  const rawContent = fs.readFileSync(dataPath, 'utf8');
  const candles = JSON.parse(rawContent);

  // Evaluate on different ranges to see how the accuracy is distributed
  for (const range of [50, 120, 250, 1000]) {
    const evaluated = evaluateHistory(candles, "NIFTY", "5m", range);
    const metrics = computeAccuracy(evaluated);
    console.log(`\n=== RANGE: Last ${range} bars ===`);
    console.log(`Total Samples Evaluated: ${metrics.total}`);
    console.log(`Model Overall Accuracy:  ${(metrics.accuracy * 100).toFixed(2)}%`);
    console.log(`Majority Class Baseline: ${(metrics.baselineMajorityAccuracy * 100).toFixed(2)}%`);
    console.log(`Prev Candle Baseline:    ${(metrics.baselinePrevDirAccuracy * 100).toFixed(2)}%`);
    console.log(`Random Choice Baseline:  ${(metrics.baselineRandomAccuracy * 100).toFixed(2)}%`);
    
    console.log("Confusion Matrix (Predicted \\ Actual):");
    console.log("            UP     DOWN   SIDEWAYS");
    console.log(`UP         ${String(metrics.matrix.UP.UP).padEnd(6)} ${String(metrics.matrix.UP.DOWN).padEnd(6)} ${String(metrics.matrix.UP.SIDEWAYS).padEnd(6)}`);
    console.log(`DOWN       ${String(metrics.matrix.DOWN.UP).padEnd(6)} ${String(metrics.matrix.DOWN.DOWN).padEnd(6)} ${String(metrics.matrix.DOWN.SIDEWAYS).padEnd(6)}`);
    console.log(`SIDEWAYS   ${String(metrics.matrix.SIDEWAYS.UP).padEnd(6)} ${String(metrics.matrix.SIDEWAYS.DOWN).padEnd(6)} ${String(metrics.matrix.SIDEWAYS.SIDEWAYS).padEnd(6)}`);
  }
}

try {
  run();
} catch (e) {
  console.error(e);
}
