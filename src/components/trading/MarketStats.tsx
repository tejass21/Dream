import { useMarket } from "@/lib/market/MarketProvider";
import { formatPrice } from "@/lib/market/types";
import { cn } from "@/lib/utils";

function compact(value: number): string {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(value);
}

export function MarketStats() {
  const { snapshot, asset, secondsToClose, timeframe } = useMarket();

  if (!snapshot) {
    return (
      <div className="panel h-[86px] animate-pulse" aria-hidden />
    );
  }

  const mmss = `${String(Math.floor(secondsToClose / 60)).padStart(2, "0")}:${String(
    secondsToClose % 60,
  ).padStart(2, "0")}`;
  const up = snapshot.change24hPct >= 0;

  const cards: { label: string; value: string; tone?: "bull" | "bear" | "neutral"; sub?: string | undefined }[] = [
    {
      label: "Price",
      value: formatPrice(snapshot.price, asset.pricePrecision),
      tone: up ? "bull" : "bear",
      sub: asset.quote,
    },
    {
      label: "24h change",
      value: `${up ? "+" : ""}${(snapshot.change24hPct * 100).toFixed(2)}%`,
      tone: up ? "bull" : "bear",
      sub: `${up ? "+" : ""}${formatPrice(snapshot.change24h, asset.pricePrecision)}`,
    },
    { label: "24h volume", value: compact(snapshot.volume), sub: asset.kind === "crypto" ? "base units" : "shares" },
    {
      label: "Volatility",
      value: `${snapshot.volatility.toFixed(2)}%`,
      sub: "realised / bar",
    },
    {
      label: "RSI (14)",
      value: snapshot.rsi != null ? snapshot.rsi.toFixed(1) : "—",
      tone: snapshot.rsi == null ? "neutral" : snapshot.rsi > 70 ? "bear" : snapshot.rsi < 30 ? "bull" : "neutral",
    },
    {
      label: "ATR (14)",
      value: snapshot.atr != null ? formatPrice(snapshot.atr, asset.pricePrecision) : "—",
      sub: snapshot.atrPct != null ? `${(snapshot.atrPct * 100).toFixed(2)}%` : undefined,
    },
    {
      label: "Trend",
      value: snapshot.trend,
      tone: snapshot.trend === "UPTREND" ? "bull" : snapshot.trend === "DOWNTREND" ? "bear" : "neutral",
      sub: "EMA 21 vs 50",
    },
    { label: "Candle close", value: mmss, sub: `${timeframe} bar` },
  ];

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
      {cards.map((c) => (
        <div key={c.label} className="panel px-2.5 py-2">
          <p className="label-xs truncate">{c.label}</p>
          <p
            className={cn(
              "num mt-0.5 truncate text-[13px] font-semibold",
              c.tone === "bull" && "text-bull",
              c.tone === "bear" && "text-bear",
              c.tone === "neutral" && "text-foreground",
            )}
          >
            {c.value}
          </p>
          {c.sub && <p className="num truncate text-[10px] text-muted-foreground">{c.sub}</p>}
        </div>
      ))}
    </div>
  );
}
