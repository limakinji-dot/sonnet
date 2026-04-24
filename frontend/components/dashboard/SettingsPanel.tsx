"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuthContext";
import { updateUserData } from "@/lib/auth";

export default function SettingsPanel() {
  const { userData, userId, refreshUser } = useAuth();
  const [leverage, setLeverage] = useState(userData?.leverage || 10);
  const [margin, setMargin] = useState(userData?.margin || 100);
  const [isRunning, setIsRunning] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (userData) {
      setLeverage(userData.leverage);
      setMargin(userData.margin);
    }
  }, [userData]);

  const handleSave = () => {
    if (!userId) return;
    updateUserData(userId, { leverage, margin });
    refreshUser();
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="glass rounded-2xl p-6 space-y-6">
      <div className="space-y-4">
        <div className="space-y-2">
          <div className="flex justify-between text-xs font-mono text-white/60">
            <span>Leverage</span>
            <span className="text-[#d4a847]">{leverage}x</span>
          </div>
          <input
            type="range"
            min="1"
            max="100"
            value={leverage}
            onChange={(e) => setLeverage(Number(e.target.value))}
            className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer"
            style={{ accentColor: "#d4a847" }}
          />
          <div className="flex justify-between text-[9px] font-mono text-white/20">
            <span>1x</span>
            <span>100x</span>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex justify-between text-xs font-mono text-white/60">
            <span>Margin per Trade</span>
            <span className="text-[#d4a847]">${margin}</span>
          </div>
          <input
            type="number"
            min="10"
            value={margin}
            onChange={(e) => setMargin(Number(e.target.value))}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-sm font-mono text-white focus:outline-none focus:border-[#d4a847]/50 transition-colors"
          />
        </div>
      </div>

      <div className="pt-4 border-t border-white/5 flex gap-3">
        <button
          onClick={() => setIsRunning(true)}
          disabled={isRunning}
          className="flex-1 py-3 rounded-lg bg-[#4ade80]/10 border border-[#4ade80]/30 text-[#4ade80] text-xs font-mono font-bold tracking-widest hover:bg-[#4ade80]/20 transition-colors disabled:opacity-50"
        >
          {isRunning ? "RUNNING..." : "START BOT"}
        </button>
        <button
          onClick={() => setIsRunning(false)}
          disabled={!isRunning}
          className="flex-1 py-3 rounded-lg bg-[#f87171]/10 border border-[#f87171]/30 text-[#f87171] text-xs font-mono font-bold tracking-widest hover:bg-[#f87171]/20 transition-colors disabled:opacity-50"
        >
          STOP BOT
        </button>
      </div>

      <button
        onClick={handleSave}
        className="w-full py-3 rounded-lg bg-white/5 border border-white/10 text-xs font-mono text-white/60 hover:bg-white/10 hover:text-white transition-colors"
      >
        {saved ? "SAVED ✓" : "SAVE SETTINGS"}
      </button>
    </div>
  );
}
