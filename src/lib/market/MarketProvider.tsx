import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { computeIndicators, lastDefined, realizedVolatility, type IndicatorSet } from "./indicators";
import { getMarketDataSource } from "./dataSource";
import { getAsset, timeframeSeconds, type Asset, type Candle, type Timeframe } from "./types";
import { getPredictionService } from "../prediction/mockService";
import type { Prediction } from "../prediction/types";
import { usePaper } from "../paper/PaperProvider";

export interface IndicatorToggles {
  ema9: boolean;
  ema21: boolean;
  ema50: boolean;
  volume: boolean;
  rsi: boolean;
  macd: boolean;
  predictionMarker: boolean;
}

export interface MarketSnapshot {
  price: number;
  change24h: number;
  change24hPct: number;
  volume: number;
  volatility: number;
  rsi: number | null;
  atr: number | null;
  atrPct: number | null;
  trend: "UPTREND" | "DOWNTREND" | "RANGE";
  high: number;
  low: number;
}

interface MarketContextValue {
  asset: Asset;
  symbol: string;
  setSymbol: (s: string) => void;
  timeframe: Timeframe;
  setTimeframe: (t: Timeframe) => void;
  candles: Candle[];
  indicators: IndicatorSet;
  snapshot: MarketSnapshot | null;
  prediction: Prediction | null;
  loading: boolean;
  secondsToClose: number;
  dataSourceId: string;
  isLiveData: boolean;
  toggles: IndicatorToggles;
  setToggle: (key: keyof IndicatorToggles, value: boolean) => void;
}

const MarketContext = createContext<MarketContextValue | null>(null);

const DEFAULT_TOGGLES: IndicatorToggles = {
  ema9: true,
  ema21: true,
  ema50: true,
  volume: true,
  rsi: true,
  macd: true,
  predictionMarker: true,
};

export function MarketProvider({ children }: { children: ReactNode }) {
  const [symbol, setSymbol] = useState("NIFTY");
  const [timeframe, setTimeframe] = useState<Timeframe>("5m");
  const [candles, setCandles] = useState<Candle[]>([]);
  const [loading, setLoading] = useState(true);
  const [prediction, setPrediction] = useState<Prediction | null>(null);
  const [secondsToClose, setSecondsToClose] = useState(0);
  const [toggles, setToggles] = useState<IndicatorToggles>(DEFAULT_TOGGLES);
  const { updateMarks } = usePaper();

  const asset = useMemo(() => getAsset(symbol), [symbol]);
  const source = getMarketDataSource();

  useEffect(() => {
    let active = true;
    setLoading(true);
    void source.getCandles(symbol, timeframe, 3000).then((data) => {
      if (!active) return;
      setCandles([...data]);
      setLoading(false);
    });
    const unsubscribe = source.subscribe(symbol, timeframe, (candle, isNew) => {
      if (!active) return;
      setCandles((prev) => {
        if (prev.length === 0) return [candle];
        if (isNew) return [...prev.slice(-3499), candle];
        const next = [...prev];
        next[next.length - 1] = candle;
        return next;
      });
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [symbol, timeframe, source]);

  const indicators = useMemo(() => computeIndicators(candles), [candles]);

  // Mark price for paper positions
  const lastClose = candles.length ? candles[candles.length - 1]!.close : null;
  useEffect(() => {
    if (lastClose != null) updateMarks({ [symbol]: lastClose });
  }, [lastClose, symbol, updateMarks]);

  // Prediction refresh: on load, on new candle, and on a slow cadence
  const candleCount = candles.length;
  const lastCandleTime = candles.length ? candles[candles.length - 1]!.time : 0;
  useEffect(() => {
    if (candleCount < 60) return;
    let cancelled = false;
    const run = () => {
      void getPredictionService()
        .predict({ asset: symbol, timeframe, candles })
        .then((p) => {
          if (!cancelled) setPrediction(p);
        });
    };
    run();
    const interval = setInterval(run, 10_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, timeframe, lastCandleTime, candleCount >= 60]);

  useEffect(() => {
    const step = timeframeSeconds(timeframe);
    const tick = () => {
      const now = Math.floor(Date.now() / 1000);
      setSecondsToClose(step - (now % step));
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [timeframe]);

  const snapshot = useMemo<MarketSnapshot | null>(() => {
    if (candles.length < 30) return null;
    const step = timeframeSeconds(timeframe);
    const barsPerDay = Math.max(2, Math.round(86400 / step));
    const window = candles.slice(-Math.min(barsPerDay, candles.length));
    const last = candles[candles.length - 1]!;
    const reference = window[0]!.open;
    const ema21 = lastDefined(indicators.ema21);
    const ema50 = lastDefined(indicators.ema50);
    const atrValue = lastDefined(indicators.atr14);
    const trend: MarketSnapshot["trend"] =
      ema21 != null && ema50 != null
        ? ema21 > ema50 * 1.0008
          ? "UPTREND"
          : ema21 < ema50 * 0.9992
            ? "DOWNTREND"
            : "RANGE"
        : "RANGE";
    return {
      price: last.close,
      change24h: last.close - reference,
      change24hPct: (last.close - reference) / reference,
      volume: window.reduce((a, c) => a + c.volume, 0),
      volatility: realizedVolatility(candles, 20),
      rsi: lastDefined(indicators.rsi14),
      atr: atrValue,
      atrPct: atrValue != null ? atrValue / last.close : null,
      trend,
      high: Math.max(...window.map((c) => c.high)),
      low: Math.min(...window.map((c) => c.low)),
    };
  }, [candles, indicators, timeframe]);

  const setToggle = useCallback((key: keyof IndicatorToggles, value: boolean) => {
    setToggles((prev) => ({ ...prev, [key]: value }));
  }, []);

  const value = useMemo(
    () => ({
      asset,
      symbol,
      setSymbol,
      timeframe,
      setTimeframe,
      candles,
      indicators,
      snapshot,
      prediction,
      loading,
      secondsToClose,
      dataSourceId: source.id,
      isLiveData: source.isLive,
      toggles,
      setToggle,
    }),
    [
      asset,
      symbol,
      timeframe,
      candles,
      indicators,
      snapshot,
      prediction,
      loading,
      secondsToClose,
      source,
      toggles,
      setToggle,
    ],
  );

  return <MarketContext.Provider value={value}>{children}</MarketContext.Provider>;
}

export function useMarket(): MarketContextValue {
  const ctx = useContext(MarketContext);
  if (!ctx) throw new Error("useMarket must be used inside MarketProvider");
  return ctx;
}
