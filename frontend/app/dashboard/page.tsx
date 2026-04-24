"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { useAuth } from "@/hooks/useAuthContext";
import { useTrading } from "@/hooks/useTradingContext";
import { register } from "@/lib/api";
import SignalFeed from "@/components/ui/SignalFeed";
import TradeHistoryTable from "@/components/ui/TradeHistoryTable";
import WinRateChart from "@/components/dashboard/WinRateChart";
import SettingsPanel from "@/components/dashboard/SettingsPanel";
import Link from "next/link";

export default function DashboardPage() {
  const { isAuthenticated, username, isAdmin, logout } = useAuth();
  const { state, balance } = useTrading();
  const router = useRouter();

  // ── Admin Register State ──
  const [newUsername, setNewUsername] = useState("");
  const [newPasskey, setNewPasskey] = useState("");
  const [regLoading, setRegLoading] = useState(false);
  const [regMsg, setRegMsg] = useState<string | null>(null);

  // Protect route
  useEffect(() => {
    if (!isAuthenticated) {
      router.replace("/");
    }
  }, [isAuthenticated, router]);

  if (!isAuthenticated) return null;

  // ── Handler: Register User ──
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUsername.trim() || !newPasskey.trim()) {
      setRegMsg("Username dan passkey wajib diisi");
      return;
    }
    setRegLoading(true);
    setRegMsg(null);
    try {
      const res = await register({
        username: newUsername.trim(),
        passkey: newPasskey.trim(),
      });
      if (res.success) {
        setRegMsg(`✅ User ${newUsername} berhasil dibuat!`);
        setNewUsername("");
        setNewPasskey("");
      } else {
        setRegMsg(`❌ ${res.detail || "Gagal membuat user"}`);
      }
    } catch (err: any) {
      setRegMsg(`❌ ${err.message || "Error"}`);
    } finally {
      setRegLoading(false);
    }
  };

  // Format balance dengan comma
  const fmtBalance = (n: number) =>
    n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });

  return (
    <main className="relative min-h-screen bg-[#030303] pt-20 sm:pt-24 pb-16 sm:pb-20 px-3 sm:px-6 lg:px-8">
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
          className="mb-8 sm:mb-10 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4"
        >
          <div>
            <Link
              href="/?section=live-logic"
              className="inline-flex items-center gap-2 text-[11px] font-mono text-white/30 hover:text-white/60 transition-colors mb-4 sm:mb-6 group"
            >
              <span className="group-hover:-translate-x-1 transition-transform">
                ←
              </span>
              BACK TO HOME
            </Link>
            <h1 className="font-display text-3xl sm:text-4xl lg:text-5xl font-bold text-white mb-2">
              Trading Dashboard
            </h1>
            <p className="text-[10px] sm:text-xs font-mono text-white/30 tracking-widest">
              ACCOUNT: {username?.toUpperCase()}
              {isAdmin && (
                <span className="ml-2 text-[#d4a847]">[ADMIN]</span>
              )}
            </p>
          </div>
          <button
            onClick={logout}
            className="self-start sm:self-auto px-4 sm:px-5 py-2.5 rounded-lg glass text-[10px] font-mono text-white/50 hover:text-white/80 hover:bg-white/5 transition-colors border border-white/10"
          >
            LOGOUT
          </button>
        </motion.div>

        {/* Top Stats */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3 mb-6 sm:mb-8"
        >
          {[
            {
              label: "BALANCE",
              value: `$${fmtBalance(balance.balance)}`,
              color: "#d4a847",
              highlight: true,
            },
            {
              label: "INITIAL",
              value: `$${fmtBalance(balance.initial_balance)}`,
              color: "#fff",
            },
            {
              label: "LEVERAGE",
              value: `${balance.leverage}x`,
              color: "#60a5fa",
            },
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
          ].map((stat) => (
            <div
              key={stat.label}
              className={`glass rounded-xl p-3 sm:p-4 text-center ${
                stat.highlight ? "border border-[#d4a847]/30 bg-[#d4a847]/5" : ""
              }`}
            >
              <div
                className={`text-base sm:text-lg lg:text-xl font-bold font-mono mb-1 ${
                  stat.highlight ? "text-[#d4a847]" : ""
                }`}
                style={{ color: stat.highlight ? undefined : stat.color || "#fff" }}
              >
                {stat.value}
              </div>
              <div className="text-[8px] sm:text-[9px] font-mono text-white/30 tracking-widest">
                {stat.label}
              </div>
            </div>
          ))}
        </motion.div>

        {/* Admin: Register New User */}
        {isAdmin && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="mb-6 sm:mb-8 glass rounded-2xl p-4 sm:p-6 border border-[#d4a847]/20"
          >
            <h3 className="text-[10px] sm:text-xs font-mono text-[#d4a847] tracking-[0.25em] uppercase mb-4 flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-[#d4a847]" />
              Create New User
            </h3>
            <form
              onSubmit={handleRegister}
              className="flex flex-col sm:flex-row gap-3"
            >
              <input
                type="text"
                placeholder="Username"
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                className="flex-1 min-w-0 bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-sm text-white placeholder-white/20 focus:outline-none focus:border-[#d4a847]/50 transition-colors"
              />
              <input
                type="password"
                placeholder="Passkey"
                value={newPasskey}
                onChange={(e) => setNewPasskey(e.target.value)}
                className="flex-1 min-w-0 bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-sm text-white placeholder-white/20 focus:outline-none focus:border-[#d4a847]/50 transition-colors"
              />
              <button
                type="submit"
                disabled={regLoading}
                className="px-6 py-3 rounded-lg bg-[#d4a847]/10 border border-[#d4a847]/30 text-[#d4a847] text-xs font-mono tracking-wider hover:bg-[#d4a847]/20 transition-colors disabled:opacity-50 whitespace-nowrap"
              >
                {regLoading ? "CREATING..." : "CREATE USER"}
              </button>
            </form>
            {regMsg && (
              <p className="mt-3 text-[11px] font-mono text-white/60">
                {regMsg}
              </p>
            )}
          </motion.div>
        )}

        {/* Main Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
          {/* Left: Signals + History */}
          <div className="lg:col-span-2 space-y-4 sm:space-y-6">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="glass rounded-2xl p-4 sm:p-6"
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
              className="glass rounded-2xl p-4 sm:p-6"
            >
              <h3 className="text-[10px] font-mono text-white/40 tracking-[0.25em] uppercase mb-4">
                Trade History
              </h3>
              <TradeHistoryTable limit={20} compact />
            </motion.div>
          </div>

          {/* Right: WR Chart + Settings */}
          <div className="space-y-4 sm:space-y-6">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25 }}
              className="glass rounded-2xl p-4 sm:p-6 flex flex-col items-center"
            >
              <h3 className="text-[10px] font-mono text-white/40 tracking-[0.25em] uppercase mb-4 self-start">
                Win Rate
              </h3>
              <div className="w-full flex justify-center">
                <WinRateChart
                  wins={state.win_count}
                  losses={state.loss_count}
                  size={180}
                />
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.35 }}
            >
              <h3 className="text-[10px] font-mono text-white/40 tracking-[0.25em] uppercase mb-3 sm:mb-4 px-1">
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
