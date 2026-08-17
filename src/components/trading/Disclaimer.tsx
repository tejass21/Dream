import { ShieldAlert } from "lucide-react";

export function Disclaimer() {
  return (
    <div className="flex items-start gap-2 rounded-md border border-panel-border bg-panel px-3 py-2">
      <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Predictions are probabilistic estimates for research and paper trading only. They are not
        financial advice and do not guarantee future price movements. No real orders are placed and no
        real money is used.
      </p>
    </div>
  );
}
