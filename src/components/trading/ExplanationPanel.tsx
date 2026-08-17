import { Minus, TrendingDown, TrendingUp } from "lucide-react";

import { useMarket } from "@/lib/market/MarketProvider";
import type { PredictionFactor } from "@/lib/prediction/types";
import { cn } from "@/lib/utils";
import { Panel } from "./Panel";

export function ExplanationPanel() {
  const { prediction } = useMarket();

  if (!prediction) {
    return (
      <Panel title="Model signals">
        <p className="label-xs">No signals yet.</p>
      </Panel>
    );
  }

  const positive = prediction.factors.filter((f) => f.impact === "positive");
  const negative = prediction.factors.filter((f) => f.impact === "negative");
  const neutral = prediction.factors.filter((f) => f.impact === "neutral");

  return (
    <Panel title="Model signals & feature weights">
      <p className="mb-3 text-[11px] leading-relaxed text-muted-foreground">
        These are the features the model weighted for this candle. They describe model inputs, not
        proven causes of price movement.
      </p>
      <div className="space-y-3">
        <FactorGroup title="Supporting upside" factors={positive} />
        <FactorGroup title="Supporting downside / caution" factors={negative} />
        {neutral.length > 0 && <FactorGroup title="Neutral / range signals" factors={neutral} />}
      </div>
    </Panel>
  );
}

function FactorGroup({ title, factors }: { title: string; factors: PredictionFactor[] }) {
  if (factors.length === 0) return null;
  return (
    <div>
      <p className="label-xs mb-1.5">{title}</p>
      <ul className="space-y-1.5">
        {factors.map((f) => (
          <li key={f.label} className="flex items-start gap-2">
            <span
              className={cn(
                "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-sm",
                f.impact === "positive"
                  ? "bg-bull-muted text-bull"
                  : f.impact === "negative"
                    ? "bg-bear-muted text-bear"
                    : "bg-neutral-muted text-neutral",
              )}
            >
              {f.impact === "positive" ? (
                <TrendingUp className="size-2.5" />
              ) : f.impact === "negative" ? (
                <TrendingDown className="size-2.5" />
              ) : (
                <Minus className="size-2.5" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs leading-snug text-foreground">{f.label}</p>
              {f.detail && <p className="num text-[10px] text-muted-foreground">{f.detail}</p>}
              <div className="mt-1 h-0.5 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn(
                    "h-full rounded-full",
                    f.impact === "positive" ? "bg-bull" : f.impact === "negative" ? "bg-bear" : "bg-neutral",
                  )}
                  style={{ width: `${Math.max(f.weight * 100, 4)}%` }}
                />
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
