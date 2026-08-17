import type { Candle, Timeframe } from "../market/types";
import { computePrediction } from "./mockService";
import type { Direction, EvaluatedPrediction } from "./types";

/** Classifies a realised candle move into a direction class. */
export function classifyMove(open: number, close: number, threshold: number): Direction {
  const move = (close - open) / open;
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
): EvaluatedPrediction[] {
  const minIndex = 60;
  if (candles.length < minIndex + 5) return [];
  const end = candles.length - 2; // last fully closed candle we can score
  const start = Math.max(minIndex, end - maxSamples + 1);
  const out: EvaluatedPrediction[] = [];

  for (let i = start; i <= end; i++) {
    const window = candles.slice(0, i + 1);
    const prediction = computePrediction(window, asset, timeframe);
    const next = candles[i + 1]!;
    const threshold = 0.0004;
    const actualDirection = classifyMove(next.open, next.close, threshold);
    const actualMove = next.close / next.open - 1;
    out.push({
      ...prediction,
      actualDirection,
      actualMove,
      correct: prediction.direction === actualDirection,
    });
  }
  return out.reverse();
}

export interface AccuracyMetrics {
  total: number;
  correct: number;
  incorrect: number;
  accuracy: number;
  upAccuracy: number;
  downAccuracy: number;
  sidewaysAccuracy: number;
  avgProbability: number;
  avgConfidence: number;
  /** matrix[predicted][actual] */
  matrix: Record<Direction, Record<Direction, number>>;
}

const DIRECTIONS: Direction[] = ["UP", "DOWN", "SIDEWAYS"];

export function computeAccuracy(predictions: EvaluatedPrediction[]): AccuracyMetrics {
  const matrix = Object.fromEntries(
    DIRECTIONS.map((d) => [d, Object.fromEntries(DIRECTIONS.map((a) => [a, 0]))]),
  ) as AccuracyMetrics["matrix"];

  let correct = 0;
  let probSum = 0;
  let confSum = 0;
  const scored = predictions.filter((p) => p.actualDirection != null);

  for (const p of scored) {
    matrix[p.direction][p.actualDirection as Direction] += 1;
    if (p.correct) correct += 1;
    probSum +=
      p.direction === "UP"
        ? p.upProbability
        : p.direction === "DOWN"
          ? p.downProbability
          : p.sidewaysProbability;
    confSum += p.confidence;
  }

  const perClass = (d: Direction) => {
    const row = matrix[d];
    const total = DIRECTIONS.reduce((a, k) => a + row[k], 0);
    return total === 0 ? 0 : row[d] / total;
  };

  const total = scored.length;
  return {
    total,
    correct,
    incorrect: total - correct,
    accuracy: total ? correct / total : 0,
    upAccuracy: perClass("UP"),
    downAccuracy: perClass("DOWN"),
    sidewaysAccuracy: perClass("SIDEWAYS"),
    avgProbability: total ? probSum / total : 0,
    avgConfidence: total ? confSum / total : 0,
    matrix,
  };
}
