import type { EvaluatedPrediction, Direction } from "./types";

export interface AnalyticsSummary {
  overallAccuracy: number;
  totalPredictions: number;
  correctCount: number;
  incorrectCount: number;

  // Class-specific precision & recall
  precision: Record<Direction, number>;
  recall: Record<Direction, number>;
  f1: Record<Direction, number>;

  // Probability and calibration
  brierScore: number;
  logLoss: number;
  confidenceBuckets: Array<{
    range: string;
    count: number;
    accuracy: number;
    avgConfidence: number;
  }>;

  // Context breakdowns
  regimePerformance: Record<string, { count: number; accuracy: number }>;
  volatilityPerformance: Record<string, { count: number; accuracy: number }>;
  timeOfDayPerformance: Record<string, { count: number; accuracy: number }>;

  // Streak/Consecutive prediction behaviors
  consecutiveUpPerformance: { count: number; accuracy: number };
  consecutiveDownPerformance: { count: number; accuracy: number };

  // Common failures counts
  failurePatterns: {
    highConfUp_actualDown: number;
    highConfUp_actualSideways: number;
    highConfDown_actualUp: number;
    highConfDown_actualSideways: number;
  };
}

const DIRECTIONS: Direction[] = ["UP", "DOWN", "SIDEWAYS"];

