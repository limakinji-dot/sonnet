"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import QRCode from "qrcode";
import { formatPrice } from "@/lib/utils";
import type { Signal } from "@/lib/types";

interface PnLPosterProps {
  signal: Signal;
  leverage?: number;
  entryUsdt?: number;
}

export default function PnLPoster({
  signal,
  leverage = 10,
  entryUsdt = 100,
}: PnLPosterProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [qrImg, setQrImg] = useState<HTMLImageElement | null>(null);

  const isProfit = (signal.pnl_pct || 0) >= 0;
  const pair = signal.symbol.replace("_USDT", "");

  useEffect(() => {
    QRCode.toDataURL("https://agent-x.vercel.app", {
      width: 120,
      margin: 1,
      color: { dark: "#ffffff", light: "#00000000" },
    }).then((url) => {
      const img = new Image();
      img.onload = () => setQrImg(img);
      img.src = url;
    });
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = 540;
    const H = 800;
    const dpr = 2;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);

    // Background
    ctx.fillStyle = "#08050f";
    ctx.fillRect(0, 0, W, H);

    // Gradient accent
    const grad = ctx.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, isProfit ? "rgba(74,222,128,0.08)" : "rgba(248,113,113,0.08)");
    grad.addColorStop(1, "transparent");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // Noise texture
    const noise = document.createElement("canvas");
    noise.width = W;
    noise.height = H;
    const nctx = noise.getContext("2d")!;
    const id = nctx.createImageData(W, H);
    for (let i = 0; i < id.data.length; i += 4) {
      const v = (Math.random() * 20) | 0;
      id.data[i] = id.data[i + 1] = id.data[i + 2] = v;
      id.data[i + 3] = 8;
    }
    nctx.putImageData(id, 0, 0);
    ctx.drawImage(noise, 0, 0);

    // Border
    ctx.strokeStyle = isProfit ? "rgba(74,222,128,0.2)" : "rgba(248,113,113,0.2)";
    ctx.lineWidth = 1;
    ctx.strokeRect(12, 12, W - 24, H - 24);

    // Header
    ctx.fillStyle = "#ffffff";
    ctx.font = "700 24px sans-serif";
    ctx.fillText("AGENT-X", 40, 60);
    ctx.fillStyle = isProfit ? "#4ade80" : "#f87171";
    ctx.beginPath();
    ctx.arc(40 + ctx.measureText("AGENT-X").width + 12, 52, 4, 0, Math.PI * 2);
    ctx.fill();

    // Date
    ctx.fillStyle = "rgba(255,255,255,0.3)";
    ctx.font = "400 11px monospace";
    ctx.fillText(new Date(signal.timestamp).toLocaleDateString("en-GB"), 40, 82);

    // Badge
    const badgeW = 90;
    const badgeX = W - 40 - badgeW;
    ctx.fillStyle = isProfit ? "rgba(74,222,128,0.1)" : "rgba(248,113,113,0.1)";
    ctx.strokeStyle = isProfit ? "rgba(74,222,128,0.4)" : "rgba(248,113,113,0.4)";
    ctx.beginPath();
    ctx.roundRect(badgeX, 40, badgeW, 32, 8);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = isProfit ? "#4ade80" : "#f87171";
    ctx.font = "700 12px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(signal.decision, badgeX + badgeW / 2, 61);
    ctx.textAlign = "left";

    // Pair
    ctx.fillStyle = "#ffffff";
    ctx.font = "900 72px sans-serif";
    ctx.fillText(pair, 40, 180);
    const pairW = ctx.measureText(pair).width;
    ctx.fillStyle = "rgba(255,255,255,0.3)";
    ctx.font = "300 28px monospace";
    ctx.fillText("/USDT", 40 + pairW + 8, 172);

    // Tags
    const tags = [
      `${leverage}× LEVERAGE`,
      signal.decision,
      "FUTURES PERP",
    ];
    let tagX = 40;
    tags.forEach((tag, i) => {
      const colors = [
        isProfit ? "rgba(74,222,128,0.15)" : "rgba(248,113,113,0.15)",
        isProfit ? "rgba(74,222,128,0.2)" : "rgba(248,113,113,0.2)",
        "rgba(255,255,255,0.05)",
      ];
      const textColors = [
        isProfit ? "#4ade80" : "#f87171",
        isProfit ? "#4ade80" : "#f87171",
        "#888",
      ];
      const tw = ctx.measureText(tag).width + 20;
      ctx.fillStyle = colors[i];
      ctx.beginPath();
      ctx.roundRect(tagX, 200, tw, 26, 6);
      ctx.fill();
      ctx.fillStyle = textColors[i];
      ctx.font = "500 10px monospace";
      ctx.textAlign = "center";
      ctx.fillText(tag, tagX + tw / 2, 217);
      ctx.textAlign = "left";
      tagX += tw + 8;
    });

    // Divider
    const divY = 260;
    const dg = ctx.createLinearGradient(0, 0, W, 0);
    dg.addColorStop(0, "transparent");
    dg.addColorStop(0.3, isProfit ? "rgba(74,222,128,0.5)" : "rgba(248,113,113,0.5)");
    dg.addColorStop(0.7, isProfit ? "rgba(74,222,128,0.5)" : "rgba(248,113,113,0.5)");
    dg.addColorStop(1, "transparent");
    ctx.strokeStyle = dg;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(40, divY);
    ctx.lineTo(W - 40, divY);
    ctx.stroke();

    // PnL Display
    const pnlStr = `${isProfit ? "+" : ""}${(signal.pnl_pct || 0).toFixed(2)}%`;
    const roeStr = `${isProfit ? "+" : ""}${((signal.pnl_pct || 0) * leverage).toFixed(2)}% ROE`;

    ctx.save();
    ctx.shadowColor = isProfit ? "#4ade80" : "#f87171";
    ctx.shadowBlur = 60;
    ctx.fillStyle = isProfit ? "#4ade80" : "#f87171";
    ctx.font = "900 96px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(pnlStr, W / 2, 380);
    ctx.restore();

    const rg = ctx.createLinearGradient(0, 300, 0, 400);
    rg.addColorStop(0, "#ffffff");
    rg.addColorStop(0.5, isProfit ? "#4ade80" : "#f87171");
    rg.addColorStop(1, isProfit ? "#16a34a" : "#b91c1c");
    ctx.fillStyle = rg;
    ctx.fillText(pnlStr, W / 2, 380);

    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.font = "500 12px monospace";
    ctx.fillText(roeStr, W / 2, 410);

    // Stats
    const stats = [
      { label: "ENTRY", val: `$${formatPrice(signal.entry)}`, c: "#e2e8f0" },
      { label: "EXIT", val: `$${formatPrice(signal.closed_price)}`, c: "#93c5fd" },
      { label: "PROFIT", val: `$${(signal.pnl_usdt || 0).toFixed(2)}`, c: isProfit ? "#4ade80" : "#f87171" },
      { label: "MARGIN", val: `$${entryUsdt}`, c: "#fca5a5" },
    ];

    const cW = (W - 80 - 21) / 4;
    stats.forEach((s, i) => {
      const sx = 40 + i * (cW + 7);
      const sy = 460;
      ctx.fillStyle = "rgba(255,255,255,0.03)";
      ctx.strokeStyle = "rgba(255,255,255,0.06)";
      ctx.beginPath();
      ctx.roundRect(sx, sy, cW, 70, 10);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = "rgba(255,255,255,0.3)";
      ctx.font = "400 9px monospace";
      ctx.textAlign = "center";
      ctx.fillText(s.label, sx + cW / 2, sy + 22);

      let vfs = 14;
      ctx.font = `700 ${vfs}px sans-serif`;
      while (ctx.measureText(s.val).width > cW - 10 && vfs > 9) {
        vfs--;
        ctx.font = `700 ${vfs}px sans-serif`;
      }
      ctx.fillStyle = s.c;
      ctx.fillText(s.val, sx + cW / 2, sy + 50);
    });

    // QR
    if (qrImg) {
      ctx.globalAlpha = 0.7;
      ctx.drawImage(qrImg, W - 100, H - 100, 60, 60);
      ctx.globalAlpha = 1;
    }

    // Footer
    ctx.fillStyle = "rgba(255,255,255,0.15)";
    ctx.font = "400 10px monospace";
    ctx.textAlign = "center";
    ctx.fillText("agent-x.vercel.app", W / 2, H - 30);
  }, [signal, leverage, entryUsdt, qrImg, isProfit, pair]);

  useEffect(() => {
    draw();
  }, [draw]);

  const download = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `agent-x-${signal.symbol}-poster.png`;
      a.click();
      URL.revokeObjectURL(url);
    }, "image/png");
  }, [signal.symbol]);

  return (
    <div className="flex flex-col items-center gap-4">
      <canvas
        ref={canvasRef}
        className="rounded-xl shadow-2xl max-w-full"
        style={{ width: 270, height: 400 }}
      />
      <button
        onClick={download}
        className="px-6 py-2.5 rounded-lg bg-white/5 border border-white/10 text-xs font-mono text-white/80 hover:bg-white/10 transition-colors"
      >
        Download Poster
      </button>
    </div>
  );
}
