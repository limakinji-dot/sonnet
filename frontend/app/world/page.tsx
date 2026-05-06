"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface AgentOpinion {
  agent_id: number;
  agent_name: string;
  agent_archetype: string;
  token_slot: number;
  round_num: number;
  decision: "LONG" | "SHORT" | "NO TRADE";
  entry: number | null;
  tp1: number | null;
  tp2: number | null;
  tp_max: number | null;
  sl: number | null;
  reason: string;
  confidence: number;
}

interface SimResult {
  simulation_id: string;
  symbol: string;
  current_price: number;
  timestamp: number;
  agent_count: number;
  token_count: number;
  round1_opinions: AgentOpinion[];
  round2_opinions: AgentOpinion[];
  round3_opinions: AgentOpinion[];
  final_decision: string;
  consensus_entry: number | null;
  consensus_tp1: number | null;
  consensus_tp2: number | null;
  consensus_tp_max: number | null;
  consensus_sl: number | null;
  consensus_confidence: number;
  vote_breakdown: { scores: Record<string, number>; pct: Record<string, number>; winner: string };
}

// ─────────────────────────────────────────────────────────────────────────────
// Agent metadata
// ─────────────────────────────────────────────────────────────────────────────

const AGENTS = [
  { id: 1,  name: "The Sniper",        archetype: "Precision Trend Follower",    weight: 1.6 },
  { id: 2,  name: "The Hawk",          archetype: "Aggressive Trend Rider",       weight: 1.2 },
  { id: 3,  name: "The Glacier",       archetype: "Patient Swing Trader",         weight: 1.8 },
  { id: 4,  name: "The Shadow",        archetype: "Stealth Trend Follower",       weight: 1.3 },
  { id: 5,  name: "The Contrarian",    archetype: "Reversal Hunter",              weight: 1.0 },
  { id: 6,  name: "The Phoenix",       archetype: "Bounce Specialist",            weight: 0.9 },
  { id: 7,  name: "Devils Advocate",   archetype: "Structural Reversal Analyst",  weight: 1.1 },
  { id: 8,  name: "The Fader",         archetype: "Overextension Fader",          weight: 0.9 },
  { id: 9,  name: "The Quant",         archetype: "Risk-Reward Calculator",       weight: 1.2 },
  { id: 10, name: "The Statistician",  archetype: "Pattern Probability Analyst",  weight: 1.1 },
  { id: 11, name: "The Engineer",      archetype: "Systematic Structure Analyst", weight: 1.3 },
  { id: 12, name: "The Macro",         archetype: "HTF Big Picture Strategist",   weight: 1.9 },
  { id: 13, name: "The Oracle",        archetype: "Multi-TF Confluence Analyst",  weight: 2.0 },
  { id: 14, name: "The Architect",     archetype: "Market Structure Builder",     weight: 1.5 },
  { id: 15, name: "The Scalper",       archetype: "Aggressive LTF Trader",        weight: 0.8 },
  { id: 16, name: "The Bullet",        archetype: "Breakout Momentum Trader",     weight: 0.9 },
  { id: 17, name: "The Pulse",         archetype: "Order Flow Reader",            weight: 0.8 },
  { id: 18, name: "The Sentinel",      archetype: "Risk Manager",                 weight: 1.7 },
  { id: 19, name: "The Alchemist",     archetype: "Cross-Asset Analyst",          weight: 1.4 },
  { id: 20, name: "The Veteran",       archetype: "Experienced All-Round Trader", weight: 1.5 },
];

// ─────────────────────────────────────────────────────────────────────────────
// Layout helpers
// ─────────────────────────────────────────────────────────────────────────────

function buildPositions(count: number, w: number, h: number) {
  const cx = w / 2, cy = h / 2;
  const outer = 12, inner = count - outer;
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < outer; i++) {
    const a = (i / outer) * Math.PI * 2 - Math.PI / 2;
    pts.push({ x: cx + Math.cos(a) * (Math.min(cx, cy) * 0.78), y: cy + Math.sin(a) * (Math.min(cx, cy) * 0.78) });
  }
  for (let i = 0; i < inner; i++) {
    const a = (i / inner) * Math.PI * 2 - Math.PI / 2;
    pts.push({ x: cx + Math.cos(a) * (Math.min(cx, cy) * 0.42), y: cy + Math.sin(a) * (Math.min(cx, cy) * 0.42) });
  }
  return pts;
}

