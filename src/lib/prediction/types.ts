import type { Candle, Timeframe } from "../market/types";

export type Direction = "UP" | "DOWN" | "SIDEWAYS";

export interface PredictionFactor {
  label: string;
  impact: "positive" | "negative" | "neutral";
  /** 0..1 relative weight of the feature in this prediction */
  weight: number;
  detail?: string;
}

export interface Prediction {
  id: string;
  asset: string;
  timeframe: Timeframe;
  /** candle open time (unix seconds) the prediction was made for */
  timestamp: number;
  currentPrice: number;
  direction: Direction;
  upProbability: number;
  downProbability: number;
  sidewaysProbability: number;
  /** 0..1 */
  confidence: number;
  /** fractional expected move, e.g. 0.0021 = +0.21% */
  expectedMove: number;
  factors: PredictionFactor[];
  modelId: string;
  modelKind: "heuristic-mock" | "ml";
  // Advanced Quant Fields
  expectedVolatility?: number;
  regime?: string;
  signal?: "TRADE" | "NO_SIGNAL";
  modelAgreement?: string;
  modelVersion?: string;
  /** honest out-of-sample metrics from the purged validation split */
  validation?: {
    samples: number;
    accuracy: number;
    logLoss: number;
    brier: number;
    highConfidenceAccuracy: number;
    highConfidenceShare: number;
    edgeThreshold: number;
  };
  trainingSamples?: number;
  /** top gain-ranked features from the boosted-tree model */
  featureImportance?: { key: string; weight: number }[];
}


export interface PredictionRequest {
  asset: string;
  timeframe: Timeframe;
  candles: Candle[];
}

export interface TradingDecision {
  signal: "TRADE" | "NO_SIGNAL";
  direction: Direction;
  positionSize: number; // percentage or notional
  stopLoss: number | null;
  takeProfit: number | null;
  reason: string;
}

export interface PredictionService {
  readonly modelId: string;
  readonly modelKind: "heuristic-mock" | "ml";
  predict(request: PredictionRequest): Promise<Prediction>;
}

export interface EvaluatedPrediction extends Prediction {
  actualDirection: Direction | null;
  correct: boolean | null;
  actualMove: number | null;
}
