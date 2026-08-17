import { ArrowDown, ArrowRight, ArrowUp, Cpu } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { useMarket } from "@/lib/market/MarketProvider";
import type { Direction } from "@/lib/prediction/types";
import { cn } from "@/lib/utils";
import { Panel } from "./Panel";

const DIRECTION_STYLES: Record<Direction, { text: string; bar: string; icon: React.ReactNode }> = {
  UP: { text: "text-bull", bar: "bg-bull", icon: <ArrowUp className="size-3.5" /> },
  DOWN: { text: "text-bear", bar: "bg-bear", icon: <ArrowDown className="size-3.5" /> },
  SIDEWAYS: { text: "text-neutral", bar: "bg-neutral", icon: <ArrowRight className="size-3.5" /> },
};

export function PredictionPanel() {
  const { prediction, secondsToClose, timeframe } = useMarket();

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

  return (
    <Panel
      title="Next candle prediction"
      action={
        <Badge variant="outline" className="num border-panel-border text-[10px]">
          {timeframe} · closes in {mmss}
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

      <div className="mt-4 grid grid-cols-3 gap-2 border-t border-panel-border pt-3">
        <Metric label="Prediction">
          <span className={cn("flex items-center gap-1 num text-sm font-semibold", style.text)}>
            {style.icon}
            {prediction.direction}
          </span>
        </Metric>
        <Metric label="Confidence">
          <span className="num text-sm font-semibold">{(prediction.confidence * 10).toFixed(1)}/10</span>
        </Metric>
        <Metric label="Expected move">
          <span
            className={cn(
              "num text-sm font-semibold",
              prediction.expectedMove > 0 ? "text-bull" : prediction.expectedMove < 0 ? "text-bear" : "text-neutral",
            )}
          >
            {prediction.expectedMove >= 0 ? "+" : ""}
            {(prediction.expectedMove * 100).toFixed(2)}%
          </span>
        </Metric>
      </div>

      <div className="mt-3 flex items-center gap-1.5 label-xs">
        <Cpu className="size-3" />
        model {prediction.modelId} · {prediction.modelKind === "ml" ? "trained model" : "heuristic feature model (no ML backend connected)"}
      </div>
    </Panel>
  );
}

function Metric({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="label-xs">{label}</p>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}
