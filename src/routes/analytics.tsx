import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Bar,
  BarChart,
  Legend,
} from "recharts";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Disclaimer } from "@/components/trading/Disclaimer";
import { ChartTooltip } from "@/components/trading/IndicatorPanes";
import { Panel } from "@/components/trading/Panel";
import { TerminalShell } from "@/components/trading/AppProviders";
import { getMarketDataSource } from "@/lib/market/dataSource";
import { useMarket } from "@/lib/market/MarketProvider";
import { ASSETS, TIMEFRAMES, formatPrice, type Timeframe, type Candle } from "@/lib/market/types";
import { usePaper } from "@/lib/paper/PaperProvider";
import { computeAccuracy, evaluateHistory } from "@/lib/prediction/backtest";
import { analyzePredictionHistory } from "@/lib/prediction/analytics";
import type { Direction } from "@/lib/prediction/types";
import { cn } from "@/lib/utils";
import { ShieldCheck, ShieldAlert, Zap, TrendingUp, AlertTriangle } from "lucide-react";

const title = "Dream Analytics — Prediction Accuracy & Paper Performance";
const description =
  "Walk-forward prediction accuracy, confusion matrix, equity curve and drawdown analytics for the Dream next-candle research model.";

export const Route = createFileRoute("/analytics")({
  head: () => ({
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
    ],
  }),
  component: AnalyticsPage,
});

const RANGES = [
  { value: "50", label: "Last 50 bars" },
  { value: "120", label: "Last 120 bars" },
  { value: "250", label: "Last 250 bars" },
];

const DIRECTIONS: Direction[] = ["UP", "DOWN", "SIDEWAYS"];

function AnalyticsPage() {
  return (
    <TerminalShell>
      <AnalyticsContent />
    </TerminalShell>
  );
}

