"use client";

import { useEffect, useState } from "react";
import { useTrading } from "@/hooks/useTradingContext";
import { motion, AnimatePresence } from "framer-motion";
import PnLPoster from "@/components/ui/PnLPoster";

interface SignalFeedProps {
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

function formatTime(ts: number | string) {
  const d = new Date(ts);
  return d.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export default function SignalFeed({ limit = 10, compact = false }: SignalFeedProps) {
  const { state } = useTrading();
  const [openSignals, setOpenSignals] = useState<any[]>([]);
  const [posterSignal, setPosterSignal] = useState<any>(null);
  const [posterMode, setPosterMode] = useState<"pnl" | "roe" | "both">("both");

  useEffect(() => {
    const signals = (state.signals || [])
      .filter((s: any) => s.status === "OPEN")
      .sort((a: any, b: any) => {
        // Running signals (entry_hit) selalu di atas
        if (a.entry_hit && !b.entry_hit) return -1;
        if (!a.entry_hit && b.entry_hit) return 1;
        // Lalu sort by timestamp desc
        return (b.timestamp || 0) - (a.timestamp || 0);
      })
      .slice(0, limit);
    setOpenSignals(signals);
  }, [state.signals, limit]);

  return (
    <div className="space-y-3">
      {!compact && (
        <div className="flex justify-between items-center text-[10px] font-mono text-white/30">
          <span>Live Signals</span>
          <span>
            {state.active_signal_count}/{state.max_active_signals} ACTIVE
          </span>
        </div>
      )}

      <AnimatePresence>
        {openSignals.map((sig) => (
          <motion.div
            key={sig.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className={`glass rounded-xl p-3 sm:p-4 border transition-all ${
              sig.entry_hit
                ? "border-[#d4a847]/40 shadow-[0_0_20px_rgba(212,168,71,0.1)]"
                : "border-white/5"
            }`}
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-mono font-bold text-white">
                  {sig.symbol.replace("_USDT", "")}
                </span>
                <span
                  className={`text-[9px] font-mono px-2 py-0.5 rounded ${
                    sig.decision === "LONG"
                      ? "bg-[#4ade80]/10 text-[#4ade80]"
                      : "bg-[#f87171]/10 text-[#f87171]"
                  }`}
                >
                  {sig.decision}
                </span>
                {sig.entry_hit && (
                  <span className="text-[9px] font-mono px-2 py-0.5 rounded bg-[#d4a847]/10 text-[#d4a847] border border-[#d4a847]/30 animate-pulse">
                    ● RUNNING
                  </span>
                )}
              </div>
              {!compact && (
                <span className="text-[9px] font-mono text-white/20">
                  {formatTime(sig.timestamp)}
                </span>
              )}
            </div>

            {/* Row 1: Entry, TP, SL */}
            <div className="grid grid-cols-3 gap-2 mb-2">
              <div className="text-center">
                <div className="text-[8px] font-mono text-white/30 mb-0.5">ENTRY</div>
                <div className="text-xs font-mono text-white">${formatPrice(sig.entry)}</div>
              </div>
              <div className="text-center">
                <div className="text-[8px] font-mono text-white/30 mb-0.5">TP</div>
                <div className="text-xs font-mono text-[#4ade80]">${formatPrice(sig.tp)}</div>
              </div>
              <div className="text-center">
                <div className="text-[8px] font-mono text-white/30 mb-0.5">SL</div>
                <div className="text-xs font-mono text-[#f87171]">${formatPrice(sig.sl)}</div>
              </div>
            </div>

            {/* Row 2: TP1, TP2, MAX */}
            <div className="grid grid-cols-3 gap-2 mb-2">
              <div className="text-center">
                <div className="text-[8px] font-mono text-white/30 mb-0.5">TP1</div>
                <div className="text-xs font-mono text-[#d4a847]">${formatPrice(sig.tp1)}</div>
              </div>
              <div className="text-center">
                <div className="text-[8px] font-mono text-white/30 mb-0.5">TP2</div>
                <div className="text-xs font-mono text-[#d4a847]/80">${formatPrice(sig.tp2)}</div>
              </div>
              <div className="text-center">
                <div className="text-[8px] font-mono text-white/30 mb-0.5">MAX</div>
                <div className="text-xs font-mono text-[#d4a847]/60">${formatPrice(sig.tp_max)}</div>
              </div>
            </div>

            {/* Live price + Share button (running signals only, non-compact) */}
            {sig.entry_hit && (
              <div className={`flex items-center ${!compact ? "justify-between" : "justify-end"} pt-2 border-t border-white/5`}>
                {!compact && (
                  <div className="flex items-center gap-2">
                    <span className="text-[8px] font-mono text-white/20">LIVE</span>
                    <span className="text-xs font-mono text-white">
                      ${formatPrice(sig.current_price)}
                    </span>
                  </div>
                )}
                <button
                  onClick={() => {
                    setPosterSignal(sig);
                    setPosterMode("both");
                  }}
                  className="text-[9px] font-mono px-3 py-1.5 rounded-lg bg-[#d4a847]/10 border border-[#d4a847]/30 text-[#d4a847] hover:bg-[#d4a847]/20 transition-colors"
                >
                  Share Poster
                </button>
              </div>
            )}
          </motion.div>
        ))}
      </AnimatePresence>

      {openSignals.length === 0 && (
        <div className="text-center py-8">
          <p className="text-[10px] font-mono text-white/20 tracking-widest">
            NO ACTIVE SIGNALS
          </p>
          {!compact && (
            <p className="text-[9px] font-mono text-white/10 mt-1">
              Waiting for AI analysis...
            </p>
          )}
        </div>
      )}

      {/* Poster Share Modal */}
      <AnimatePresence>
        {posterSignal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm px-4"
            onClick={() => setPosterSignal(null)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="glass-strong rounded-2xl p-6 w-full max-w-sm relative"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={() => setPosterSignal(null)}
                className="absolute top-3 right-3 text-white/30 hover:text-white/60 text-lg"
              >
                ×
              </button>

              <h3 className="text-center text-[10px] font-mono text-[#d4a847] tracking-[0.3em] mb-4">
                SHARE POSTER
              </h3>

              {/* Toggle mode */}
              <div className="flex gap-2 mb-4">
                {(["pnl", "roe", "both"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setPosterMode(m)}
                    className={`flex-1 py-2 rounded-lg text-[10px] font-mono font-bold tracking-wider border transition-colors ${
                      posterMode === m
                        ? "bg-[#d4a847]/20 border-[#d4a847]/50 text-[#d4a847]"
                        : "bg-white/5 border-white/10 text-white/40 hover:text-white/70"
                    }`}
                  >
                    {m === "both" ? "ROE + PnL" : m.toUpperCase()}
                  </button>
                ))}
              </div>

              <PnLPoster signal={posterSignal} mode={posterMode} />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}