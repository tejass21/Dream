import { useMemo } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { useMarket } from "@/lib/market/MarketProvider";
import { Panel } from "./Panel";

const AXIS = { stroke: "var(--muted-foreground)", fontSize: 9, fontFamily: "JetBrains Mono, monospace" };

export function IndicatorPanes() {
  const { candles, indicators, toggles } = useMarket();

  const data = useMemo(() => {
    const slice = candles.slice(-90);
    const offset = candles.length - slice.length;
    return slice.map((c, i) => {
      const idx = offset + i;
      const m = indicators.macd[idx];
      return {
        time: new Date(c.time * 1000).toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
        }),
        rsi: indicators.rsi14[idx] ?? null,
        macd: m?.macd ?? null,
        signal: m?.signal ?? null,
        histogram: m?.histogram ?? null,
      };
    });
  }, [candles, indicators]);

  if (!toggles.rsi && !toggles.macd) return null;

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {toggles.rsi && (
        <Panel title="RSI (14)" bodyClassName="p-2">
          <div className="h-[130px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
                <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                <XAxis dataKey="time" tick={AXIS} interval="preserveStartEnd" minTickGap={40} />
                <YAxis domain={[0, 100]} ticks={[30, 50, 70]} tick={AXIS} width={34} />
                <ReferenceLine y={70} stroke="var(--bear)" strokeDasharray="3 3" />
                <ReferenceLine y={30} stroke="var(--bull)" strokeDasharray="3 3" />
                <Tooltip content={<ChartTooltip />} />
                <Line
                  type="monotone"
                  dataKey="rsi"
                  stroke="var(--primary)"
                  strokeWidth={1.4}
                  dot={false}
                  connectNulls
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      )}

      {toggles.macd && (
        <Panel title="MACD (12, 26, 9)" bodyClassName="p-2">
          <div className="h-[130px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
                <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                <XAxis dataKey="time" tick={AXIS} interval="preserveStartEnd" minTickGap={40} />
                <YAxis tick={AXIS} width={34} />
                <ReferenceLine y={0} stroke="rgba(255,255,255,0.15)" />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="histogram" fill="var(--neutral)" opacity={0.5} />
                <Line type="monotone" dataKey="macd" stroke="var(--chart-1)" strokeWidth={1.3} dot={false} connectNulls />
                <Line
                  type="monotone"
                  dataKey="signal"
                  stroke="var(--chart-4)"
                  strokeWidth={1.3}
                  dot={false}
                  connectNulls
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      )}
    </div>
  );
}

export function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { name?: string | number; value?: number | string; color?: string }[];
  label?: string | number;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="panel num px-2 py-1.5 text-[10px] shadow-lg">
      <p className="text-muted-foreground">{label}</p>
      {payload.map((p) => (
        <p key={String(p.name)} style={{ color: p.color }}>
          {p.name}: {typeof p.value === "number" ? p.value.toFixed(3) : p.value}
        </p>
      ))}
    </div>
  );
}
