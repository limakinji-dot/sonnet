"use client";

import { useEffect, useState } from "react";
import { useTrading } from "@/hooks/useTradingContext";
import { motion, AnimatePresence } from "framer-motion";

interface TradeHistoryTableProps {
  limit?: number;
  compact?: boolean;
}

function formatPrice(n: number | undefined) {
  if (n === undefined || n === null) return "—";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  });
}

export default function TradeHistoryTable({ limit = 20, compact = false }: TradeHistoryTableProps) {
  const { state } = useTrading();
  const [history, setHistory] = useState<any[]>([]);

  useEffect(() => {
    const closed = (state.signals || [])
      .filter((s: any) => s.result === "TP" || s.result === "SL")
      .slice(0, limit);
    setHistory(closed);
  }, [state.signals, limit]);

  const headers = compact
    ? ["PAIR", "DIR", "ENTRY", "CLOSE", "PnL %"]
    : ["PAIR", "DIR", "ENTRY", "TP1", "TP2", "MAX", "CLOSE", "PnL %"];

  return (
    <div className="overflow-x-auto -mx-2 px-2">
      <table className="w-full min-w-[500px]">
        <thead>
          <tr className="border-b border-white/5">
            {headers.map((h) => (
              <th
                key={h}
                className="text-left py-2 px-2 text-[8px] font-mono text-white/20 tracking-widest"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <AnimatePresence>
            {history.map((sig, i) => (
              <motion.tr
                key={sig.id || i}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="border-b border-white/[0.02] hover:bg-white/[0.02] transition-colors"
              >
                <td className="py-2.5 px-2 text-[10px] font-mono text-white font-medium">
                  {sig.symbol.replace("_USDT", "")}
                </td>
                <td className="py-2.5 px-2">
                  <span
                    className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${
                      sig.decision === "LONG"
                        ? "bg-[#4ade80]/10 text-[#4ade80]"
                        : "bg-[#f87171]/10 text-[#f87171]"
                    }`}
                  >
                    {sig.decision}
                  </span>
                </td>
                <td className="py-2.5 px-2 text-[10px] font-mono text-white/60">
                  ${formatPrice(sig.entry)}
                </td>

                {!compact && (
                  <>
                    <td className="py-2.5 px-2 text-[10px] font-mono text-[#d4a847]">
                      ${formatPrice(sig.tp1)}
                    </td>
                    <td className="py-2.5 px-2 text-[10px] font-mono text-[#d4a847]/80">
                      ${formatPrice(sig.tp2)}
                    </td>
                    <td className="py-2.5 px-2 text-[10px] font-mono text-[#d4a847]/60">
                      ${formatPrice(sig.tp_max)}
                    </td>
                  </>
                )}

                <td className="py-2.5 px-2 text-[10px] font-mono text-white/60">
                  ${formatPrice(sig.closed_price)}
                </td>
                <td
                  className={`py-2.5 px-2 text-[10px] font-mono font-bold ${
                    (sig.pnl_pct || 0) >= 0 ? "text-[#4ade80]" : "text-[#f87171]"
                  }`}
                >
                  {(sig.pnl_pct || 0) >= 0 ? "+" : ""}
                  {sig.pnl_pct?.toFixed(2)}%
                </td>
              </motion.tr>
            ))}
          </AnimatePresence>
        </tbody>
      </table>

      {history.length === 0 && (
        <div className="text-center py-8">
          <p className="text-[10px] font-mono text-white/20 tracking-widest">
            NO TRADE HISTORY
          </p>
        </div>
      )}
    </div>
  );
}
