import { generateCandles } from "../src/lib/market/dataSource.ts";
import { computePrediction } from "../src/lib/prediction/mockService.ts";

const niftyCandles = generateCandles("NIFTY", "5m", 250);
const prediction = computePrediction(niftyCandles, "NIFTY", "5m");

console.log("=== NIFTY MODEL VERIFICATION ===");
console.log("Asset Name:     ", prediction.asset);
console.log("Current Price:  ", prediction.currentPrice);
console.log("Prediction:     ", prediction.direction);
console.log("UP Probability: ", (prediction.upProbability * 100).toFixed(2) + "%");
console.log("DOWN Probability:", (prediction.downProbability * 100).toFixed(2) + "%");
console.log("Confidence:     ", (prediction.confidence * 100).toFixed(0) + "%");
console.log("Model ID:       ", prediction.modelId);
console.log("Model Version:  ", prediction.modelVersion);
