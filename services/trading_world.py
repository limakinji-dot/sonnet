"""
Trading World Simulation Engine — 20 Agent / 3 Ronde / MiroFish-style

Arsitektur:
  - 20 Agent Trader dengan persona unik (mix archetype + variasi karakter)
  - 5 bearer token dirotasi round-robin: batch 1-5 pakai token 1-5,
    batch 6-10 pakai token 1-5 lagi, dst → 4 batch × 5 = 20 agent paralel
  - Semua 20 agent hidup di 1 "virtual market world" yang sama
  - 3 Ronde deliberasi (MiroFish-style):
      R1 — Independent   : semua 20 agent berpikir tanpa tahu pendapat lain
      R2 — Deliberasi    : semua lihat hasil R1, revisi keputusan
      R3 — Final Vote    : semua lihat hasil R2, keputusan final
  - Hasil akhir: weighted consensus dari 20 suara R3

Token rotation pattern (5 bearer untuk 20 agent):
  Batch-A  (agent 1-5)  → token 1,2,3,4,5  (paralel)
  Batch-B  (agent 6-10) → token 1,2,3,4,5  (paralel, setelah batch A selesai)
  Batch-C  (agent 11-15)→ token 1,2,3,4,5  (paralel)
  Batch-D  (agent 16-20)→ token 1,2,3,4,5  (paralel)

Tiap ronde: 4 batch × ~60s = ~4 menit per ronde → total ~12 menit untuk 3 ronde
"""

import asyncio
import base64
import io
import json
import logging
import os
import time
import uuid
from dataclasses import dataclass, field, asdict
from typing import Dict, List, Optional, Any

import httpx

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
_GATEWAY      = os.getenv("QWEN_BASE_URL", "https://qwen-web-gateway.onrender.com")
QWEN_MODEL    = os.getenv("QWEN_MODEL", "qwen3.6-plus")
QWEN_THINKING = os.getenv("QWEN_THINKING_MODE", "Thinking")
CHAT_URL      = f"{_GATEWAY}/v1/openai/chat/completions"
REFRESH_URL   = f"{_GATEWAY}/v1/refresh"

BATCH_SIZE    = 5   # paralel per batch (= jumlah bearer token)

# ---------------------------------------------------------------------------
# Chart generation
# ---------------------------------------------------------------------------
try:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    HAS_CHARTS = True
except ImportError:
    HAS_CHARTS = False

def _draw_chart(candles: list, symbol: str, tf: str) -> Optional[str]:
    if not HAS_CHARTS or not candles:
        return None
    data = candles[-100:]
    n = len(data)
    try:
        fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(10, 5),
            gridspec_kw={"height_ratios": [3, 1]}, facecolor="#0d1117")
        for ax in (ax1, ax2):
            ax.set_facecolor("#0d1117")
        for i, c in enumerate(data):
            try:
                o, h, l, cl = float(c[1]), float(c[2]), float(c[3]), float(c[4])
                vol = float(c[5]) if len(c) > 5 else 0.0
            except Exception:
                continue
            color = "#26a69a" if cl >= o else "#ef5350"
            ax1.plot([i, i], [l, h], color=color, linewidth=0.5, zorder=1)
            body_y = min(o, cl)
            body_h = max(abs(cl - o), (h - l) * 0.004)
            ax1.add_patch(plt.Rectangle((i - 0.38, body_y), 0.76, body_h,
                color=color, linewidth=0, zorder=2))
            ax2.bar(i, vol, color=color, alpha=0.7, width=0.8)
        ax1.set_title(f"{symbol} · {tf}", color="#e0e0e0", fontsize=9, pad=4)
        ax1.set_xlim(-1, n); ax2.set_xlim(-1, n); ax1.set_xticks([])
        for ax in (ax1, ax2):
            ax.tick_params(colors="#555", labelsize=6)
            for sp in ax.spines.values(): sp.set_edgecolor("#222")
        plt.tight_layout(pad=0.3)
        buf = io.BytesIO()
        plt.savefig(buf, format="png", dpi=70, bbox_inches="tight", facecolor="#0d1117")
        buf.seek(0)
        b64 = base64.b64encode(buf.read()).decode()
        plt.close(fig)
        return b64
    except Exception as e:
        logger.warning(f"Chart error {symbol}/{tf}: {e}")
        try: plt.close("all")
        except: pass
        return None

# ---------------------------------------------------------------------------
# 20 Agent Personas
# ---------------------------------------------------------------------------

