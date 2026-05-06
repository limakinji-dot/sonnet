"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";

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
  vote_breakdown: {
    scores: Record<string, number>;
    pct: Record<string, number>;
    winner: string;
  };
}

const AGENTS = [
  { id: 1,  name: "The Sniper",       archetype: "Precision Trend Follower",    weight: 1.6, short: "Sniper"      },
  { id: 2,  name: "The Hawk",         archetype: "Aggressive Trend Rider",       weight: 1.2, short: "Hawk"        },
  { id: 3,  name: "The Glacier",      archetype: "Patient Swing Trader",         weight: 1.8, short: "Glacier"     },
  { id: 4,  name: "The Shadow",       archetype: "Stealth Trend Follower",       weight: 1.3, short: "Shadow"      },
  { id: 5,  name: "The Contrarian",   archetype: "Reversal Hunter",              weight: 1.0, short: "Contrarian"  },
  { id: 6,  name: "The Phoenix",      archetype: "Bounce Specialist",            weight: 0.9, short: "Phoenix"     },
  { id: 7,  name: "Devils Advocate",  archetype: "Structural Reversal Analyst",  weight: 1.1, short: "D.Advocate"  },
  { id: 8,  name: "The Fader",        archetype: "Overextension Fader",          weight: 0.9, short: "Fader"       },
  { id: 9,  name: "The Quant",        archetype: "Risk-Reward Calculator",       weight: 1.2, short: "Quant"       },
  { id: 10, name: "The Statistician", archetype: "Pattern Probability Analyst",  weight: 1.1, short: "Statist."    },
  { id: 11, name: "The Engineer",     archetype: "Systematic Structure Analyst", weight: 1.3, short: "Engineer"    },
  { id: 12, name: "The Macro",        archetype: "HTF Big Picture Strategist",   weight: 1.9, short: "Macro"       },
  { id: 13, name: "The Oracle",       archetype: "Multi-TF Confluence Analyst",  weight: 2.0, short: "Oracle"      },
  { id: 14, name: "The Architect",    archetype: "Market Structure Builder",     weight: 1.5, short: "Architect"   },
  { id: 15, name: "The Scalper",      archetype: "Aggressive LTF Trader",        weight: 0.8, short: "Scalper"     },
  { id: 16, name: "The Bullet",       archetype: "Breakout Momentum Trader",     weight: 0.9, short: "Bullet"      },
  { id: 17, name: "The Pulse",        archetype: "Order Flow Reader",            weight: 0.8, short: "Pulse"       },
  { id: 18, name: "The Sentinel",     archetype: "Risk Manager",                 weight: 1.7, short: "Sentinel"    },
  { id: 19, name: "The Alchemist",    archetype: "Cross-Asset Analyst",          weight: 1.4, short: "Alchemist"   },
  { id: 20, name: "The Veteran",      archetype: "Experienced All-Round Trader", weight: 1.5, short: "Veteran"     },
];

function buildRingPositions(count: number, w: number, h: number) {
  const cx = w / 2, cy = h / 2;
  const outer = 12, inner = count - outer;
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < outer; i++) {
    const a = (i / outer) * Math.PI * 2 - Math.PI / 2;
    pts.push({
      x: cx + Math.cos(a) * (Math.min(cx, cy) * 0.72),
      y: cy + Math.sin(a) * (Math.min(cx, cy) * 0.68),
    });
  }
  for (let i = 0; i < inner; i++) {
    const a = (i / inner) * Math.PI * 2 - Math.PI / 2;
    pts.push({
      x: cx + Math.cos(a) * (Math.min(cx, cy) * 0.36),
      y: cy + Math.sin(a) * (Math.min(cx, cy) * 0.36),
    });
  }
  return pts;
}

interface PhysBody { x: number; y: number; vx: number; vy: number; baseX: number; baseY: number; weight: number; }
interface NodeState { id: number; decision: "LONG" | "SHORT" | "NO TRADE" | "IDLE"; confidence: number; pulsePhase: number; }

