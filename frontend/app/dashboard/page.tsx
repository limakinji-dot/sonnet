"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { useAuth } from "@/hooks/useAuthContext";
import { useTrading } from "@/hooks/useTradingContext";
import SignalFeed from "@/components/ui/SignalFeed";
import TradeHistoryTable from "@/components/ui/TradeHistoryTable";
import WinRateChart from "@/components/dashboard/WinRateChart";
import SettingsPanel from "@/components/dashboard/SettingsPanel";
import Link from "next/link";

export default function DashboardPage() {
  const { isAuthenticated, username, logout } = useAuth();
  const { state } = useTrading();
  const router = useRouter();

  // Protect route
  useEffect(() => {
    if (!isAuthenticated) {
      router.replace("/");
    }
  }, [isAuthenticated, router]);

  if (!isAuthenticated) return null;

  return (
    <main className="relative min-h-screen bg-[#030303] pt-24 pb-20 px-4 sm:px-8">
      <div className="fixed inset-0 -z-10 bg-[#030303]" />
      <div
        className="fixed inset-0 -z-10 opacity-15"
        style={{
          backgroundImage:
            "radial-gradient(circle at 50% 0%, #1e3a8a 0%, transparent 50%)",
        }}
      />

      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="mb-10 flex items-end justify-between"
        >
          <div>
            <Link
              href="/?section=live-logic"
              className="inline-flex items-center gap-2 text-[11px] font-mono text-white/30 hover:text-white/60 transition-colors mb-6 group"
            >
              <span className="group-hover:-translate-x-1 transition-transform">
                ←
              </span>
              BACK TO HOME
            </Link>
            <h1 className="font-display text-4xl sm:text-5xl font-bold text-white mb-2">
              Trading Dashboard
            </h1>
            <p className="text-xs font-mono text-white/30 tracking-widest">
              ACCOUNT: {username?.toUpperCase()}
            </p>
          </div>
          <button
            onClick={logout}
            className="px-5 py-2.5 rounded-lg glass text-[10px] font-mono text-white/50 hover:text-white/80 hover:bg-white/5 transition-colors border border-white/10"
          >
            LOGOUT
          </button>
        </motion.div>

        {/* Top Stats */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8"
        >
          {[
            {
              label: "TOTAL TRADES",
              value: state.trade_count,
            },
            {
              label: "WINS",
              value: state.win_count,
              color: "#4ade80",
            },
            {
              label: "LOSSES",
              value: state.loss_count,
              color: "#f87171",
            },
            {
              label: "TOTAL PnL",
              value: `${state.total_pnl_pct >= 0 ? "+" : ""}${state.total_pnl_pct.toFixed(2)}%`,
              color: state.total_pnl_pct >= 0 ? "#4ade80" : "#f87171",
            },
          ].map((stat) => (
            <div key={stat.label} className="glass rounded-xl p-5 text-center">
              <div
                className="text-2xl font-bold font-mono mb-1"
                style={{ color: stat.color || "#fff" }}
              >
                {stat.value}
              </div>
              <div className="text-[9px] font-mono text-white/30 tracking-widest">
                {stat.label}
              </div>
            </div>
          ))}
        </motion.div>

        {/* Main Grid */}
        <div className="grid lg:grid-cols-3 gap-6">
          {/* Left: Signals + History */}
          <div className="lg:col-span-2 space-y-6">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="glass rounded-2xl p-6"
            >
              <h3 className="text-[10px] font-mono text-white/40 tracking-[0.25em] uppercase mb-4">
                Live Signals
              </h3>
              <SignalFeed limit={10} compact />
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="glass rounded-2xl p-6"
            >
              <h3 className="text-[10px] font-mono text-white/40 tracking-[0.25em] uppercase mb-4">
                Trade History
              </h3>
              <TradeHistoryTable limit={20} compact />
            </motion.div>
          </div>

          {/* Right: WR Chart + Settings */}
          <div className="space-y-6">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25 }}
              className="glass rounded-2xl p-6 flex flex-col items-center"
            >
              <h3 className="text-[10px] font-mono text-white/40 tracking-[0.25em] uppercase mb-4 self-start">
                Win Rate
              </h3>
              <WinRateChart
                wins={state.win_count}
                losses={state.loss_count}
                size={220}
              />
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.35 }}
            >
              <h3 className="text-[10px] font-mono text-white/40 tracking-[0.25em] uppercase mb-4 px-1">
                Bot Settings
              </h3>
              <SettingsPanel />
            </motion.div>
          </div>
        </div>
      </div>
    </main>
  );
}
