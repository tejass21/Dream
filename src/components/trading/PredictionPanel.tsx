import { ArrowDown, ArrowRight, ArrowUp, Cpu, ShieldCheck, ShieldX, Zap } from "lucide-react";
import { useMemo } from "react";

import { Badge } from "@/components/ui/badge";
import { useMarket } from "@/lib/market/MarketProvider";
import type { Direction } from "@/lib/prediction/types";
import { cn } from "@/lib/utils";
import { Panel } from "./Panel";
import { computePrediction } from "@/lib/prediction/mockService";
import { classifyMove } from "@/lib/prediction/backtest";
import { realizedVolatility } from "@/lib/market/indicators";

const DIRECTION_STYLES: Record<Direction, { text: string; bar: string; icon: React.ReactNode }> = {
  UP: { text: "text-bull", bar: "bg-bull", icon: <ArrowUp className="size-3.5" /> },
  DOWN: { text: "text-bear", bar: "bg-bear", icon: <ArrowDown className="size-3.5" /> },
  SIDEWAYS: { text: "text-neutral", bar: "bg-neutral", icon: <ArrowRight className="size-3.5" /> },
};

export function PredictionPanel() {
  const { prediction, secondsToClose, timeframe, candles, symbol } = useMarket();

  const prevPrediction = useMemo(() => {
    if (candles.length < 62) return null;
    try {
      // We score the prediction made at close of candles[n - 3] for candles[n - 2]
      // using history up to candles.length - 2 (which has last index candles.length - 3)
      const history = candles.slice(0, candles.length - 2);
      const pred = computePrediction(history, symbol, timeframe);

      const prevClose = candles[candles.length - 3]!.close;
      const targetCandle = candles[candles.length - 2]!;

      const vol = realizedVolatility(history, 20);
      const threshold = (0.5 * vol) / 100;

      const actualDir = classifyMove(prevClose, targetCandle.close, threshold);
      const actualMove = (targetCandle.close - prevClose) / prevClose;
      const correct = pred.direction === actualDir;

      return {
        pred,
        actualDir,
        actualMove,
        correct,
      };
    } catch (e) {
      return null;
    }
  }, [candles, symbol, timeframe]);

  if (!prediction) {
    return (
      <Panel title="Next candle prediction">
        <p className="label-xs">Waiting for enough candle history…</p>
      </Panel>
    );
  }

  const probs: { direction: Direction; value: number }[] = [
    { direction: "UP", value: prediction.upProbability },
    { direction: "DOWN", value: prediction.downProbability },
    { direction: "SIDEWAYS", value: prediction.sidewaysProbability },
  ];
  const style = DIRECTION_STYLES[prediction.direction];
  const mmss = `${String(Math.floor(secondsToClose / 60)).padStart(2, "0")}:${String(
    secondsToClose % 60,
  ).padStart(2, "0")}`;

  const isTrade = prediction.signal === "TRADE";

  return (
    <Panel
      title="Next candle prediction"
      action={
        <Badge variant="outline" className="num border-panel-border text-[10px]">
          NEXT {timeframe.toUpperCase()} · closes in {mmss}
        </Badge>
      }
    >
      <div className="space-y-2.5">
        {probs.map((p) => (
          <div key={p.direction}>
            <div className="mb-1 flex items-baseline justify-between">
              <span
                className={cn(
                  "text-[11px] font-semibold tracking-wide",
                  DIRECTION_STYLES[p.direction].text,
                )}
              >
                {p.direction}
              </span>
              <span className="num text-xs font-semibold">{(p.value * 100).toFixed(1)}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className={cn("h-full rounded-full transition-[width] duration-500", DIRECTION_STYLES[p.direction].bar)}
                style={{ width: `${Math.max(p.value * 100, 1.5)}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-x-2 gap-y-3 border-t border-panel-border pt-3 sm:grid-cols-3">
        <Metric label="Direction">
          <span className={cn("flex items-center gap-1 num text-xs font-semibold", style.text)}>
            {style.icon}
            {prediction.direction}
          </span>
        </Metric>
        <Metric label="Confidence">
          <span className="num text-xs font-semibold">{(prediction.confidence * 100).toFixed(0)}%</span>
        </Metric>
        <Metric label="Expected return">
          <span
            className={cn(
              "num text-xs font-semibold",
              prediction.expectedMove > 0 ? "text-bull" : prediction.expectedMove < 0 ? "text-bear" : "text-neutral",
            )}
          >
            {prediction.expectedMove >= 0 ? "+" : ""}
            {(prediction.expectedMove * 100).toFixed(2)}%
          </span>
        </Metric>
        <Metric label="Market regime">
          <span className="num text-[10px] font-semibold text-foreground tracking-wide truncate">
            {prediction.regime?.replace("_", " ")}
          </span>
        </Metric>
        <Metric label="Signal">
          <Badge
            variant="outline"
            className={cn(
              "h-5 text-[9px] font-bold py-0 flex w-fit items-center gap-1 px-1.5",
              isTrade
                ? "border-bull/30 bg-bull-muted text-bull"
                : "border-muted-foreground/30 bg-muted text-muted-foreground",
            )}
          >
            {isTrade ? <Zap className="size-2" /> : <ShieldX className="size-2" />}
            {prediction.signal}
          </Badge>
        </Metric>
        <Metric label="Agreement">
          <span className="num text-xs font-semibold text-muted-foreground flex items-center gap-1">
            <ShieldCheck className="size-3 text-primary" />
            {prediction.modelAgreement}
          </span>
        </Metric>
      </div>

      {prevPrediction && (
        <div className="mt-3.5 border-t border-panel-border pt-2.5 flex items-center justify-between text-[10px] leading-none">
          <span className="text-muted-foreground text-[9px]">PREV OUTCOME</span>
          <span className="num font-semibold text-muted-foreground">
            Act <span className={cn("font-bold", DIRECTION_STYLES[prevPrediction.actualDir].text)}>{prevPrediction.actualDir}</span> ·{" "}
            <span className={prevPrediction.correct ? "text-bull" : "text-bear"}>
              {prevPrediction.correct ? "HIT" : "MISS"} ({(prevPrediction.actualMove * 100).toFixed(2)}%)
            </span>
          </span>
        </div>
      )}

      {prediction.validation && (
        <div className="mt-3 border-t border-panel-border pt-2.5 grid grid-cols-3 gap-2">
          <Metric label="OOS accuracy">
            <span className="num text-xs font-semibold text-foreground">
              {(prediction.validation.accuracy * 100).toFixed(1)}%
            </span>
          </Metric>
          <Metric label="Hit rate (gated)">
            <span
              className={cn(
                "num text-xs font-semibold",
                prediction.validation.highConfidenceShare > 0 ? "text-bull" : "text-muted-foreground",
              )}
            >
              {prediction.validation.highConfidenceShare > 0
                ? `${(prediction.validation.highConfidenceAccuracy * 100).toFixed(1)}%`
                : "no edge"}
            </span>
          </Metric>
          <Metric label="Log loss">
            <span className="num text-xs font-semibold text-muted-foreground">
              {prediction.validation.logLoss.toFixed(3)}
            </span>
          </Metric>
        </div>
      )}

      <div className="mt-3 flex items-center gap-1.5 label-xs text-[9px]">
        <Cpu className="size-2.5 text-primary" />
        model {prediction.modelId} ({prediction.modelVersion}) · GBM + softmax ensemble, purged
        walk-forward validation
        {prediction.validation
          ? ` · ${prediction.validation.samples} out-of-sample bars`
          : ""}
      </div>

    </Panel>
  );
}

function Metric({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="label-xs text-[9px] mb-0.5 text-muted-foreground">{label}</p>
      <div className="flex h-5 items-center">{children}</div>
    </div>
  );
}
