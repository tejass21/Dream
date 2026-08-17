import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMarket } from "@/lib/market/MarketProvider";
import { formatPrice } from "@/lib/market/types";
import { usePaper } from "@/lib/paper/PaperProvider";
import { positionPnl } from "@/lib/paper/types";
import { cn } from "@/lib/utils";
import { Panel } from "./Panel";

export function PaperTradingPanel() {
  const { asset, snapshot, symbol } = useMarket();
  const { account, stats, paperTradingEnabled, openPosition, closePosition, closeAll } = usePaper();
  const [notional, setNotional] = useState("500");
  const [stopLoss, setStopLoss] = useState("");
  const [takeProfit, setTakeProfit] = useState("");
  const [mode, setMode] = useState<"market" | "limit">("market");
  const [limitPrice, setLimitPrice] = useState("");

  const price = snapshot?.price ?? 0;
  const entry = mode === "limit" && Number(limitPrice) > 0 ? Number(limitPrice) : price;
  const marks = useMemo(() => ({ [symbol]: price }), [symbol, price]);

  const submit = (side: "LONG" | "SHORT") => {
    openPosition({
      asset: symbol,
      side,
      notional: Number(notional),
      price: entry,
      stopLoss: Number(stopLoss) > 0 ? Number(stopLoss) : null,
      takeProfit: Number(takeProfit) > 0 ? Number(takeProfit) : null,
    });
  };

  const disabled = !paperTradingEnabled || price <= 0 || Number(notional) <= 0;

  return (
    <Panel
      title="Paper trading"
      action={
        <span className="num text-[10px] text-muted-foreground">
          simulated · balance ${formatPrice(account.balance, 2)}
        </span>
      }
      bodyClassName="p-3 space-y-3"
    >
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Equity" value={`$${formatPrice(stats.equity, 2)}`} />
        <Stat
          label="Unrealised P&L"
          value={`${stats.unrealizedPnl >= 0 ? "+" : ""}$${formatPrice(stats.unrealizedPnl, 2)}`}
          tone={stats.unrealizedPnl >= 0 ? "bull" : "bear"}
        />
        <Stat
          label="Realised P&L"
          value={`${stats.realizedPnl >= 0 ? "+" : ""}$${formatPrice(stats.realizedPnl, 2)}`}
          tone={stats.realizedPnl >= 0 ? "bull" : "bear"}
        />
        <Stat label="Win rate" value={`${(stats.winRate * 100).toFixed(1)}%`} />
        <Stat label="Trades" value={`${stats.trades}`} />
        <Stat label="Max drawdown" value={`${(stats.maxDrawdown * 100).toFixed(2)}%`} tone="bear" />
      </div>

      <div className="space-y-2 border-t border-panel-border pt-3">
        <Tabs value={mode} onValueChange={(v) => setMode(v as "market" | "limit")}>
          <TabsList className="h-7 w-full bg-muted">
            <TabsTrigger value="market" className="h-6 flex-1 text-[11px]">
              Market
            </TabsTrigger>
            <TabsTrigger value="limit" className="h-6 flex-1 text-[11px]">
              Limit
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="grid grid-cols-2 gap-2">
          <Field label={`Size (${asset.quote === "INR" ? "₹" : "$"} notional)`}>
            <Input
              value={notional}
              onChange={(e) => setNotional(e.target.value)}
              inputMode="decimal"
              className="num h-8 text-xs"
            />
          </Field>
          <Field label={mode === "limit" ? "Limit price" : "Entry (market)"}>
            <Input
              value={mode === "limit" ? limitPrice : formatPrice(price, asset.pricePrecision)}
              onChange={(e) => setLimitPrice(e.target.value)}
              disabled={mode !== "limit"}
              inputMode="decimal"
              className="num h-8 text-xs"
            />
          </Field>
          <Field label="Stop loss">
            <Input
              value={stopLoss}
              onChange={(e) => setStopLoss(e.target.value)}
              placeholder="optional"
              inputMode="decimal"
              className="num h-8 text-xs"
            />
          </Field>
          <Field label="Take profit">
            <Input
              value={takeProfit}
              onChange={(e) => setTakeProfit(e.target.value)}
              placeholder="optional"
              inputMode="decimal"
              className="num h-8 text-xs"
            />
          </Field>
        </div>

        <div className="flex gap-2">
          <Button
            onClick={() => submit("LONG")}
            disabled={disabled}
            className="h-8 flex-1 bg-bull text-[11px] font-semibold text-background hover:bg-bull/90"
          >
            BUY / LONG
          </Button>
          <Button
            onClick={() => submit("SHORT")}
            disabled={disabled}
            className="h-8 flex-1 bg-bear text-[11px] font-semibold text-background hover:bg-bear/90"
          >
            SELL / SHORT
          </Button>
        </div>
        {!paperTradingEnabled && (
          <p className="label-xs">Paper trading is switched off in the top bar.</p>
        )}
      </div>

      <div className="border-t border-panel-border pt-3">
        <div className="mb-2 flex items-center justify-between">
          <p className="label-xs">Open positions ({account.positions.length})</p>
          {account.positions.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[10px]"
              onClick={() => closeAll(marks)}
            >
              Close all
            </Button>
          )}
        </div>
        {account.positions.length === 0 ? (
          <p className="label-xs">No open simulated positions.</p>
        ) : (
          <ul className="space-y-1.5">
            {account.positions.map((p) => {
              const mark = p.asset === symbol ? price : p.entryPrice;
              const pnl = positionPnl(p, mark);
              return (
                <li
                  key={p.id}
                  className="flex items-center justify-between rounded-sm border border-panel-border bg-background/40 px-2 py-1.5"
                >
                  <div className="min-w-0">
                    <p className="num text-[11px] font-semibold">
                      <span className={p.side === "LONG" ? "text-bull" : "text-bear"}>{p.side}</span>{" "}
                      {p.asset}
                    </p>
                    <p className="num text-[10px] text-muted-foreground">
                      {p.quantity.toFixed(4)} @ {formatPrice(p.entryPrice, 2)}
                      {p.stopLoss ? ` · SL ${formatPrice(p.stopLoss, 2)}` : ""}
                      {p.takeProfit ? ` · TP ${formatPrice(p.takeProfit, 2)}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={cn("num text-[11px] font-semibold", pnl >= 0 ? "text-bull" : "text-bear")}
                    >
                      {pnl >= 0 ? "+" : ""}
                      {formatPrice(pnl, 2)}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 px-2 text-[10px]"
                      onClick={() => closePosition(p.id, mark)}
                    >
                      Close
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {account.trades.length > 0 && (
        <div className="border-t border-panel-border pt-3">
          <p className="label-xs mb-2">Recent closed trades</p>
          <ul className="space-y-1">
            {account.trades.slice(0, 5).map((t) => (
              <li key={`${t.id}-${t.closedAt}`} className="flex items-center justify-between num text-[10px]">
                <span className="text-muted-foreground">
                  {t.side} {t.asset} · {formatPrice(t.entryPrice, 2)} → {formatPrice(t.exitPrice, 2)} ({t.reason})
                </span>
                <span className={t.pnl >= 0 ? "text-bull" : "text-bear"}>
                  {t.pnl >= 0 ? "+" : ""}
                  {formatPrice(t.pnl, 2)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "bull" | "bear" }) {
  return (
    <div className="rounded-sm border border-panel-border bg-background/40 px-2 py-1.5">
      <p className="label-xs truncate">{label}</p>
      <p
        className={cn(
          "num truncate text-[12px] font-semibold",
          tone === "bull" && "text-bull",
          tone === "bear" && "text-bear",
        )}
      >
        {value}
      </p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="label-xs">{label}</Label>
      {children}
    </div>
  );
}
