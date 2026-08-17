import { useEffect, useRef, useState } from "react";
import { tvDatafeed } from "@/lib/market/tvDatafeed";
import type { Timeframe } from "@/lib/market/types";

interface TradingViewChartProps {
  symbol: string;
  timeframe: Timeframe;
  onLoadError: (err: Error) => void;
}

function mapTimeframeToResolution(timeframe: Timeframe): string {
  switch (timeframe) {
    case "1m":
      return "1";
    case "5m":
      return "5";
    case "15m":
      return "15";
    case "1h":
      return "60";
    case "4h":
      return "240";
    case "1d":
      return "1D";
    default:
      return "5";
  }
}

export function TradingViewChart({ symbol, timeframe, onLoadError }: TradingViewChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<any>(null);
  const [ready, setReady] = useState(false);
  const [scriptLoaded, setScriptLoaded] = useState(false);

  // Load the script
  useEffect(() => {
    let active = true;

    const loadScript = () => {
      if ((window as any).TradingView) {
        if (active) setScriptLoaded(true);
        return;
      }

      const script = document.createElement("script");
      script.id = "tradingview-charting-library-script";
      script.src = "/charting_library/charting_library.js";
      script.type = "text/javascript";
      script.async = true;

      script.onload = () => {
        if ((window as any).TradingView) {
          if (active) setScriptLoaded(true);
        } else {
          if (active) onLoadError(new Error("TradingView script loaded but namespace not found"));
        }
      };

      script.onerror = () => {
        if (active) onLoadError(new Error("TradingView charting library not found in public/charting_library"));
      };

      document.head.appendChild(script);
    };

    loadScript();

    return () => {
      active = false;
    };
  }, [onLoadError]);

  // Create the widget
  useEffect(() => {
    if (!scriptLoaded || !containerRef.current) return;

    let isDisposed = false;
    const containerId = "tv_chart_container";

    // Prepare container
    containerRef.current.id = containerId;

    try {
      const widget = new (window as any).TradingView.widget({
        symbol: symbol,
        interval: mapTimeframeToResolution(timeframe),
        container: containerId,
        datafeed: tvDatafeed,
        library_path: "/charting_library/",
        locale: "en",
        disabled_features: [
          "use_localstorage_for_settings",
          "header_symbol_search",
          "symbol_search_hot_key",
        ],
        enabled_features: [],
        fullscreen: false,
        autosize: true,
        theme: "Dark",
        style: "1",
        timezone: "Etc/UTC",
        studies_overrides: {},
        overrides: {
          "paneProperties.background": "#121419",
          "paneProperties.backgroundType": "solid",
          "paneProperties.vertGridProperties.color": "rgba(255,255,255,0.03)",
          "paneProperties.horzGridProperties.color": "rgba(255,255,255,0.03)",
          "scalesProperties.textColor": "#8b93a3",
          "scalesProperties.lineColor": "rgba(255,255,255,0.08)",
          "mainSeriesProperties.candleStyle.upColor": "#2ecc8a",
          "mainSeriesProperties.candleStyle.downColor": "#f0553a",
          "mainSeriesProperties.candleStyle.wickUpColor": "#2ecc8a",
          "mainSeriesProperties.candleStyle.wickDownColor": "#f0553a",
          "mainSeriesProperties.candleStyle.borderVisible": false,
        },
      });

      widget.onChartReady(() => {
        if (isDisposed) return;
        widgetRef.current = widget;
        setReady(true);
      });
    } catch (err: any) {
      onLoadError(err || new Error("Failed to initialize TradingView widget"));
    }

    return () => {
      isDisposed = true;
      if (widgetRef.current) {
        try {
          widgetRef.current.remove();
        } catch (e) {
          console.warn("Error removing TradingView widget", e);
        }
        widgetRef.current = null;
        setReady(false);
      }
    };
  }, [scriptLoaded, onLoadError]);

  // Update symbol / resolution when props change
  useEffect(() => {
    if (ready && widgetRef.current) {
      try {
        const chart = widgetRef.current.chart();
        const currentSymbol = chart.symbol();
        const currentResolution = chart.resolution();
        const targetResolution = mapTimeframeToResolution(timeframe);

        if (currentSymbol !== symbol || currentResolution !== targetResolution) {
          widgetRef.current.setSymbol(symbol, targetResolution, () => {
            console.log(`[TradingViewChart] Set symbol to ${symbol} (${targetResolution})`);
          });
        }
      } catch (err) {
        console.warn("Failed to dynamically update symbol/interval in TradingView Widget", err);
      }
    }
  }, [symbol, timeframe, ready]);

  return (
    <div className="relative h-full w-full bg-[#121419]">
      <div ref={containerRef} className="h-full w-full" />
      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center label-xs bg-[#121419]/80 text-[#8b93a3]">
          Loading TradingView Widget...
        </div>
      )}
    </div>
  );
}
