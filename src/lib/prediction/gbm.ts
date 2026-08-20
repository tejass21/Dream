import type { FeatureSet } from "./ml";

/**
 * Multiclass gradient-boosted regression trees (softmax boosting), the model
 * family that dominates tabular financial prediction. Pure TypeScript, trains
 * in the browser in well under a second on a few thousand samples.
 */

interface TreeNode {
  /** leaf value when featureIndex is null */
  value?: number;
  featureIndex?: number;
  threshold?: number;
  left?: TreeNode;
  right?: TreeNode;
}

interface TreeConfig {
  maxDepth: number;
  minSamplesLeaf: number;
  lambda: number;
  featureSubsample: number;
  seed: number;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Fits one regression tree to (gradient, hessian) pairs using the XGBoost
 * similarity-gain objective. Candidate thresholds are quantile buckets so
 * training stays linear-ish in sample count.
 */
function buildTree(
  X: number[][],
  grad: number[],
  hess: number[],
  indices: number[],
  depth: number,
  cfg: TreeConfig,
  rand: () => number,
  quantiles: number[][],
): TreeNode {
  const sumGrad = indices.reduce((s, i) => s + grad[i]!, 0);
  const sumHess = indices.reduce((s, i) => s + hess[i]!, 0);
  const leafValue = -sumGrad / (sumHess + cfg.lambda);

  if (depth >= cfg.maxDepth || indices.length < cfg.minSamplesLeaf * 2) {
    return { value: leafValue };
  }

  const parentScore = (sumGrad * sumGrad) / (sumHess + cfg.lambda);
  let bestGain = 1e-9;
  let bestFeature = -1;
  let bestThreshold = 0;

  const D = X[0]?.length ?? 0;
  for (let f = 0; f < D; f++) {
    if (rand() > cfg.featureSubsample) continue;
    const cuts = quantiles[f]!;
    for (const threshold of cuts) {
      let gl = 0;
      let hl = 0;
      let nl = 0;
      for (const i of indices) {
        if (X[i]![f]! <= threshold) {
          gl += grad[i]!;
          hl += hess[i]!;
          nl++;
        }
      }
      const nr = indices.length - nl;
      if (nl < cfg.minSamplesLeaf || nr < cfg.minSamplesLeaf) continue;
      const gr = sumGrad - gl;
      const hr = sumHess - hl;
      const gain =
        (gl * gl) / (hl + cfg.lambda) + (gr * gr) / (hr + cfg.lambda) - parentScore;
      if (gain > bestGain) {
        bestGain = gain;
        bestFeature = f;
        bestThreshold = threshold;
      }
    }
  }

  if (bestFeature < 0) return { value: leafValue };

  const leftIdx: number[] = [];
  const rightIdx: number[] = [];
  for (const i of indices) {
    if (X[i]![bestFeature]! <= bestThreshold) leftIdx.push(i);
    else rightIdx.push(i);
  }

  return {
    featureIndex: bestFeature,
    threshold: bestThreshold,
    left: buildTree(X, grad, hess, leftIdx, depth + 1, cfg, rand, quantiles),
    right: buildTree(X, grad, hess, rightIdx, depth + 1, cfg, rand, quantiles),
  };
}

function predictTree(node: TreeNode, x: number[]): number {
  let cur = node;
  while (cur.featureIndex !== undefined) {
    cur = x[cur.featureIndex]! <= cur.threshold! ? cur.left! : cur.right!;
  }
  return cur.value ?? 0;
}

function quantileCuts(X: number[][], featureIndex: number, buckets: number): number[] {
  const values = X.map((row) => row[featureIndex] ?? 0).sort((a, b) => a - b);
  const cuts: number[] = [];
  for (let q = 1; q < buckets; q++) {
    const idx = Math.floor((q / buckets) * (values.length - 1));
    const v = values[idx]!;
    if (cuts[cuts.length - 1] !== v) cuts.push(v);
  }
  return cuts;
}

export interface GBMOptions {
  rounds?: number;
  learningRate?: number;
  maxDepth?: number;
  minSamplesLeaf?: number;
  lambda?: number;
  featureSubsample?: number;
  rowSubsample?: number;
  quantileBuckets?: number;
  seed?: number;
}

/** Multiclass (3-way) gradient boosting classifier with softmax output. */
export class GradientBoostingClassifier {
  private trees: TreeNode[][] = []; // [round][class]
  private base: number[] = [0, 0, 0];
  private learningRate: number;
  private opts: Required<GBMOptions>;
  readonly featureKeys: string[];
  /** total split gain attributed to each feature, for explainability */
  gainByFeature: Record<string, number> = {};