function stepPhysics(bodies: PhysBody[], nodes: NodeState[], mouse: { x: number; y: number }, hoveredId: number | null, W: number, H: number) {
  const N = bodies.length;
  if (N === 0) return;
  const fx = new Float32Array(N);
  const fy = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const bi = bodies[i]; const ni = nodes[i];
    const sk = 0.008 * bi.weight;
    fx[i] += (bi.baseX - bi.x) * sk; fy[i] += (bi.baseY - bi.y) * sk;
    const cmx = bi.x - mouse.x, cmy = bi.y - mouse.y;
    const cdist = Math.sqrt(cmx * cmx + cmy * cmy) + 0.1;
    // Skip repulsion for the hovered node so it stays still and can be clicked
    if (cdist < 110 && hoveredId !== i + 1) { const f = Math.pow((110 - cdist) / 110, 2) * 1.8; fx[i] += (cmx / cdist) * f; fy[i] += (cmy / cdist) * f; }
    if (hoveredId !== null && hoveredId !== i + 1) {
      const bh = bodies[hoveredId - 1]; const nh = nodes[hoveredId - 1];
      if (bh && nh && ni.decision !== "IDLE" && nh.decision !== "IDLE") {
        const dhx = bi.x - bh.x, dhy = bi.y - bh.y;
        const dhd = Math.sqrt(dhx * dhx + dhy * dhy) + 0.1;
        if (ni.decision === nh.decision && ni.decision !== "NO TRADE") { if (dhd > 32 && dhd < 230) { const f = 0.045 * (dhd / 230); fx[i] -= (dhx / dhd) * f; fy[i] -= (dhy / dhd) * f; } }
        else if (ni.decision !== "NO TRADE" && nh.decision !== "NO TRADE") { if (dhd < 160) { const f = 0.04 * Math.pow(1 - dhd / 160, 1.2); fx[i] += (dhx / dhd) * f; fy[i] += (dhy / dhd) * f; } }
      }
    }
    for (let j = i + 1; j < N; j++) {
      const bj = bodies[j]; const nj = nodes[j];
      const dx = bi.x - bj.x, dy = bi.y - bj.y;
      const dist = Math.sqrt(dx * dx + dy * dy) + 0.1;
      const nx_ = dx / dist, ny_ = dy / dist;
      const minD = 30;
      if (dist < minD) { const f = ((minD - dist) / minD) * 0.8; fx[i] += nx_ * f; fy[i] += ny_ * f; fx[j] -= nx_ * f; fy[j] -= ny_ * f; }
      if (ni.decision !== "IDLE" && nj.decision !== "IDLE") {
        const sameDecision = ni.decision === nj.decision && ni.decision !== "NO TRADE";
        const opposing = (ni.decision === "LONG" && nj.decision === "SHORT") || (ni.decision === "SHORT" && nj.decision === "LONG");
        if (sameDecision && dist < 250 && dist > minD) { const avgW = (bi.weight + bj.weight) * 0.5; const confBoost = 0.35 + (nodes[i].confidence + nodes[j].confidence) / 350; const f = (dist / 250) * 0.022 * avgW * confBoost; fx[i] -= nx_ * f; fy[i] -= ny_ * f; fx[j] += nx_ * f; fy[j] += ny_ * f; }
        if (opposing && dist < 190) { const f = Math.pow(1 - dist / 190, 1.4) * 0.06; fx[i] += nx_ * f; fy[i] += ny_ * f; fx[j] -= nx_ * f; fy[j] -= ny_ * f; }
      }
      if (dist < 75 && dist >= minD) { const f = Math.pow(1 - dist / 75, 2) * 0.07; fx[i] += nx_ * f; fy[i] += ny_ * f; fx[j] -= nx_ * f; fy[j] -= ny_ * f; }
    }
    const m = 42;
    if (bi.x < m) fx[i] += (m - bi.x) * 0.12; if (bi.x > W - m) fx[i] -= (bi.x - (W - m)) * 0.12;
    if (bi.y < m) fy[i] += (m - bi.y) * 0.12; if (bi.y > H - m) fy[i] -= (bi.y - (H - m)) * 0.12;
  }
  const damp = 0.855;
  for (let i = 0; i < N; i++) { bodies[i].vx = (bodies[i].vx + fx[i]) * damp; bodies[i].vy = (bodies[i].vy + fy[i]) * damp; bodies[i].x += bodies[i].vx; bodies[i].y += bodies[i].vy; }
}

interface EdgeState { from: number; to: number; decision: string }