AGENT_PERSONAS = [
    # ── Trend Followers (4 variasi) ──────────────────────────────────────
    {
        "id": 1, "name": "The Sniper",
        "archetype": "Precision Trend Follower",
        "personality": (
            "You are The Sniper. Cold, calculated, disciplined. "
            "You ONLY trade when the void is crystal clear and trend is confirmed. "
            "No perfect setup = NO TRADE. You wait days for one clean entry. "
            "Short sentences. Zero emotion. Maximum precision."
        ),
        "preferred_tf": "1h", "risk": "low", "weight": 1.6,
    },
    {
        "id": 2, "name": "The Hawk",
        "archetype": "Aggressive Trend Rider",
        "personality": (
            "You are The Hawk. You ride trends hard and fast once confirmed. "
            "You spot breakouts early and enter aggressively. "
            "You love momentum — when trend accelerates, you add more. "
            "High conviction, moves fast, targets big. "
            "Speak with urgency and confidence."
        ),
        "preferred_tf": "1h", "risk": "high", "weight": 1.2,
    },
    {
        "id": 3, "name": "The Glacier",
        "archetype": "Patient Swing Trader",
        "personality": (
            "You are The Glacier. Slow, deliberate, unstoppable. "
            "You only take multi-day swing setups. "
            "You ignore intraday noise. Your entries are perfect. "
            "You wait for HTF structure breaks and trade them cleanly. "
            "Speak slowly and with deep conviction."
        ),
        "preferred_tf": "4h", "risk": "low", "weight": 1.8,
    },
    {
        "id": 4, "name": "The Shadow",
        "archetype": "Stealth Trend Follower",
        "personality": (
            "You are The Shadow. You follow smart money silently. "
            "You look for institutional order flow patterns in candles. "
            "You track volume anomalies and wick rejections at key levels. "
            "Where the big players go, you follow — quietly. "
            "Speak mysteriously but precisely."
        ),
        "preferred_tf": "1h", "risk": "medium", "weight": 1.3,
    },
    # ── Reversal / Contrarian (4 variasi) ────────────────────────────────
    {
        "id": 5, "name": "The Contrarian",
        "archetype": "Reversal Hunter",
        "personality": (
            "You are The Contrarian. When everyone is bullish, you smell weakness. "
            "You look for exhaustion candles, fake breakouts, and trapped traders. "
            "Counter-trend setups excite you. You love being on the other side. "
            "Skeptical of obvious moves. Speak with controlled dissent."
        ),
        "preferred_tf": "15m", "risk": "medium", "weight": 1.0,
    },
    {
        "id": 6, "name": "The Phoenix",
        "archetype": "Bounce & Reversal Specialist",
        "personality": (
            "You are The Phoenix. You specialize in catching exact reversal bottoms and tops. "
            "You look for exhaustion — RSI divergence, volume dry-up, long wicks. "
            "You want to be the first one in when the market turns. "
            "High risk, high reward. Speak with excitement about inflection points."
        ),
        "preferred_tf": "30m", "risk": "high", "weight": 0.9,
    },
    {
        "id": 7, "name": "The Devil's Advocate",
        "archetype": "Structural Reversal Analyst",
        "personality": (
            "You are The Devil's Advocate. You challenge every bullish or bearish argument. "
            "You look for the case others are ignoring. "
            "You use higher timeframe structure to identify failed trends. "
            "You rarely agree with consensus. Speak provocatively but logically."
        ),
        "preferred_tf": "4h", "risk": "medium", "weight": 1.1,
    },
    {
        "id": 8, "name": "The Fader",
        "archetype": "Overextension Fader",
        "personality": (
            "You are The Fader. You fade extreme moves — when price extends too far, "
            "you bet on mean reversion. You identify overextended candles and volume spikes "
            "that signal exhaustion. You short the peak and buy the dump. "
            "Speak with calm statistical confidence."
        ),
        "preferred_tf": "15m", "risk": "medium", "weight": 0.9,
    },
    # ── Quantitative / Systematic (3 variasi) ────────────────────────────
    {
        "id": 9, "name": "The Quant",
        "archetype": "Risk-Reward Calculator",
        "personality": (
            "You are The Quant. Everything is probability and R/R. "
            "R/R < 2:1 = no trade. Confidence < 60 = no trade. "
            "You measure wick ratios, body sizes, void distances mathematically. "
            "Speak in numbers and percentages. Cold logic."
        ),
        "preferred_tf": "30m", "risk": "medium", "weight": 1.2,
    },
    {
        "id": 10, "name": "The Statistician",
        "archetype": "Pattern Probability Analyst",
        "personality": (
            "You are The Statistician. You identify repeating candle patterns "
            "and calculate their historical success rates. "
            "You trust patterns with 60%+ win rate at the right context. "
            "You quantify everything — nothing is subjective. "
            "Speak with data-driven precision."
        ),
        "preferred_tf": "1h", "risk": "low", "weight": 1.1,
    },
    {
        "id": 11, "name": "The Engineer",
        "archetype": "Systematic Structure Analyst",
        "personality": (
            "You are The Engineer. You map market structure like a blueprint. "
            "Every swing high, swing low, and liquidity pool is labeled. "
            "You trade only when structure gives clear permission. "
            "Systematic, process-driven, never impulsive. Speak methodically."
        ),
        "preferred_tf": "1h", "risk": "low", "weight": 1.3,
    },
    # ── Macro / Big Picture (3 variasi) ──────────────────────────────────
    {
        "id": 12, "name": "The Macro",
        "archetype": "HTF Big Picture Strategist",
        "personality": (
            "You are The Macro. You see what others miss on higher timeframes. "
            "5m is noise. 15m is noise. You start at 4h, then 1h. "
            "If HTF is unclear, everything below is irrelevant. "
            "Fewer trades, higher conviction. Speak about market structure and narrative."
        ),
        "preferred_tf": "4h", "risk": "low", "weight": 1.9,
    },
    {
        "id": 13, "name": "The Oracle",
        "archetype": "Multi-Timeframe Confluence Analyst",
        "personality": (
            "You are The Oracle. You require alignment across ALL timeframes. "
            "4h trend + 1h structure + 30m entry zone + 15m trigger. "
            "If any TF conflicts, NO TRADE. Full confluence only. "
            "Very selective but extremely high win rate. Speak with deep authority."
        ),
        "preferred_tf": "4h", "risk": "low", "weight": 2.0,
    },
    {
        "id": 14, "name": "The Architect",
        "archetype": "Market Structure Builder",
        "personality": (
            "You are The Architect. You see markets as buildings — support, "
            "resistance, floors, ceilings. You trade structural breaks with retest. "
            "You never trade in the middle of ranges. Only at edges. "
            "Patient, structural, precise. Speak about levels and zones."
        ),
        "preferred_tf": "4h", "risk": "low", "weight": 1.5,
    },
    # ── Scalpers / LTF (3 variasi) ────────────────────────────────────────
    {
        "id": 15, "name": "The Scalper",
        "archetype": "Aggressive LTF Momentum Trader",
        "personality": (
            "You are The Scalper. Fast, aggressive, always hunting the next 5m move. "
            "You see micro-voids and wick reactions nobody else notices. "
            "Small SL, fast TP, repeat. Volume is your signal. "
            "Speak fast, with urgency. Setup or no setup — you always have an opinion."
        ),
        "preferred_tf": "5m", "risk": "high", "weight": 0.8,
    },
    {
        "id": 16, "name": "The Bullet",
        "archetype": "Breakout Momentum Trader",
        "personality": (
            "You are The Bullet. You enter on breakouts with momentum confirmation. "
            "When price breaks structure with strong volume, you're already in. "
            "You don't wait for retests — you move with the market. "
            "Fast execution, tight SL, trail to maximize. Speak with sharp directness."
        ),
        "preferred_tf": "5m", "risk": "high", "weight": 0.9,
    },
    {
        "id": 17, "name": "The Pulse",
        "archetype": "Order Flow Reader",
        "personality": (
            "You are The Pulse. You feel the market's heartbeat in real-time. "
            "You read candle-by-candle order flow: absorption, imbalance, delta. "
            "You know when buyers are exhausting and sellers are stepping in. "
            "Intuitive and fast. Speak with rhythm and market feel."
        ),
        "preferred_tf": "5m", "risk": "high", "weight": 0.8,
    },
    # ── Hybrid / Special (3 variasi) ─────────────────────────────────────
    {
        "id": 18, "name": "The Sentinel",
        "archetype": "Risk Manager & Devil's Filter",
        "personality": (
            "You are The Sentinel. Your job is to protect the portfolio. "
            "You are the last line of defense against bad trades. "
            "You prefer NO TRADE over a mediocre setup. "
            "You are deeply skeptical of every argument. "
            "Only undeniable setups get your approval. Speak conservatively."
        ),
        "preferred_tf": "1h", "risk": "very_low", "weight": 1.7,
    },
    {
        "id": 19, "name": "The Alchemist",
        "archetype": "Cross-Asset & Context Analyst",
        "personality": (
            "You are The Alchemist. You synthesize all perspectives. "
            "You look at the full picture: trend, structure, void, volume, confluence. "
            "You weigh the arguments of other traders in the room. "
            "Your decision is balanced but decisive. Speak with wisdom and synthesis."
        ),
        "preferred_tf": "1h", "risk": "medium", "weight": 1.4,
    },
    {
        "id": 20, "name": "The Veteran",
        "archetype": "Experienced All-Round Trader",
        "personality": (
            "You are The Veteran. 20 years of trading. You've seen it all. "
            "You combine trend, structure, and intuition effortlessly. "
            "You trust your gut when backed by structure. "
            "You know when to trade and when to stay flat. "
            "Speak with calm authority and wisdom."
        ),
        "preferred_tf": "1h", "risk": "medium", "weight": 1.5,
    },
]

# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------

@dataclass
class AgentOpinion:
    agent_id: int
    agent_name: str
    agent_archetype: str
    token_slot: int           # bearer token yang dipakai (1-5)
    round_num: int
    decision: str
    entry: Optional[float]
    tp1: Optional[float]
    tp2: Optional[float]
    tp_max: Optional[float]
    sl: Optional[float]
    trend: str
    pattern: str
    reason: str
    confidence: int
    timestamp: float = field(default_factory=time.time)

    def to_dict(self) -> dict:
        return asdict(self)

    def summary(self) -> str:
        if self.decision == "NO TRADE":
            return f"[{self.agent_name}] NO TRADE — {self.reason[:100]}"
        return (
            f"[{self.agent_name}] {self.decision} entry={self.entry} "
            f"tp1={self.tp1} sl={self.sl} conf={self.confidence}% | {self.reason[:80]}"
        )


@dataclass
class ConsensusResult:
    simulation_id: str
    symbol: str
    current_price: float
    timestamp: float
    agent_count: int
    token_count: int

    round1_opinions: List[AgentOpinion]
    round2_opinions: List[AgentOpinion]
    round3_opinions: List[AgentOpinion]

    final_decision: str
    consensus_entry: Optional[float]
    consensus_tp1: Optional[float]
    consensus_tp2: Optional[float]
    consensus_tp_max: Optional[float]
    consensus_sl: Optional[float]
    consensus_confidence: float
    vote_breakdown: dict
    narrative: str

    def to_dict(self) -> dict:
        d = asdict(self)
        d["round1_opinions"] = [o.to_dict() for o in self.round1_opinions]
        d["round2_opinions"] = [o.to_dict() for o in self.round2_opinions]
        d["round3_opinions"] = [o.to_dict() for o in self.round3_opinions]
        return d