function AnalyticsContent() {
  const { symbol, timeframe } = useMarket();
  const { account, stats: paperStats } = usePaper();
  const [asset, setAsset] = useState(symbol);
  const [tf, setTf] = useState<Timeframe>(timeframe);
  const [range, setRange] = useState("120");
  const [candles, setCandles] = useState<Candle[]>([]);
  const [loading, setLoading] = useState(true);

  // Sync state when global market selections change in top navigation
  useEffect(() => {
    setAsset(symbol);
  }, [symbol]);

  useEffect(() => {
    setTf(timeframe);
  }, [timeframe]);

  // Load real Yahoo Finance / Binance candles dynamically
  useEffect(() => {
    let active = true;
    setLoading(true);
    const source = getMarketDataSource();
    const count = Math.max(400, Number(range) + 80);

    source.getCandles(asset, tf, count)
      .then((data) => {
        if (!active) return;
        setCandles(data);
        setLoading(false);
      })
      .catch((err) => {
        console.error("Failed to load candles in analytics:", err);
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [asset, tf, range]);

  const evaluated = useMemo(() => {
    if (candles.length === 0) return [];
    return evaluateHistory(candles, asset, tf, Number(range));
  }, [candles, asset, tf, range]);

  const metrics = useMemo(() => computeAccuracy(evaluated), [evaluated]);
  const deepStats = useMemo(() => analyzePredictionHistory(evaluated), [evaluated]);

  const equityData = useMemo(() => {
    const history = [...account.equityHistory, { time: Math.floor(Date.now() / 1000), equity: paperStats.equity }];
    let peak = history[0]?.equity ?? account.startingBalance;
    return history.map((point, i) => {
      peak = Math.max(peak, point.equity);
      return {
        label: i === 0 ? "start" : new Date(point.time * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        equity: Number(point.equity.toFixed(2)),
        drawdown: Number((((point.equity - peak) / peak) * 100).toFixed(2)),
      };
    });
  }, [account.equityHistory, account.startingBalance, paperStats.equity]);

  const accuracyBuckets = useMemo(
    () =>
      DIRECTIONS.map((d) => ({
        name: d,
        accuracy: Number((metrics.matrix[d][d] / (DIRECTIONS.reduce((a, k) => a + metrics.matrix[d][k], 0) || 1) * 100).toFixed(1)),
      })),
    [metrics],
  );

  const baselineData = useMemo(() => [
    { name: "ML Ensemble", accuracy: Number((metrics.accuracy * 100).toFixed(1)) },
    { name: "Majority Class", accuracy: Number((metrics.baselineMajorityAccuracy * 100).toFixed(1)) },
    { name: "Prev Candle", accuracy: Number((metrics.baselinePrevDirAccuracy * 100).toFixed(1)) },
    { name: "Momentum", accuracy: Number((metrics.baselineMomentumAccuracy * 100).toFixed(1)) },
    { name: "Random", accuracy: Number((metrics.baselineRandomAccuracy * 100).toFixed(1)) },
  ], [metrics]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div>
          <h1 className="text-sm font-semibold">Analytics & Model Performance</h1>
          <p className="text-[11px] text-muted-foreground">
            Walk-forward chronological backtesting metrics for the Walk-Forward Softmax Ensemble.
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Select value={asset} onValueChange={setAsset}>
            <SelectTrigger className="h-8 w-[132px] num text-xs" aria-label="Asset filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ASSETS.map((a) => (
                <SelectItem key={a.symbol} value={a.symbol} className="num text-xs">
                  {a.symbol}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={tf} onValueChange={(v) => setTf(v as Timeframe)}>
            <SelectTrigger className="h-8 w-[84px] num text-xs" aria-label="Timeframe filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIMEFRAMES.map((t) => (
                <SelectItem key={t.value} value={t.value} className="num text-xs">
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={range} onValueChange={setRange}>
            <SelectTrigger className="h-8 w-[132px] text-xs" aria-label="Date range">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RANGES.map((r) => (
                <SelectItem key={r.value} value={r.value} className="text-xs">
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {loading ? (
        <div className="flex h-[450px] items-center justify-center rounded-lg border border-panel-border bg-[#161b26]/50 backdrop-blur-xs">
          <div className="flex flex-col items-center gap-2">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <p className="text-xs text-muted-foreground">Evaluating model performance...</p>
          </div>
        </div>
      ) : evaluated.length === 0 ? (
        <div className="flex h-[450px] items-center justify-center rounded-lg border border-panel-border bg-[#161b26]/50">
          <p className="text-xs text-muted-foreground text-center px-4">
            Insufficient candle history to run backtest.<br />
            Please try another symbol or timeframe.
          </p>
        </div>
      ) : (
        <>
          {/* KPI Row */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
            <KpiCard label="Overall accuracy" value={`${(metrics.accuracy * 100).toFixed(1)}%`} />
            <KpiCard label="Brier Score (Cal.)" value={metrics.brierScore.toFixed(4)} sub="lower is better" />
            <KpiCard label="Log Loss (Entropy)" value={metrics.logLoss.toFixed(4)} sub="lower is better" />
            <KpiCard label="Total predictions" value={`${metrics.total}`} />
            <KpiCard label="Correct / incorrect" value={`${metrics.correct} / ${metrics.incorrect}`} />
            <KpiCard
              label="Avg confidence"
              value={`${(metrics.avgConfidence * 100).toFixed(0)}%`}
              sub={`trades: ${metrics.tradesCount} / no: ${metrics.noSignalsCount}`}
            />
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            {/* Confusion Matrix Panel */}
            <Panel title="Confusion matrix (predicted vs actual)" bodyClassName="p-3">
              <div className="overflow-x-auto">
                <table className="w-full num text-[11px]">
                  <thead>
                    <tr>
                      <th className="label-xs py-1 text-left">Pred ↓ / Act →</th>
                      {DIRECTIONS.map((d) => (
                        <th key={d} className="label-xs py-1 text-right">
                          {d}
                        </th>
                      ))}
                      <th className="label-xs py-1 text-right">Precision</th>
                      <th className="label-xs py-1 text-right">Recall</th>
                      <th className="label-xs py-1 text-right">F1</th>
                    </tr>
                  </thead>
                  <tbody>
                    {DIRECTIONS.map((pred) => (
                      <tr key={pred} className="border-t border-panel-border">
                        <td className="py-1.5 font-semibold text-muted-foreground">{pred}</td>
                        {DIRECTIONS.map((act) => {
                          const value = metrics.matrix[pred][act];
                          const hit = pred === act;
                          return (
                            <td
                              key={act}
                              className={cn(
                                "py-1.5 text-right font-semibold",
                                hit ? "text-bull" : value > 0 ? "text-bear" : "text-muted-foreground",
                              )}
                            >
                              {value}
                            </td>
                          );
                        })}
                        <td className="py-1.5 text-right text-foreground font-semibold">
                          {(metrics.precision[pred] * 100).toFixed(1)}%
                        </td>
                        <td className="py-1.5 text-right text-foreground">
                          {(metrics.recall[pred] * 100).toFixed(1)}%
                        </td>
                        <td className="py-1.5 text-right text-primary">
                          {metrics.f1[pred].toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-3 h-[100px]">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={accuracyBuckets} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                    <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 9, fill: "var(--muted-foreground)" }} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 9, fill: "var(--muted-foreground)" }} width={34} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="accuracy" radius={[2, 2, 0, 0]}>
                      {accuracyBuckets.map((b) => (
                        <Cell
                          key={b.name}
                          fill={b.name === "UP" ? "var(--bull)" : b.name === "DOWN" ? "var(--bear)" : "var(--neutral)"}
                        />
                      ))}
                    </Bar>
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </Panel>

            {/* Paper Performance Summary */}
            <Panel title="Paper Trading Metrics" bodyClassName="p-3">
              <div className="grid grid-cols-3 gap-2">
                <KpiCard label="Account Balance" value={`$${formatPrice(account.balance, 2)}`} compact />
                <KpiCard
                  label="Simulation Return"
                  value={`${metrics.avgReturn >= 0 ? "+" : ""}${(metrics.avgReturn * 100 * metrics.tradesCount).toFixed(2)}%`}
                  tone={metrics.avgReturn >= 0 ? "bull" : "bear"}
                  compact
                />
                <KpiCard label="Backtest Win rate" value={`${(metrics.winRate * 100).toFixed(1)}%`} compact />
                <KpiCard label="Backtest Signals" value={`${metrics.tradesCount}`} compact />
                <KpiCard label="Simulated Drawdown" value={`${(metrics.maxDrawdown * 100).toFixed(2)}%`} tone="bear" compact />
                <KpiCard
                  label="Profit Factor"
                  value={metrics.profitFactor.toFixed(2)}
                  tone={metrics.profitFactor >= 1.0 ? "bull" : "bear"}
                  compact
                />
              </div>
              <p className="label-xs mt-3 mb-1">Equity Curve</p>
              <div className="h-[90px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={equityData} margin={{ top: 4, right: 4, bottom: 0, left: -12 }}>
                    <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 9, fill: "var(--muted-foreground)" }} minTickGap={30} />
                    <YAxis domain={["auto", "auto"]} tick={{ fontSize: 9, fill: "var(--muted-foreground)" }} width={48} />
                    <Tooltip content={<ChartTooltip />} />
                    <Area
                      type="monotone"
                      dataKey="equity"
                      stroke="var(--primary)"
                      fill="var(--primary)"
                      fillOpacity={0.12}
                      strokeWidth={1.4}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Panel>
          </div>

          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {/* Baselines Panel */}
            <Panel title="Model Benchmarks vs Baselines" bodyClassName="p-3 flex flex-col justify-between">
              <div className="space-y-2">
                <p className="text-[10px] text-muted-foreground">
                  Comparison of ML walk-forward ensembling against heuristic default baselines over identical ranges.
                </p>
                <div className="space-y-1.5">
                  {baselineData.map((b) => {
                    const diff = b.accuracy - baselineData[4]!.accuracy; // Diff from random baseline
                    return (
                      <div key={b.name} className="flex items-center justify-between text-xs">
                        <span className={b.name === "ML Ensemble" ? "font-bold text-foreground" : "text-muted-foreground"}>
                          {b.name}
                        </span>
                        <div className="flex items-center gap-2 num">
                          <span className={b.name === "ML Ensemble" ? "font-bold text-primary" : "text-foreground"}>
                            {b.accuracy}%
                          </span>
                          {b.name !== "Random" && (
                            <span className={diff >= 0 ? "text-bull text-[10px]" : "text-bear text-[10px]"}>
                              {diff >= 0 ? "+" : ""}{diff.toFixed(1)}%
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="mt-3 h-[110px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={baselineData} margin={{ top: 5, right: 5, left: -25, bottom: 5 }}>
                    <CartesianGrid stroke="rgba(255,255,255,0.03)" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 8, fill: "var(--muted-foreground)" }} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 8, fill: "var(--muted-foreground)" }} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="accuracy" fill="var(--muted)" radius={[1, 1, 0, 0]}>
                      {baselineData.map((b, i) => (
                        <Cell key={i} fill={b.name === "ML Ensemble" ? "var(--primary)" : "var(--muted-foreground)"} fillOpacity={0.6} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Panel>

            {/* Confidence Calibration Panel */}
            <Panel title="Confidence Calibration" bodyClassName="p-3">
              <p className="text-[10px] text-muted-foreground mb-2">
                Verifying if higher model confidence scores map to higher actual historical hits.
              </p>
              <div className="overflow-x-auto max-h-[160px]">
                <table className="w-full num text-[10px]">
                  <thead>
                    <tr className="border-b border-panel-border text-muted-foreground text-left">
                      <th className="py-1">Confidence Bucket</th>
                      <th className="py-1 text-right">Predictions</th>
                      <th className="py-1 text-right">Accuracy</th>
                      <th className="py-1 text-right">Calibration Gap</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deepStats.confidenceBuckets.map((b) => {
                      const mid = b.avgConfidence * 100;
                      const acc = b.accuracy * 100;
                      const gap = acc - mid;
                      return (
                        <tr key={b.range} className="border-b border-panel-border/30 hover:bg-accent/20">
                          <td className="py-1">{b.range}</td>
                          <td className="py-1 text-right text-muted-foreground">{b.count}</td>
                          <td className={cn("py-1 text-right font-bold", acc > 50 ? "text-bull" : "text-bear")}>
                            {acc.toFixed(1)}%
                          </td>
                          <td className={cn("py-1 text-right", gap >= 0 ? "text-bull" : "text-bear")}>
                            {gap >= 0 ? "+" : ""}{gap.toFixed(1)}%
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Panel>

            {/* Regime Performance Panel */}
            <Panel title="Performance by Market Regime" bodyClassName="p-3">
              <p className="text-[10px] text-muted-foreground mb-2">
                Accuracy breakdown by structural price and volatility regimes.
              </p>
              <div className="overflow-x-auto max-h-[160px]">
                <table className="w-full num text-[10px]">
                  <thead>
                    <tr className="border-b border-panel-border text-muted-foreground text-left">
                      <th className="py-1">Market Regime / Volatility</th>
                      <th className="py-1 text-right">Samples</th>
                      <th className="py-1 text-right">Accuracy</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.keys(deepStats.regimePerformance).map((reg) => {
                      const r = deepStats.regimePerformance[reg]!;
                      return (
                        <tr key={reg} className="border-b border-panel-border/30 hover:bg-accent/20">
                          <td className="py-1 font-medium">{reg.replace("_", " ")}</td>
                          <td className="py-1 text-right text-muted-foreground">{r.count}</td>
                          <td className="py-1 text-right font-bold text-foreground">
                            {(r.accuracy * 100).toFixed(1)}%
                          </td>
                        </tr>
                      );
                    })}
                    {Object.keys(deepStats.volatilityPerformance).map((vol) => {
                      const v = deepStats.volatilityPerformance[vol]!;
                      return (
                        <tr key={vol} className="border-b border-panel-border/30 hover:bg-accent/20">
                          <td className="py-1 text-primary">{vol} VOLATILITY</td>
                          <td className="py-1 text-right text-muted-foreground">{v.count}</td>
                          <td className="py-1 text-right font-bold text-primary">
                            {(v.accuracy * 100).toFixed(1)}%
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Panel>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            {/* Streak Performance & Common Failures */}
            <Panel title="Model Streaks & Failure Diagnostics" bodyClassName="p-3">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="label-xs mb-1.5 text-muted-foreground">Streak accuracy (accuracy following directional prediction)</p>
                  <div className="space-y-1 text-[11px] num">
                    <div className="flex justify-between">
                      <span>After UP prediction:</span>
                      <span className="font-bold text-bull">
                        {(deepStats.consecutiveUpPerformance.accuracy * 100).toFixed(1)}% (N={deepStats.consecutiveUpPerformance.count})
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>After DOWN prediction:</span>
                      <span className="font-bold text-bear">
                        {(deepStats.consecutiveDownPerformance.accuracy * 100).toFixed(1)}% (N={deepStats.consecutiveDownPerformance.count})
                      </span>
                    </div>
                  </div>
                </div>
                <div>
                  <p className="label-xs mb-1.5 text-muted-foreground flex items-center gap-1">
                    <AlertTriangle className="size-3 text-bear" /> Common Failure Patterns (Confidence &ge; 70%)
                  </p>
                  <div className="space-y-1 text-[10px] num text-muted-foreground">
                    <div className="flex justify-between">
                      <span>High-Conf UP &rarr; Actual DOWN:</span>
                      <span className="font-semibold text-bear">{deepStats.failurePatterns.highConfUp_actualDown}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>High-Conf UP &rarr; Actual SIDEWAYS:</span>
                      <span className="font-semibold text-foreground">{deepStats.failurePatterns.highConfUp_actualSideways}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>High-Conf DOWN &rarr; Actual UP:</span>
                      <span className="font-semibold text-bull">{deepStats.failurePatterns.highConfDown_actualUp}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>High-Conf DOWN &rarr; Actual SIDEWAYS:</span>
                      <span className="font-semibold text-foreground">{deepStats.failurePatterns.highConfDown_actualSideways}</span>
                    </div>
                  </div>
                </div>
              </div>
            </Panel>

            <Disclaimer />
          </div>

          {/* Scored Predictions Table */}
          <Panel
            title={`Walk-Forward Logs — ${asset} ${tf}`}
            action={<Badge variant="outline" className="border-panel-border text-[10px]">{evaluated.length} scored</Badge>}
            bodyClassName="p-0"
          >
            <div className="max-h-[350px] overflow-auto">
              <table className="w-full num text-[11px]">
                <thead className="sticky top-0 bg-panel border-b border-panel-border">
                  <tr>
                    {["Time", "Price", "Predicted", "UP", "DOWN", "SIDE", "Conf", "Signal", "Regime", "Actual", "Outcome"].map((h) => (
                      <th key={h} className="label-xs px-3 py-1.5 text-right first:text-left">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {evaluated.map((p) => (
                    <tr key={p.id} className="border-b border-panel-border/60 hover:bg-accent/40">
                      <td className="px-3 py-1.5 text-muted-foreground">
                        {new Date(p.timestamp * 1000).toLocaleString("en-US", {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </td>
                      <td className="px-3 py-1.5 text-right">{formatPrice(p.currentPrice, 2)}</td>
                      <td className={cn("px-3 py-1.5 text-right font-semibold", toneClass(p.direction))}>
                        {p.direction}
                      </td>
                      <td className="px-3 py-1.5 text-right text-muted-foreground">{(p.upProbability * 100).toFixed(1)}</td>
                      <td className="px-3 py-1.5 text-right text-muted-foreground">{(p.downProbability * 100).toFixed(1)}</td>
                      <td className="px-3 py-1.5 text-right text-muted-foreground">
                        {(p.sidewaysProbability * 100).toFixed(1)}
                      </td>
                      <td className="px-3 py-1.5 text-right">{(p.confidence * 100).toFixed(0)}%</td>
                      <td className="px-3 py-1.5 text-right">
                        <span className={p.signal === "TRADE" ? "text-bull font-bold" : "text-muted-foreground"}>
                          {p.signal}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 text-right text-muted-foreground text-[10px] truncate max-w-[80px]">
                        {p.regime}
                      </td>
                      <td className={cn("px-3 py-1.5 text-right", toneClass(p.actualDirection))}>
                        {p.actualDirection ?? "—"}
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        <span className={p.correct ? "text-bull" : "text-bear font-semibold"}>{p.correct ? "HIT" : "MISS"}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </>)}
    </div>
  );
}

function toneClass(direction: Direction | null) {
  if (direction === "UP") return "text-bull";
  if (direction === "DOWN") return "text-bear";
  return "text-neutral";
}

function KpiCard({
  label,
  value,
  sub,
  tone,
  compact,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "bull" | "bear";
  compact?: boolean;
}) {
  return (
    <div className={cn("panel px-2.5", compact ? "py-1.5" : "py-2")}>
      <p className="label-xs truncate">{label}</p>
      <p
        className={cn(
          "num mt-0.5 truncate font-semibold",
          compact ? "text-[12px]" : "text-[13px]",
          tone === "bull" && "text-bull",
          tone === "bear" && "text-bear",
        )}
      >
        {value}
      </p>
      {sub && <p className="num truncate text-[10px] text-muted-foreground">{sub}</p>}
    </div>
  );
}