export function analyzePredictionHistory(predictions: EvaluatedPrediction[]): AnalyticsSummary {
  const scored = predictions.filter((p) => p.actualDirection != null);
  const total = scored.length;

  let correct = 0;
  let brierSum = 0;
  let logLossSum = 0;

  // Confusion matrix & counters
  const confusion: Record<Direction, Record<Direction, number>> = {
    UP: { UP: 0, DOWN: 0, SIDEWAYS: 0 },
    DOWN: { UP: 0, DOWN: 0, SIDEWAYS: 0 },
    SIDEWAYS: { UP: 0, DOWN: 0, SIDEWAYS: 0 },
  };

  const actualCounts: Record<Direction, number> = { UP: 0, DOWN: 0, SIDEWAYS: 0 };
  const predictedCounts: Record<Direction, number> = { UP: 0, DOWN: 0, SIDEWAYS: 0 };

  // Volatility, regime, and time of day groups
  const regimeStats: Record<string, { total: number; correct: number }> = {};
  const volStats: Record<string, { total: number; correct: number }> = {};
  const timeStats: Record<string, { total: number; correct: number }> = {};

  // Confidence buckets: 0-50, 50-60, 60-70, 70-80, 80-90, 90-100
  const buckets = [
    { label: "0-50%", min: 0.0, max: 0.5, total: 0, correct: 0, confSum: 0 },
    { label: "50-60%", min: 0.5, max: 0.6, total: 0, correct: 0, confSum: 0 },
    { label: "60-70%", min: 0.6, max: 0.7, total: 0, correct: 0, confSum: 0 },
    { label: "70-80%", min: 0.7, max: 0.8, total: 0, correct: 0, confSum: 0 },
    { label: "80-90%", min: 0.8, max: 0.9, total: 0, correct: 0, confSum: 0 },
    { label: "90%+", min: 0.9, max: 1.01, total: 0, correct: 0, confSum: 0 },
  ];

  // Streaks
  let consecutiveUpCount = 0;
  let consecutiveUpCorrect = 0;
  let consecutiveDownCount = 0;
  let consecutiveDownCorrect = 0;

  // Failures
  let highConfUp_actualDown = 0;
  let highConfUp_actualSideways = 0;
  let highConfDown_actualUp = 0;
  let highConfDown_actualSideways = 0;

  for (let i = 0; i < total; i++) {
    const p = scored[i]!;
    const pred = p.direction;
    const act = p.actualDirection!;
    const isCorrect = pred === act;

    if (isCorrect) correct++;

    // Matrix
    confusion[pred][act]++;
    actualCounts[act]++;
    predictedCounts[pred]++;

    // Brier Score & Log Loss
    const pUp = p.upProbability;
    const pDown = p.downProbability;
    const pSideways = p.sidewaysProbability;

    const yUp = act === "UP" ? 1 : 0;
    const yDown = act === "DOWN" ? 1 : 0;
    const ySideways = act === "SIDEWAYS" ? 1 : 0;

    brierSum += (pUp - yUp) ** 2 + (pDown - yDown) ** 2 + (pSideways - ySideways) ** 2;

    const actProb = act === "UP" ? pUp : act === "DOWN" ? pDown : pSideways;
    logLossSum -= Math.log(Math.max(1e-15, actProb));

    // Confidence buckets
    const conf = p.confidence;
    for (const b of buckets) {
      if (conf >= b.min && conf < b.max) {
        b.total++;
        b.confSum += conf;
        if (isCorrect) b.correct++;
        break;
      }
    }

    // Regimes
    const regime = p.regime || "UNKNOWN";
    if (!regimeStats[regime]) regimeStats[regime] = { total: 0, correct: 0 };
    regimeStats[regime].total++;
    if (isCorrect) regimeStats[regime].correct++;

    // Volatility (realizedVol / expectedVolatility)
    const vol = p.expectedVolatility != null ? (p.expectedVolatility > 0.0015 ? "HIGH" : "LOW") : "NORMAL";
    if (!volStats[vol]) volStats[vol] = { total: 0, correct: 0 };
    volStats[vol].total++;
    if (isCorrect) volStats[vol].correct++;

    // Time of day
    const hour = Math.floor((p.timestamp % 86400) / 3600);
    const timeLabel = hour >= 9 && hour < 16 ? "MARKET_HOURS" : "OFF_HOURS";
    if (!timeStats[timeLabel]) timeStats[timeLabel] = { total: 0, correct: 0 };
    timeStats[timeLabel].total++;
    if (isCorrect) timeStats[timeLabel].correct++;

    // Consecutive signals (check preceding prediction history in original list)
    // scored is sorted in reverse (index 0 is most recent). So index i + 1 is the previous prediction.
    if (i + 1 < total) {
      const prev1 = scored[i + 1]!;
      if (prev1.direction === "UP") {
        consecutiveUpCount++;
        if (isCorrect) consecutiveUpCorrect++;
      } else if (prev1.direction === "DOWN") {
        consecutiveDownCount++;
        if (isCorrect) consecutiveDownCorrect++;
      }
    }

    // Failures
    if (conf >= 0.7) {
      if (pred === "UP" && act === "DOWN") highConfUp_actualDown++;
      if (pred === "UP" && act === "SIDEWAYS") highConfUp_actualSideways++;
      if (pred === "DOWN" && act === "UP") highConfDown_actualUp++;
      if (pred === "DOWN" && act === "SIDEWAYS") highConfDown_actualSideways++;
    }
  }

  // Calculate Precision, Recall, F1 for each class
  const precision: Record<Direction, number> = { UP: 0, DOWN: 0, SIDEWAYS: 0 };
  const recall: Record<Direction, number> = { UP: 0, DOWN: 0, SIDEWAYS: 0 };
  const f1: Record<Direction, number> = { UP: 0, DOWN: 0, SIDEWAYS: 0 };

  for (const d of DIRECTIONS) {
    const tp = confusion[d][d];
    const fp = predictedCounts[d] - tp;
    const fn = actualCounts[d] - tp;

    precision[d] = tp + fp > 0 ? tp / (tp + fp) : 0;
    recall[d] = tp + fn > 0 ? tp / (tp + fn) : 0;
    f1[d] = precision[d] + recall[d] > 0 ? (2 * precision[d] * recall[d]) / (precision[d] + recall[d]) : 0;
  }

  // Map regimes, vol, time stats to output records
  const regimePerformance: Record<string, { count: number; accuracy: number }> = {};
  for (const k of Object.keys(regimeStats)) {
    const s = regimeStats[k]!;
    regimePerformance[k] = { count: s.total, accuracy: s.total > 0 ? s.correct / s.total : 0 };
  }

  const volatilityPerformance: Record<string, { count: number; accuracy: number }> = {};
  for (const k of Object.keys(volStats)) {
    const s = volStats[k]!;
    volatilityPerformance[k] = { count: s.total, accuracy: s.total > 0 ? s.correct / s.total : 0 };
  }

  const timeOfDayPerformance: Record<string, { count: number; accuracy: number }> = {};
  for (const k of Object.keys(timeStats)) {
    const s = timeStats[k]!;
    timeOfDayPerformance[k] = { count: s.total, accuracy: s.total > 0 ? s.correct / s.total : 0 };
  }

  return {
    overallAccuracy: total > 0 ? correct / total : 0,
    totalPredictions: total,
    correctCount: correct,
    incorrectCount: total - correct,
    precision,
    recall,
    f1,
    brierScore: total > 0 ? brierSum / total : 0,
    logLoss: total > 0 ? logLossSum / total : 0,
    confidenceBuckets: buckets.map((b) => ({
      range: b.label,
      count: b.total,
      accuracy: b.total > 0 ? b.correct / b.total : 0,
      avgConfidence: b.total > 0 ? b.confSum / b.total : 0,
    })),
    regimePerformance,
    volatilityPerformance,
    timeOfDayPerformance,
    consecutiveUpPerformance: {
      count: consecutiveUpCount,
      accuracy: consecutiveUpCount > 0 ? consecutiveUpCorrect / consecutiveUpCount : 0,
    },
    consecutiveDownPerformance: {
      count: consecutiveDownCount,
      accuracy: consecutiveDownCount > 0 ? consecutiveDownCorrect / consecutiveDownCount : 0,
    },
    failurePatterns: {
      highConfUp_actualDown,
      highConfUp_actualSideways,
      highConfDown_actualUp,
      highConfDown_actualSideways,
    },
  };
}