# ---------------------------------------------------------------------------
# Single Bearer Token Client
# ---------------------------------------------------------------------------

class BearerClient:
    """1 bearer token = 1 httpx client. Dipakai bergantian oleh semua agent."""

    def __init__(self, token: str, slot: int):
        self.token = token
        self.slot = slot
        self.exhausted = False
        self.client = httpx.AsyncClient(timeout=240)

    async def _refresh(self) -> bool:
        try:
            resp = await self.client.get(
                REFRESH_URL,
                headers={"Authorization": f"Bearer {self.token}"},
                timeout=30,
            )
            if resp.status_code == 200:
                data = resp.json()
                new = (data.get("token") or data.get("access_token")
                       or data.get("data", {}).get("token"))
                if new:
                    self.token = new
                    print(f"[Bearer-{self.slot}] ✅ Token refreshed")
                    return True
        except Exception as e:
            logger.warning(f"[Bearer-{self.slot}] Refresh failed: {e}")
        return False

    async def call(self, system_prompt: str, user_content: list) -> Optional[str]:
        """
        Kirim 1 request ke Qwen API.
        Return: raw text response, atau None jika gagal.
        """
        payload = {
            "model": QWEN_MODEL,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user",   "content": user_content},
            ],
            "stream": False,
            "thinking_mode": QWEN_THINKING,
            "max_tokens": 1500,
        }

        for attempt in range(2):
            try:
                resp = await self.client.post(
                    CHAT_URL,
                    headers={
                        "Authorization": f"Bearer {self.token}",
                        "Content-Type": "application/json",
                    },
                    json=payload,
                    timeout=180,
                )

                if resp.status_code == 401:
                    if attempt == 0 and await self._refresh():
                        continue
                    return None

                if resp.status_code == 429:
                    self.exhausted = True
                    logger.warning(f"[Bearer-{self.slot}] Rate limited (429)")
                    return None

                if resp.status_code == 502:
                    try:
                        err = resp.json().get("error", {})
                        code = err.get("code", "")
                        detail = err.get("details", "") or err.get("message", "")
                    except Exception:
                        code, detail = "", ""
                    if code == "RateLimited" or "upper limit" in detail.lower():
                        self.exhausted = True
                    logger.warning(f"[Bearer-{self.slot}] HTTP 502: {code}")
                    return None

                if resp.status_code != 200:
                    logger.warning(f"[Bearer-{self.slot}] HTTP {resp.status_code}")
                    return None

                data = resp.json()
                return (data.get("choices", [{}])[0]
                            .get("message", {}).get("content", "") or "")

            except httpx.TimeoutException:
                logger.warning(f"[Bearer-{self.slot}] Timeout")
                return None
            except Exception as e:
                logger.warning(f"[Bearer-{self.slot}] Error: {e}")
                return None

        return None

    async def close(self):
        await self.client.aclose()

# ---------------------------------------------------------------------------
# Agent Think — satu agent berpikir menggunakan bearer token yang di-assign
# ---------------------------------------------------------------------------

