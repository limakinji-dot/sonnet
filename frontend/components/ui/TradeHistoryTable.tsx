"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { formatPrice, cn } from "@/lib/utils";
import type { Signal } from "@/lib/types";

interface TradeHistoryTableProps {
  limit?: number;
  compact?: boolean;
}

export default function TradeHistoryTable({ limit = 20, compact = false }: TradeHistoryTableProps) {
  const [history, setHistory] = useState<Signal[]>([]);

  useEffect(() => {
    fetch(`/api/history/signals?limit=${limit}`)
      .then((r) => r.json())
      .then((data) => setHistory(data.data || []))
      .catch(() => {});
  }, [limit]);

  return (
    <div className="relative">
      {!compact && (
        <>
          <div className="absolute top-0 left-0 right-0 h-16 bg-gradient-to-b from-[#030303] to-transparent z-10 pointer-events-none" />
          <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-[#030303] to-transparent z-10 pointer-events-none" />
        </>
      )}

      <div className={cn("overflow-x-auto rounded-2xl glass", compact && "rounded-xl")}>
        <table className="w-full min-w-[480px] text-left border-collapse">
          <thead>
            <tr className="border-b border-white/5">
              {["PAIR", "DIR", "ENTRY", "CLOSE", "PnL %"].map((h, i) => (
                <th
                  key={h}
                  className={cn(
                    "px-4 sm:px-6 text-[10px] font-mono tracking-widest text-white/30 font-normal whitespace-nowrap",
                    i === 4 && "text-right",
                    compact ? "py-3" : "py-4"
                  )}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {history.map((sig, i) => (
              <motion.tr
                key={sig.id}
                initial={{ opacity: 0, y: 10 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.04 }}
                className="border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors"
              >
                <td className="px-4 sm:px-6 py-3 sm:py-4 text-xs font-mono text-white/80 whitespace-nowrap">
                  {sig.symbol.replace("_USDT", "")}
                </td>
                <td className="px-4 sm:px-6 py-3 sm:py-4">
                  <span
                    className={cn(
                      "text-[10px] font-bold px-2 py-0.5 rounded whitespace-nowrap",
                      sig.decision === "LONG"
                        ? "bg-[#4ade80]/10 text-[#4ade80]"
                        : "bg-[#f87171]/10 text-[#f87171]"
                    )}
                  >
                    {sig.decision}
                  </span>
                </td>
                <td className="px-4 sm:px-6 py-3 sm:py-4 text-xs font-mono text-white/50 whitespace-nowrap">
                  ${formatPrice(sig.entry)}
                </td>
                <td className="px-4 sm:px-6 py-3 sm:py-4 text-xs font-mono text-white/50 whitespace-nowrap">
                  ${formatPrice(sig.closed_price)}
                </td>
                <td
                  className={cn(
                    "px-4 sm:px-6 py-3 sm:py-4 text-xs font-mono text-right font-bold whitespace-nowrap",
                    (sig.pnl_pct || 0) >= 0 ? "text-[#4ade80]" : "text-[#f87171]"
                  )}
                >
                  {(sig.pnl_pct || 0) >= 0 ? "+" : ""}
                  {sig.pnl_pct?.toFixed(2)}%
                </td>
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
