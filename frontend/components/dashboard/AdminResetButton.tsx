"use client";

import { useState } from "react";
import { useAuth } from "@/hooks/useAuthContext";
import { resetBot } from "@/lib/api";

export default function AdminResetButton() {
  const { isAdmin, userId } = useAuth();
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  if (!isAdmin) return null;

  const handleReset = async () => {
    const ok = confirm(
      "Yakin reset semua?\n\n• History signal akan dihapus\n• Live signal di-clear\n• Saldo kembali ke nilai awal"
    );
    if (!ok) return;

    setLoading(true);
    setMsg("");
    try {
      const res = await resetBot(userId || undefined);
      if (res.ok) {
        setMsg("✅ Reset berhasil! Reload halaman...");
        setTimeout(() => window.location.reload(), 1200);
      } else {
        setMsg(`❌ ${res.reason || "Gagal reset"}`);
      }
    } catch (e: any) {
      setMsg(`❌ ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mt-6 p-4 rounded-xl border border-red-500/30 bg-red-500/5">
      <h3 className="text-sm font-semibold text-red-300 mb-3">Admin Control</h3>
      <button
        onClick={handleReset}
        disabled={loading}
        className="w-full py-2.5 rounded-lg bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-sm font-medium transition-colors"
      >
        {loading ? "Resetting..." : "🔄 Reset All (History + Signal + Balance)"}
      </button>
      {msg && <p className="mt-2 text-xs text-white/80">{msg}</p>}
    </div>
  );
}