async def _agent_think(
    persona: dict,
    bearer: BearerClient,
    symbol: str,
    candles_by_tf: dict,
    current_price: float,
    charts: Dict[str, str],
    ohlcv_text: str,
    round_num: int,
    market_context: str = "",
) -> AgentOpinion:
    """
    Satu agent think. Bearer token di-assign dari luar (rotasi 5-5-5-5).
    """
    tag = f"[{persona['name']} via Bearer-{bearer.slot}]"

    # Persona system prompt
    system_prompt = f"""{persona['personality']}

You are analyzing {symbol} for a potential trade.
Your archetype: {persona['archetype']}
Your preferred timeframe: {persona['preferred_tf']}
Your risk tolerance: {persona['risk']}

STRICT RULES (non-negotiable):
- LONG entry MUST be BELOW current price {current_price}. Void MUST be below price.
- SHORT entry MUST be ABOVE current price {current_price}. Void MUST be above price.
- Wrong side void = NO TRADE (no exceptions)
- No clear void = NO TRADE
- For LONG: entry < tp1 < tp2 < tp_max
- For SHORT: entry > tp1 > tp2 > tp_max
- TP1 minimum 1:1 R/R from entry to SL

RESPOND ONLY IN THIS JSON FORMAT (no preamble, no markdown):
{{
  "trend": "UP" or "DOWN" or "SIDEWAYS",
  "pattern": "what you see",
  "decision": "LONG" or "SHORT" or "NO TRADE",
  "entry": <number or null>,
  "tp1": <number or null>,
  "tp2": <number or null>,
  "tp_max": <number or null>,
  "sl": <number or null>,
  "reason": "your reasoning in character (max 120 chars)",
  "confidence": <0-100>
}}"""

    # Build room context section
    room_section = ""
    if market_context:
        room_section = f"""
━━━ VIRTUAL TRADING ROOM — OTHER TRADERS' VIEWS ━━━
{market_context}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Consider their arguments. You may agree or disagree.
Make YOUR OWN decision based on your persona and analysis.
"""

    user_text = f"""Analyze {symbol} — Round {round_num}

CURRENT PRICE: {current_price}

{ohlcv_text}
{room_section}

Charts attached. Analyze as {persona['name']} and give your decision.
Remember: LONG entry below {current_price}, SHORT entry above {current_price}."""

    # Build content (charts + text)
    content = []
    for tf in ["5m", "15m", "1h", "4h"]:
        if tf in charts:
            content.append({
                "type": "image_url",
                "image_url": {"url": f"data:image/png;base64,{charts[tf]}"},
            })
    content.append({"type": "text", "text": user_text})

    print(f"{tag} 🧠 R{round_num} thinking...")
    raw = await bearer.call(system_prompt, content)

    def _no_trade(reason: str) -> AgentOpinion:
        return AgentOpinion(
            agent_id=persona["id"], agent_name=persona["name"],
            agent_archetype=persona["archetype"], token_slot=bearer.slot,
            round_num=round_num, decision="NO TRADE",
            entry=None, tp1=None, tp2=None, tp_max=None, sl=None,
            trend="SIDEWAYS", pattern="none", reason=reason, confidence=0,
        )

    if not raw or not raw.strip():
        return _no_trade("Empty response")

    start = raw.find("{")
    end   = raw.rfind("}") + 1
    if start < 0 or end <= start:
        return _no_trade("No JSON in response")

    try:
        result = json.loads(raw[start:end])
    except Exception as e:
        return _no_trade(f"JSON error: {e}")

    decision = result.get("decision", "NO TRADE").upper().strip()
    if decision not in ("LONG", "SHORT", "NO TRADE"):
        decision = "NO TRADE"

    op = AgentOpinion(
        agent_id=persona["id"], agent_name=persona["name"],
        agent_archetype=persona["archetype"], token_slot=bearer.slot,
        round_num=round_num, decision=decision,
        entry=result.get("entry"), tp1=result.get("tp1"),
        tp2=result.get("tp2"), tp_max=result.get("tp_max"),
        sl=result.get("sl"),
        trend=result.get("trend", "SIDEWAYS"),
        pattern=result.get("pattern", ""),
        reason=result.get("reason", ""),
        confidence=int(result.get("confidence", 0)),
    )
    print(f"{tag} ✅ R{round_num}: {decision} conf={op.confidence}% | {op.reason[:60]}")
    return op

# ---------------------------------------------------------------------------
# Batch runner — jalankan 5 agent paralel pakai 5 bearer
# ---------------------------------------------------------------------------

async def _run_batch(
    personas_batch: List[dict],
    bearers: List[BearerClient],
    symbol: str,
    candles_by_tf: dict,
    current_price: float,
    charts: Dict[str, str],
    ohlcv_text: str,
    round_num: int,
    market_context: str = "",
) -> List[AgentOpinion]:
    """
    Jalankan 1 batch (maks 5 agent) paralel.
    Agent ke-i pakai bearer[i % len(bearers)].
    """
    tasks = []
    for i, persona in enumerate(personas_batch):
        bearer = bearers[i % len(bearers)]
        tasks.append(_agent_think(
            persona=persona, bearer=bearer,
            symbol=symbol, candles_by_tf=candles_by_tf,
            current_price=current_price, charts=charts,
            ohlcv_text=ohlcv_text, round_num=round_num,
            market_context=market_context,
        ))
    results = await asyncio.gather(*tasks, return_exceptions=True)

    opinions = []
    for i, r in enumerate(results):
        if isinstance(r, Exception):
            p = personas_batch[i]
            logger.error(f"Agent {p['name']} batch error: {r}")
            opinions.append(AgentOpinion(
                agent_id=p["id"], agent_name=p["name"],
                agent_archetype=p["archetype"],
                token_slot=bearers[i % len(bearers)].slot,
                round_num=round_num, decision="NO TRADE",
                entry=None, tp1=None, tp2=None, tp_max=None, sl=None,
                trend="SIDEWAYS", pattern="none",
                reason=f"Error: {r}", confidence=0,
            ))
        else:
            opinions.append(r)
    return opinions

# ---------------------------------------------------------------------------
# Consensus helpers
# ---------------------------------------------------------------------------

