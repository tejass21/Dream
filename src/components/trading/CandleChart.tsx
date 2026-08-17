import { useEffect, useRef, useState } from "react";

import { useMarket } from "@/lib/market/MarketProvider";
import { cn } from "@/lib/utils";
import { TradingViewChart } from "./TradingViewChart";
import { HelpCircle, X, Download } from "lucide-react";

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
 * Browser-only hybrid candlestick chart.
 * Dynamically loads the Advanced TradingView Charting Library if files are present in public/charting_library.
 * Falls back to open-source lightweight-charts if the commercial files are missing.
 */
export function CandleChart() {
  const { candles, indicators, prediction, toggles, asset, symbol, timeframe } = useMarket();
  
  const [useAdvanced, setUseAdvanced] = useState(true);
  const [tvError, setTvError] = useState<string | null>(null);
  const [showSetupHelp, setShowSetupHelp] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ChartApi | null>(null);
  const seriesRef = useRef<Partial<Record<SeriesKey, SeriesApi>>>({});
  const markersRef = useRef<{ setMarkers: (m: never[]) => void } | null>(null);
  const [ready, setReady] = useState(false);

  // create lightweight chart if advanced is disabled or has error
  useEffect(() => {
    if (useAdvanced && !tvError) return;

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
  }, [asset.pricePrecision, useAdvanced, tvError]);

  // push data to lightweight chart
  useEffect(() => {
    if (useAdvanced && !tvError) return;
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
  }, [ready, candles, indicators, toggles, useAdvanced, tvError]);

  // prediction marker on lightweight chart
  useEffect(() => {
    if (useAdvanced && !tvError) return;
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
  }, [ready, prediction, toggles.predictionMarker, useAdvanced, tvError]);

  return (
    <div className="relative h-full w-full bg-[#121419] overflow-hidden rounded-md border border-panel-border">
      {/* Chart engine status badge */}
      <div className="absolute left-2 top-2 z-10 flex items-center gap-2">
        <button
          onClick={() => setShowSetupHelp(true)}
          className={cn(
            "flex items-center gap-1.5 rounded-sm bg-[#1b2230] hover:bg-[#252f42] border border-[#2c374d] px-2 py-1 text-[10px] font-semibold transition-colors uppercase tracking-wider num",
            useAdvanced && !tvError ? "text-bull" : "text-amber-400"
          )}
        >
          <span className={cn("h-1.5 w-1.5 rounded-full", useAdvanced && !tvError ? "bg-bull animate-pulse" : "bg-amber-400")} />
          {useAdvanced && !tvError ? "TradingView Advanced" : "Lightweight (TV Config)"}
          <HelpCircle className="size-3 text-muted-foreground ml-0.5" />
        </button>
      </div>

      {/* Render selected chart */}
      {useAdvanced && !tvError ? (
        <TradingViewChart
          symbol={symbol}
          timeframe={timeframe}
          onLoadError={(err) => {
            console.warn("Failed to load TradingView advanced widget", err);
            setTvError(err.message);
            setUseAdvanced(false);
          }}
        />
      ) : (
        <div className="relative h-full w-full">
          <div ref={containerRef} className="h-full w-full" />
          <div className="pointer-events-none absolute left-2 top-11 flex gap-3 num text-[10px]">
            {toggles.ema9 && <LegendItem color="text-[#3fc7e0]" label="EMA 9" />}
            {toggles.ema21 && <LegendItem color="text-[#e0b23f]" label="EMA 21" />}
            {toggles.ema50 && <LegendItem color="text-[#b07ff0]" label="EMA 50" />}
          </div>
          {!ready && (
            <div className="absolute inset-0 flex items-center justify-center label-xs text-muted-foreground">
              Loading lightweight chart…
            </div>
          )}
        </div>
      )}

      {/* Setup instructions modal */}
      {showSetupHelp && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs">
          <div className="relative w-full max-w-md rounded-lg border border-[#2c374d] bg-[#161b26] p-5 text-foreground shadow-2xl animate-in fade-in-50 zoom-in-95 duration-200">
            <button
              onClick={() => setShowSetupHelp(false)}
              className="absolute right-3 top-3 text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="size-4" />
            </button>

            <h3 className="text-sm font-semibold tracking-wide flex items-center gap-2 mb-3">
              <Download className="size-4 text-primary" />
              TradingView Advanced Charts Integration
            </h3>
            
            <p className="text-xs text-muted-foreground leading-relaxed mb-4">
              This terminal includes a custom implemented **Datafeed API** linked to the market data system. To load the professional TradingView terminal interface (with custom indicators, tools, and multi-panes):
            </p>

            <div className="space-y-3.5 text-[11px] text-muted-foreground bg-[#10141d] p-3.5 rounded border border-[#222b3d] mb-4">
              <div>
                <p className="font-semibold text-foreground mb-1">1. Download Charting Library Files</p>
                <p>Download the private repository zip containing TradingView's Advanced Charts (typically named `charting_library`).</p>
              </div>
              <div>
                <p className="font-semibold text-foreground mb-1">2. Place in Public Folder</p>
                <p>Copy the unzipped `charting_library` folder to the `public/` directory of this project.</p>
                <p className="font-mono text-[10px] text-primary/80 mt-1 bg-[#1a2336] p-1 rounded inline-block">
                  public/charting_library/charting_library.js
                </p>
              </div>
              <div>
                <p className="font-semibold text-foreground mb-1">3. Refresh and Connect</p>
                <p>Refresh the browser. The chart will dynamically detect the library and spin up the Advanced TradingView terminal automatically.</p>
              </div>
            </div>

            <div className="flex gap-2 justify-end">
              {tvError && (
                <button
                  onClick={() => {
                    setTvError(null);
                    setUseAdvanced(true);
                    setShowSetupHelp(false);
                  }}
                  className="rounded bg-primary hover:bg-primary/95 text-primary-foreground px-3 py-1.5 text-xs font-semibold transition-colors"
                >
                  Retry Loading
                </button>
              )}
              <button
                onClick={() => setShowSetupHelp(false)}
                className="rounded bg-[#202736] hover:bg-[#2a3449] border border-[#2d384f] text-foreground px-3 py-1.5 text-xs font-semibold transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return <span className={cn("font-medium", color)}>{label}</span>;
}