  constructor(featureKeys: string[], options: GBMOptions = {}) {
    this.featureKeys = featureKeys;
    this.opts = {
      rounds: options.rounds ?? 60,
      learningRate: options.learningRate ?? 0.12,
      maxDepth: options.maxDepth ?? 3,
      minSamplesLeaf: options.minSamplesLeaf ?? 20,
      lambda: options.lambda ?? 1.5,
      featureSubsample: options.featureSubsample ?? 0.8,
      rowSubsample: options.rowSubsample ?? 0.85,
      quantileBuckets: options.quantileBuckets ?? 16,
      seed: options.seed ?? 1337,
    };
    this.learningRate = this.opts.learningRate;
  }

  private vec(x: FeatureSet): number[] {
    return this.featureKeys.map((k) => x[k] ?? 0);
  }

  train(X: FeatureSet[], y: number[]): void {
    const N = X.length;
    if (N < 40) return;
    const rows = X.map((x) => this.vec(x));
    const D = this.featureKeys.length;
    const rand = mulberry32(this.opts.seed);

    // class priors as base scores (log-odds style init)
    const counts = [0, 0, 0];
    for (const label of y) counts[label] = (counts[label] ?? 0) + 1;
    this.base = counts.map((c) => Math.log(Math.max(1e-6, c / N)));

    const quantiles: number[][] = [];
    for (let f = 0; f < D; f++) quantiles.push(quantileCuts(rows, f, this.opts.quantileBuckets));

    // running raw scores
    const F: number[][] = rows.map(() => [...this.base]);

    for (let round = 0; round < this.opts.rounds; round++) {
      // softmax probabilities per sample
      const probs: number[][] = F.map((scores) => {
        const max = Math.max(...scores);
        const exps = scores.map((s) => Math.exp(s - max));
        const sum = exps.reduce((a, b) => a + b, 0) || 1;
        return exps.map((e) => e / sum);
      });

      const roundTrees: TreeNode[] = [];
      for (let c = 0; c < 3; c++) {
        const grad = new Array<number>(N);
        const hess = new Array<number>(N);
        for (let i = 0; i < N; i++) {
          const p = probs[i]![c]!;
          const target = y[i] === c ? 1 : 0;
          grad[i] = p - target;
          hess[i] = Math.max(1e-6, 2 * p * (1 - p));
        }

        const indices: number[] = [];
        for (let i = 0; i < N; i++) if (rand() <= this.opts.rowSubsample) indices.push(i);
        if (indices.length < this.opts.minSamplesLeaf * 2) {
          roundTrees.push({ value: 0 });
          continue;
        }

        const tree = buildTree(rows, grad, hess, indices, 0, this.opts, rand, quantiles);
        roundTrees.push(tree);

        for (let i = 0; i < N; i++) {
          F[i]![c] = F[i]![c]! + this.learningRate * predictTree(tree, rows[i]!);
        }
      }
      this.trees.push(roundTrees);
    }

    this.computeGains(rows);
  }

  private computeGains(rows: number[][]): void {
    const gains: Record<string, number> = {};
    const walk = (node: TreeNode, samples: number) => {
      if (node.featureIndex === undefined) return;
      const key = this.featureKeys[node.featureIndex] ?? String(node.featureIndex);
      gains[key] = (gains[key] ?? 0) + samples;
      walk(node.left!, samples / 2);
      walk(node.right!, samples / 2);
    };
    for (const round of this.trees) for (const tree of round) walk(tree, rows.length);
    const total = Object.values(gains).reduce((a, b) => a + b, 0) || 1;
    for (const k of Object.keys(gains)) gains[k] = gains[k]! / total;
    this.gainByFeature = gains;
  }

  rawScores(x: FeatureSet): number[] {
    const v = this.vec(x);
    const scores = [...this.base];
    for (const round of this.trees) {
      for (let c = 0; c < 3; c++) {
        scores[c] = scores[c]! + this.learningRate * predictTree(round[c]!, v);
      }
    }
    return scores;
  }

  predictProbs(x: FeatureSet, temperature = 1): number[] {
    const scaled = this.rawScores(x).map((s) => s / (temperature || 1));
    const max = Math.max(...scaled);
    const exps = scaled.map((s) => Math.exp(s - max));
    const sum = exps.reduce((a, b) => a + b, 0) || 1;
    return exps.map((e) => e / sum);
  }

  get isTrained(): boolean {
    return this.trees.length > 0;
  }
}

/** Grid-searches a temperature that minimises validation log-loss. */
export function tuneGbmTemperature(
  model: GradientBoostingClassifier,
  X: FeatureSet[],
  y: number[],
): number {
  if (X.length === 0 || !model.isTrained) return 1;
  let best = 1;
  let bestLoss = Infinity;
  for (let T = 0.4; T <= 3.0; T += 0.05) {
    let loss = 0;
    for (let i = 0; i < X.length; i++) {
      const p = model.predictProbs(X[i]!, T);
      loss -= Math.log(Math.max(1e-12, p[y[i]!]!));
    }
    loss /= X.length;
    if (loss < bestLoss) {
      bestLoss = loss;
      best = T;
    }
  }
  return best;
}
