import { getMarketDataSource } from "./dataSource";
import { ASSETS, timeframeSeconds, type Timeframe } from "./types";

// Map TradingView resolutions to our Timeframe type
function mapResolutionToTimeframe(resolution: string): Timeframe {
  switch (resolution) {
    case "1":
      return "1m";
    case "5":
      return "5m";
    case "15":
      return "15m";
    case "60":
      return "1h";
    case "240":
      return "4h";
    case "1D":
    case "D":
      return "1d";
    default:
      return "5m";
  }
}

// Datafeed configuration
const configurationData = {
  supports_search: true,
  supports_group_request: false,
  supports_marks: false,
  supports_timescale_marks: false,
  supports_time: true,
  exchanges: [
    { value: "Crypto", name: "Crypto", desc: "Cryptocurrency Market" },
    { value: "Index", name: "Index", desc: "Stock Indices" },
    { value: "Equity", name: "Equity", desc: "Individual Equities" },
  ],
  symbols_types: [
    { name: "All types", value: "" },
    { name: "Crypto", value: "crypto" },
    { name: "Stock", value: "equity" },
    { name: "Index", value: "index" },
  ],
  supported_resolutions: ["1", "5", "15", "60", "240", "1D"],
};

// Store active subscriptions to push updates
const activeSubscriptions = new Map<string, () => void>();

export const tvDatafeed = {
  // 1. onReady
  onReady: (callback: (config: typeof configurationData) => void) => {
    console.log("[tvDatafeed] onReady: Method call");
    setTimeout(() => callback(configurationData), 0);
  },

  // 2. searchSymbols
  searchSymbols: (
    userInput: string,
    exchange: string,
    symbolType: string,
    onResultReadyCallback: (result: any[]) => void,
  ) => {
    console.log("[tvDatafeed] searchSymbols: Method call", { userInput, exchange, symbolType });
    const query = userInput.toLowerCase();
    const results = ASSETS.filter((asset) => {
      const matchesQuery =
        asset.symbol.toLowerCase().includes(query) || asset.name.toLowerCase().includes(query);
      const matchesExchange = !exchange || asset.kind.toLowerCase() === exchange.toLowerCase();
      const matchesType = !symbolType || asset.kind.toLowerCase() === symbolType.toLowerCase();
      return matchesQuery && matchesExchange && matchesType;
    }).map((asset) => ({
      symbol: asset.symbol,
      full_name: asset.symbol,
      description: asset.name,
      exchange: asset.kind === "crypto" ? "Crypto" : asset.kind === "index" ? "Index" : "Equity",
      ticker: asset.symbol,
      type: asset.kind,
    }));

    setTimeout(() => onResultReadyCallback(results), 0);
  },

  // 3. resolveSymbol
  resolveSymbol: (
    symbolName: string,
    onSymbolResolvedCallback: (symbolInfo: any) => void,
    onResolveErrorCallback: (reason: string) => void,
  ) => {
    console.log("[tvDatafeed] resolveSymbol: Method call", symbolName);
    try {
      const asset = ASSETS.find((a) => a.symbol === symbolName || a.name === symbolName);
      if (!asset) {
        onResolveErrorCallback("unknown_symbol");
        return;
      }

      const symbolInfo = {
        ticker: asset.symbol,
        name: asset.symbol,
        description: asset.name,
        type: asset.kind,
        session: "24x7", // Simulated 24/7 session
        timezone: "Etc/UTC",
        exchange: asset.kind === "crypto" ? "Crypto" : asset.kind === "index" ? "Index" : "Equity",
        minmov: 1,
        pricescale: Math.round(10 ** asset.pricePrecision),
        has_intraday: true,
        has_weekly_and_monthly: false,
        supported_resolutions: ["1", "5", "15", "60", "240", "1D"],
        volume_precision: 2,
        data_status: "streaming",
      };

      setTimeout(() => onSymbolResolvedCallback(symbolInfo), 0);
    } catch (err: any) {
      onResolveErrorCallback(err?.message || "Failed to resolve symbol");
    }
  },

  // 4. getBars
  getBars: async (
    symbolInfo: any,
    resolution: string,
    periodParams: { from: number; to: number; countBack: number },
    onHistoryCallback: (bars: any[], meta: { noData?: boolean }) => void,
    onErrorCallback: (reason: string) => void,
  ) => {
    console.log("[tvDatafeed] getBars: Method call", {
      ticker: symbolInfo.ticker,
      resolution,
      from: periodParams.from,
      to: periodParams.to,
      countBack: periodParams.countBack,
    });

    const timeframe = mapResolutionToTimeframe(resolution);

    try {
      // Get the candles from our local hybrid datasource
      const candles = await getMarketDataSource().getCandles(
        symbolInfo.ticker,
        timeframe,
        periodParams.countBack,
      );

      if (candles.length === 0) {
        onHistoryCallback([], { noData: true });
        return;
      }

      // Convert candles to TradingView expected format:
      // ascending chronological order, with timestamps in milliseconds
      const tvBars = candles.map((c) => ({
        time: c.time * 1000, // Unix seconds to milliseconds
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
      }));

      setTimeout(() => {
        onHistoryCallback(tvBars, { noData: false });
      }, 0);
    } catch (err: any) {
      onErrorCallback(err?.message || "Failed to retrieve historical bars");
    }
  },

  // 5. subscribeBars
  subscribeBars: (
    symbolInfo: any,
    resolution: string,
    onRealtimeCallback: (bar: any) => void,
    subscriberUID: string,
    onResetCacheNeededCallback: () => void,
  ) => {
    console.log("[tvDatafeed] subscribeBars: Method call", {
      ticker: symbolInfo.ticker,
      resolution,
      subscriberUID,
    });

    const timeframe = mapResolutionToTimeframe(resolution);

    // Cancel existing subscription for this UID if any
    if (activeSubscriptions.has(subscriberUID)) {
      activeSubscriptions.get(subscriberUID)!();
    }

    // Subscribe to updates from our hybrid datasource
    const unsubscribe = getMarketDataSource().subscribe(symbolInfo.ticker, timeframe, (candle) => {
      onRealtimeCallback({
        time: candle.time * 1000,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
      });
    });

    activeSubscriptions.set(subscriberUID, unsubscribe);
  },

  // 6. unsubscribeBars
  unsubscribeBars: (subscriberUID: string) => {
    console.log("[tvDatafeed] unsubscribeBars: Method call", subscriberUID);
    const unsubscribe = activeSubscriptions.get(subscriberUID);
    if (unsubscribe) {
      unsubscribe();
      activeSubscriptions.delete(subscriberUID);
    }
  },

  // 7. getServerTime
  getServerTime: (callback: (time: number) => void) => {
    setTimeout(() => callback(Math.floor(Date.now() / 1000)), 0);
  },
};
