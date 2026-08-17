import { createFileRoute } from "@tanstack/react-router";

import { CandleChart } from "@/components/trading/CandleChart";
import { Disclaimer } from "@/components/trading/Disclaimer";
import { ExplanationPanel } from "@/components/trading/ExplanationPanel";
import { MarketStats } from "@/components/trading/MarketStats";
import { PaperTradingPanel } from "@/components/trading/PaperTradingPanel";
import { Panel } from "@/components/trading/Panel";
import { PredictionPanel } from "@/components/trading/PredictionPanel";
import { TerminalShell } from "@/components/trading/AppProviders";
import { IndicatorPanes } from "@/components/trading/IndicatorPanes";

const title = "Dream Terminal — Next-Candle Probability & Paper Trading";
const description =
  "Dark quant terminal for next-candle UP/DOWN/SIDEWAYS probability estimates, technical signals and $10,000 virtual paper trading across crypto and Indian markets.";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
    ],
  }),
  component: Terminal,
});

function Terminal() {
  return (
    <TerminalShell>
      <h1 className="sr-only">Dream next-candle prediction and paper trading terminal</h1>
      <div className="space-y-3">
        <MarketStats />
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-3">
            <Panel bodyClassName="p-0" className="overflow-hidden">
              <div className="h-[420px] lg:h-[480px]">
                <CandleChart />
              </div>
            </Panel>
            <IndicatorPanes />
            <Disclaimer />
          </div>
          <div className="space-y-3">
            <PredictionPanel />
            <PaperTradingPanel />
            <ExplanationPanel />
          </div>
        </div>
      </div>
    </TerminalShell>
  );
}