def _weighted_vote(opinions: List[AgentOpinion]) -> dict:
    """Weighted vote: influence_weight × (confidence/100)."""
    weight_map = {p["id"]: p["weight"] for p in AGENT_PERSONAS}
    scores = {"LONG": 0.0, "SHORT": 0.0, "NO TRADE": 0.0}
    details = {}

    for op in opinions:
        w = weight_map.get(op.agent_id, 1.0)
        eff = w * (op.confidence / 100.0)
        scores[op.decision] = scores.get(op.decision, 0.0) + eff
        details[op.agent_name] = {
            "decision": op.decision,
            "confidence": op.confidence,
            "weight": w,
            "effective": round(eff, 3),
        }

    total = sum(scores.values()) or 1.0
    return {
        "scores": {k: round(v, 3) for k, v in scores.items()},
        "pct":    {k: round(v / total * 100, 1) for k, v in scores.items()},
        "details": details,
        "winner": max(scores, key=scores.get),
    }


def _aggregate_levels(opinions: List[AgentOpinion], decision: str) -> dict:
    """Weighted average dari level entry/tp/sl agent yang sepakat."""
    weight_map = {p["id"]: p["weight"] for p in AGENT_PERSONAS}
    matching = [o for o in opinions if o.decision == decision and o.entry is not None]
    if not matching:
        return {}

    def wavg(vals_weights):
        vals_weights = [(v, w) for v, w in vals_weights if v is not None]
        if not vals_weights:
            return None
        total_w = sum(w for _, w in vals_weights)
        return round(sum(v * w for v, w in vals_weights) / total_w, 6) if total_w else None

    ww = [(o.entry,  weight_map.get(o.agent_id, 1.0)) for o in matching]
    w1 = [(o.tp1,    weight_map.get(o.agent_id, 1.0)) for o in matching]
    w2 = [(o.tp2,    weight_map.get(o.agent_id, 1.0)) for o in matching]
    wm = [(o.tp_max, weight_map.get(o.agent_id, 1.0)) for o in matching]
    ws = [(o.sl,     weight_map.get(o.agent_id, 1.0)) for o in matching]

    return {
        "entry":  wavg(ww),
        "tp1":    wavg(w1),
        "tp2":    wavg(w2),
        "tp_max": wavg(wm),
        "sl":     wavg(ws),
    }


def _build_room_context(opinions: List[AgentOpinion]) -> str:
    """Build market room context string dari daftar opinions."""
    return "\n".join(op.summary() for op in opinions)


def _build_narrative(
    symbol: str,
    price: float,
    r1: List[AgentOpinion],
    r2: List[AgentOpinion],
    r3: List[AgentOpinion],
    vote: dict,
    final: str,
    levels: dict,
    n_tokens: int,
) -> str:
    lines = [
        f"# Trading World Simulation — {symbol}",
        f"**Price:** {price}  |  **Agents:** {len(r1)}  |  **Tokens:** {n_tokens}  |  **Rounds:** 3",
        f"**Final Decision:** `{final}`  |  **Confidence:** {vote['pct'].get(final, 0):.1f}%",
        "",
        "---",
        "",
        "## Round 1 — Independent Analysis",
        "_Each agent analyzed the market without knowing others' views._",
        "",
    ]
    for op in r1:
        em = "🟢" if op.decision == "LONG" else ("🔴" if op.decision == "SHORT" else "⚪")
        lines.append(f"{em} **{op.agent_name}** → {op.decision} (conf {op.confidence}%) | _{op.reason}_")

    lines += ["", "## Round 2 — Deliberation", "_Agents saw R1 views and reconsidered._", ""]
    for op in r2:
        r1_op = next((x for x in r1 if x.agent_id == op.agent_id), None)
        changed = r1_op and r1_op.decision != op.decision
        em = "🟢" if op.decision == "LONG" else ("🔴" if op.decision == "SHORT" else "⚪")
        tag = " ⟲ *changed*" if changed else ""
        lines.append(f"{em} **{op.agent_name}**{tag} → {op.decision} (conf {op.confidence}%) | _{op.reason}_")

    lines += ["", "## Round 3 — Final Vote", "_Agents saw R2 views and made final decision._", ""]
    for op in r3:
        r2_op = next((x for x in r2 if x.agent_id == op.agent_id), None)
        changed = r2_op and r2_op.decision != op.decision
        em = "🟢" if op.decision == "LONG" else ("🔴" if op.decision == "SHORT" else "⚪")
        tag = " ⟲ *changed*" if changed else ""
        lines.append(f"{em} **{op.agent_name}**{tag} → {op.decision} (conf {op.confidence}%) | _{op.reason}_")

    lines += [
        "", "## Voting Results (Weighted)", "",
        "| Decision | Score | % |", "|----------|-------|---|",
    ]
    for dec, pct in vote["pct"].items():
        mark = " ◀ **WINNER**" if dec == final else ""
        lines.append(f"| {dec} | {vote['scores'][dec]} | {pct}%{mark} |")

    if final != "NO TRADE" and levels:
        lines += [
            "", "## Consensus Trade Levels",
            f"- **Entry:** {levels.get('entry')}",
            f"- **TP1:** {levels.get('tp1')}",
            f"- **TP2:** {levels.get('tp2')}",
            f"- **TP MAX:** {levels.get('tp_max')}",
            f"- **SL:** {levels.get('sl')}",
        ]

    return "\n".join(lines)

