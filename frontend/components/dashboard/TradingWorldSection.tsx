"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { apiFetch } from "@/lib/api";

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
  trend: string;
  pattern: string;
  reason: string;
  confidence: number;
}

interface VoteBreakdown {
  scores: Record<string, number>;
  pct: Record<string, number>;
  details: Record<string, { decision: string; confidence: number; weight: number; effective: number }>;
  winner: string;
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
  vote_breakdown: VoteBreakdown;
  narrative: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Agent metadata (20 agents)
// ─────────────────────────────────────────────────────────────────────────────

const AGENTS = [
  { id: 1,  name: "The Sniper",           archetype: "Precision Trend Follower",    weight: 1.6 },
  { id: 2,  name: "The Hawk",             archetype: "Aggressive Trend Rider",       weight: 1.2 },
  { id: 3,  name: "The Glacier",          archetype: "Patient Swing Trader",         weight: 1.8 },
  { id: 4,  name: "The Shadow",           archetype: "Stealth Trend Follower",       weight: 1.3 },
  { id: 5,  name: "The Contrarian",       archetype: "Reversal Hunter",              weight: 1.0 },
  { id: 6,  name: "The Phoenix",          archetype: "Bounce Specialist",            weight: 0.9 },
  { id: 7,  name: "Devils Advocate",      archetype: "Structural Reversal Analyst",  weight: 1.1 },
  { id: 8,  name: "The Fader",            archetype: "Overextension Fader",          weight: 0.9 },
  { id: 9,  name: "The Quant",            archetype: "Risk-Reward Calculator",       weight: 1.2 },
  { id: 10, name: "The Statistician",     archetype: "Pattern Probability Analyst",  weight: 1.1 },
  { id: 11, name: "The Engineer",         archetype: "Systematic Structure Analyst", weight: 1.3 },
  { id: 12, name: "The Macro",            archetype: "HTF Big Picture Strategist",   weight: 1.9 },
  { id: 13, name: "The Oracle",           archetype: "Multi-TF Confluence Analyst",  weight: 2.0 },
  { id: 14, name: "The Architect",        archetype: "Market Structure Builder",     weight: 1.5 },
  { id: 15, name: "The Scalper",          archetype: "Aggressive LTF Trader",        weight: 0.8 },
  { id: 16, name: "The Bullet",           archetype: "Breakout Momentum Trader",     weight: 0.9 },
  { id: 17, name: "The Pulse",            archetype: "Order Flow Reader",            weight: 0.8 },
  { id: 18, name: "The Sentinel",         archetype: "Risk Manager",                 weight: 1.7 },
  { id: 19, name: "The Alchemist",        archetype: "Cross-Asset Analyst",          weight: 1.4 },
  { id: 20, name: "The Veteran",          archetype: "Experienced All-Round Trader", weight: 1.5 },
];

// ─────────────────────────────────────────────────────────────────────────────
// Neural Canvas — agent nodes + interaction edges
// ─────────────────────────────────────────────────────────────────────────────

interface NeuralNode {
  id: number;
  x: number;
  y: number;
  decision: "LONG" | "SHORT" | "NO TRADE" | "THINKING" | "IDLE";
  confidence: number;
  active: boolean;
  pulsePhase: number;
}

interface NeuralEdge {
  from: number;
  to: number;
  strength: number; // 0-1
  animated: boolean;
}

function buildLayout(count: number, width: number, height: number) {
  // Arrange agents in a circular + inner ring layout
  const nodes: Array<{ x: number; y: number }> = [];
  const cx = width / 2;
  const cy = height / 2;

  const outer = 12;
  const inner = count - outer;

  // Outer ring
  for (let i = 0; i < outer; i++) {
    const angle = (i / outer) * Math.PI * 2 - Math.PI / 2;
    const r = Math.min(cx, cy) * 0.78;
    nodes.push({ x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r });
  }
  // Inner ring
  for (let i = 0; i < inner; i++) {
    const angle = (i / inner) * Math.PI * 2 - Math.PI / 2;
    const r = Math.min(cx, cy) * 0.42;
    nodes.push({ x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r });
  }
  return nodes;
}

function NeuralCanvas({
  opinions,
  thinkingIds,
  width = 480,
  height = 360,
  round,
}: {
  opinions: AgentOpinion[];
  thinkingIds: number[];
  width?: number;
  height?: number;
  round: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const timeRef = useRef(0);

  const positions = buildLayout(20, width, height);

  // Build node states
  const nodes: NeuralNode[] = AGENTS.map((a, i) => {
    const op = opinions.find((o) => o.agent_id === a.id && o.round_num === round);
    const thinking = thinkingIds.includes(a.id);
    return {
      id: a.id,
      x: positions[i].x,
      y: positions[i].y,
      decision: thinking ? "THINKING" : op ? op.decision : "IDLE",
      confidence: op?.confidence ?? 0,
      active: thinking || !!op,
      pulsePhase: (i * 0.37) % (Math.PI * 2),
    };
  });

  // Build edges between agents that agree (same decision)
  const edges: NeuralEdge[] = [];
  const activeOps = opinions.filter((o) => o.round_num === round && o.decision !== "NO TRADE");
  for (let i = 0; i < activeOps.length; i++) {
    for (let j = i + 1; j < activeOps.length; j++) {
      if (activeOps[i].decision === activeOps[j].decision) {
        const w1 = AGENTS.find((a) => a.id === activeOps[i].agent_id)?.weight ?? 1;
        const w2 = AGENTS.find((a) => a.id === activeOps[j].agent_id)?.weight ?? 1;
        edges.push({
          from: activeOps[i].agent_id,
          to: activeOps[j].agent_id,
          strength: Math.min(1, ((w1 + w2) / 4) * (activeOps[i].confidence / 100)),
          animated: true,
        });
      }
    }
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const draw = (t: number) => {
      timeRef.current = t * 0.001;
      const time = timeRef.current;
      ctx.clearRect(0, 0, width, height);

      // Draw edges
      for (const edge of edges) {
        const fromNode = nodes.find((n) => n.id === edge.from);
        const toNode = nodes.find((n) => n.id === edge.to);
        if (!fromNode || !toNode) continue;

        const fromOp = activeOps.find((o) => o.agent_id === edge.from);
        const isLong = fromOp?.decision === "LONG";
        const baseColor = isLong ? "74, 222, 128" : "248, 113, 113";

        // Animated pulse along edge
        const progress = (time * 0.6 + edge.strength) % 1;
        const px = fromNode.x + (toNode.x - fromNode.x) * progress;
        const py = fromNode.y + (toNode.y - fromNode.y) * progress;

        // Base line
        ctx.beginPath();
        ctx.moveTo(fromNode.x, fromNode.y);
        ctx.lineTo(toNode.x, toNode.y);
        ctx.strokeStyle = `rgba(${baseColor}, ${edge.strength * 0.18})`;
        ctx.lineWidth = edge.strength * 1.5;
        ctx.stroke();

        // Traveling particle
        const grad = ctx.createRadialGradient(px, py, 0, px, py, 6);
        grad.addColorStop(0, `rgba(${baseColor}, 0.9)`);
        grad.addColorStop(1, `rgba(${baseColor}, 0)`);
        ctx.beginPath();
        ctx.arc(px, py, 6, 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.fill();
      }

      // Draw nodes
      for (const node of nodes) {
        const pulse = Math.sin(time * 2.2 + node.pulsePhase) * 0.5 + 0.5;

        let coreColor: string;
        let glowColor: string;
        let radius = 5;

        if (node.decision === "IDLE") {
          coreColor = `rgba(255,255,255,${0.08 + pulse * 0.06})`;
          glowColor = "rgba(255,255,255,0.04)";
          radius = 4;
        } else if (node.decision === "THINKING") {
          coreColor = `rgba(212,168,71,${0.5 + pulse * 0.5})`;
          glowColor = `rgba(212,168,71,${0.15 + pulse * 0.2})`;
          radius = 5 + pulse * 2;
        } else if (node.decision === "LONG") {
          const intensity = node.confidence / 100;
          coreColor = `rgba(74,222,128,${0.6 + intensity * 0.4})`;
          glowColor = `rgba(74,222,128,${0.15 + pulse * 0.12})`;
          radius = 5 + intensity * 4;
        } else if (node.decision === "SHORT") {
          const intensity = node.confidence / 100;
          coreColor = `rgba(248,113,113,${0.6 + intensity * 0.4})`;
          glowColor = `rgba(248,113,113,${0.15 + pulse * 0.12})`;
          radius = 5 + intensity * 4;
        } else {
          coreColor = `rgba(90,100,120,${0.3 + pulse * 0.1})`;
          glowColor = "rgba(90,100,120,0.08)";
          radius = 4;
        }

        // Glow
        const glow = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, radius * 4);
        glow.addColorStop(0, glowColor);
        glow.addColorStop(1, "rgba(0,0,0,0)");
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius * 4, 0, Math.PI * 2);
        ctx.fillStyle = glow;
        ctx.fill();

        // Core
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = coreColor;
        ctx.fill();

        // Ring for thinking
        if (node.decision === "THINKING") {
          ctx.beginPath();
          ctx.arc(node.x, node.y, radius + 4 + pulse * 3, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(212,168,71,${0.3 - pulse * 0.25})`;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }

      animRef.current = requestAnimationFrame(draw);
    };

    animRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animRef.current);
  }, [opinions, thinkingIds, round, edges.length]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{ width: "100%", height: "100%" }}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const fmt = (v: number | null | undefined) => {
  if (v == null) return "—";
  return v < 1 ? v.toFixed(6) : v < 100 ? v.toFixed(4) : v.toFixed(2);
};

const fmtPct = (v: number | null | undefined) => {
  if (v == null) return "—";
  return v.toFixed(1) + "%";
};

// ─────────────────────────────────────────────────────────────────────────────
// Opinion row
// ─────────────────────────────────────────────────────────────────────────────

function OpinionRow({ op, prevOp }: { op: AgentOpinion; prevOp?: AgentOpinion }) {
  const changed = prevOp && prevOp.decision !== op.decision;
  const isLong = op.decision === "LONG";
  const isShort = op.decision === "SHORT";

  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      className="glass rounded-xl p-3 sm:p-4 border border-white/[0.06]"
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-mono text-white/80 font-bold">{op.agent_name}</span>
            {changed && (
              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[#c4b5fd]/10 text-[#c4b5fd] border border-[#c4b5fd]/20">
                CHANGED
              </span>
            )}
            <span className="text-[9px] font-mono text-white/20">T{op.token_slot}</span>
          </div>
          <div className="text-[9px] font-mono text-white/30 mt-0.5">{op.agent_archetype}</div>
        </div>
        <div className={`flex-shrink-0 text-[10px] font-mono font-bold px-2 py-1 rounded border ${
          isLong
            ? "bg-[#4ade80]/10 border-[#4ade80]/25 text-[#4ade80]"
            : isShort
            ? "bg-[#f87171]/10 border-[#f87171]/25 text-[#f87171]"
            : "bg-white/5 border-white/10 text-white/30"
        }`}>
          {op.decision}
        </div>
      </div>

      {op.decision !== "NO TRADE" && op.entry && (
        <div className="flex gap-2 flex-wrap mb-2">
          {[["ENTRY", op.entry], ["TP1", op.tp1], ["TP2", op.tp2], ["MAX", op.tp_max], ["SL", op.sl]].map(
            ([label, val]) =>
              val != null && (
                <span key={label as string} className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-white/[0.04] border border-white/[0.06] text-white/50">
                  <span className="text-white/25 mr-1">{label}</span>{fmt(val as number)}
                </span>
              )
          )}
        </div>
      )}

      <p className="text-[10px] text-white/40 italic leading-relaxed">{op.reason}</p>

      <div className="flex items-center gap-2 mt-2">
        <span className="text-[9px] font-mono text-white/20 w-14">CONF</span>
        <div className="flex-1 h-[2px] bg-white/[0.06] rounded-full overflow-hidden">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${op.confidence}%` }}
            transition={{ duration: 0.8, ease: "easeOut" }}
            className={`h-full rounded-full ${isLong ? "bg-[#4ade80]" : isShort ? "bg-[#f87171]" : "bg-white/20"}`}
          />
        </div>
        <span className="text-[9px] font-mono text-white/30 w-8 text-right">{op.confidence}%</span>
      </div>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

type RoundTab = "consensus" | "r1" | "r2" | "r3";
type SimPhase = "idle" | "fetching" | "r1" | "r2" | "r3" | "done" | "error";

export default function TradingWorldSection() {
  const [symbol, setSymbol] = useState("BTC_USDT");
  const [phase, setPhase] = useState<SimPhase>("idle");
  const [phaseLabel, setPhaseLabel] = useState("");
  const [result, setResult] = useState<SimResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<RoundTab>("consensus");
  const [thinkingIds, setThinkingIds] = useState<number[]>([]);

  const isRunning = phase !== "idle" && phase !== "done" && phase !== "error";

  const runSim = useCallback(async () => {
    if (isRunning) return;
    setResult(null);
    setError(null);
    setActiveTab("consensus");

    try {
      // 1. Fetch market data
      setPhase("fetching");
      setPhaseLabel("Fetching market data...");
      setThinkingIds([]);

      const mRes = await apiFetch(`/market/candles?symbol=${symbol}`);
      if (!mRes.ok) throw new Error(mRes.error || "Market data failed");

      // 2. Mark all thinking
      setPhase("r1");
      setPhaseLabel("Round 1 — Independent Analysis");
      setThinkingIds(AGENTS.map((a) => a.id));

      // 3. Run simulation (single long call)
      const simRes = await apiFetch("/sim/run", {
        method: "POST",
        body: JSON.stringify({
          symbol,
          candles_by_tf: mRes.candles_by_tf,
          current_price: mRes.current_price,
        }),
      });

      if (!simRes.ok) throw new Error(simRes.error || "Simulation failed");

      setPhase("done");
      setPhaseLabel("Complete");
      setThinkingIds([]);
      setResult(simRes.data);
      setActiveTab("consensus");
    } catch (e: any) {
      setPhase("error");
      setPhaseLabel("");
      setError(e.message || "Unknown error");
      setThinkingIds([]);
    }
  }, [symbol, isRunning]);

  // Which opinions to show in neural canvas
  const canvasOpinions =
    !result
      ? []
      : activeTab === "r1"
      ? result.round1_opinions
      : activeTab === "r2"
      ? result.round2_opinions
      : result.round3_opinions;

  const canvasRound =
    activeTab === "r1" ? 1 : activeTab === "r2" ? 2 : 3;

  const tabs: { key: RoundTab; label: string }[] = [
    { key: "consensus", label: "Consensus" },
    { key: "r3", label: "Round 3" },
    { key: "r2", label: "Round 2" },
    { key: "r1", label: "Round 1" },
  ];

  const vote = result?.vote_breakdown;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.4 }}
      className="glass-gold rounded-2xl p-4 sm:p-6 border border-[#d4a847]/20"
    >
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h3 className="text-[10px] font-mono text-[#d4a847] tracking-[0.25em] uppercase flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-[#d4a847]" />
            Trading World Simulation
          </h3>
          <p className="text-[9px] font-mono text-white/20 mt-1 tracking-wider">
            20 AGENTS · 5 BEARER TOKENS · 3 ROUNDS · WEIGHTED CONSENSUS
          </p>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="text"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            placeholder="BTC_USDT"
            disabled={isRunning}
            className="w-28 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-[11px] font-mono text-white placeholder-white/20 focus:outline-none focus:border-[#d4a847]/50 transition-colors disabled:opacity-40"
          />
          <button
            onClick={runSim}
            disabled={isRunning}
            className="px-4 py-2 rounded-lg bg-[#d4a847]/10 border border-[#d4a847]/30 text-[#d4a847] text-[10px] font-mono tracking-wider hover:bg-[#d4a847]/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
          >
            {isRunning ? "RUNNING..." : "RUN SIMULATION"}
          </button>
        </div>
      </div>

      {/* Phase indicator */}
      {isRunning && (
        <div className="mb-4 flex items-center gap-3">
          <div className="w-1.5 h-1.5 rounded-full bg-[#d4a847] animate-pulse" />
          <span className="text-[10px] font-mono text-[#d4a847]/70 tracking-wider">{phaseLabel}</span>
        </div>
      )}

      {/* Error */}
      {phase === "error" && error && (
        <div className="mb-4 p-3 rounded-lg bg-[#f87171]/5 border border-[#f87171]/20 text-[10px] font-mono text-[#f87171]">
          {error}
        </div>
      )}

      {/* Main content grid */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-4">

        {/* Left: neural canvas + consensus */}
        <div className="space-y-4">

          {/* Neural canvas */}
          <div className="relative rounded-xl overflow-hidden bg-black/30 border border-white/[0.05]" style={{ aspectRatio: "4/3" }}>
            {phase === "idle" ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                <div className="w-px h-16 bg-gradient-to-b from-transparent via-[#d4a847]/30 to-transparent" />
                <p className="text-[9px] font-mono text-white/20 tracking-[0.3em] uppercase">
                  20 Agent Neural World
                </p>
              </div>
            ) : (
              <NeuralCanvas
                opinions={canvasOpinions}
                thinkingIds={phase !== "done" ? thinkingIds : []}
                round={canvasRound}
              />
            )}

            {/* Legend */}
            <div className="absolute bottom-3 left-3 flex items-center gap-3">
              {[["LONG", "#4ade80"], ["SHORT", "#f87171"], ["THINKING", "#d4a847"]].map(([label, color]) => (
                <div key={label} className="flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
                  <span className="text-[8px] font-mono text-white/30">{label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Consensus result (shown after done) */}
          {result && (
            <div className="glass rounded-xl p-4 sm:p-5 border border-white/[0.06]">
              <div className="text-[9px] font-mono text-white/25 tracking-[0.25em] uppercase mb-3">
                Final Consensus
              </div>

              <div className="flex items-end gap-4 mb-4">
                <div>
                  <div
                    className={`font-display text-5xl font-bold leading-none ${
                      result.final_decision === "LONG"
                        ? "text-[#4ade80]"
                        : result.final_decision === "SHORT"
                        ? "text-[#f87171]"
                        : "text-white/30"
                    }`}
                    style={
                      result.final_decision === "LONG"
                        ? { textShadow: "0 0 30px rgba(74,222,128,0.35)" }
                        : result.final_decision === "SHORT"
                        ? { textShadow: "0 0 30px rgba(248,113,113,0.35)" }
                        : {}
                    }
                  >
                    {result.final_decision}
                  </div>
                  <div className="text-[9px] font-mono text-white/25 mt-1">
                    {result.symbol} · {fmt(result.current_price)} · {fmtPct(result.consensus_confidence)} confidence
                  </div>
                </div>
              </div>

              {/* Levels */}
              {result.final_decision !== "NO TRADE" && (
                <div className="grid grid-cols-5 gap-2 mb-4">
                  {(
                    [
                      ["ENTRY", result.consensus_entry],
                      ["TP1",   result.consensus_tp1],
                      ["TP2",   result.consensus_tp2],
                      ["MAX",   result.consensus_tp_max],
                      ["SL",    result.consensus_sl],
                    ] as [string, number | null][]
                  ).map(([label, val]) => (
                    <div key={label} className="bg-white/[0.03] border border-white/[0.06] rounded-lg p-2 text-center">
                      <div className="text-[8px] font-mono text-white/25 mb-1">{label}</div>
                      <div className="text-[10px] font-mono text-white/70 font-bold">{fmt(val)}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* Vote bars */}
              {vote && (
                <div className="space-y-2">
                  {Object.entries(vote.pct).map(([dec, pct]) => {
                    const isL = dec === "LONG";
                    const isS = dec === "SHORT";
                    return (
                      <div key={dec} className="flex items-center gap-3">
                        <span className={`text-[9px] font-mono w-16 ${isL ? "text-[#4ade80]" : isS ? "text-[#f87171]" : "text-white/25"}`}>
                          {dec}
                        </span>
                        <div className="flex-1 h-[3px] bg-white/[0.06] rounded-full overflow-hidden">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${pct}%` }}
                            transition={{ duration: 1, ease: "easeOut", delay: 0.2 }}
                            className={`h-full rounded-full ${isL ? "bg-[#4ade80]" : isS ? "bg-[#f87171]" : "bg-white/20"}`}
                          />
                        </div>
                        <span className="text-[9px] font-mono text-white/30 w-10 text-right">{pct.toFixed(1)}%</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Idle placeholder */}
          {phase === "idle" && (
            <div className="glass rounded-xl p-5 border border-white/[0.06] text-center">
              <p className="text-[9px] font-mono text-white/20 tracking-[0.2em] uppercase">
                Select a symbol and run the simulation
              </p>
            </div>
          )}
        </div>

        {/* Right: tabs + opinions */}
        <div className="flex flex-col min-h-0">

          {/* Tabs */}
          <div className="flex border-b border-white/[0.06] mb-3">
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                disabled={!result}
                className={`px-3 py-2 text-[9px] font-mono tracking-wider transition-colors border-b-2 ${
                  activeTab === t.key
                    ? "text-[#d4a847] border-[#d4a847]"
                    : "text-white/25 border-transparent hover:text-white/50"
                } disabled:opacity-30 disabled:cursor-not-allowed`}
              >
                {t.label.toUpperCase()}
              </button>
            ))}
          </div>

          {/* Opinions list */}
          <div className="overflow-y-auto space-y-2 pr-1" style={{ maxHeight: 520 }}>
            <AnimatePresence mode="wait">
              {!result ? (
                <motion.div
                  key="empty"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex items-center justify-center h-40"
                >
                  <p className="text-[9px] font-mono text-white/15 tracking-[0.25em] uppercase">
                    {isRunning ? phaseLabel : "Awaiting simulation"}
                  </p>
                </motion.div>
              ) : activeTab === "consensus" ? (
                <motion.div key="consensus" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-2">
                  {result.round3_opinions.map((op) => (
                    <OpinionRow key={op.agent_id} op={op} prevOp={result.round2_opinions.find(o => o.agent_id === op.agent_id)} />
                  ))}
                </motion.div>
              ) : activeTab === "r3" ? (
                <motion.div key="r3" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-2">
                  {result.round3_opinions.map((op) => (
                    <OpinionRow key={op.agent_id} op={op} prevOp={result.round2_opinions.find(o => o.agent_id === op.agent_id)} />
                  ))}
                </motion.div>
              ) : activeTab === "r2" ? (
                <motion.div key="r2" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-2">
                  {result.round2_opinions.map((op) => (
                    <OpinionRow key={op.agent_id} op={op} prevOp={result.round1_opinions.find(o => o.agent_id === op.agent_id)} />
                  ))}
                </motion.div>
              ) : (
                <motion.div key="r1" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-2">
                  {result.round1_opinions.map((op) => (
                    <OpinionRow key={op.agent_id} op={op} />
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
