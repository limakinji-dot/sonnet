"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useTrading } from "@/hooks/useTradingContext";
import { formatPrice, formatTime, cn } from "@/lib/utils";
import { useEffect, useState } from "react";

interface SignalFeedProps {
  limit?: number;
  compact?: boolean;
}

export default function SignalFeed({ limit = 5, compact = false }: SignalFeedProps) {
  const { state } = useTrading();
  const [glitchId, setGlitchId] = useState<string | null>(null);

  const openSignals = state.signals
    .filter((s) => s.status === "OPEN")
    .slice(0, limit);

  useEffect(() => {
    if (openSignals.length > 0) {
      setGlitchId(openSignals[0].id);
      const t = setTimeout(() => setGlitchId(null), 500);
      return () => clearTimeout(t);
    }
  }, [openSignals.length > 0 ? openSignals[0].id : null]);

  return (
    <div className={cn("space-y-3", compact && "space-y-2")}>
      {!compact && (
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-[10px] font-mono tracking-[0.25em] text-white/40 uppercase">
            Live Signals
          </h3>
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-[#4ade80] animate-pulse" />
            <span className="text-[10px] font-mono text-white/30">
              {state.active_signal_count}/{state.max_active_signals} ACTIVE
            </span>
          </div>
        </div>
      )}

      <AnimatePresence mode="popLayout">
        {openSignals.map((sig) => (
          <motion.div
            key={sig.id}
            layout
            initial={{ opacity: 0, x: 50, scale: 0.95 }}
            animate={{
              opacity: 1,
              x: 0,
              scale: 1,
              ...(glitchId === sig.id && {
                x: [0, -3, 3, -2, 2, 0],
                transition: { duration: 0.2 },
              }),
            }}
            exit={{ opacity: 0, x: -50, scale: 0.95 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className={cn(
              "glass shimmer-card border-l-2 transition-all duration-300",
              "hover:border-white/20 hover:bg-white/[0.05]",
              compact ? "rounded-lg p-3" : "rounded-xl p-4",
              sig.decision === "LONG" ? "border-l-[#4ade80]" : "border-l-[#f87171]"
            )}
          >
            <div className={cn("flex items-center justify-between mb-2", compact && "mb-1.5")}>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold font-mono text-white tracking-wider">
                  {sig.symbol.replace("_USDT", "")}
                </span>
                <span
                  className={cn(
                    "text-[9px] font-bold px-2 py-0.5 rounded-full tracking-widest",
                    sig.decision === "LONG"
                      ? "bg-[#4ade80]/10 text-[#4ade80] border border-[#4ade80]/20"
                      : "bg-[#f87171]/10 text-[#f87171] border border-[#f87171]/20"
                  )}
                >
                  {sig.decision}
                </span>
              </div>
              {!compact && (
                <span className="text-[10px] font-mono text-white/25">
                  {formatTime(sig.timestamp)}
                </span>
              )}
            </div>

            <div className={cn("grid grid-cols-3 gap-2 text-[11px] font-mono", compact && "text-[10px]")}>
              <div>
                <div className="text-white/25 mb-0.5 text-[9px] tracking-widest">ENTRY</div>
                <div className="text-white/70">${formatPrice(sig.entry)}</div>
              </div>
              <div>
                <div className="text-white/25 mb-0.5 text-[9px] tracking-widest">TP</div>
                <div className="text-[#4ade80]">${formatPrice(sig.tp)}</div>
              </div>
              <div>
                <div className="text-white/25 mb-0.5 text-[9px] tracking-widest">SL</div>
                <div className="text-[#f87171]">${formatPrice(sig.sl)}</div>
              </div>
            </div>

            {!compact && sig.entry_hit && (
              <div className="mt-3 pt-3 border-t border-white/[0.04] flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className="w-1 h-1 rounded-full bg-[#4ade80] animate-pulse" />
                  <span className="text-[9px] text-white/30 font-mono tracking-widest">LIVE</span>
                </div>
                <span className="text-xs font-mono text-white/70">
                  ${formatPrice(sig.current_price)}
                </span>
              </div>
            )}
          </motion.div>
        ))}
      </AnimatePresence>

      {openSignals.length === 0 && (
        <div className={cn("glass rounded-xl text-center", compact ? "p-6" : "p-10")}>
          <div className="text-white/15 text-xs font-mono tracking-widest">NO ACTIVE SIGNALS</div>
          {!compact && (
            <div className="text-white/10 text-[10px] font-mono mt-2 tracking-wide">
              Waiting for AI analysis...
            </div>
          )}
        </div>
      )}
    </div>
  );
}