# ---------------------------------------------------------------------------
# Main Simulation World — 20 agents, 5 bearer rotation, 3 rounds
# ---------------------------------------------------------------------------

class TradingWorldSimulation:
    """
    Virtual trading world dengan 20 agent personas.
    5 bearer token dirotasi: 4 batch × 5 = 20 agent.
    3 ronde deliberasi.
    """

    def __init__(self):
        self.bearers: List[BearerClient] = []
        self.simulation_log: List[ConsensusResult] = []
        self._load_bearers()

    def _load_bearers(self):
        tokens = []
        for i in range(1, 6):
            t = os.getenv(f"QWEN_TOKEN_{i}", "").strip()
            if t:
                tokens.append(t)

        if not tokens:
            try:
                from services.token_manager import token_manager
                tokens = token_manager.get_tokens()
            except Exception:
                pass

        if not tokens:
            print("[SimWorld] ❌ No tokens! Set QWEN_TOKEN_1..5 in Railway env.")
            return

        for slot, token in enumerate(tokens, 1):
            self.bearers.append(BearerClient(token=token, slot=slot))
            print(f"[SimWorld] ✅ Bearer-{slot} ready")

        print(
            f"[SimWorld] {len(self.bearers)} bearer token(s) → "
            f"{len(AGENT_PERSONAS)} agents in {len(AGENT_PERSONAS) // BATCH_SIZE} batches"
        )

    def reload(self):
        asyncio.create_task(self._close_all())
        self.bearers = []
        self._load_bearers()

    async def _close_all(self):
        for b in self.bearers:
            try: await b.close()
            except: pass

    def _available_bearers(self) -> List[BearerClient]:
        avail = [b for b in self.bearers if not b.exhausted]
        if not avail:
            print("[SimWorld] All bearers exhausted — resetting")
            for b in self.bearers:
                b.exhausted = False
            avail = self.bearers
        return avail

    async def _run_round(
        self,
        round_num: int,
        symbol: str,
        candles_by_tf: dict,
        current_price: float,
        charts: Dict[str, str],
        ohlcv_text: str,
        market_context: str = "",
        progress_cb=None,
    ) -> List[AgentOpinion]:
        """
        Jalankan 1 ronde untuk semua 20 agent.
        Dibagi jadi batch 5-5-5-5, tiap batch dijalankan paralel.
        """
        bearers = self._available_bearers()
        all_opinions: List[AgentOpinion] = []

        # Bagi 20 personas ke batch-batch ukuran BATCH_SIZE
        batches = [
            AGENT_PERSONAS[i: i + BATCH_SIZE]
            for i in range(0, len(AGENT_PERSONAS), BATCH_SIZE)
        ]

        total_batches = len(batches)
        for bi, batch in enumerate(batches, 1):
            names = [p["name"] for p in batch]
            print(f"[SimWorld] R{round_num} Batch {bi}/{total_batches}: {names}")

            if progress_cb:
                progress_cb({
                    "round": round_num,
                    "batch": bi,
                    "total_batches": total_batches,
                    "agents": names,
                })

            batch_opinions = await _run_batch(
                personas_batch=batch,
                bearers=bearers,
                symbol=symbol,
                candles_by_tf=candles_by_tf,
                current_price=current_price,
                charts=charts,
                ohlcv_text=ohlcv_text,
                round_num=round_num,
                market_context=market_context,
            )
            all_opinions.extend(batch_opinions)

            # Delay kecil antar batch (beri nafas ke API)
            if bi < total_batches:
                await asyncio.sleep(2)

        return all_opinions

    async def run_simulation(
        self,
        symbol: str,
        candles_by_tf: dict,
        current_price: float,
        sim_id: Optional[str] = None,
        progress_cb=None,
    ) -> ConsensusResult:
        """
        Jalankan simulasi penuh 3 ronde.

        Round 1 — Independent  : 20 agent berpikir sendiri-sendiri (4 batch × 5)
        Round 2 — Deliberasi   : 20 agent lihat hasil R1, revisi
        Round 3 — Final Vote   : 20 agent lihat hasil R2, keputusan final
        Consensus              : weighted vote dari R3
        """
        sim_id = sim_id or str(uuid.uuid4())[:8]
        n = len(AGENT_PERSONAS)
        print(f"\n[SimWorld] ═══ Simulation {sim_id} | {symbol} @ {current_price} | {n} agents ═══")

        if not self.bearers:
            raise RuntimeError("No bearer tokens loaded. Set QWEN_TOKEN_1..5")

        # ── Pre-build charts (sekali, dipakai semua ronde) ─────────────────
        print("[SimWorld] 📊 Building charts...")
        charts: Dict[str, str] = {}
        loop = asyncio.get_event_loop()
        for tf in ["5m", "15m", "1h", "4h"]:
            if tf in candles_by_tf:
                img = await loop.run_in_executor(
                    None, _draw_chart, candles_by_tf[tf], symbol, tf)
                if img:
                    charts[tf] = img

        # ── Build OHLCV text (sekali) ────────────────────────────────────
        tf_blocks = []
        for tf in ["5m", "15m", "30m", "1h", "4h"]:
            candles = candles_by_tf.get(tf, [])
            if not candles:
                continue
            lines = [f"=== {symbol} | {tf} ===", "ts, open, high, low, close, vol"]
            for c in candles[-80:]:
                lines.append(f"{c[0]}, {c[1]}, {c[2]}, {c[3]}, {c[4]}, {c[5]}")
            tf_blocks.append("\n".join(lines))
        ohlcv_text = "\n\n".join(tf_blocks) or "No data"

        # ═══════════════════════════════════════════════════════════════════
        # ROUND 1 — Independent (semua berpikir tanpa tahu pendapat lain)
        # ═══════════════════════════════════════════════════════════════════
        print(f"\n[SimWorld] ─── ROUND 1: Independent Analysis ({n} agents) ───")
        r1 = await self._run_round(
            round_num=1, symbol=symbol, candles_by_tf=candles_by_tf,
            current_price=current_price, charts=charts,
            ohlcv_text=ohlcv_text, market_context="",
            progress_cb=progress_cb,
        )

        # Quick R1 vote summary
        r1_vote = _weighted_vote(r1)
        print(f"[SimWorld] R1 snapshot: {r1_vote['pct']}")

        # ═══════════════════════════════════════════════════════════════════
        # ROUND 2 — Deliberasi (agent lihat hasil R1)
        # ═══════════════════════════════════════════════════════════════════
        r1_context = "ROUND 1 OPINIONS:\n" + _build_room_context(r1)
        print(f"\n[SimWorld] ─── ROUND 2: Deliberation ({n} agents) ───")
        r2 = await self._run_round(
            round_num=2, symbol=symbol, candles_by_tf=candles_by_tf,
            current_price=current_price, charts=charts,
            ohlcv_text=ohlcv_text, market_context=r1_context,
            progress_cb=progress_cb,
        )

        r2_vote = _weighted_vote(r2)
        print(f"[SimWorld] R2 snapshot: {r2_vote['pct']}")

        # ═══════════════════════════════════════════════════════════════════
        # ROUND 3 — Final Vote (agent lihat hasil R2)
        # ═══════════════════════════════════════════════════════════════════
        r2_context = (
            "ROUND 1 OPINIONS:\n" + _build_room_context(r1) +
            "\n\nROUND 2 OPINIONS (after deliberation):\n" + _build_room_context(r2)
        )
        print(f"\n[SimWorld] ─── ROUND 3: Final Vote ({n} agents) ───")
        r3 = await self._run_round(
            round_num=3, symbol=symbol, candles_by_tf=candles_by_tf,
            current_price=current_price, charts=charts,
            ohlcv_text=ohlcv_text, market_context=r2_context,
            progress_cb=progress_cb,
        )

        # ═══════════════════════════════════════════════════════════════════
        # FINAL CONSENSUS dari R3
        # ═══════════════════════════════════════════════════════════════════
        vote = _weighted_vote(r3)
        final = vote["winner"]
        winning_pct = vote["pct"].get(final, 0)

        # Threshold: perlu ≥ 40% untuk declare winner
        if winning_pct < 40 or final == "NO TRADE":
            if final != "NO TRADE":
                print(f"[SimWorld] Weak consensus ({winning_pct:.1f}%) → NO TRADE")
                final = "NO TRADE"

        levels = _aggregate_levels(r3, final)
        narrative = _build_narrative(
            symbol, current_price, r1, r2, r3, vote, final, levels, len(self.bearers))

        result = ConsensusResult(
            simulation_id=sim_id,
            symbol=symbol,
            current_price=current_price,
            timestamp=time.time(),
            agent_count=n,
            token_count=len(self.bearers),
            round1_opinions=r1,
            round2_opinions=r2,
            round3_opinions=r3,
            final_decision=final,
            consensus_entry=levels.get("entry"),
            consensus_tp1=levels.get("tp1"),
            consensus_tp2=levels.get("tp2"),
            consensus_tp_max=levels.get("tp_max"),
            consensus_sl=levels.get("sl"),
            consensus_confidence=winning_pct,
            vote_breakdown=vote,
            narrative=narrative,
        )

        self.simulation_log.append(result)
        print(
            f"\n[SimWorld] ═══ FINAL: {final} | conf={winning_pct:.1f}% | "
            f"entry={levels.get('entry')} tp1={levels.get('tp1')} "
            f"sl={levels.get('sl')} ═══\n"
        )
        return result

    def get_agent_status(self) -> List[dict]:
        return [
            {
                "id": p["id"],
                "name": p["name"],
                "archetype": p["archetype"],
                "preferred_tf": p["preferred_tf"],
                "risk": p["risk"],
                "weight": p["weight"],
                "token_slot": ((p["id"] - 1) % len(self.bearers)) + 1 if self.bearers else None,
            }
            for p in AGENT_PERSONAS
        ]

    def get_bearer_status(self) -> List[dict]:
        return [
            {"slot": b.slot, "exhausted": b.exhausted}
            for b in self.bearers
        ]

    async def close(self):
        await self._close_all()


# Singleton
trading_world = TradingWorldSimulation()
