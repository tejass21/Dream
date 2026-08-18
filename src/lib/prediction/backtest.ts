import type { Candle, Timeframe } from "../market/types";
import { computePrediction, trainEnsemble, predictWithEnsemble } from "./mockService";
import type { Direction, EvaluatedPrediction } from "./types";
import { realizedVolatility } from "../market/indicators";
import { analyzePredictionHistory } from "./analytics";

/** Classifies a realised candle move into a direction class based on previous close. */
export function classifyMove(currentClose: number, futureClose: number, threshold: number): Direction {
  const move = (futureClose - currentClose) / currentClose;
  if (move > threshold) return "UP";
  if (move < -threshold) return "DOWN";
  return "SIDEWAYS";
}

/**
 * Walk-forward evaluation of the current prediction service over the loaded
 * candle history. Each prediction uses only data available up to that bar and is
 * scored against the following (already closed) bar.
 */
export function evaluateHistory(
  candles: Candle[],
  asset: string,
  timeframe: Timeframe,
  maxSamples = 120,
  k = 0.5, // configurable volatility factor
): EvaluatedPrediction[] {
  const minIndex = 60;
  if (candles.length < minIndex + 5) return [];
  const end = candles.length - 2; // last fully closed candle we can score
  const start = Math.max(minIndex, end - maxSamples + 1);
  const out: EvaluatedPrediction[] = [];

  // Train the ensemble ONCE on all data available up to the end index
  const trainingData = candles.slice(0, end + 1);
  const ensemble = trainEnsemble(trainingData, timeframe, k);

  for (let i = start; i <= end; i++) {
    const window = candles.slice(0, i + 1);
    
    // Calculate target using volatility-adjusted threshold
    const volPct = realizedVolatility(window, 20); // realized vol in percent
    const threshold = (k * volPct) / 100; // in fractional terms
    
    const currentClose = window[window.length - 1]!.close;
    const next = candles[i + 1]!;
    
    // Generate prediction using only the window and the pre-trained ensemble parameters (O(1) inference)
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

export interface ExtendedBacktestMetrics {
  total: number;
  correct: number;
  incorrect: number;
  accuracy: number;
  
  // Class-specific scores
  upAccuracy: number;
  downAccuracy: number;
  sidewaysAccuracy: number;
  
  precision: Record<Direction, number>;
  recall: Record<Direction, number>;
  f1: Record<Direction, number>;
  
  avgProbability: number;
  avgConfidence: number;
  matrix: Record<Direction, Record<Direction, number>>;
  
  // Calibration
  brierScore: number;
  logLoss: number;
  
  // Trading performance (based on TRADE signals)
  tradesCount: number;
  noSignalsCount: number;
  winRate: number;
  avgReturn: number;
  profitFactor: number;
  maxDrawdown: number;
  
  // Baselines accuracy
  baselineMajorityAccuracy: number;
  baselinePrevDirAccuracy: number;
  baselineRandomAccuracy: number;
  baselineMomentumAccuracy: number;
}

export function computeAccuracy(predictions: EvaluatedPrediction[]): ExtendedBacktestMetrics {
  const scored = predictions.filter((p) => p.actualDirection != null);
  const total = scored.length;

  // Run our advanced analytics engine first
  const stats = analyzePredictionHistory(predictions);

  let correct = 0;
  let probSum = 0;
  let confSum = 0;

  // Confusion matrix
  const matrix: Record<Direction, Record<Direction, number>> = {
    UP: { UP: 0, DOWN: 0, SIDEWAYS: 0 },
    DOWN: { UP: 0, DOWN: 0, SIDEWAYS: 0 },
    SIDEWAYS: { UP: 0, DOWN: 0, SIDEWAYS: 0 },
  };

  for (const p of scored) {
    matrix[p.direction][p.actualDirection!] += 1;
    if (p.correct) correct += 1;
    probSum +=
      p.direction === "UP"
        ? p.upProbability
        : p.direction === "DOWN"
          ? p.downProbability
          : p.sidewaysProbability;
    confSum += p.confidence;
  }

  // Baseline evaluation
  let baselineMajorityCorrect = 0;
  let baselinePrevDirCorrect = 0;
  let baselineRandomCorrect = 0;
  let baselineMomentumCorrect = 0;

  // Determine majority class in actuals
  const actualCounts = { UP: 0, DOWN: 0, SIDEWAYS: 0 };
  for (const p of scored) {
    actualCounts[p.actualDirection!]++;
  }
  let majorityClass: Direction = "SIDEWAYS";
  if (actualCounts.UP > actualCounts.SIDEWAYS && actualCounts.UP > actualCounts.DOWN) {
    majorityClass = "UP";
  } else if (actualCounts.DOWN > actualCounts.SIDEWAYS && actualCounts.DOWN > actualCounts.UP) {
    majorityClass = "DOWN";
  }

  // Track state for previous direction
  let prevActualDirection: Direction = "SIDEWAYS";

  // Seeds for deterministic random baseline
  let seed = 42;
  const pseudoRand = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };

  // Evaluate baselines in forward order (reverse of scored list)
  const forwardScored = [...scored].reverse();
  for (let i = 0; i < forwardScored.length; i++) {
    const p = forwardScored[i]!;
    const act = p.actualDirection!;

    // 1. Majority
    if (act === majorityClass) baselineMajorityCorrect++;

    // 2. Previous Direction
    if (act === prevActualDirection) baselinePrevDirCorrect++;
    prevActualDirection = act;

    // 3. Random
    const r = pseudoRand();
    const randDir: Direction = r < 0.33 ? "UP" : r < 0.66 ? "DOWN" : "SIDEWAYS";
    if (act === randDir) baselineRandomCorrect++;

    // 4. Momentum (based on 3-bar rolling returns)
    // Heuristic momentum prediction
    let momentumPrediction: Direction = "SIDEWAYS";
    if (p.factors && p.factors.length > 0) {
      const momFactor = p.factors.find(f => f.label.includes("momentum"));
      if (momFactor) {
        momentumPrediction = momFactor.impact === "positive" ? "UP" : "DOWN";
      }
    }
    if (act === momentumPrediction) baselineMomentumCorrect++;
  }

  // Trading Performance Simulations
  let tradesCount = 0;
  let noSignalsCount = 0;
  let tradesCorrect = 0;
  let totalReturn = 0;
  let grossProfit = 0;
  let grossLoss = 0;

  // Equity tracking
  let balance = 10000;
  let peakBalance = 10000;
  let maxDrawdown = 0;

  for (const p of forwardScored) {
    const act = p.actualDirection!;
    const isTrade = p.signal === "TRADE";

    if (!isTrade) {
      noSignalsCount++;
      continue;
    }

    tradesCount++;
    const pred = p.direction;
    const move = p.actualMove ?? 0;
    
    // Simulate trade payout
    let tradeReturn = 0;
    if (pred === "UP") {
      tradeReturn = move; // long profit/loss
      if (act === "UP") tradesCorrect++;
    } else if (pred === "DOWN") {
      tradeReturn = -move; // short profit/loss
      if (act === "DOWN") tradesCorrect++;
    }

    totalReturn += tradeReturn;
    if (tradeReturn > 0) {
      grossProfit += tradeReturn;
    } else {
      grossLoss += Math.abs(tradeReturn);
    }

    // Equity curve math
    balance = balance * (1 + tradeReturn);
    if (balance > peakBalance) {
      peakBalance = balance;
    }
    const dd = (peakBalance - balance) / peakBalance;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  const winRate = tradesCount > 0 ? tradesCorrect / tradesCount : 0;
  const avgReturn = tradesCount > 0 ? totalReturn / tradesCount : 0;
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 99.0 : 1.0;

  const perClass = (d: Direction) => {
    const row = matrix[d];
    const DIRECTIONS_LIST: Direction[] = ["UP", "DOWN", "SIDEWAYS"];
    const totalRow = DIRECTIONS_LIST.reduce((acc: number, key: Direction) => acc + row[key], 0);
    return totalRow === 0 ? 0 : row[d] / totalRow;
  };

  return {
    total,
    correct,
    incorrect: total - correct,
    accuracy: total ? correct / total : 0,
    upAccuracy: perClass("UP"),
    downAccuracy: perClass("DOWN"),
    sidewaysAccuracy: perClass("SIDEWAYS"),
    
    precision: stats.precision,
    recall: stats.recall,
    f1: stats.f1,
    
    avgProbability: total ? probSum / total : 0,
    avgConfidence: total ? confSum / total : 0,
    matrix,
    
    brierScore: stats.brierScore,
    logLoss: stats.logLoss,
    
    tradesCount,
    noSignalsCount,
    winRate,
    avgReturn,
    profitFactor,
    maxDrawdown,
    
    baselineMajorityAccuracy: total ? baselineMajorityCorrect / total : 0,
    baselinePrevDirAccuracy: total ? baselinePrevDirCorrect / total : 0,
    baselineRandomAccuracy: total ? baselineRandomCorrect / total : 0,
    baselineMomentumAccuracy: total ? baselineMomentumCorrect / total : 0,
  };
}