function NeuralCanvas({ nodes, edges, selectedId, onSelectAgent, width, height }: {
  nodes: NodeState[]; edges: EdgeState[]; selectedId: number | null;
  onSelectAgent: (id: number) => void; width: number; height: number;
}) {
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const rafRef     = useRef<number>(0);
  const mouseRef   = useRef({ x: -9999, y: -9999 });
  const hoveredRef = useRef<number | null>(null);
  const bodiesRef  = useRef<PhysBody[]>([]);

  useEffect(() => {
    const pts = buildRingPositions(20, width, height);
    bodiesRef.current = pts.map((p, i) => ({
      x: p.x, y: p.y, vx: 0, vy: 0, baseX: p.x, baseY: p.y, weight: AGENTS[i]?.weight ?? 1,
    }));
  }, [width, height]);

  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (width / rect.width);
    const my = (e.clientY - rect.top)  * (height / rect.height);
    for (let i = 0; i < bodiesRef.current.length; i++) {
      if (Math.hypot(mx - bodiesRef.current[i].x, my - bodiesRef.current[i].y) < 22) { onSelectAgent(i + 1); return; }
    }
  }, [width, height, onSelectAgent]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (width / rect.width);
    const my = (e.clientY - rect.top)  * (height / rect.height);
    mouseRef.current = { x: mx, y: my };
    let found: number | null = null;
    for (let i = 0; i < bodiesRef.current.length; i++) {
      if (Math.hypot(mx - bodiesRef.current[i].x, my - bodiesRef.current[i].y) < 22) { found = i + 1; break; }
    }
    hoveredRef.current = found;
    if (canvasRef.current) canvasRef.current.style.cursor = found !== null ? "pointer" : "crosshair";
  }, [width, height]);

  const handleMouseLeave = useCallback(() => {
    mouseRef.current = { x: -9999, y: -9999 }; hoveredRef.current = null;
    if (canvasRef.current) canvasRef.current.style.cursor = "crosshair";
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // ── DPR-aware canvas resolution ─────────────────────────────────────────
    // Multiplying the internal pixel buffer by devicePixelRatio ensures text
    // and geometry are rendered at full screen sharpness on Retina / HDPI
    // displays and that font sizes appear correctly on desktop (1× DPR).
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width  = Math.round(width  * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.scale(dpr, dpr);
    // Display size stays at the logical dimensions
    canvas.style.width  = `${width}px`;
    canvas.style.height = `${height}px`;

    const draw = (t: number) => {
      const time = t * 0.001;
      const bodies = bodiesRef.current;
      if (bodies.length === 20) stepPhysics(bodies, nodes, mouseRef.current, hoveredRef.current, width, height);

      ctx.clearRect(0, 0, width, height);

      // Edges
      for (const edge of edges) {
        const fp = bodies[edge.from - 1]; const tp = bodies[edge.to - 1];
        if (!fp || !tp) continue;
        const isL = edge.decision === "LONG"; const rgb = isL ? "74,222,128" : "248,113,113";
        const grad = ctx.createLinearGradient(fp.x, fp.y, tp.x, tp.y);
        grad.addColorStop(0, `rgba(${rgb},0.04)`); grad.addColorStop(0.5, `rgba(${rgb},0.20)`); grad.addColorStop(1, `rgba(${rgb},0.04)`);
        ctx.beginPath(); ctx.moveTo(fp.x, fp.y); ctx.lineTo(tp.x, tp.y);
        ctx.strokeStyle = grad; ctx.lineWidth = 1.3; ctx.stroke();
        for (let k = 0; k < 2; k++) {
          const prog = ((time * 0.5 + edge.from * 0.11 + k * 0.5)) % 1;
          const px = fp.x + (tp.x - fp.x) * prog; const py = fp.y + (tp.y - fp.y) * prog;
          const g = ctx.createRadialGradient(px, py, 0, px, py, 7);
          g.addColorStop(0, `rgba(${rgb},${k === 0 ? 0.85 : 0.4})`); g.addColorStop(1, "rgba(0,0,0,0)");
          ctx.beginPath(); ctx.arc(px, py, 7, 0, Math.PI * 2); ctx.fillStyle = g; ctx.fill();
        }
      }

      // Nodes
      nodes.forEach((node, i) => {
        const p = bodies[i]; if (!p) return;
        const agent = AGENTS[i];
        const pulse = Math.sin(time * 2.3 + node.pulsePhase) * 0.5 + 0.5;
        const isSelected = selectedId === node.id;
        const isHovered  = hoveredRef.current === node.id;
        const isL = node.decision === "LONG"; const isS = node.decision === "SHORT"; const isNT = node.decision === "NO TRADE";

        let rgb = "160,185,210"; let alpha = 0.08 + pulse * 0.07; let r = 5;
        if (isL)  { rgb = "74,222,128";  alpha = 0.5 + (node.confidence / 100) * 0.5; r = 5 + (node.confidence / 100) * 7; }
        if (isS)  { rgb = "248,113,113"; alpha = 0.5 + (node.confidence / 100) * 0.5; r = 5 + (node.confidence / 100) * 7; }
        if (isNT) { rgb = "65,85,108"; alpha = 0.22; r = 4; }
        if (isHovered) r *= 1.4;

        const glowR = r * (isHovered || isSelected ? 7 : 5);
        const glow  = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, glowR);
        glow.addColorStop(0, `rgba(${rgb},${alpha * 0.35})`); glow.addColorStop(1, "rgba(0,0,0,0)");
        ctx.beginPath(); ctx.arc(p.x, p.y, glowR, 0, Math.PI * 2); ctx.fillStyle = glow; ctx.fill();

        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fillStyle = `rgba(${rgb},${alpha})`; ctx.fill();
        ctx.beginPath(); ctx.arc(p.x, p.y, r * 0.42, 0, Math.PI * 2); ctx.fillStyle = `rgba(${rgb},${Math.min(1, alpha + 0.35)})`; ctx.fill();

        if ((isL || isS) && node.confidence > 0) {
          const arcEnd = -Math.PI / 2 + (node.confidence / 100) * Math.PI * 2;
          ctx.beginPath(); ctx.arc(p.x, p.y, r + 3.5, -Math.PI / 2, arcEnd);
          ctx.strokeStyle = `rgba(${rgb},0.55)`; ctx.lineWidth = 2; ctx.lineCap = "round"; ctx.stroke();
        }

        if (isSelected) {
          ctx.beginPath(); ctx.arc(p.x, p.y, r + 9 + pulse * 3, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(212,168,71,${0.7 + pulse * 0.3})`; ctx.lineWidth = 1.5; ctx.stroke();
          ctx.beginPath(); ctx.arc(p.x, p.y, r + 18 + pulse * 2, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(212,168,71,${0.15 + pulse * 0.1})`; ctx.lineWidth = 0.8; ctx.stroke();
        }

        if (isHovered && !isSelected) {
          ctx.beginPath(); ctx.arc(p.x, p.y, r + 8 + pulse * 2, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(255,255,255,${0.3 + pulse * 0.2})`; ctx.lineWidth = 1; ctx.stroke();
        }

        // ── Agent label — FIXED: larger fonts + DPR scaling = crisp on all screens ──
        const shortName = agent?.short ?? `A${node.id}`;
        const agentNum  = `A${String(node.id).padStart(2, "0")}`;
        const labelY    = p.y + r + 19;

        let labelAlpha = 0.22;
        if (isL || isS)  labelAlpha = isHovered || isSelected ? 1.0 : 0.70;
        else if (isNT)   labelAlpha = 0.32;
        if (isHovered || isSelected) labelAlpha = Math.max(labelAlpha, 0.90);

        // bg pill on hover/select
        if (isHovered || isSelected) {
          ctx.save();
          ctx.font = `bold 11px 'Courier New', monospace`;
          const tw = ctx.measureText(shortName).width + 14;
          ctx.beginPath();
          ctx.roundRect(p.x - tw / 2, labelY - 10, tw, 13, 3);
          ctx.fillStyle = `rgba(${rgb},0.15)`;
          ctx.fill();
          ctx.restore();
        }

        // Short name — 11px (was 7.5px) → readable on desktop, HD-sharp on mobile
        ctx.save();
        ctx.textAlign = "center";
        ctx.font = `bold 11px 'Courier New', monospace`;
        if (isL)       ctx.fillStyle = `rgba(74,222,128,${labelAlpha})`;
        else if (isS)  ctx.fillStyle = `rgba(248,113,113,${labelAlpha})`;
        else           ctx.fillStyle = `rgba(200,210,225,${labelAlpha})`;
        ctx.fillText(shortName, p.x, labelY);

        // Agent number — 8px (was 5.5px)
        ctx.font = `8px 'Courier New', monospace`;
        ctx.fillStyle = `rgba(255,255,255,${labelAlpha * 0.45})`;
        ctx.fillText(agentNum, p.x, labelY + 12);
        ctx.restore();
      });

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [nodes, edges, selectedId, width, height]);

  return (
    <canvas
      ref={canvasRef}
      onClick={handleClick}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{ display: "block", cursor: "crosshair" }}
    />
  );
}

const fmt = (v: number | null | undefined) => {
  if (v == null || isNaN(v)) return "—";
  return v < 1 ? v.toFixed(6) : v < 100 ? v.toFixed(4) : v.toFixed(2);
};
const timeAgo = (ts: number) => {
  const s = Math.floor((Date.now() - ts * 1000) / 1000);
  if (s < 60) return `${s}s ago`; if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
};

export default function WorldPage() {
  const [result, setResult]           = useState<SimResult | null>(null);
  const [loading, setLoading]         = useState(true);
  const [lastUpdated, setLastUpdated] = useState<number>(0);
  const [liveRound, setLiveRound]     = useState<number>(0);
  const [nodes, setNodes]             = useState<NodeState[]>(
    AGENTS.map((a, i) => ({ id: a.id, decision: "IDLE", confidence: 0, pulsePhase: (i * 0.37) % (Math.PI * 2) }))
  );
  const [edges, setEdges]     = useState<EdgeState[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [canvasSize, setCanvasSize] = useState({ w: 700, h: 500 });
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef        = useRef<WebSocket | null>(null);

  useEffect(() => {
    const obs = new ResizeObserver((entries) => {
      const e = entries[0];
      if (e) { const w = e.contentRect.width; setCanvasSize({ w: Math.floor(w), h: Math.floor(w * 0.7) }); }
    });
    if (containerRef.current) obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  // ── Fetch current in-progress simulation (untuk late joiners / mobile) ──────
  const fetchCurrent = useCallback(async () => {
    try {
      const API = typeof window !== "undefined" ? window.location.origin : "";
      const res = await fetch(`${API}/sim/current`);
      if (!res.ok) return;
      const data = await res.json();
      if (!data?.is_running) return;
      // Set round yang sedang berjalan
      setLiveRound(data.round_num || 1);
      // Apply state agent yang sudah masuk — yang belum vote tampil THINKING
      const ops: AgentOpinion[] = data.agent_opinions || [];
      setNodes(AGENTS.map((a, i) => {
        const op = ops.find(o => o.agent_id === a.id);
        return { id: a.id, decision: op ? (op.decision as NodeState["decision"]) : "IDLE", confidence: op?.confidence || 0, pulsePhase: (i * 0.37) % (Math.PI * 2) };
      }));
      const longs = ops.filter(o => o.decision === "LONG"); const shorts = ops.filter(o => o.decision === "SHORT");
      const newEdges: EdgeState[] = [];
      for (let i = 0; i < longs.length; i++) for (let j = i + 1; j < longs.length; j++) newEdges.push({ from: longs[i].agent_id, to: longs[j].agent_id, decision: "LONG" });
      for (let i = 0; i < shorts.length; i++) for (let j = i + 1; j < shorts.length; j++) newEdges.push({ from: shorts[i].agent_id, to: shorts[j].agent_id, decision: "SHORT" });
      setEdges(newEdges);
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || "https://web-production-e78a1.up.railway.app";
    const wsUrl = BACKEND.replace(/^https:\/\//, "wss://").replace(/^http:\/\//, "ws://") + "/sim/ws";
    const connect = () => {
      try {
        const ws = new WebSocket(wsUrl); wsRef.current = ws;
        // ── Sync state saat pertama konek (fix: late joiner / mobile) ──────
        ws.onopen = () => { fetchCurrent(); };
        ws.onmessage = (e) => {
          try {
            const { event, data } = JSON.parse(e.data);
            if (event === "sim_start") {
              setLiveRound(1);
              setNodes(AGENTS.map((a, i) => ({ id: a.id, decision: "IDLE" as const, confidence: 0, pulsePhase: (i * 0.37) % (Math.PI * 2) })));
              setEdges([]);
            } else if (event === "agent_update") {
              setNodes(prev => prev.map(n => n.id === data.agent_id ? { ...n, decision: data.decision as NodeState["decision"], confidence: data.confidence } : n));
            } else if (event === "round_done") {
              setLiveRound(data.round_num + 1);
              const ops: AgentOpinion[] = data.opinions || [];
              setNodes(AGENTS.map((a, i) => { const op = ops.find(o => o.agent_id === a.id); return { id: a.id, decision: (op?.decision as NodeState["decision"]) || "IDLE", confidence: op?.confidence || 0, pulsePhase: (i * 0.37) % (Math.PI * 2) }; }));
              const longs = ops.filter(o => o.decision === "LONG"); const shorts = ops.filter(o => o.decision === "SHORT");
              const newEdges: EdgeState[] = [];
              for (let i = 0; i < longs.length; i++) for (let j = i + 1; j < longs.length; j++) newEdges.push({ from: longs[i].agent_id, to: longs[j].agent_id, decision: "LONG" });
              for (let i = 0; i < shorts.length; i++) for (let j = i + 1; j < shorts.length; j++) newEdges.push({ from: shorts[i].agent_id, to: shorts[j].agent_id, decision: "SHORT" });
              setEdges(newEdges);
            } else if (event === "sim_result") { setLiveRound(0); fetchLatest(); }
          } catch {}
        };
        ws.onclose = () => setTimeout(connect, 3000); ws.onerror = () => ws.close();
      } catch {}
    };
    connect();
    return () => { wsRef.current?.close(); wsRef.current = null; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchLatest = useCallback(async () => {
    try {
      const API = typeof window !== "undefined" ? window.location.origin : "";
      const res = await fetch(`${API}/sim/latest`);
      if (!res.ok) { setLoading(false); return; }
      const data = await res.json();
      if (!data?.simulation_id) { setLoading(false); return; }
      const simData = data as SimResult;
      setResult(simData); setLastUpdated(simData.timestamp); setLoading(false);
      const opinions: AgentOpinion[] = data.round3_opinions || [];
      setNodes(AGENTS.map((a, i) => { const op = opinions.find((o: AgentOpinion) => o.agent_id === a.id); return { id: a.id, decision: (op?.decision as NodeState["decision"]) || "IDLE", confidence: op?.confidence || 0, pulsePhase: (i * 0.37) % (Math.PI * 2) }; }));
      const longOps = opinions.filter((o: AgentOpinion) => o.decision === "LONG"); const shortOps = opinions.filter((o: AgentOpinion) => o.decision === "SHORT");
      const newEdges: EdgeState[] = [];
      for (let i = 0; i < longOps.length; i++) for (let j = i + 1; j < longOps.length; j++) newEdges.push({ from: longOps[i].agent_id, to: longOps[j].agent_id, decision: "LONG" });
      for (let i = 0; i < shortOps.length; i++) for (let j = i + 1; j < shortOps.length; j++) newEdges.push({ from: shortOps[i].agent_id, to: shortOps[j].agent_id, decision: "SHORT" });
      setEdges(newEdges);
    } catch { setLoading(false); }
  }, []);

  useEffect(() => { fetchLatest(); const iv = setInterval(fetchLatest, 15000); return () => clearInterval(iv); }, [fetchLatest]);

  const selectedAgent = selectedId ? AGENTS.find(a => a.id === selectedId) : null;
  const getOpinion = (agentId: number, round: number) =>
    result ? [result.round1_opinions, result.round2_opinions, result.round3_opinions][round - 1]?.find(o => o.agent_id === agentId) : null;

  const activeRound = liveRound > 0 ? liveRound : result
    ? (result.round3_opinions?.length ? 3 : result.round2_opinions?.length ? 2 : 1) : 0;

  const roundOpinions: AgentOpinion[] = result
    ? (activeRound === 3 ? result.round3_opinions : activeRound === 2 ? result.round2_opinions : result.round1_opinions) ?? [] : [];

  const vote = result?.vote_breakdown; const isLong = result?.final_decision === "LONG"; const isShort = result?.final_decision === "SHORT";

  return (
    <div className="min-h-screen bg-[#030303] text-white">
      <div className="fixed inset-0 pointer-events-none" style={{ background: ["radial-gradient(ellipse at 20% 20%, rgba(96,165,250,0.05) 0%, transparent 50%)", "radial-gradient(ellipse at 80% 80%, rgba(212,168,71,0.05) 0%, transparent 50%)"].join(",") }} />

      <motion.header initial={{ y: -20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: 0.6 }}
        className="sticky top-0 z-50 px-4 sm:px-8 py-4 border-b border-white/[0.05] bg-[#030303]/90 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link href="/" className="text-[11px] font-mono font-bold tracking-[0.3em] text-white/60 hover:text-white transition-colors">
              SONNET<span className="text-[#d4a847]">RADE</span>
            </Link>
            <div className="hidden sm:flex items-center gap-2 text-[9px] font-mono text-white/20">
              <span>/</span><span className="text-white/50">AGENT WORLD</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {result && (
              <div className="hidden sm:flex items-center gap-2 text-[9px] font-mono text-white/25">
                <span className="w-1 h-1 rounded-full bg-[#4ade80] animate-pulse" />
                Updated {timeAgo(lastUpdated)}
              </div>
            )}
            <Link href="/" className="px-3 py-1.5 rounded-lg glass border border-white/[0.08] text-[9px] font-mono text-white/40 hover:text-white/70 transition-colors">BACK</Link>
          </div>
        </div>
      </motion.header>

      <main className="max-w-7xl mx-auto px-4 sm:px-8 py-8">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7 }} className="mb-8">
          <h1 className="font-display text-3xl sm:text-4xl font-bold text-white mb-1">
            Agent <span className="italic text-[#d4a847]">World</span>
          </h1>
          <p className="text-[10px] font-mono text-white/25 tracking-wider">20 AUTONOMOUS TRADERS · LIVE · 3-ROUND DELIBERATION · HOVER TO INTERACT</p>
        </motion.div>

        <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-6">
          <div className="space-y-4">
            <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.8 }}
              className="glass rounded-2xl border border-white/[0.06] overflow-hidden">
              <div className="px-4 py-3 border-b border-white/[0.05] flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className={`w-1.5 h-1.5 rounded-full ${loading ? "bg-[#d4a847] animate-pulse" : "bg-[#4ade80] animate-pulse"}`} />
                  <span className="text-[10px] font-mono text-white/40">{loading ? "CONNECTING..." : result ? result.symbol : "AWAITING SIMULATION"}</span>
                  {result && (<><span className="text-[10px] font-mono text-white/20">·</span><span className="text-[10px] font-mono text-white/30">{result.agent_count} agents · {result.token_count} tokens</span></>)}
                </div>
                <div className="flex items-center gap-4 text-[8px] font-mono text-white/20">
                  {[["LONG", "#4ade80"], ["SHORT", "#f87171"]].map(([l, c]) => (
                    <span key={l} className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full" style={{ background: c }} />{l}</span>
                  ))}
                </div>
              </div>

              <div ref={containerRef} className="relative bg-black/30">
                <NeuralCanvas nodes={nodes} edges={edges} selectedId={selectedId} onSelectAgent={setSelectedId} width={canvasSize.w} height={canvasSize.h} />
                {!result && !loading && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <p className="text-[10px] font-mono text-white/20 tracking-[0.3em]">S</p>
                    <p className="text-[9px] font-mono text-white/10 mt-1">T</p>
                  </div>
                )}
                <p className="absolute bottom-3 right-3 text-[8px] font-mono text-white/15 pointer-events-none">·</p>
              </div>

              <div className="px-4 py-3 border-t border-white/[0.05] flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-[#4ade80] animate-pulse" />
                <span className="text-[9px] font-mono text-white/40 tracking-wider">
                  {loading ? "LOADING..." : activeRound === 3 ? "ROUND 3 — FINAL VOTE" : activeRound === 2 ? "ROUND 2 — DELIBERATION" : activeRound === 1 ? "ROUND 1 — INDEPENDENT" : "20 AGENTS IDLE · WAITING FOR BOT"}
                </span>
              </div>
            </motion.div>

            {result ? (
              <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.1 }}
                className="glass-gold rounded-2xl border border-[#d4a847]/15 p-5">
                <div className="flex items-start gap-6">
                  <div className="flex-1">
                    <div className="text-[9px] font-mono text-white/20 tracking-[0.25em] uppercase mb-2">Final Consensus</div>
                    <div className={`font-display text-5xl font-bold leading-none mb-2 ${isLong ? "text-[#4ade80]" : isShort ? "text-[#f87171]" : "text-white/30"}`}
                      style={isLong ? { textShadow: "0 0 30px rgba(74,222,128,0.35)" } : isShort ? { textShadow: "0 0 30px rgba(248,113,113,0.35)" } : {}}>
                      {result.final_decision}
                    </div>
                    <div className="text-[9px] font-mono text-white/25">{fmt(result.current_price)} · {(result.consensus_confidence ?? 0).toFixed(1)}% confidence</div>
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
            ) : (
              <div className="glass rounded-2xl border border-white/[0.04] p-5 text-center">
                <p className="text-[9px] font-mono text-white/15 tracking-[0.2em]">CONSENSUS PANEL</p>
                <p className="text-[8px] font-mono text-white/10 mt-1">Final decision appears here after simulation</p>
              </div>
            )}
          </div>

          <div className="space-y-4">
            <AnimatePresence mode="wait">
              {selectedAgent ? (
                <motion.div key={selectedAgent.id} initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                  className="glass-gold rounded-2xl border border-[#d4a847]/20 p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="text-[9px] font-mono text-[#d4a847]/50 tracking-[0.2em] uppercase mb-1">Agent Inspector</div>
                      <div className="text-sm font-mono font-bold text-white">{selectedAgent.name}</div>
                      <div className="text-[9px] font-mono text-white/30 mt-0.5">{selectedAgent.archetype}</div>
                    </div>
                    <button onClick={() => setSelectedId(null)} className="text-[9px] font-mono text-white/20 hover:text-white/50 transition-colors">CLOSE</button>
                  </div>
                  <div className="text-[9px] font-mono text-white/20 mb-2">Influence weight: {selectedAgent.weight}×</div>
                  {!result && liveRound > 0 ? (
                    // Live simulation in progress — show current node state
                    <div className="py-2 border-t border-white/[0.05]">
                      {(() => {
                        const liveNode = nodes.find(n => n.id === selectedAgent.id);
                        const l = liveNode?.decision === "LONG", s = liveNode?.decision === "SHORT";
                        return (
                          <div className="flex items-center gap-3">
                            <span className="text-[8px] font-mono text-white/20 w-12 flex-shrink-0">R{liveRound}</span>
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <span className={`text-[9px] font-mono font-bold ${l ? "text-[#4ade80]" : s ? "text-[#f87171]" : "text-white/25"}`}>
                                  {liveNode?.decision || "THINKING..."}
                                </span>
                                {liveNode && liveNode.decision !== "IDLE" && (
                                  <span className="text-[8px] font-mono text-white/20">{liveNode.confidence}%</span>
                                )}
                              </div>
                              <p className="text-[9px] text-white/20 italic">Simulation round {liveRound} in progress...</p>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  ) : !result ? (
                    <p className="text-[9px] text-white/15 italic py-2 border-t border-white/[0.05]">Awaiting simulation data...</p>
                  ) : (
                  <div className="space-y-2">
                    {([1, 2, 3] as const).map((rn) => {
                      const op = getOpinion(selectedAgent.id, rn);
                      const changed = rn > 1 && getOpinion(selectedAgent.id, (rn - 1) as 1 | 2)?.decision !== op?.decision;
                      const l = op?.decision === "LONG", s = op?.decision === "SHORT";
                      return (
                        <div key={rn} className="flex items-start gap-3 py-2 border-t border-white/[0.05]">
                          <span className="text-[8px] font-mono text-white/20 w-12 flex-shrink-0 pt-0.5">R{rn}</span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className={`text-[9px] font-mono font-bold ${l ? "text-[#4ade80]" : s ? "text-[#f87171]" : "text-white/25"}`}>{op?.decision || "—"}</span>
                              {changed && <span className="text-[8px] font-mono text-[#c4b5fd]">CHANGED</span>}
                              {op && <span className="text-[8px] font-mono text-white/20">{op.confidence}%</span>}
                            </div>
                            {op?.reason && <p className="text-[9px] text-white/30 italic leading-relaxed line-clamp-2">{op.reason}</p>}
                            {!op && <p className="text-[9px] text-white/15 italic">No data for this round</p>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  )}
                </motion.div>
              ) : (
                <motion.div key="hint" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  className="glass rounded-2xl border border-white/[0.05] p-4 text-center">
                  <p className="text-[9px] font-mono text-white/15 tracking-[0.2em]">CLICK A NODE TO INSPECT</p>
                  <p className="text-[8px] font-mono text-white/10 mt-1">Each dot = 1 AI trader · hover to interact</p>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="glass rounded-2xl border border-white/[0.05] overflow-hidden">
              <div className="px-4 py-3 border-b border-white/[0.05]">
                <span className="text-[9px] font-mono text-white/30 tracking-wider">
                  {activeRound === 3 ? "ROUND 3 — FINAL VOTE" : activeRound === 2 ? "ROUND 2 — DELIBERATION" : activeRound === 1 ? "ROUND 1 — INDEPENDENT" : "OPINION FEED"}
                </span>
              </div>
              <div className="overflow-y-auto" style={{ maxHeight: 480 }}>
                {roundOpinions.length === 0 ? (
                  <div className="px-4 py-8 text-center">
                    <p className="text-[9px] font-mono text-white/15 tracking-[0.2em]">NO OPINIONS YET</p>
                    <p className="text-[8px] font-mono text-white/10 mt-1">Waiting for bot simulation</p>
                  </div>
                ) : (
                  <AnimatePresence mode="wait">
                    <motion.div key={activeRound} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="divide-y divide-white/[0.04]">
                      {roundOpinions.map((op, i) => {
                        const prevOp = result && activeRound > 1
                          ? (activeRound === 2 ? result.round1_opinions : result.round2_opinions)?.find(o => o.agent_id === op.agent_id) : undefined;
                        const changed = prevOp && prevOp.decision !== op.decision;
                        const l = op.decision === "LONG", s = op.decision === "SHORT";
                        const isActive = selectedId === op.agent_id;
                        return (
                          <motion.div key={op.agent_id} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.02 }}
                            onClick={() => setSelectedId(isActive ? null : op.agent_id)}
                            className={`px-4 py-3 cursor-pointer transition-colors ${isActive ? "bg-[#d4a847]/05 border-l-2 border-[#d4a847]" : "hover:bg-white/[0.02]"}`}>
                            <div className="flex items-center justify-between mb-1">
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] font-mono text-white/60">{op.agent_name}</span>
                                {changed && <span className="text-[8px] font-mono text-[#c4b5fd]">CHANGED</span>}
                                <span className="text-[8px] font-mono text-white/15">T{op.token_slot}</span>
                              </div>
                              <span className={`text-[9px] font-mono font-bold ${l ? "text-[#4ade80]" : s ? "text-[#f87171]" : "text-white/25"}`}>{op.decision}</span>
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
                )}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
