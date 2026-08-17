export type Timeframe = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";

export interface Candle {
  /** Unix seconds of candle open */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Asset {
  symbol: string;
  name: string;
  kind: "crypto" | "equity" | "index";
  basePrice: number;
  /** relative volatility factor used by the demo data generator */
  vol: number;
  quote: string;
  pricePrecision: number;
}

export const ASSETS: Asset[] = [
  {
    symbol: "BTC/USDT",
    name: "Bitcoin",
    kind: "crypto",
    basePrice: 67450,
    vol: 1,
    quote: "USDT",
    pricePrecision: 1,
  },
  {
    symbol: "ETH/USDT",
    name: "Ethereum",
    kind: "crypto",
    basePrice: 3520,
    vol: 1.25,
    quote: "USDT",
    pricePrecision: 2,
  },
  {
    symbol: "SOL/USDT",
    name: "Solana",
    kind: "crypto",
    basePrice: 168.4,
    vol: 1.7,
    quote: "USDT",
    pricePrecision: 3,
  },
  {
    symbol: "NIFTY",
    name: "Nifty 50 Index",
    kind: "index",
    basePrice: 24310,
    vol: 0.45,
    quote: "INR",
    pricePrecision: 2,
  },
  {
    symbol: "BANKNIFTY",
    name: "Nifty Bank Index",
    kind: "index",
    basePrice: 52180,
    vol: 0.6,
    quote: "INR",
    pricePrecision: 2,
  },
  {
    symbol: "RELIANCE",
    name: "Reliance Industries",
    kind: "equity",
    basePrice: 2945,
    vol: 0.7,
    quote: "INR",
    pricePrecision: 2,
  },
];

export const TIMEFRAMES: { value: Timeframe; label: string; seconds: number }[] = [
  { value: "1m", label: "1m", seconds: 60 },
  { value: "5m", label: "5m", seconds: 300 },
  { value: "15m", label: "15m", seconds: 900 },
  { value: "1h", label: "1H", seconds: 3600 },
  { value: "4h", label: "4H", seconds: 14400 },
  { value: "1d", label: "1D", seconds: 86400 },
];

export function timeframeSeconds(tf: Timeframe): number {
  return TIMEFRAMES.find((t) => t.value === tf)?.seconds ?? 60;
}

export function getAsset(symbol: string): Asset {
  return ASSETS.find((a) => a.symbol === symbol) ?? ASSETS[0]!;
}

export function formatPrice(value: number, precision = 2): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  });
}
