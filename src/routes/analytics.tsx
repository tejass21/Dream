import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
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
import { generateCandles } from "@/lib/market/dataSource";
import { useMarket } from "@/lib/market/MarketProvider";
import { ASSETS, TIMEFRAMES, formatPrice, type Timeframe } from "@/lib/market/types";
import { usePaper } from "@/lib/paper/PaperProvider";
import { computeAccuracy, evaluateHistory } from "@/lib/prediction/backtest";
import type { Direction } from "@/lib/prediction/types";
import { cn } from "@/lib/utils";

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
  const { account, stats } = usePaper();
  const [asset, setAsset] = useState(symbol);
  const [tf, setTf] = useState<Timeframe>(timeframe);
  const [range, setRange] = useState("120");

  const evaluated = useMemo(() => {
    const candles = generateCandles(asset, tf, Math.max(400, Number(range) + 80));
    return evaluateHistory(candles, asset, tf, Number(range));
  }, [asset, tf, range]);

  const metrics = useMemo(() => computeAccuracy(evaluated), [evaluated]);

  const equityData = useMemo(() => {
    const history = [...account.equityHistory, { time: Math.floor(Date.now() / 1000), equity: stats.equity }];
    let peak = history[0]?.equity ?? account.startingBalance;
    return history.map((point, i) => {
      peak = Math.max(peak, point.equity);
      return {
        label: i === 0 ? "start" : new Date(point.time * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        equity: Number(point.equity.toFixed(2)),
        drawdown: Number((((point.equity - peak) / peak) * 100).toFixed(2)),
      };
    });
  }, [account.equityHistory, account.startingBalance, stats.equity]);

  const accuracyBuckets = useMemo(
    () =>
      DIRECTIONS.map((d) => ({
        name: d,
        accuracy: Number(
          (
            (d === "UP" ? metrics.upAccuracy : d === "DOWN" ? metrics.downAccuracy : metrics.sidewaysAccuracy) * 100
          ).toFixed(1),
        ),
      })),
    [metrics],
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div>
          <h1 className="text-sm font-semibold">Analytics</h1>
          <p className="text-[11px] text-muted-foreground">
            Walk-forward evaluation of the current prediction service on demo candle data.
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

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        <KpiCard label="Overall accuracy" value={`${(metrics.accuracy * 100).toFixed(1)}%`} />
        <KpiCard label="UP accuracy" value={`${(metrics.upAccuracy * 100).toFixed(1)}%`} tone="bull" />
        <KpiCard label="DOWN accuracy" value={`${(metrics.downAccuracy * 100).toFixed(1)}%`} tone="bear" />
        <KpiCard label="Total predictions" value={`${metrics.total}`} />
        <KpiCard label="Correct / incorrect" value={`${metrics.correct} / ${metrics.incorrect}`} />
        <KpiCard
          label="Avg predicted prob."
          value={`${(metrics.avgProbability * 100).toFixed(1)}%`}
          sub={`conf ${(metrics.avgConfidence * 10).toFixed(1)}/10`}
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 h-[120px]">
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

        <Panel title="Paper trading performance" bodyClassName="p-3">
          <div className="grid grid-cols-3 gap-2">
            <KpiCard label="Equity" value={`$${formatPrice(stats.equity, 2)}`} compact />
            <KpiCard
              label="Return"
              value={`${stats.returnPct >= 0 ? "+" : ""}${(stats.returnPct * 100).toFixed(2)}%`}
              tone={stats.returnPct >= 0 ? "bull" : "bear"}
              compact
            />
            <KpiCard label="Win rate" value={`${(stats.winRate * 100).toFixed(1)}%`} compact />
            <KpiCard label="Trades" value={`${stats.trades}`} compact />
            <KpiCard label="Max drawdown" value={`${(stats.maxDrawdown * 100).toFixed(2)}%`} tone="bear" compact />
            <KpiCard
              label="Realised P&L"
              value={`${stats.realizedPnl >= 0 ? "+" : ""}$${formatPrice(stats.realizedPnl, 2)}`}
              tone={stats.realizedPnl >= 0 ? "bull" : "bear"}
              compact
            />
          </div>
          <p className="label-xs mt-3 mb-1">Equity curve</p>
          <div className="h-[120px]">
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
          <p className="label-xs mt-3 mb-1">Drawdown (%)</p>
          <div className="h-[90px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={equityData} margin={{ top: 4, right: 4, bottom: 0, left: -12 }}>
                <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 9, fill: "var(--muted-foreground)" }} minTickGap={30} />
                <YAxis tick={{ fontSize: 9, fill: "var(--muted-foreground)" }} width={48} />
                <Tooltip content={<ChartTooltip />} />
                <Area
                  type="monotone"
                  dataKey="drawdown"
                  stroke="var(--bear)"
                  fill="var(--bear)"
                  fillOpacity={0.15}
                  strokeWidth={1.2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      <Panel
        title={`Recent predictions — ${asset} ${tf}`}
        action={<Badge variant="outline" className="border-panel-border text-[10px]">{evaluated.length} scored</Badge>}
        bodyClassName="p-0"
      >
        <div className="max-h-[420px] overflow-auto">
          <table className="w-full num text-[11px]">
            <thead className="sticky top-0 bg-panel">
              <tr className="border-b border-panel-border">
                {["Time", "Price", "Predicted", "UP", "DOWN", "SIDE", "Conf", "Actual", "Result"].map((h) => (
                  <th key={h} className="label-xs px-3 py-1.5 text-right first:text-left">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {evaluated.slice(0, 60).map((p) => (
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
                  <td className="px-3 py-1.5 text-right">{(p.confidence * 10).toFixed(1)}</td>
                  <td className={cn("px-3 py-1.5 text-right", toneClass(p.actualDirection))}>
                    {p.actualDirection ?? "—"}
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    <span className={p.correct ? "text-bull" : "text-bear"}>{p.correct ? "HIT" : "MISS"}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" className="text-xs" onClick={() => setRange("250")}>
          Extend sample to 250 bars
        </Button>
        <p className="label-xs">
          Accuracy is measured against demo candle data with the heuristic model — connect a live feed and
          trained model to reproduce these metrics on real markets.
        </p>
      </div>

      <Disclaimer />
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
