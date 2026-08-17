export type Side = "LONG" | "SHORT";

export interface PaperPosition {
  id: string;
  asset: string;
  side: Side;
  /** notional value at entry, in quote currency */
  notional: number;
  quantity: number;
  entryPrice: number;
  stopLoss: number | null;
  takeProfit: number | null;
  openedAt: number;
}

export interface PaperTrade {
  id: string;
  asset: string;
  side: Side;
  quantity: number;
  entryPrice: number;
  exitPrice: number;
  pnl: number;
  pnlPct: number;
  openedAt: number;
  closedAt: number;
  reason: "manual" | "stop-loss" | "take-profit";
}

export interface PaperAccount {
  startingBalance: number;
  balance: number;
  positions: PaperPosition[];
  trades: PaperTrade[];
  equityHistory: { time: number; equity: number }[];
}

export const STARTING_BALANCE = 10_000;

export function emptyAccount(): PaperAccount {
  return {
    startingBalance: STARTING_BALANCE,
    balance: STARTING_BALANCE,
    positions: [],
    trades: [],
    equityHistory: [{ time: Math.floor(Date.now() / 1000), equity: STARTING_BALANCE }],
  };
}

export function positionPnl(position: PaperPosition, markPrice: number): number {
  const diff = markPrice - position.entryPrice;
  return (position.side === "LONG" ? diff : -diff) * position.quantity;
}

export interface PaperStats {
  realizedPnl: number;
  unrealizedPnl: number;
  equity: number;
  winRate: number;
  trades: number;
  wins: number;
  losses: number;
  maxDrawdown: number;
  returnPct: number;
}

export function computeStats(account: PaperAccount, prices: Record<string, number>): PaperStats {
  const realizedPnl = account.trades.reduce((a, t) => a + t.pnl, 0);
  const unrealizedPnl = account.positions.reduce(
    (a, p) => a + positionPnl(p, prices[p.asset] ?? p.entryPrice),
    0,
  );
  const equity = account.balance + unrealizedPnl;
  const wins = account.trades.filter((t) => t.pnl > 0).length;
  const losses = account.trades.filter((t) => t.pnl <= 0).length;

  let peak = account.startingBalance;
  let maxDrawdown = 0;
  for (const point of [...account.equityHistory, { time: Date.now() / 1000, equity }]) {
    peak = Math.max(peak, point.equity);
    const dd = peak === 0 ? 0 : (peak - point.equity) / peak;
    maxDrawdown = Math.max(maxDrawdown, dd);
  }

  return {
    realizedPnl,
    unrealizedPnl,
    equity,
    winRate: account.trades.length ? wins / account.trades.length : 0,
    trades: account.trades.length,
    wins,
    losses,
    maxDrawdown,
    returnPct: (equity - account.startingBalance) / account.startingBalance,
  };
}
