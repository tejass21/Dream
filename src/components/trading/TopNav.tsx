import { Link, useRouterState } from "@tanstack/react-router";
import { Activity, BarChart3, CandlestickChart, Settings2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { useMarket, type IndicatorToggles } from "@/lib/market/MarketProvider";
import { ASSETS, TIMEFRAMES, type Timeframe } from "@/lib/market/types";
import { usePaper } from "@/lib/paper/PaperProvider";
import { cn } from "@/lib/utils";

const TOGGLE_LABELS: { key: keyof IndicatorToggles; label: string }[] = [
  { key: "ema9", label: "EMA 9" },
  { key: "ema21", label: "EMA 21" },
  { key: "ema50", label: "EMA 50" },
  { key: "volume", label: "Volume" },
  { key: "rsi", label: "RSI (14)" },
  { key: "macd", label: "MACD" },
  { key: "predictionMarker", label: "Prediction marker" },
];

export function TopNav() {
  const { symbol, setSymbol, timeframe, setTimeframe, toggles, setToggle, isLiveData, dataSourceId } =
    useMarket();
  const { paperTradingEnabled, setPaperTradingEnabled, reset } = usePaper();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <header className="sticky top-0 z-40 border-b border-panel-border bg-panel/95 backdrop-blur">
      <div className="flex h-14 items-center gap-3 px-3 lg:px-4">
        <Link to="/" className="flex items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-sm bg-primary/15 text-primary">
            <CandlestickChart className="size-4" />
          </span>
          <span className="text-sm font-semibold tracking-tight">
            Candle<span className="text-primary">AI</span>
          </span>
        </Link>

        <Separator orientation="vertical" className="hidden h-6 sm:block" />

        <nav className="hidden items-center gap-1 sm:flex">
          <NavLink to="/" active={pathname === "/"} icon={<Activity className="size-3.5" />}>
            Terminal
          </NavLink>
          <NavLink
            to="/analytics"
            active={pathname.startsWith("/analytics")}
            icon={<BarChart3 className="size-3.5" />}
          >
            Analytics
          </NavLink>
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <Select value={symbol} onValueChange={setSymbol}>
            <SelectTrigger className="h-8 w-[132px] num text-xs" aria-label="Market">
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

          <div className="hidden items-center rounded-md border border-panel-border bg-background p-0.5 md:flex">
            {TIMEFRAMES.map((tf) => (
              <button
                key={tf.value}
                onClick={() => setTimeframe(tf.value as Timeframe)}
                className={cn(
                  "num rounded-sm px-2 py-1 text-[11px] font-medium transition-colors",
                  timeframe === tf.value
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {tf.label}
              </button>
            ))}
          </div>

          <Select value={timeframe} onValueChange={(v) => setTimeframe(v as Timeframe)}>
            <SelectTrigger className="h-8 w-[74px] num text-xs md:hidden" aria-label="Timeframe">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIMEFRAMES.map((tf) => (
                <SelectItem key={tf.value} value={tf.value} className="num text-xs">
                  {tf.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Badge
            variant="outline"
            className="hidden gap-1.5 border-panel-border text-[10px] font-medium tracking-wide lg:flex"
          >
            <span
              className={cn(
                "size-1.5 rounded-full",
                isLiveData ? "bg-bull" : "bg-neutral",
              )}
            />
            {isLiveData ? "LIVE FEED" : "DEMO FEED"}
            <span className="text-muted-foreground">· {dataSourceId}</span>
          </Badge>

          <div className="hidden items-center gap-2 rounded-md border border-panel-border px-2 py-1 lg:flex">
            <Label htmlFor="paper-toggle" className="label-xs cursor-pointer">
              Paper
            </Label>
            <Switch id="paper-toggle" checked={paperTradingEnabled} onCheckedChange={setPaperTradingEnabled} />
          </div>

          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" className="size-8" aria-label="Settings">
                <Settings2 className="size-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64 border-panel-border bg-popover">
              <p className="label-xs mb-3">Chart & model overlays</p>
              <div className="space-y-2.5">
                {TOGGLE_LABELS.map(({ key, label }) => (
                  <div key={key} className="flex items-center justify-between">
                    <Label htmlFor={key} className="text-xs font-normal text-foreground">
                      {label}
                    </Label>
                    <Switch
                      id={key}
                      checked={toggles[key]}
                      onCheckedChange={(v) => setToggle(key, v)}
                    />
                  </div>
                ))}
              </div>
              <Separator className="my-3" />
              <div className="flex items-center justify-between lg:hidden">
                <Label htmlFor="paper-toggle-mobile" className="text-xs font-normal">
                  Paper trading
                </Label>
                <Switch
                  id="paper-toggle-mobile"
                  checked={paperTradingEnabled}
                  onCheckedChange={setPaperTradingEnabled}
                />
              </div>
              <Button variant="outline" size="sm" className="mt-3 w-full text-xs" onClick={reset}>
                Reset paper account
              </Button>
            </PopoverContent>
          </Popover>
        </div>
      </div>
    </header>
  );
}

function NavLink({
  to,
  active,
  icon,
  children,
}: {
  to: string;
  active: boolean;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Link
      to={to}
      className={cn(
        "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
        active ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {icon}
      {children}
    </Link>
  );
}
