import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";

import {
  computeStats,
  emptyAccount,
  positionPnl,
  type PaperAccount,
  type PaperPosition,
  type PaperStats,
  type Side,
} from "./types";

const STORAGE_KEY = "candleai.paper.account.v1";

interface OpenParams {
  asset: string;
  side: Side;
  notional: number;
  price: number;
  stopLoss: number | null;
  takeProfit: number | null;
}

interface PaperContextValue {
  account: PaperAccount;
  stats: PaperStats;
  paperTradingEnabled: boolean;
  setPaperTradingEnabled: (v: boolean) => void;
  openPosition: (params: OpenParams) => void;
  closePosition: (id: string, price: number, reason?: "manual" | "stop-loss" | "take-profit") => void;
  closeAll: (prices: Record<string, number>) => void;
  reset: () => void;
  updateMarks: (prices: Record<string, number>) => void;
}

const PaperContext = createContext<PaperContextValue | null>(null);

function loadAccount(): PaperAccount {
  if (typeof window === "undefined") return emptyAccount();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyAccount();
    const parsed = JSON.parse(raw) as PaperAccount;
    if (typeof parsed.balance !== "number" || !Array.isArray(parsed.positions)) return emptyAccount();
    return { ...emptyAccount(), ...parsed };
  } catch {
    return emptyAccount();
  }
}

export function PaperProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<PaperAccount>(() => emptyAccount());
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [paperTradingEnabled, setPaperTradingEnabled] = useState(true);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setAccount(loadAccount());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(account));
  }, [account, hydrated]);

  const closePosition = useCallback(
    (id: string, price: number, reason: "manual" | "stop-loss" | "take-profit" = "manual") => {
      setAccount((prev) => {
        const position = prev.positions.find((p) => p.id === id);
        if (!position) return prev;
        const pnl = positionPnl(position, price);
        const balance = prev.balance + pnl;
        const now = Math.floor(Date.now() / 1000);
        return {
          ...prev,
          balance,
          positions: prev.positions.filter((p) => p.id !== id),
          trades: [
            {
              id: position.id,
              asset: position.asset,
              side: position.side,
              quantity: position.quantity,
              entryPrice: position.entryPrice,
              exitPrice: price,
              pnl,
              pnlPct: pnl / position.notional,
              openedAt: position.openedAt,
              closedAt: now,
              reason,
            },
            ...prev.trades,
          ].slice(0, 500),
          equityHistory: [...prev.equityHistory, { time: now, equity: balance }].slice(-500),
        };
      });
    },
    [],
  );

  const openPosition = useCallback(
    ({ asset, side, notional, price, stopLoss, takeProfit }: OpenParams) => {
      if (notional <= 0 || price <= 0) return;
      setAccount((prev) => {
        if (notional > prev.balance) {
          toast.error("Insufficient virtual balance for this position size");
          return prev;
        }
        const position: PaperPosition = {
          id: `${asset}-${Date.now()}`,
          asset,
          side,
          notional,
          quantity: notional / price,
          entryPrice: price,
          stopLoss,
          takeProfit,
          openedAt: Math.floor(Date.now() / 1000),
        };
        return { ...prev, positions: [position, ...prev.positions] };
      });
      toast.success(`Paper ${side} ${asset} opened at ${price.toFixed(2)}`);
    },
    [],
  );

  const updateMarks = useCallback((next: Record<string, number>) => {
    setPrices((prev) => ({ ...prev, ...next }));
  }, []);

  // Stop-loss / take-profit evaluation against latest marks
  useEffect(() => {
    for (const position of account.positions) {
      const mark = prices[position.asset];
      if (!mark) continue;
      const hitSl =
        position.stopLoss != null &&
        (position.side === "LONG" ? mark <= position.stopLoss : mark >= position.stopLoss);
      const hitTp =
        position.takeProfit != null &&
        (position.side === "LONG" ? mark >= position.takeProfit : mark <= position.takeProfit);
      if (hitSl || hitTp) {
        const exit = hitSl ? position.stopLoss! : position.takeProfit!;
        closePosition(position.id, exit, hitSl ? "stop-loss" : "take-profit");
        toast.info(`${position.asset} ${hitSl ? "stop loss" : "take profit"} triggered at ${exit.toFixed(2)}`);
      }
    }
  }, [prices, account.positions, closePosition]);

  const closeAll = useCallback(
    (markPrices: Record<string, number>) => {
      for (const position of account.positions) {
        closePosition(position.id, markPrices[position.asset] ?? position.entryPrice);
      }
    },
    [account.positions, closePosition],
  );

  const reset = useCallback(() => {
    setAccount(emptyAccount());
    toast.success("Paper trading account reset to $10,000");
  }, []);

  const stats = useMemo(() => computeStats(account, prices), [account, prices]);

  const value = useMemo(
    () => ({
      account,
      stats,
      paperTradingEnabled,
      setPaperTradingEnabled,
      openPosition,
      closePosition,
      closeAll,
      reset,
      updateMarks,
    }),
    [account, stats, paperTradingEnabled, openPosition, closePosition, closeAll, reset, updateMarks],
  );

  return <PaperContext.Provider value={value}>{children}</PaperContext.Provider>;
}

export function usePaper(): PaperContextValue {
  const ctx = useContext(PaperContext);
  if (!ctx) throw new Error("usePaper must be used inside PaperProvider");
  return ctx;
}