// ─────────────────────────────────────────────────────────────────────────────
// Neural Canvas
// ─────────────────────────────────────────────────────────────────────────────

interface NodeState {
  id: number;
  decision: "LONG" | "SHORT" | "NO TRADE" | "IDLE";
  confidence: number;
  pulsePhase: number;
}

interface EdgeState { from: number; to: number; decision: string }

function NeuralCanvas({ nodes, edges, selectedId, onSelectAgent, width, height }: {
  nodes: NodeState[];
  edges: EdgeState[];
  selectedId: number | null;
  onSelectAgent: (id: number) => void;
  width: number;
  height: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const posRef = useRef(buildPositions(20, width, height));

  // Rebuild positions on resize
  useEffect(() => { posRef.current = buildPositions(20, width, height); }, [width, height]);

  // Click detection
  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const scaleX = width / rect.width;
    const scaleY = height / rect.height;
    const mx = (e.clientX - rect.left) * scaleX;
    const my = (e.clientY - rect.top) * scaleY;
    for (let i = 0; i < posRef.current.length; i++) {
      const p = posRef.current[i];
      const dist = Math.hypot(mx - p.x, my - p.y);
      if (dist < 18) { onSelectAgent(i + 1); return; }
    }
  }, [width, height, onSelectAgent]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const draw = (t: number) => {
      const time = t * 0.001;
      ctx.clearRect(0, 0, width, height);
      const positions = posRef.current;

      // Edges
      for (const edge of edges) {
        const fp = positions[edge.from - 1];
        const tp = positions[edge.to - 1];
        if (!fp || !tp) continue;
        const isL = edge.decision === "LONG";
        const rgb = isL ? "74,222,128" : "248,113,113";
        const prog = (time * 0.45 + edge.from * 0.09) % 1;
        const px = fp.x + (tp.x - fp.x) * prog;
        const py = fp.y + (tp.y - fp.y) * prog;

        ctx.beginPath(); ctx.moveTo(fp.x, fp.y); ctx.lineTo(tp.x, tp.y);
        ctx.strokeStyle = `rgba(${rgb},0.1)`; ctx.lineWidth = 1; ctx.stroke();

        const g = ctx.createRadialGradient(px, py, 0, px, py, 6);
        g.addColorStop(0, `rgba(${rgb},0.85)`); g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.beginPath(); ctx.arc(px, py, 6, 0, Math.PI * 2); ctx.fillStyle = g; ctx.fill();
      }

      // Nodes
      nodes.forEach((node, i) => {
        const p = positions[i];
        if (!p) return;
        const pulse = Math.sin(time * 2.3 + node.pulsePhase) * 0.5 + 0.5;
        const isSelected = selectedId === node.id;
        const isL = node.decision === "LONG";
        const isS = node.decision === "SHORT";

        let rgb = "255,255,255";
        let alpha = 0.1 + pulse * 0.07;
        let r = 5;

        if (isL) { rgb = "74,222,128"; alpha = 0.55 + (node.confidence / 100) * 0.45; r = 5 + (node.confidence / 100) * 5; }
        else if (isS) { rgb = "248,113,113"; alpha = 0.55 + (node.confidence / 100) * 0.45; r = 5 + (node.confidence / 100) * 5; }
        else if (node.decision === "NO TRADE") { rgb = "80,95,115"; alpha = 0.25; r = 4; }

        // Glow
        const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 5);
        glow.addColorStop(0, `rgba(${rgb},${alpha * 0.35})`);
        glow.addColorStop(1, "rgba(0,0,0,0)");
        ctx.beginPath(); ctx.arc(p.x, p.y, r * 5, 0, Math.PI * 2); ctx.fillStyle = glow; ctx.fill();

        // Core
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${rgb},${alpha})`; ctx.fill();

        // Selected ring
        if (isSelected) {
          ctx.beginPath(); ctx.arc(p.x, p.y, r + 6 + pulse * 2, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(212,168,71,${0.6 + pulse * 0.4})`; ctx.lineWidth = 1.5; ctx.stroke();
        }

        // Hover hit area indicator (subtle)
        ctx.beginPath(); ctx.arc(p.x, p.y, 14, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255,255,255,0)`; ctx.lineWidth = 0; ctx.stroke();
      });

      rafRef.current = requestAnimationFrame(draw);
    };
    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [nodes, edges, selectedId, width, height]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      onClick={handleClick}
      style={{ width: "100%", height: "100%", cursor: "crosshair", display: "block" }}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const fmt = (v: number | null | undefined) => {
  if (v == null || isNaN(v)) return "—";
  return v < 1 ? v.toFixed(6) : v < 100 ? v.toFixed(4) : v.toFixed(2);
};

const timeAgo = (ts: number) => {
  const s = Math.floor((Date.now() - ts * 1000) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
};

// ─────────────────────────────────────────────────────────────────────────────
// World Page
// ─────────────────────────────────────────────────────────────────────────────

export default function WorldPage() {
  const [result, setResult] = useState<SimResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<number>(0);
  const [nodes, setNodes] = useState<NodeState[]>(
    AGENTS.map((a, i) => ({ id: a.id, decision: "IDLE", confidence: 0, pulsePhase: (i * 0.37) % (Math.PI * 2) }))
  );
  const [edges, setEdges] = useState<EdgeState[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [canvasSize, setCanvasSize] = useState({ w: 700, h: 460 });
  const containerRef = useRef<HTMLDivElement>(null);

  // Canvas responsive sizing
  useEffect(() => {
    const obs = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        const w = entry.contentRect.width;
        setCanvasSize({ w: Math.floor(w), h: Math.floor(w * 0.65) });
      }
    });
    if (containerRef.current) obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  const fetchLatest = useCallback(async () => {
    try {
      const API = typeof window !== "undefined" ? window.location.origin : "";
      const res = await fetch(`${API}/sim/latest`);
      if (!res.ok) { setLoading(false); return; }
      const data: SimResult = await res.json();
      setResult(data);
      setLastUpdated(data.timestamp);
      setLoading(false);

      // Build nodes from round3
      const opinions: AgentOpinion[] = data.round3_opinions || [];
      setNodes(AGENTS.map((a, i) => {
        const op = opinions.find((o: AgentOpinion) => o.agent_id === a.id);
        return { id: a.id, decision: (op?.decision as NodeState["decision"]) || "IDLE", confidence: op?.confidence || 0, pulsePhase: (i * 0.37) % (Math.PI * 2) };
      }));

      // Build edges
      const longOps = opinions.filter((o: AgentOpinion) => o.decision === "LONG");
      const shortOps = opinions.filter((o: AgentOpinion) => o.decision === "SHORT");
      const newEdges: EdgeState[] = [];
      for (let i = 0; i < longOps.length; i++)
        for (let j = i + 1; j < longOps.length; j++)
          newEdges.push({ from: longOps[i].agent_id, to: longOps[j].agent_id, decision: "LONG" });
      for (let i = 0; i < shortOps.length; i++)
        for (let j = i + 1; j < shortOps.length; j++)
          newEdges.push({ from: shortOps[i].agent_id, to: shortOps[j].agent_id, decision: "SHORT" });
      setEdges(newEdges);
    } catch { setLoading(false); }
  }, []);

  useEffect(() => {
    fetchLatest();
    const iv = setInterval(fetchLatest, 15000);
    return () => clearInterval(iv);
  }, [fetchLatest]);

  const selectedAgent = selectedId ? AGENTS.find((a) => a.id === selectedId) : null;
  const getOpinion = (agentId: number, round: number) =>
    result ? [result.round1_opinions, result.round2_opinions, result.round3_opinions][round - 1]?.find((o) => o.agent_id === agentId) : null;

  // Auto-detect current round from backend data (no manual tab needed)
  const activeRound = result
    ? (result.round3_opinions?.length ? 3 : result.round2_opinions?.length ? 2 : 1)
    : 0;

  const roundOpinions: AgentOpinion[] = result
    ? (activeRound === 3 ? result.round3_opinions : activeRound === 2 ? result.round2_opinions : result.round1_opinions) ?? []
    : [];

  const vote = result?.vote_breakdown;
  const isLong = result?.final_decision === "LONG";
  const isShort = result?.final_decision === "SHORT";

  return (
    <div className="min-h-screen bg-[#030303] text-white">

      {/* Ambient bg */}
      <div className="fixed inset-0 pointer-events-none" style={{
        background: "radial-gradient(ellipse at 20% 20%, rgba(96,165,250,0.04) 0%, transparent 50%), radial-gradient(ellipse at 80% 80%, rgba(212,168,71,0.04) 0%, transparent 50%)"
      }} />

      {/* Nav */}
      <motion.header
        initial={{ y: -20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.6 }}
        className="sticky top-0 z-50 px-4 sm:px-8 py-4 border-b border-white/[0.05] bg-[#030303]/90 backdrop-blur-xl"
      >
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link href="/" className="text-[11px] font-mono font-bold tracking-[0.3em] text-white/60 hover:text-white transition-colors">
              SONNET<span className="text-[#d4a847]">RADE</span>
            </Link>
            <div className="hidden sm:flex items-center gap-2 text-[9px] font-mono text-white/20">
              <span>/</span>
              <span className="text-white/50">AGENT WORLD</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {result && (
              <div className="hidden sm:flex items-center gap-2 text-[9px] font-mono text-white/25">
                <span className="w-1 h-1 rounded-full bg-[#4ade80] animate-pulse" />
                Updated {timeAgo(lastUpdated)}
              </div>
            )}
            <Link href="/" className="px-3 py-1.5 rounded-lg glass border border-white/[0.08] text-[9px] font-mono text-white/40 hover:text-white/70 transition-colors">
              BACK
            </Link>
          </div>
        </div>
      </motion.header>

      <main className="max-w-7xl mx-auto px-4 sm:px-8 py-8">

        {/* Page title */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7 }} className="mb-8">
          <h1 className="font-display text-3xl sm:text-4xl font-bold text-white mb-1">
            Agent <span className="italic text-[#d4a847]">World</span>
          </h1>
          <p className="text-[10px] font-mono text-white/25 tracking-wider">
            20 AUTONOMOUS TRADERS · LIVE FROM BOT · 3-ROUND DELIBERATION
          </p>
        </motion.div>

        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="text-[10px] font-mono text-white/25 tracking-[0.3em] animate-pulse">
              LOADING AGENT WORLD...
            </div>
          </div>
        ) : !result ? (
          <div className="flex flex-col items-center justify-center h-64 gap-4">
            <div className="w-px h-16 bg-gradient-to-b from-transparent via-white/10 to-transparent" />
            <p className="text-[10px] font-mono text-white/20 tracking-[0.3em]">AWAITING FIRST SIMULATION</p>
            <p className="text-[9px] font-mono text-white/10">Start the bot from the admin dashboard to begin</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-6">

            {/* Left: neural canvas + consensus */}
            <div className="space-y-4">

              {/* Neural canvas */}
              <motion.div
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.8 }}
                className="glass rounded-2xl border border-white/[0.06] overflow-hidden"
              >
                <div className="px-4 py-3 border-b border-white/[0.05] flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#4ade80] animate-pulse" />
                    <span className="text-[10px] font-mono text-white/40">{result.symbol}</span>
                    <span className="text-[10px] font-mono text-white/20">·</span>
                    <span className="text-[10px] font-mono text-white/30">{result.agent_count} agents · {result.token_count} tokens</span>
                  </div>
                  <div className="flex items-center gap-4 text-[8px] font-mono text-white/20">
                    {[["LONG", "#4ade80"], ["SHORT", "#f87171"]].map(([l, c]) => (
                      <span key={l} className="flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: c }} />{l}
                      </span>
                    ))}
                  </div>
                </div>

                <div ref={containerRef} className="relative bg-black/30">
                  <NeuralCanvas
                    nodes={nodes}
                    edges={edges}
                    selectedId={selectedId}
                    onSelectAgent={setSelectedId}
                    width={canvasSize.w}
                    height={canvasSize.h}
                  />
                  <p className="absolute bottom-3 right-3 text-[8px] font-mono text-white/15">
                    Click a node to inspect
                  </p>
                </div>

                {/* Auto round indicator */}
                <div className="px-4 py-3 border-t border-white/[0.05] flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#4ade80] animate-pulse" />
                  <span className="text-[9px] font-mono text-white/40 tracking-wider">
                    {activeRound === 3 ? "ROUND 3 — FINAL VOTE" : activeRound === 2 ? "ROUND 2 — DELIBERATION" : activeRound === 1 ? "ROUND 1 — INDEPENDENT" : "AWAITING DATA"}
                  </span>
                </div>
              </motion.div>

              {/* Consensus result */}
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.7, delay: 0.15 }}
                className="glass-gold rounded-2xl border border-[#d4a847]/15 p-5"
              >
                <div className="flex items-start gap-6">
                  <div className="flex-1">
                    <div className="text-[9px] font-mono text-white/20 tracking-[0.25em] uppercase mb-2">Final Consensus</div>
                    <div
                      className={`font-display text-5xl font-bold leading-none mb-2 ${isLong ? "text-[#4ade80]" : isShort ? "text-[#f87171]" : "text-white/30"}`}
                      style={isLong ? { textShadow: "0 0 30px rgba(74,222,128,0.35)" } : isShort ? { textShadow: "0 0 30px rgba(248,113,113,0.35)" } : {}}
                    >
                      {result.final_decision}
                    </div>
                    <div className="text-[9px] font-mono text-white/25">
                      {fmt(result.current_price)} · {(result.consensus_confidence ?? 0).toFixed(1)}% confidence
                    </div>
                  </div>

                  {result.final_decision !== "NO TRADE" && (
                    <div className="grid grid-cols-2 gap-2 text-right">
                      {[["ENTRY", result.consensus_entry], ["TP1", result.consensus_tp1], ["TP2", result.consensus_tp2], ["SL", result.consensus_sl]].map(([l, v]) => (
                        <div key={l as string} className="bg-white/[0.03] rounded-lg px-3 py-2">
                          <div className="text-[8px] font-mono text-white/20 mb-0.5">{l}</div>
                          <div className="text-[11px] font-mono text-white/70 font-bold">{fmt(v as number)}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {vote && (
                  <div className="mt-4 pt-4 border-t border-white/[0.05] space-y-2">
                    {Object.entries(vote.pct ?? {}).map(([dec, pct]) => {
                      const l = dec === "LONG", s = dec === "SHORT";
                      return (
                        <div key={dec} className="flex items-center gap-3">
                          <span className={`text-[9px] font-mono w-16 ${l ? "text-[#4ade80]" : s ? "text-[#f87171]" : "text-white/20"}`}>{dec}</span>
                          <div className="flex-1 h-[2px] bg-white/[0.06] rounded-full overflow-hidden">
                            <motion.div initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 1, ease: "easeOut" }}
                              className={`h-full rounded-full ${l ? "bg-[#4ade80]" : s ? "bg-[#f87171]" : "bg-white/15"}`} />
                          </div>
                          <span className="text-[9px] font-mono text-white/30 w-10 text-right">{pct.toFixed(1)}%</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </motion.div>
            </div>

            {/* Right: agent inspector + opinion feed */}
            <div className="space-y-4">

              {/* Selected agent inspector */}
              <AnimatePresence mode="wait">
                {selectedAgent ? (
                  <motion.div key={selectedAgent.id} initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                    className="glass-gold rounded-2xl border border-[#d4a847]/20 p-4"
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <div className="text-[9px] font-mono text-[#d4a847]/50 tracking-[0.2em] uppercase mb-1">Agent Inspector</div>
                        <div className="text-sm font-mono font-bold text-white">{selectedAgent.name}</div>
                        <div className="text-[9px] font-mono text-white/30 mt-0.5">{selectedAgent.archetype}</div>
                      </div>
                      <button onClick={() => setSelectedId(null)} className="text-[9px] font-mono text-white/20 hover:text-white/50 transition-colors">CLOSE</button>
                    </div>
                    <div className="text-[9px] font-mono text-white/20 mb-2">Influence weight: {selectedAgent.weight}×</div>

                    {/* Per-round opinions */}
                    <div className="space-y-2">
                      {([1, 2, 3] as const).map((rn) => {
                        const op = getOpinion(selectedAgent.id, rn);
                        const changed = rn > 1 && getOpinion(selectedAgent.id, rn - 1 as 1 | 2)?.decision !== op?.decision;
                        const l = op?.decision === "LONG", s = op?.decision === "SHORT";
                        return (
                          <div key={rn} className="flex items-start gap-3 py-2 border-t border-white/[0.05]">
                            <span className="text-[8px] font-mono text-white/20 w-12 flex-shrink-0 pt-0.5">R{rn}</span>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <span className={`text-[9px] font-mono font-bold ${l ? "text-[#4ade80]" : s ? "text-[#f87171]" : "text-white/25"}`}>
                                  {op?.decision || "—"}
                                </span>
                                {changed && <span className="text-[8px] font-mono text-[#c4b5fd]">CHANGED</span>}
                                {op && <span className="text-[8px] font-mono text-white/20">{op.confidence}%</span>}
                              </div>
                              {op?.reason && <p className="text-[9px] text-white/30 italic leading-relaxed line-clamp-2">{op.reason}</p>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </motion.div>
                ) : (
                  <motion.div key="hint" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    className="glass rounded-2xl border border-white/[0.05] p-4 text-center"
                  >
                    <p className="text-[9px] font-mono text-white/15 tracking-[0.2em]">CLICK A NODE TO INSPECT</p>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Opinion feed for current round */}
              <div className="glass rounded-2xl border border-white/[0.05] overflow-hidden">
                <div className="px-4 py-3 border-b border-white/[0.05]">
                  <span className="text-[9px] font-mono text-white/30 tracking-wider">
                    {activeRound === 3 ? "ROUND 3 — FINAL VOTE" : activeRound === 2 ? "ROUND 2 — DELIBERATION" : "ROUND 1 — INDEPENDENT"}
                  </span>
                </div>
                <div className="overflow-y-auto" style={{ maxHeight: 480 }}>
                  <AnimatePresence mode="wait">
                    <motion.div key={activeRound} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="divide-y divide-white/[0.04]">
                      {roundOpinions.map((op, i) => {
                        const prevOp = activeRound > 1
                          ? (activeRound === 2 ? result.round1_opinions : result.round2_opinions)?.find((o) => o.agent_id === op.agent_id)
                          : undefined;
                        const changed = prevOp && prevOp.decision !== op.decision;
                        const l = op.decision === "LONG", s = op.decision === "SHORT";
                        const isActive = selectedId === op.agent_id;
                        return (
                          <motion.div
                            key={op.agent_id}
                            initial={{ opacity: 0, x: -6 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: i * 0.02 }}
                            onClick={() => setSelectedId(isActive ? null : op.agent_id)}
                            className={`px-4 py-3 cursor-pointer transition-colors ${isActive ? "bg-[#d4a847]/05 border-l-2 border-[#d4a847]" : "hover:bg-white/[0.02]"}`}
                          >
                            <div className="flex items-center justify-between mb-1">
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] font-mono text-white/60">{op.agent_name}</span>
                                {changed && <span className="text-[8px] font-mono text-[#c4b5fd]">CHANGED</span>}
                                <span className="text-[8px] font-mono text-white/15">T{op.token_slot}</span>
                              </div>
                              <span className={`text-[9px] font-mono font-bold ${l ? "text-[#4ade80]" : s ? "text-[#f87171]" : "text-white/25"}`}>
                                {op.decision}
                              </span>
                            </div>
                            <p className="text-[9px] text-white/30 italic leading-relaxed line-clamp-1">{op.reason}</p>
                            <div className="flex items-center gap-2 mt-1.5">
                              <div className="flex-1 h-[1px] bg-white/[0.05] rounded overflow-hidden">
                                <div className={`h-full ${l ? "bg-[#4ade80]" : s ? "bg-[#f87171]" : "bg-white/15"}`} style={{ width: `${op.confidence}%` }} />
                              </div>
                              <span className="text-[8px] font-mono text-white/20">{op.confidence}%</span>
                            </div>
                          </motion.div>
                        );
                      })}
                    </motion.div>
                  </AnimatePresence>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
