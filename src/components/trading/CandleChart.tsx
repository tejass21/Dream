import { useEffect, useRef, useState } from "react";

import { useMarket } from "@/lib/market/MarketProvider";
import { cn } from "@/lib/utils";

type ChartApi = {
  remove: () => void;
  timeScale: () => { fitContent: () => void };
  applyOptions: (o: unknown) => void;
};

interface SeriesApi {
  setData: (data: unknown[]) => void;
  setMarkers?: (markers: unknown[]) => void;
  applyOptions?: (o: unknown) => void;
  priceScale?: () => { applyOptions: (o: unknown) => void };
}

type SeriesKey = "candles" | "volume" | "ema9" | "ema21" | "ema50";

const COLORS = {
  bull: "#2ecc8a",
  bear: "#f0553a",
  neutral: "#9aa3b2",
  grid: "rgba(255,255,255,0.045)",
  text: "#8b93a3",
  ema9: "#3fc7e0",
  ema21: "#e0b23f",
  ema50: "#b07ff0",
};

/**
 * Browser-only candlestick chart. lightweight-charts is imported dynamically so
 * it never runs during SSR.
 */
export function CandleChart() {
  const { candles, indicators, prediction, toggles, asset } = useMarket();
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ChartApi | null>(null);
  const seriesRef = useRef<Partial<Record<SeriesKey, SeriesApi>>>({});
  const markersRef = useRef<{ setMarkers: (m: never[]) => void } | null>(null);
  const [ready, setReady] = useState(false);

  // create chart once
  useEffect(() => {
    let disposed = false;
    const container = containerRef.current;
    if (!container) return;

    void (async () => {
      const lc = await import("lightweight-charts");
      if (disposed || !containerRef.current) return;

      const chart = lc.createChart(containerRef.current, {
        layout: {
          background: { color: "transparent" },
          textColor: COLORS.text,
          fontFamily: "JetBrains Mono, monospace",
          fontSize: 10,
          attributionLogo: false,
        },
        grid: {
          vertLines: { color: COLORS.grid },
          horzLines: { color: COLORS.grid },
        },
        rightPriceScale: { borderColor: "rgba(255,255,255,0.08)", scaleMargins: { top: 0.08, bottom: 0.26 } },
        timeScale: { borderColor: "rgba(255,255,255,0.08)", timeVisible: true, secondsVisible: false },
        crosshair: { mode: lc.CrosshairMode.Normal },
        handleScroll: true,
        handleScale: true,
      }) as unknown as ChartApi;

      const candleSeries = (chart as unknown as {
        addSeries: (t: unknown, o?: unknown) => SeriesApi;
      }).addSeries(lc.CandlestickSeries, {
        upColor: COLORS.bull,
        downColor: COLORS.bear,
        wickUpColor: COLORS.bull,
        wickDownColor: COLORS.bear,
        borderVisible: false,
        priceFormat: { type: "price", precision: asset.pricePrecision, minMove: 10 ** -asset.pricePrecision },
      });

      const addSeries = (chart as unknown as {
        addSeries: (t: unknown, o?: unknown, pane?: number) => SeriesApi;
      }).addSeries;

      const volumeSeries = addSeries.call(
        chart,
        lc.HistogramSeries,
        { priceFormat: { type: "volume" }, priceScaleId: "vol" },
      );
      volumeSeries.priceScale?.().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });

      const mkLine = (color: string) =>
        addSeries.call(chart, lc.LineSeries, {
          color,
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });

      seriesRef.current = {
        candles: candleSeries,
        volume: volumeSeries,
        ema9: mkLine(COLORS.ema9),
        ema21: mkLine(COLORS.ema21),
        ema50: mkLine(COLORS.ema50),
      };

      markersRef.current = lc.createSeriesMarkers(candleSeries as never, []) as unknown as {
        setMarkers: (m: never[]) => void;
      };
      chartRef.current = chart;
      setReady(true);

      const observer = new ResizeObserver(() => {
        if (!containerRef.current) return;
        chart.applyOptions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      });
      observer.observe(containerRef.current);

      return () => observer.disconnect();
    })();

    return () => {
      disposed = true;
      chartRef.current?.remove();
      chartRef.current = null;
      seriesRef.current = {};
      markersRef.current = null;
      setReady(false);
    };
  }, [asset.pricePrecision]);

  // push data
  useEffect(() => {
    if (!ready || candles.length === 0) return;
    const s = seriesRef.current;
    s.candles?.setData(
      candles.map((c) => ({
        time: c.time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      })),
    );
    s.volume?.setData(
      toggles.volume
        ? candles.map((c) => ({
            time: c.time,
            value: c.volume,
            color: c.close >= c.open ? "rgba(46,204,138,0.35)" : "rgba(240,85,58,0.35)",
          }))
        : [],
    );
    const lineData = (series: (number | null)[]) =>
      candles
        .map((c, i) => ({ time: c.time, value: series[i] }))
        .filter((p): p is { time: number; value: number } => p.value != null);

    s.ema9?.setData(toggles.ema9 ? lineData(indicators.ema9) : []);
    s.ema21?.setData(toggles.ema21 ? lineData(indicators.ema21) : []);
    s.ema50?.setData(toggles.ema50 ? lineData(indicators.ema50) : []);
  }, [ready, candles, indicators, toggles]);

  // prediction marker
  useEffect(() => {
    if (!ready || !markersRef.current) return;
    if (!toggles.predictionMarker || !prediction) {
      markersRef.current.setMarkers([] as never[]);
      return;
    }
    const color =
      prediction.direction === "UP"
        ? COLORS.bull
        : prediction.direction === "DOWN"
          ? COLORS.bear
          : COLORS.neutral;
    markersRef.current.setMarkers([
      {
        time: prediction.timestamp,
        position: prediction.direction === "DOWN" ? "aboveBar" : "belowBar",
        color,
        shape: prediction.direction === "DOWN" ? "arrowDown" : "arrowUp",
        text: `${prediction.direction} ${(
          (prediction.direction === "UP"
            ? prediction.upProbability
            : prediction.direction === "DOWN"
              ? prediction.downProbability
              : prediction.sidewaysProbability) * 100
        ).toFixed(1)}%`,
      },
    ] as unknown as never[]);
  }, [ready, prediction, toggles.predictionMarker]);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      <div className="pointer-events-none absolute left-2 top-2 flex gap-3 num text-[10px]">
        {toggles.ema9 && <LegendItem color="text-[#3fc7e0]" label="EMA 9" />}
        {toggles.ema21 && <LegendItem color="text-[#e0b23f]" label="EMA 21" />}
        {toggles.ema50 && <LegendItem color="text-[#b07ff0]" label="EMA 50" />}
      </div>
      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center label-xs">Loading chart…</div>
      )}
    </div>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return <span className={cn("font-medium", color)}>{label}</span>;
}
