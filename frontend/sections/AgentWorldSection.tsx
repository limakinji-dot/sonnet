"use client";

import { useRef, useEffect, useState } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(ScrollTrigger);

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers (must stay in sync with world/page.tsx)
// ─────────────────────────────────────────────────────────────────────────────

const AGENT_COUNT = 20;

function buildRingPositions(count: number, w: number, h: number) {
  const cx = w / 2, cy = h / 2;
  const outer = 12, inner = count - outer;
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < outer; i++) {
    const a = (i / outer) * Math.PI * 2 - Math.PI / 2;
    // Use same ring radii as world page (0.72 / 0.68 / 0.36)
    pts.push({ x: cx + Math.cos(a) * (Math.min(cx, cy) * 0.72), y: cy + Math.sin(a) * (Math.min(cx, cy) * 0.68) });
  }
  for (let i = 0; i < inner; i++) {
    const a = (i / inner) * Math.PI * 2 - Math.PI / 2;
    pts.push({ x: cx + Math.cos(a) * (Math.min(cx, cy) * 0.36), y: cy + Math.sin(a) * (Math.min(cx, cy) * 0.36) });
  }
  return pts;
}

interface LiveNode {
  id: number;
  decision: "LONG" | "SHORT" | "NO TRADE" | "THINKING" | "IDLE";
  confidence: number;
  pulsePhase: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Mini Neural Canvas
// Now accepts width/height props (responsive) + DPR scaling (HD/Retina)
// ─────────────────────────────────────────────────────────────────────────────

function MiniNeuralCanvas({
  nodes,
  edges,
  width,
  height,
}: {
  nodes: LiveNode[];
  edges: { from: number; to: number; decision: string }[];
  width: number;
  height: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef    = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width === 0 || height === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // ── DPR-aware resolution — fixes blur on Retina & correct size on desktop ──
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width  = Math.round(width  * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.scale(dpr, dpr);
    canvas.style.width  = `${width}px`;
    canvas.style.height = `${height}px`;

    const positions = buildRingPositions(AGENT_COUNT, width, height);

    const draw = (t: number) => {
      const time = t * 0.001;
      ctx.clearRect(0, 0, width, height);

      // Edges
      for (const edge of edges) {
        const fp = positions[edge.from - 1]; const tp = positions[edge.to - 1];
        if (!fp || !tp) continue;
        const isL = edge.decision === "LONG"; const rgb = isL ? "74,222,128" : "248,113,113";
        const prog = (time * 0.5 + edge.from * 0.07) % 1;
        const px = fp.x + (tp.x - fp.x) * prog; const py = fp.y + (tp.y - fp.y) * prog;

        ctx.beginPath(); ctx.moveTo(fp.x, fp.y); ctx.lineTo(tp.x, tp.y);
        ctx.strokeStyle = `rgba(${rgb},0.12)`; ctx.lineWidth = 1; ctx.stroke();

        const g = ctx.createRadialGradient(px, py, 0, px, py, 5);
        g.addColorStop(0, `rgba(${rgb},0.8)`); g.addColorStop(1, `rgba(${rgb},0)`);
        ctx.beginPath(); ctx.arc(px, py, 5, 0, Math.PI * 2); ctx.fillStyle = g; ctx.fill();
      }

      // Nodes
      nodes.forEach((node, i) => {
        const p = positions[i]; if (!p) return;
        const pulse = Math.sin(time * 2.4 + node.pulsePhase) * 0.5 + 0.5;
        let rgb = "255,255,255"; let alpha = 0.12 + pulse * 0.08; let r = 4;

        if (node.decision === "THINKING") { rgb = "212,168,71"; alpha = 0.5 + pulse * 0.5; r = 4 + pulse * 2; }
        else if (node.decision === "LONG")     { rgb = "74,222,128";  alpha = 0.5 + (node.confidence / 100) * 0.5; r = 4 + (node.confidence / 100) * 4; }
        else if (node.decision === "SHORT")    { rgb = "248,113,113"; alpha = 0.5 + (node.confidence / 100) * 0.5; r = 4 + (node.confidence / 100) * 4; }
        else if (node.decision === "NO TRADE") { rgb = "90,100,120"; alpha = 0.2; r = 3; }

        const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 4);
        glow.addColorStop(0, `rgba(${rgb},${alpha * 0.4})`); glow.addColorStop(1, "rgba(0,0,0,0)");
        ctx.beginPath(); ctx.arc(p.x, p.y, r * 4, 0, Math.PI * 2); ctx.fillStyle = glow; ctx.fill();

        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fillStyle = `rgba(${rgb},${alpha})`; ctx.fill();

        if (node.decision === "THINKING") {
          ctx.beginPath(); ctx.arc(p.x, p.y, r + 3 + pulse * 3, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(212,168,71,${0.3 - pulse * 0.25})`; ctx.lineWidth = 0.8; ctx.stroke();
        }
      });

      rafRef.current = requestAnimationFrame(draw);
    };

    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  // Re-run whenever size or data changes
  }, [nodes, edges, width, height]);

  return <canvas ref={canvasRef} style={{ display: "block" }} />;
}

// ─────────────────────────────────────────────────────────────────────────────
// Data types
// ─────────────────────────────────────────────────────────────────────────────

interface LatestSim {
  symbol: string;
  final_decision: string;
  consensus_confidence: number;
  agent_count: number;
  round3_opinions: Array<{ agent_id: number; decision: string; confidence: number }>;
  vote_breakdown?: { pct: Record<string, number> };
}

// ─────────────────────────────────────────────────────────────────────────────
// AgentWorldSection
// ─────────────────────────────────────────────────────────────────────────────

export default function AgentWorldSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);

  const [latest, setLatest] = useState<LatestSim | null>(null);
  const [nodes, setNodes]   = useState<LiveNode[]>(() =>
    Array.from({ length: AGENT_COUNT }, (_, i) => ({
      id: i + 1, decision: "IDLE", confidence: 0, pulsePhase: (i * 0.37) % (Math.PI * 2),
    }))
  );
  const [edges, setEdges]         = useState<{ from: number; to: number; decision: string }[]>([]);
  // ── Responsive canvas size — same pattern as World page ──────────────────
  const [canvasSize, setCanvasSize] = useState({ w: 560, h: 320 });
  const wsRef = useRef<WebSocket | null>(null);

  // Track container width and compute height at 9:16 → or fixed ratio
  useEffect(() => {
    const obs = new ResizeObserver((entries) => {
      const e = entries[0];
      if (e) {
        const w = Math.floor(e.contentRect.width);
        // 56% height ratio — same proportion as the world page canvas
        setCanvasSize({ w, h: Math.floor(w * 0.56) });
      }
    });
    if (canvasContainerRef.current) obs.observe(canvasContainerRef.current);
    return () => obs.disconnect();
  }, []);

  const applyOpinions = (opinions: LatestSim["round3_opinions"]) => {
    const newNodes: LiveNode[] = Array.from({ length: AGENT_COUNT }, (_, i) => {
      const op = opinions?.find((o) => o.agent_id === i + 1);
      return { id: i + 1, decision: (op?.decision as LiveNode["decision"]) || "IDLE", confidence: op?.confidence || 0, pulsePhase: (i * 0.37) % (Math.PI * 2) };
    });
    setNodes(newNodes);
    const longOps  = opinions?.filter((o) => o.decision === "LONG") || [];
    const shortOps = opinions?.filter((o) => o.decision === "SHORT") || [];
    const newEdges: { from: number; to: number; decision: string }[] = [];
    for (let i = 0; i < longOps.length; i++)
      for (let j = i + 1; j < longOps.length; j++)
        newEdges.push({ from: longOps[i].agent_id, to: longOps[j].agent_id, decision: "LONG" });
    for (let i = 0; i < shortOps.length; i++)
      for (let j = i + 1; j < shortOps.length; j++)
        newEdges.push({ from: shortOps[i].agent_id, to: shortOps[j].agent_id, decision: "SHORT" });
    setEdges(newEdges);
  };

  const fetchLatest = async () => {
    try {
      const res = await fetch("/sim/latest");
      if (!res.ok) return;
      const raw = await res.json();
      if (!raw?.simulation_id) return;
      const data: LatestSim = raw;
      setLatest(data);
      applyOpinions(data.round3_opinions);
    } catch {}
  };

  useEffect(() => {
    const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || "https://web-production-e78a1.up.railway.app";
    const wsUrl = BACKEND.replace(/^https:\/\//, "wss://").replace(/^http:\/\//, "ws://") + "/sim/ws";
    const connect = () => {
      try {
        const ws = new WebSocket(wsUrl); wsRef.current = ws;
        ws.onmessage = (e) => {
          try {
            const { event, data } = JSON.parse(e.data);
            if (event === "sim_start") {
              setNodes(Array.from({ length: AGENT_COUNT }, (_, i) => ({
                id: i + 1, decision: "THINKING" as const, confidence: 0, pulsePhase: (i * 0.37) % (Math.PI * 2),
              })));
              setEdges([]);
            } else if (event === "agent_update") {
              setNodes((prev) => prev.map((n) =>
                n.id === data.agent_id ? { ...n, decision: data.decision as LiveNode["decision"], confidence: data.confidence } : n
              ));
            } else if (event === "round_done") {
              applyOpinions(data.opinions || []);
            } else if (event === "sim_result") {
              fetchLatest();
            }
          } catch {}
        };
        ws.onclose = () => setTimeout(connect, 3000); ws.onerror = () => ws.close();
      } catch {}
    };
    connect();
    return () => { wsRef.current?.close(); wsRef.current = null; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fetchLatest();
    const iv = setInterval(fetchLatest, 15000);
    return () => clearInterval(iv);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useGSAP(() => {
    if (!contentRef.current) return;
    gsap.fromTo(
      contentRef.current,
      { opacity: 0, y: 60 },
      { opacity: 1, y: 0, ease: "power3.out",
        scrollTrigger: { trigger: sectionRef.current, start: "top center", end: "center center", scrub: 1 } }
    );
  }, { scope: sectionRef });

  const isLong = latest?.final_decision === "LONG";
  const isShort = latest?.final_decision === "SHORT";
  const vote = latest?.vote_breakdown?.pct;

  return (
    <section ref={sectionRef} id="agent-world"
      className="relative min-h-screen flex items-center justify-center z-10 px-4 sm:px-8 lg:px-16 py-24">
      <div ref={contentRef} className="w-full max-w-5xl mx-auto">

        {/* Label */}
        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
          transition={{ duration: 0.8 }} className="text-center mb-12">
          <div className="text-[9px] font-mono text-white/20 tracking-[0.4em] uppercase mb-4">Live Agent Intelligence</div>
          <h2 className="font-display text-4xl sm:text-5xl lg:text-6xl font-bold text-white mb-4">
            The Agent{" "}
            <span className="italic text-transparent bg-clip-text bg-gradient-to-r from-[#d4a847] via-yellow-200 to-[#d4a847]">World</span>
          </h2>
          <p className="text-[11px] font-mono text-white/25 max-w-md mx-auto leading-relaxed">
            20 autonomous AI traders live in a shared virtual market.
            They analyze, deliberate across 3 rounds, and reach consensus.
          </p>
        </motion.div>

        {/* Main card */}
        <div className="glass-gold rounded-2xl border border-[#d4a847]/15 overflow-hidden">

          {/* Neural canvas — responsive container, same as World page */}
          <div ref={canvasContainerRef} className="relative bg-black/40 border-b border-white/[0.04]"
            style={{ height: canvasSize.h > 0 ? canvasSize.h : 280 }}>
            <MiniNeuralCanvas nodes={nodes} edges={edges} width={canvasSize.w} height={canvasSize.h} />

            {/* Gradient overlay */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent pointer-events-none" />

            {/* Live badge */}
            <div className="absolute top-4 left-4 flex items-center gap-2 glass px-3 py-1.5 rounded-full border border-white/10">
              <span className="w-1.5 h-1.5 rounded-full bg-[#4ade80] animate-pulse" />
              <span className="text-[9px] font-mono text-white/50 tracking-wider">LIVE</span>
            </div>

            {/* Agent count badge */}
            <div className="absolute top-4 right-4 glass px-3 py-1.5 rounded-full border border-white/10">
              <span className="text-[9px] font-mono text-white/30">20 AGENTS · 5 TOKENS · 3 ROUNDS</span>
            </div>

            {/* Latest result overlay */}
            {latest && (
              <div className="absolute bottom-4 left-4 right-4 flex items-end justify-between">
                <div>
                  <div className="text-[9px] font-mono text-white/25 mb-1">{latest.symbol}</div>
                  <div
                    className={`font-display text-3xl font-bold ${isLong ? "text-[#4ade80]" : isShort ? "text-[#f87171]" : "text-white/40"}`}
                    style={isLong ? { textShadow: "0 0 20px rgba(74,222,128,0.4)" } : isShort ? { textShadow: "0 0 20px rgba(248,113,113,0.4)" } : {}}
                  >
                    {latest.final_decision}
                  </div>
                </div>
                {vote && (
                  <div className="flex flex-col gap-1 w-36">
                    {Object.entries(vote).map(([dec, pct]) => {
                      const l = dec === "LONG", s = dec === "SHORT";
                      return (
                        <div key={dec} className="flex items-center gap-2">
                          <span className={`text-[8px] font-mono w-14 ${l ? "text-[#4ade80]" : s ? "text-[#f87171]" : "text-white/20"}`}>{dec}</span>
                          <div className="flex-1 h-[2px] bg-white/10 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full ${l ? "bg-[#4ade80]" : s ? "bg-[#f87171]" : "bg-white/20"}`} style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-[8px] font-mono text-white/25 w-8 text-right">{pct.toFixed(0)}%</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {!latest && (
              <div className="absolute bottom-4 left-4">
                <div className="text-[9px] font-mono text-white/20 tracking-[0.2em]">Awaiting agent consensus...</div>
              </div>
            )}
          </div>

          {/* Bottom strip */}
          <div className="flex items-center justify-between px-5 py-4">
            <div className="flex items-center gap-4">
              {[["LONG", "#4ade80"], ["SHORT", "#f87171"], ["THINKING", "#d4a847"]].map(([label, color]) => (
                <div key={label} className="flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
                  <span className="text-[9px] font-mono text-white/25">{label}</span>
                </div>
              ))}
            </div>
            <Link href="/world"
              className="group flex items-center gap-2 px-4 py-2 rounded-lg bg-[#d4a847]/08 border border-[#d4a847]/25 text-[10px] font-mono text-[#d4a847]/70 hover:text-[#d4a847] hover:bg-[#d4a847]/15 transition-all">
              Enter Agent World
              <span className="group-hover:translate-x-0.5 transition-transform">→</span>
            </Link>
          </div>
        </div>

      </div>
    </section>
  );
}
