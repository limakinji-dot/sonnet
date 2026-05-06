"""
Trading World Simulation Engine — 20 Agent / 3 Ronde / Reverse API

Perubahan dari versi sebelumnya:
  - Client bukan lagi httpx ke gateway
  - Langsung reverse API ke chat.qwen.ai (sama persis cara di testt.py)
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
from typing import Dict, List, Optional

import httpx

logger = logging.getLogger(__name__)

# Lazy import ws_manager to avoid circular imports
def _get_ws():
    try:
        from services.ws_manager import ws_manager
        return ws_manager
    except Exception:
        return None

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
BASE_URL    = "https://chat.qwen.ai"
QWEN_MODEL  = os.getenv("QWEN_MODEL", "qwen3-max")
BATCH_SIZE  = 5   # paralel per batch = jumlah bearer token

# ---------------------------------------------------------------------------
# Chart generation (tidak berubah)
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
# System prompt — TIDAK DIUBAH, sama persis dengan qwen_ai.py original
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """You are an AI trained to mimic a specific trading strategy based on example data.

Your job:
- Learn from the examples
- Apply the SAME behavior to new data

Focus on:
- Trend structure (market direction)
- Wick behavior (rejection / inefficiency)
- Void
- Candle relationships
- Multi-timeframe context (HTF vs LTF)

---
STRICT TREND RULE:
- UP → ONLY LONG (Higher Low → Higher High)
- DOWN → ONLY SHORT (Lower High → Lower Low)
- Do NOT counter-trade by default

---
WICK + VOID DIRECTION RULE (CRITICAL):

- UP trend:
  → use UPPER WICK voids (see some candle before)
  → ignore lower wick voids

- DOWN trend:
  → use lower WICK voids (see some candle before)
  → ignore upper wick voids

IMPORTANT:
- The void must be in the direction of a RETRACEMENT, not continuation

Logic:
- LONG = buy lower → void must be BELOW current price
- SHORT = sell higher → void must be ABOVE current price

- NEVER choose a void that would require chasing price

---
ENTRY DISTANCE RULE:
- Entry MUST be placed at a clear void
- Entry must NOT be near current price without structure
- If price is already near the level → NO TRADE
- Entry should feel like a LIMIT order (far from price), not a market entry

---
NO TRADE RULE:
- No clear void → NO TRADE
- Bad structure → NO TRADE
- Entry too close to price → NO TRADE
- If very low volume → NO TRADE

---
REVERSAL RULE (ADVANCED):
Reversal trades are allowed ONLY if ALL conditions are met:

1. There is a clear void (4H / 2H — if found on a higher timeframe, check further back
   on a lower timeframe; if a pattern similar to the training data exists, verify the
   previous high/low from the higher timeframe)
2. The level comes from past price action (look-back structure)
3. The level has NOT been revisited

If ALL valid → Counter-trend entry is allowed
If NOT → Stay with trend or NO TRADE

---
PRIORITY RULE:
1. Primary → Trend-following setups
2. Secondary → Reversal (ONLY with strong HTF confirmation)

---
ANTI-FAKE RULE:
- Do NOT assume reversal randomly
- Do NOT force trades
- If unsure → NO TRADE

---
MULTI-TARGET RULE (TP1 / TP2 / MAX):
- Every valid trade MUST have 3 profit targets: TP1, TP2, MAX
- TP1 = nearest realistic target (1:1 to 1:2 R/R). This is the "safe" take.
- TP2 = intermediate target (1:2 to 1:3 R/R). This is the "aggressive" take.
- MAX = maximum realistic extension (1:3+ R/R or next major HTF level). This is the "moon" take.
- Risk/Reward is calculated from ENTRY to each TP, with SL as risk.
- TP1 MUST be closer to entry than TP2. TP2 MUST be closer than MAX.
- For LONG: TP1 < TP2 < MAX (all above entry)
- For SHORT: TP1 > TP2 > MAX (all below entry)

---
TRAINING DATA:

[
  {
    "input": "the trend is going down; found this on the 4h timeframe: o:0.003942 h:0.003979 l:0.003791 c:0.003843 v:246.84M; +1 o:0.003844 h:0.003887 l:0.003831 c:0.003835 v:103.39M; -1 o:0.003858 h:0.003942 l:0.003845 c:0.003941 v:98.58M — enter at the last wick body candle from that void",
    "output": "limit short at 0.003942 (trend down, level not yet touched)"
  },
  {
    "input": "trend is up; looking for short entry; -1 o:0.0004684 h:0.0004692 l:0.0004635 c:0.0004637; main o:0.0004636 h:0.0004646 l:0.0004539 c:0.0004582; +1 o:0.0004581 h:0.0004585 l:0.0004556 c:0.0004570; +2 o:0.0004570 h:0.0004570 l:0.0004526 c:0.0004541 — main candle long wick, next candle does not close it → void",
    "output": "entry short at 0.0004582 (body close of last wick candle)"
  },
  {
    "input": "trend up; looking for long; o:13.33160 h:13.73500 l:13.10230 c:13.21796; +1 o:13.21795 h:13.26964 l:13.04792 c:13.22730; +2 o:13.22775 h:13.87839 l:13.20719 c:13.81678; -1 o:13.23907 h:13.33333 l:13.06984 c:13.33331; -2 o:13.04731 h:13.24540 l:12.98318 c:13.23923 — wick then gap then close: void in the middle",
    "output": "entry long at 13.33160 (candle body open)"
  },
  {
    "input": "trend up; 3m; o:2.42663 h:2.97600 l:2.35226 c:2.48033; +1 o:2.48030 h:2.52137 l:2.25767 c:2.40491; +2 o:2.40507 h:2.49556 l:2.33333 c:2.43605; -1 o:2.05480 h:2.56645 l:2.05450 c:2.42613; -2 o:2.01596 h:2.05789 l:2.01000 c:2.05443",
    "output": "entry long at 2.42613 (void confirmed)"
  },
  {
    "input": "same void on 15m: o:2.01596 h:2.97600 l:2.01000 c:2.48033; +1 o:2.48030 h:2.52137 l:2.25767 c:2.45024; +2 o:2.45016 h:3.17200 l:2.44670 c:2.77272; -1 o:1.97052 h:2.03159 l:1.95600 c:2.01583",
    "output": "entry long at 2.48033 (queue on 15m timeframe)"
  },
  {
    "input": "trend down on 15m; o:16.69993 h:16.91653 l:13.86700 c:15.71328; -3 empty -4 wick -5 last wick; -5 o:17.52713 h:17.63100 l:16.64201 c:17.21921",
    "output": "entry short at 17.21921 (body close of last wick, void behind)"
  }
]"""

# ---------------------------------------------------------------------------
# 20 Agent Personas (tidak berubah)
# ---------------------------------------------------------------------------

AGENT_PERSONAS = [
    {"id": 1,  "name": "The Sniper",         "archetype": "Precision Trend Follower",    "personality": "You are The Sniper. Cold, calculated, disciplined. You ONLY trade when the void is crystal clear and trend is confirmed. No perfect setup = NO TRADE. You wait days for one clean entry. Short sentences. Zero emotion. Maximum precision.", "preferred_tf": "1h",  "risk": "low",     "weight": 1.6},
    {"id": 2,  "name": "The Hawk",           "archetype": "Aggressive Trend Rider",      "personality": "You are The Hawk. You ride trends hard and fast once confirmed. You spot breakouts early and enter aggressively. You love momentum — when trend accelerates, you add more. High conviction, moves fast, targets big. Speak with urgency and confidence.", "preferred_tf": "1h",  "risk": "high",    "weight": 1.2},
    {"id": 3,  "name": "The Glacier",        "archetype": "Patient Swing Trader",        "personality": "You are The Glacier. Slow, deliberate, unstoppable. You only take multi-day swing setups. You ignore intraday noise. Your entries are perfect. You wait for HTF structure breaks and trade them cleanly. Speak slowly and with deep conviction.", "preferred_tf": "4h",  "risk": "low",     "weight": 1.8},
    {"id": 4,  "name": "The Shadow",         "archetype": "Stealth Trend Follower",      "personality": "You are The Shadow. You follow smart money silently. You look for institutional order flow patterns in candles. You track volume anomalies and wick rejections at key levels. Where the big players go, you follow quietly. Speak mysteriously but precisely.", "preferred_tf": "1h",  "risk": "medium",  "weight": 1.3},
    {"id": 5,  "name": "The Contrarian",     "archetype": "Reversal Hunter",             "personality": "You are The Contrarian. When everyone is bullish, you smell weakness. You look for exhaustion, fake breakouts, and reversal patterns. When the trend looks too obvious, you look the other way. You have high conviction in counter-trend setups. Speak with skepticism and contrarian logic.", "preferred_tf": "15m", "risk": "medium",  "weight": 1.0},
    {"id": 6,  "name": "The Phoenix",        "archetype": "Bounce Specialist",           "personality": "You are The Phoenix. You specialize in catching exact reversal bottoms and tops. You look for exhaustion — volume dry-up, long wicks. You want to be the first one in when the market turns. High risk, high reward. Speak with excitement about inflection points.", "preferred_tf": "30m", "risk": "high",    "weight": 0.9},
    {"id": 7,  "name": "Devils Advocate",    "archetype": "Structural Reversal Analyst", "personality": "You are the Devils Advocate. You challenge every bullish or bearish argument. You look for the case others are ignoring. You use higher timeframe structure to identify failed trends. You rarely agree with consensus. Speak provocatively but logically.", "preferred_tf": "4h",  "risk": "medium",  "weight": 1.1},
    {"id": 8,  "name": "The Fader",          "archetype": "Overextension Fader",         "personality": "You are The Fader. You fade extreme moves — when price extends too far, you bet on mean reversion. You identify overextended candles and volume spikes that signal exhaustion. You short the peak and buy the dump. Speak with calm statistical confidence.", "preferred_tf": "15m", "risk": "medium",  "weight": 0.9},
    {"id": 9,  "name": "The Quant",          "archetype": "Risk-Reward Calculator",      "personality": "You are The Quant. Everything is probability and R/R. R/R < 2:1 = no trade. Confidence < 60 = no trade. You measure wick ratios, body sizes, void distances mathematically. Speak in numbers and percentages. Cold logic.", "preferred_tf": "30m", "risk": "medium",  "weight": 1.2},
    {"id": 10, "name": "The Statistician",   "archetype": "Pattern Probability Analyst", "personality": "You are The Statistician. You identify repeating candle patterns and calculate their historical success rates. You trust patterns with 60%+ win rate at the right context. You quantify everything — nothing is subjective. Speak with data-driven precision.", "preferred_tf": "1h",  "risk": "low",     "weight": 1.1},
    {"id": 11, "name": "The Engineer",       "archetype": "Systematic Structure Analyst","personality": "You are The Engineer. You map market structure like a blueprint. Every swing high, swing low, and liquidity pool is labeled. You trade only when structure gives clear permission. Systematic, process-driven, never impulsive. Speak methodically.", "preferred_tf": "1h",  "risk": "low",     "weight": 1.3},
    {"id": 12, "name": "The Macro",          "archetype": "HTF Big Picture Strategist",  "personality": "You are The Macro. You see what others miss on higher timeframes. 5m is noise. 15m is noise. You start at 4h, then 1h. If HTF is unclear, everything below is irrelevant. Fewer trades, higher conviction. Speak about market structure and narrative.", "preferred_tf": "4h",  "risk": "low",     "weight": 1.9},
    {"id": 13, "name": "The Oracle",         "archetype": "Multi-TF Confluence Analyst", "personality": "You are The Oracle. You require alignment across ALL timeframes. 4h trend + 1h structure + 30m entry zone + 15m trigger. If any TF conflicts, NO TRADE. Full confluence only. Very selective but extremely high win rate. Speak with deep authority.", "preferred_tf": "4h",  "risk": "low",     "weight": 2.0},
    {"id": 14, "name": "The Architect",      "archetype": "Market Structure Builder",    "personality": "You are The Architect. You see markets as buildings — support, resistance, floors, ceilings. You trade structural breaks with retest. You never trade in the middle of ranges. Only at edges. Patient, structural, precise. Speak about levels and zones.", "preferred_tf": "4h",  "risk": "low",     "weight": 1.5},
    {"id": 15, "name": "The Scalper",        "archetype": "Aggressive LTF Trader",       "personality": "You are The Scalper. Fast, aggressive, always hunting the next 5m move. You see micro-voids and wick reactions nobody else notices. Small SL, fast TP, repeat. Volume is your signal. Speak fast, with urgency. Setup or no setup — you always have an opinion.", "preferred_tf": "5m",  "risk": "high",    "weight": 0.8},
    {"id": 16, "name": "The Bullet",         "archetype": "Breakout Momentum Trader",    "personality": "You are The Bullet. You enter on breakouts with momentum confirmation. When price breaks structure with strong volume, you're already in. You don't wait for retests — you move with the market. Fast execution, tight SL, trail to maximize. Speak with sharp directness.", "preferred_tf": "5m",  "risk": "high",    "weight": 0.9},
    {"id": 17, "name": "The Pulse",          "archetype": "Order Flow Reader",           "personality": "You are The Pulse. You feel the market's heartbeat in real-time. You read candle-by-candle order flow: absorption, imbalance, delta. You know when buyers are exhausting and sellers are stepping in. Intuitive and fast. Speak with rhythm and market feel.", "preferred_tf": "5m",  "risk": "high",    "weight": 0.8},
    {"id": 18, "name": "The Sentinel",       "archetype": "Risk Manager",                "personality": "You are The Sentinel. Your job is to protect the portfolio. You are the last line of defense against bad trades. You prefer NO TRADE over a mediocre setup. You are deeply skeptical of every argument. Only undeniable setups get your approval. Speak conservatively.", "preferred_tf": "1h",  "risk": "very_low","weight": 1.7},
    {"id": 19, "name": "The Alchemist",      "archetype": "Cross-Asset Analyst",         "personality": "You are The Alchemist. You synthesize all perspectives. You look at the full picture: trend, structure, void, volume, confluence. You weigh the arguments of other traders in the room. Your decision is balanced but decisive. Speak with wisdom and synthesis.", "preferred_tf": "1h",  "risk": "medium",  "weight": 1.4},
    {"id": 20, "name": "The Veteran",        "archetype": "Experienced All-Round Trader","personality": "You are The Veteran. 20 years of trading. You've seen it all. You combine trend, structure, and intuition effortlessly. You trust your gut when backed by structure. You know when to trade and when to stay flat. Speak with calm authority and wisdom.", "preferred_tf": "1h",  "risk": "medium",  "weight": 1.5},
]

# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------

@dataclass
class AgentOpinion:
    agent_id: int
    agent_name: str
    agent_archetype: str
    token_slot: int
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

    def to_dict(self): return asdict(self)

    def summary(self):
        if self.decision == "NO TRADE":
            return f"[{self.agent_name}] NO TRADE — {self.reason[:100]}"
        return (f"[{self.agent_name}] {self.decision} entry={self.entry} "
                f"tp1={self.tp1} sl={self.sl} conf={self.confidence}% | {self.reason[:80]}")


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

    def to_dict(self):
        d = asdict(self)
        d["round1_opinions"] = [o.to_dict() for o in self.round1_opinions]
        d["round2_opinions"] = [o.to_dict() for o in self.round2_opinions]
        d["round3_opinions"] = [o.to_dict() for o in self.round3_opinions]
        return d

# ---------------------------------------------------------------------------
# Reverse API Client — async wrapper dari testt.py
# ---------------------------------------------------------------------------

def _make_headers(token: str, chat_id: str = "") -> dict:
    h = {
        "Accept": "application/json",
        "Accept-Language": "zh-CN,zh;q=0.9",
        "Content-Type": "application/json",
        "source": "web",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
        "Origin": "https://chat.qwen.ai",
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-origin",
        "Version": "0.2.7",
        "bx-v": "2.5.36",
        "Authorization": f"Bearer {token}",
        "X-Request-Id": str(uuid.uuid4()),
    }
    if chat_id:
        h["Referer"] = f"https://chat.qwen.ai/c/{chat_id}"
        h["x-accel-buffering"] = "no"
    return h


async def _buat_chat(client: httpx.AsyncClient, token: str, model: str) -> Optional[str]:
    """Buat chat baru, return chat_id."""
    payload = {
        "title": f"Agent Analysis {int(time.time())}",
        "models": [model],
        "chat_mode": "normal",
        "chat_type": "t2t",
        "timestamp": int(time.time() * 1000),
        "project_id": "",
    }
    try:
        resp = await client.post(
            f"{BASE_URL}/api/v2/chats/new",
            json=payload,
            headers=_make_headers(token),
            timeout=30,
        )
        if resp.status_code == 401:
            logger.warning("Token 401 — expired or invalid")
            return None
        resp.raise_for_status()
        return resp.json()["data"]["id"]
    except Exception as e:
        logger.warning(f"buat_chat error: {e}")
        return None


async def _hapus_chat(client: httpx.AsyncClient, token: str, chat_id: str):
    """Hapus chat setelah selesai."""
    try:
        await client.delete(
            f"{BASE_URL}/api/v2/chats/{chat_id}",
            headers=_make_headers(token),
            timeout=15,
        )
    except Exception:
        pass


async def _upload_one_chart(
    client: httpx.AsyncClient,
    token: str,
    image_b64: str,
    filename: str,
) -> Optional[dict]:
    """
    Upload satu chart ke Qwen OSS via 2-step:
      1. POST /api/v2/files/getstsToken → dapat STS credentials
      2. PUT image ke OSS dengan OSS4-HMAC-SHA256 header signing
    """
    import hashlib, hmac as _hmac
    from datetime import datetime, timezone

    def _oss_sign(ak_id, ak_secret, sts_token, method, host, path, region, content_type):
        """Generate OSS4-HMAC-SHA256 Authorization + related headers."""
        now          = datetime.now(timezone.utc)
        date_str     = now.strftime("%Y%m%d")
        datetime_str = now.strftime("%Y%m%dT%H%M%SZ")

        signed_headers   = "content-type;host;x-oss-content-sha256;x-oss-date;x-oss-security-token"
        canonical_headers = (
            f"content-type:{content_type}\n"
            f"host:{host}\n"
            f"x-oss-content-sha256:UNSIGNED-PAYLOAD\n"
            f"x-oss-date:{datetime_str}\n"
            f"x-oss-security-token:{sts_token}\n"
        )
        canonical_request = "\n".join([
            method.upper(),
            "/" + path,
            "",  # empty query string
            canonical_headers,
            signed_headers,
            "UNSIGNED-PAYLOAD",
        ])

        credential_scope = f"{date_str}/{region}/oss/aliyun_v4_request"
        string_to_sign   = "\n".join([
            "OSS4-HMAC-SHA256",
            datetime_str,
            credential_scope,
            hashlib.sha256(canonical_request.encode()).hexdigest(),
        ])

        def _hmac_sha256(key, msg):
            k = key if isinstance(key, bytes) else key.encode()
            return _hmac.new(k, msg.encode(), hashlib.sha256).digest()

        k = _hmac_sha256("aliyun_v4" + ak_secret, date_str)
        k = _hmac_sha256(k, region)
        k = _hmac_sha256(k, "oss")
        k = _hmac_sha256(k, "aliyun_v4_request")
        signature = _hmac.new(k, string_to_sign.encode(), hashlib.sha256).hexdigest()

        authorization = (
            f"OSS4-HMAC-SHA256 Credential={ak_id}/{credential_scope},"
            f"SignedHeaders={signed_headers},"
            f"Signature={signature}"
        )
        return {
            "Authorization":         authorization,
            "x-oss-date":            datetime_str,
            "x-oss-content-sha256":  "UNSIGNED-PAYLOAD",
            "x-oss-security-token":  sts_token,
            "Content-Type":          content_type,
        }

    try:
        image_bytes = base64.b64decode(image_b64)
        filesize    = len(image_bytes)

        # Step 1 — minta STS credentials
        sts_resp = await client.post(
            f"{BASE_URL}/api/v2/files/getstsToken",
            json={"filename": filename, "filesize": filesize, "filetype": "image"},
            headers=_make_headers(token),
            timeout=30,
        )
        if sts_resp.status_code != 200:
            logger.warning(f"getstsToken failed {sts_resp.status_code} for {filename}")
            return None

        sts        = sts_resp.json().get("data", {})
        ak_id      = sts.get("access_key_id", "")
        ak_secret  = sts.get("access_key_secret", "")
        sts_token  = sts.get("security_token", "")
        file_id    = sts.get("file_id", "")
        file_path  = sts.get("file_path", "")   # "user_id/file_id_filename.png"
        bucketname = sts.get("bucketname", "qwen-webui-prod")
        endpoint   = sts.get("endpoint", "oss-accelerate.aliyuncs.com")
        region_raw = sts.get("region", "oss-ap-southeast-1")

        if not all([ak_id, ak_secret, sts_token, file_id, file_path]):
            logger.warning(f"getstsToken: incomplete credentials for {filename}")
            return None

        # region di credential scope TIDAK pakai prefix "oss-"
        region = region_raw.removeprefix("oss-") if region_raw.startswith("oss-") else region_raw

        host       = f"{bucketname}.{endpoint}"
        put_url    = f"https://{host}/{file_path}"
        put_headers = _oss_sign(ak_id, ak_secret, sts_token, "PUT", host, file_path, region, "image/png")

        # Step 2 — PUT ke OSS dengan signed headers
        put_resp = await client.put(
            put_url,
            content=image_bytes,
            headers=put_headers,
            timeout=60,
        )
        if put_resp.status_code != 200:
            logger.warning(f"OSS PUT failed {put_resp.status_code} for {filename}: {put_resp.text[:200]}")
            return None

        print(f"  [World 📸 upload] {filename} → {file_id[:8]}... OK")
        return {
            "type":       "image",
            "file":       {
                "id":       file_id,
                "filename": filename,
                "meta":     {"name": filename, "size": filesize, "content_type": "image/png"},
                "data":     {},
            },
            "file_type":  "image/png",
            "file_class": "vision",
            "id":         file_id,
            "name":       filename,
            "size":       filesize,
            "status":     "uploaded",
            "url":        put_url,
            "showType":   "image",
        }
    except Exception as e:
        logger.warning(f"_upload_one_chart error ({filename}): {e}")
        return None


async def _upload_charts(
    client: httpx.AsyncClient,
    token: str,
    charts: Dict[str, str],
) -> List[dict]:
    """Upload semua chart paralel, return list file info (hanya yang berhasil)."""
    if not charts:
        return []
    tasks = [
        _upload_one_chart(client, token, b64, f"chart_{tf}.png")
        for tf, b64 in charts.items()
    ]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    return [r for r in results if isinstance(r, dict)]


async def _kirim_pesan(
    client: httpx.AsyncClient,
    token: str,
    chat_id: str,
    system_prompt: str,
    user_content: str,
    model: str,
    charts: Optional[Dict[str, str]] = None,
) -> Optional[str]:
    """
    Kirim pesan dengan streaming.
    Kalau ada charts (base64), upload dulu ke Qwen OSS lalu sertakan
    sebagai 'files' array — ini cara yang benar menurut reverse-engineering
    dari inspect element chat.qwen.ai.
    """
    fid      = str(uuid.uuid4())
    child_id = str(uuid.uuid4())
    ts       = int(time.time())

    # [IMAGE UPLOAD DINONAKTIFKAN] — text-only mode
    # Upload charts ke OSS dulu kalau ada
    uploaded_files: List[dict] = []
    # if charts:
    #     uploaded_files = await _upload_charts(client, token, charts)
    #     if uploaded_files:
    #         print(f"  [World 📸] {len(uploaded_files)}/{len(charts)} chart(s) uploaded OK")
    #     else:
    #         print(f"  [World ⚠️ ] Chart upload failed — lanjut text-only")

    content = f"{system_prompt}\n\n---\n\n{user_content}"

    payload = {
        "stream": True,
        "version": "2.1",
        "incremental_output": True,
        "chat_id": chat_id,
        "chat_mode": "normal",
        "model": model,
        "parent_id": None,
        "messages": [
            {
                "fid": fid,
                "parentId": None,
                "childrenIds": [child_id],
                "role": "user",
                "content": content,
                "user_action": "chat",
                "files": uploaded_files,   # ← hasil upload OSS
                "timestamp": ts,
                "models": [model],
                "chat_type": "t2t",
                "feature_config": {
                    "thinking_enabled": True,
                    "output_schema": "phase",
                    "research_mode": "normal",
                    "auto_thinking": True,
                    "thinking_mode": "Auto",
                    "thinking_format": "summary",
                    "auto_search": False,
                },
                "extra": {"meta": {"subChatType": "t2t"}},
                "sub_chat_type": "t2t",
                "parent_id": None,
            }
        ],
        "timestamp": ts + 1,
    }

    full_reply = ""
    think_buf  = ""   # dikumpulkan tapi tidak masuk ke reply
    try:
        async with client.stream(
            "POST",
            f"{BASE_URL}/api/v2/chat/completions?chat_id={chat_id}",
            json=payload,
            headers=_make_headers(token, chat_id),
            timeout=180,
        ) as resp:
            if resp.status_code != 200:
                logger.warning(f"kirim_pesan HTTP {resp.status_code}")
                return None

            async for line in resp.aiter_lines():
                if not line or not line.startswith("data: "):
                    continue
                data_str = line[6:]
                if data_str.strip() == "[DONE]":
                    break
                try:
                    data = json.loads(data_str)
                    if not data.get("choices"):
                        continue
                    delta   = data["choices"][0].get("delta", {})
                    phase   = delta.get("phase", "answer")
                    content = delta.get("content", "")
                    status  = delta.get("status", "")

                    if phase == "thinking_summary":          # FIX 1: "think" → "thinking_summary"
                        # Kumpulkan thinking tapi JANGAN masuk ke reply
                        # FIX 2: tidak break di sini walau status=="finished"
                        if content:
                            think_buf += content
                    else:
                        # Phase 'answer' — ini yang kita mau
                        if content:
                            full_reply += content
                        if status == "finished":             # FIX 2: break HANYA saat answer finished
                            break
                except (json.JSONDecodeError, KeyError):
                    continue

    except httpx.TimeoutException:
        logger.warning("kirim_pesan timeout")
        return None
    except Exception as e:
        logger.warning(f"kirim_pesan error: {e}")
        return None

    # Log hasil kedua phase supaya mudah debug
    if think_buf.strip():
        logger.debug(f"[World think] {think_buf[:300]}")
        print(f"  [World 🧠 think] {think_buf[:200].strip()}")
    if full_reply.strip():
        print(f"  [World ✍️  answer] {full_reply[:300].strip()}")
    else:
        print(f"  [World ⚠️  answer EMPTY] — think={len(think_buf)} chars, reply={len(full_reply)} chars")

    return full_reply if full_reply.strip() else None


# ---------------------------------------------------------------------------
# Agent think — buat chat → kirim → hapus (full lifecycle per call)
# ---------------------------------------------------------------------------

async def _agent_think(
    persona: dict,
    token: str,
    token_slot: int,
    symbol: str,
    ohlcv_text: str,
    current_price: float,
    charts: Dict[str, str],
    round_num: int,
    market_context: str = "",
) -> AgentOpinion:
    """
    Satu agent think. Setiap call buat chat baru → paralel aman tanpa block.
    Content dikirim sebagai array [image_url, image_url, ..., text] — sama persis
    dengan gateway, jadi chart candlestick bisa dilampirkan ke tiap agent call.
    """
    tag = f"[{persona['name']} slot={token_slot} R{round_num}]"

    def _no_trade(reason: str) -> AgentOpinion:
        return AgentOpinion(
            agent_id=persona["id"], agent_name=persona["name"],
            agent_archetype=persona["archetype"], token_slot=token_slot,
            round_num=round_num, decision="NO TRADE",
            entry=None, tp1=None, tp2=None, tp_max=None, sl=None,
            trend="SIDEWAYS", pattern="none", reason=reason, confidence=0,
        )

    # Room context
    room_section = ""
    if market_context:
        room_section = f"""
━━━ VIRTUAL TRADING ROOM — OTHER TRADERS' VIEWS ━━━
{market_context}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Consider their arguments. You may agree or disagree.
Make YOUR OWN decision based on your persona and analysis.
"""

    # Persona layer (ditambahkan di depan system prompt)
    persona_prefix = f"""=== YOUR PERSONA ===
{persona['personality']}
Archetype: {persona['archetype']}
Preferred timeframe: {persona['preferred_tf']}
Risk tolerance: {persona['risk']}
===================

"""

    # User prompt — sama persis dengan qwen_ai.py original
    user_prompt = f"""Analyze {symbol} — Round {round_num} (as {persona['name']})

{ohlcv_text}

---

Candlestick charts for all timeframes are attached as images above this text.
Use BOTH the chart images AND the OHLCV text to identify void.
Cross-reference: what you see visually in the charts should match the OHLCV numbers.

⚠️ CURRENT REALTIME PRICE: {current_price}
(This is the live ticker price — use it as the reference for entry placement)

---
VOID POSITION RULE (CRITICAL):
- LONG → void MUST be BELOW current price ({current_price})
- SHORT → void MUST be ABOVE current price ({current_price})
- If void is on the wrong side → IGNORE IT
- If no valid void on correct side → NO TRADE

ENTRY DIRECTION RULE (CRITICAL — violations cause instant loss):
- LONG → entry MUST be BELOW {current_price}
- SHORT → entry MUST be ABOVE {current_price}
- NEVER: LONG above price | SHORT below price

{room_section}

---
Respond in this EXACT JSON format ONLY — no preamble, no markdown:

{{
  "trend": "UP" or "DOWN" or "SIDEWAYS",
  "pattern": "brief description of void/wick pattern detected",
  "decision": "LONG" or "SHORT" or "NO TRADE",
  "entry": <number>,
  "tp1": <number>,
  "tp2": <number>,
  "tp_max": <number>,
  "sl": <number>,
  "invalidation": <number>,
  "reason": "short explanation referencing the void/wick imbalance (max 120 chars)",
  "confidence": <0-100>
}}

TP RULES:
- tp1 = nearest target (1:1~1:2 R/R). MUST be realistic.
- tp2 = intermediate target (1:2~1:3 R/R). MUST be further than tp1.
- tp_max = max extension target (1:3+ R/R or next HTF level). MUST be furthest.
- For LONG: entry < tp1 < tp2 < tp_max
- For SHORT: entry > tp1 > tp2 > tp_max

If there is NO clear void/imbalance setup → return "NO TRADE". Do NOT force a trade."""

    # Full system prompt = persona prefix + original SYSTEM_PROMPT
    full_system = persona_prefix + SYSTEM_PROMPT

    print(f"{tag} 🧠 Thinking...")

    async with httpx.AsyncClient(timeout=240) as client:
        # 1. Buat chat baru
        chat_id = await _buat_chat(client, token, QWEN_MODEL)
        if not chat_id:
            return _no_trade("Failed to create chat (token issue?)")

        try:
            # 2. Kirim pesan
            raw = await _kirim_pesan(
                client, token, chat_id,
                system_prompt=full_system,
                user_content=user_prompt,
                model=QWEN_MODEL,
                charts=charts,
            )
        finally:
            # 3. Hapus chat (selalu, bahkan kalau error)
            await _hapus_chat(client, token, chat_id)

    if not raw or not raw.strip():
        print(f"{tag} ⚠️  Empty answer — cek log [World ⚠️  answer EMPTY] di atas")
        return _no_trade("Empty response")

    print(f"{tag} 📄 Raw answer ({len(raw)} chars): {raw[:400]}")

    # Parse JSON dari response
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
        agent_archetype=persona["archetype"], token_slot=token_slot,
        round_num=round_num, decision=decision,
        entry=result.get("entry"), tp1=result.get("tp1"),
        tp2=result.get("tp2"), tp_max=result.get("tp_max"),
        sl=result.get("sl"),
        trend=result.get("trend", "SIDEWAYS"),
        pattern=result.get("pattern", ""),
        reason=result.get("reason", ""),
        confidence=int(result.get("confidence", 0)),
    )
    print(f"{tag} ✅ {decision} conf={op.confidence}% | {op.reason[:60]}")

    # Broadcast realtime ke frontend via WebSocket — await langsung agar
    # pesan terkirim segera saat agent selesai, bukan deferred via create_task
    try:
        ws = _get_ws()
        if ws:
            await ws.broadcast("agent_update", {
                "agent_id":   op.agent_id,
                "agent_name": op.agent_name,
                "round_num":  op.round_num,
                "decision":   op.decision,
                "confidence": op.confidence,
                "reason":     op.reason[:120],
                "entry":      op.entry,
                "tp1":        op.tp1,
                "sl":         op.sl,
            })
    except Exception:
        pass

    return op

# ---------------------------------------------------------------------------
# Batch runner — 5 agent paralel pakai 5 token
# ---------------------------------------------------------------------------

async def _run_batch(
    personas_batch: List[dict],
    tokens: List[str],
    symbol: str,
    candles_by_tf: dict,
    current_price: float,
    charts: Dict[str, str],
    ohlcv_text: str,
    round_num: int,
    market_context: str = "",
) -> List[AgentOpinion]:
    tasks = []
    for i, persona in enumerate(personas_batch):
        token_slot = (i % len(tokens)) + 1
        token      = tokens[i % len(tokens)]
        tasks.append(_agent_think(
            persona=persona, token=token, token_slot=token_slot,
            symbol=symbol, ohlcv_text=ohlcv_text,
            current_price=current_price, charts=charts,
            round_num=round_num, market_context=market_context,
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
                token_slot=(i % len(tokens)) + 1,
                round_num=round_num, decision="NO TRADE",
                entry=None, tp1=None, tp2=None, tp_max=None, sl=None,
                trend="SIDEWAYS", pattern="none",
                reason=f"Error: {r}", confidence=0,
            ))
        else:
            opinions.append(r)
    return opinions

# ---------------------------------------------------------------------------
# Consensus helpers (tidak berubah)
# ---------------------------------------------------------------------------

def _weighted_vote(opinions: List[AgentOpinion]) -> dict:
    weight_map = {p["id"]: p["weight"] for p in AGENT_PERSONAS}
    scores = {"LONG": 0.0, "SHORT": 0.0, "NO TRADE": 0.0}
    details = {}
    for op in opinions:
        w   = weight_map.get(op.agent_id, 1.0)
        eff = w * (op.confidence / 100.0)
        scores[op.decision] = scores.get(op.decision, 0.0) + eff
        details[op.agent_name] = {"decision": op.decision, "confidence": op.confidence,
                                   "weight": w, "effective": round(eff, 3)}
    total = sum(scores.values()) or 1.0
    return {
        "scores":  {k: round(v, 3) for k, v in scores.items()},
        "pct":     {k: round(v / total * 100, 1) for k, v in scores.items()},
        "details": details,
        "winner":  max(scores, key=scores.get),
    }


def _aggregate_levels(opinions: List[AgentOpinion], decision: str) -> dict:
    weight_map = {p["id"]: p["weight"] for p in AGENT_PERSONAS}
    matching   = [o for o in opinions if o.decision == decision and o.entry is not None]
    if not matching:
        return {}
    def wavg(pairs):
        pairs = [(v, w) for v, w in pairs if v is not None]
        if not pairs: return None
        tw = sum(w for _, w in pairs)
        return round(sum(v * w for v, w in pairs) / tw, 6) if tw else None
    ww = [(o.entry,  weight_map.get(o.agent_id, 1.0)) for o in matching]
    return {
        "entry":  wavg(ww),
        "tp1":    wavg([(o.tp1,    weight_map.get(o.agent_id, 1.0)) for o in matching]),
        "tp2":    wavg([(o.tp2,    weight_map.get(o.agent_id, 1.0)) for o in matching]),
        "tp_max": wavg([(o.tp_max, weight_map.get(o.agent_id, 1.0)) for o in matching]),
        "sl":     wavg([(o.sl,     weight_map.get(o.agent_id, 1.0)) for o in matching]),
    }


def _build_room_context(opinions: List[AgentOpinion]) -> str:
    return "\n".join(op.summary() for op in opinions)


def _build_narrative(symbol, price, r1, r2, r3, vote, final, levels, n_tokens) -> str:
    lines = [
        f"# Trading World — {symbol}",
        f"Price: {price} | Agents: {len(r1)} | Tokens: {n_tokens} | Rounds: 3",
        f"Final: {final} | Confidence: {vote['pct'].get(final, 0):.1f}%", "",
        "## Round 1 — Independent", "",
    ]
    for op in r1:
        em = "LONG" if op.decision == "LONG" else ("SHORT" if op.decision == "SHORT" else "–")
        lines.append(f"[{em}] {op.agent_name} ({op.confidence}%) — {op.reason}")
    lines += ["", "## Round 2 — Deliberation", ""]
    for op in r2:
        r1op = next((x for x in r1 if x.agent_id == op.agent_id), None)
        chg  = " [CHANGED]" if r1op and r1op.decision != op.decision else ""
        em   = "LONG" if op.decision == "LONG" else ("SHORT" if op.decision == "SHORT" else "–")
        lines.append(f"[{em}]{chg} {op.agent_name} ({op.confidence}%) — {op.reason}")
    lines += ["", "## Round 3 — Final Vote", ""]
    for op in r3:
        r2op = next((x for x in r2 if x.agent_id == op.agent_id), None)
        chg  = " [CHANGED]" if r2op and r2op.decision != op.decision else ""
        em   = "LONG" if op.decision == "LONG" else ("SHORT" if op.decision == "SHORT" else "–")
        lines.append(f"[{em}]{chg} {op.agent_name} ({op.confidence}%) — {op.reason}")
    lines += ["", "## Voting", ""]
    for dec, pct in vote["pct"].items():
        mark = " <-- WINNER" if dec == final else ""
        lines.append(f"{dec}: {pct}%{mark}")
    if final != "NO TRADE" and levels:
        lines += ["", "## Consensus Levels",
                  f"Entry: {levels.get('entry')} | TP1: {levels.get('tp1')} | "
                  f"TP2: {levels.get('tp2')} | MAX: {levels.get('tp_max')} | SL: {levels.get('sl')}"]
    return "\n".join(lines)

# ---------------------------------------------------------------------------
# Main Simulation World
# ---------------------------------------------------------------------------

LATEST_SIM_PATH = os.getenv("LATEST_SIM_PATH", "/tmp/latest_sim.json")


class TradingWorldSimulation:
    """
    Virtual trading world — 20 agent / 5 JWT token reverse API / 3 ronde.
    Tiap agent buat chat baru → hapus setelah selesai → full parallel aman.
    """

    def __init__(self):
        self.tokens: List[str] = []
        self.simulation_log: List[ConsensusResult] = []
        self._load_tokens()
        self._restore_latest()

    def _restore_latest(self):
        """Load hasil simulasi terakhir dari file (survive server restart)."""
        try:
            if os.path.exists(LATEST_SIM_PATH):
                with open(LATEST_SIM_PATH, "r") as f:
                    data = json.load(f)
                def _ops(lst):
                    return [AgentOpinion(**{k: v for k, v in o.items()}) for o in (lst or [])]
                result = ConsensusResult(
                    simulation_id=data["simulation_id"],
                    symbol=data["symbol"],
                    current_price=data["current_price"],
                    timestamp=data["timestamp"],
                    agent_count=data["agent_count"],
                    token_count=data["token_count"],
                    round1_opinions=_ops(data.get("round1_opinions", [])),
                    round2_opinions=_ops(data.get("round2_opinions", [])),
                    round3_opinions=_ops(data.get("round3_opinions", [])),
                    final_decision=data["final_decision"],
                    consensus_entry=data.get("consensus_entry"),
                    consensus_tp1=data.get("consensus_tp1"),
                    consensus_tp2=data.get("consensus_tp2"),
                    consensus_tp_max=data.get("consensus_tp_max"),
                    consensus_sl=data.get("consensus_sl"),
                    consensus_confidence=data.get("consensus_confidence", 0),
                    vote_breakdown=data.get("vote_breakdown", {}),
                    narrative=data.get("narrative", ""),
                )
                self.simulation_log.append(result)
                print(f"[SimWorld] Restored: {result.simulation_id} | {result.symbol} | {result.final_decision}")
        except Exception as e:
            logger.warning(f"[SimWorld] Could not restore latest sim: {e}")

    def _persist_latest(self, result: ConsensusResult):
        """Simpan hasil simulasi terbaru ke file JSON agar survive restart."""
        try:
            with open(LATEST_SIM_PATH, "w") as f:
                json.dump(result.to_dict(), f)
        except Exception as e:
            logger.warning(f"[SimWorld] Could not persist: {e}")

    def _load_tokens(self):
        for i in range(1, 6):
            t = os.getenv(f"QWEN_TOKEN_{i}", "").strip()
            if t:
                self.tokens.append(t)

        if not self.tokens:
            try:
                from services.token_manager import token_manager
                self.tokens = token_manager.get_tokens()
            except Exception:
                pass

        if not self.tokens:
            print("[SimWorld] No tokens! Set QWEN_TOKEN_1..5 (JWT dari chat.qwen.ai)")
        else:
            print(f"[SimWorld] {len(self.tokens)} JWT token(s) loaded → {len(AGENT_PERSONAS)} agents, {len(AGENT_PERSONAS)//BATCH_SIZE} batches")

    def reload(self):
        self.tokens = []
        self._load_tokens()

    async def _run_round(self, round_num, symbol, candles_by_tf, current_price,
                         charts, ohlcv_text, market_context="", progress_cb=None) -> List[AgentOpinion]:
        batches = [AGENT_PERSONAS[i: i + BATCH_SIZE] for i in range(0, len(AGENT_PERSONAS), BATCH_SIZE)]
        all_opinions: List[AgentOpinion] = []
        for bi, batch in enumerate(batches, 1):
            names = [p["name"] for p in batch]
            print(f"[SimWorld] R{round_num} Batch {bi}/{len(batches)}: {names}")
            if progress_cb:
                progress_cb({"round": round_num, "batch": bi, "total_batches": len(batches), "agents": names})
            batch_ops = await _run_batch(
                personas_batch=batch, tokens=self.tokens,
                symbol=symbol, candles_by_tf=candles_by_tf,
                current_price=current_price, charts=charts,
                ohlcv_text=ohlcv_text, round_num=round_num,
                market_context=market_context,
            )
            all_opinions.extend(batch_ops)
            if bi < len(batches):
                await asyncio.sleep(1)  # sedikit jeda antar batch
        return all_opinions

    async def run_simulation(self, symbol, candles_by_tf, current_price,
                              sim_id=None, progress_cb=None) -> ConsensusResult:
        import uuid as _uuid
        sim_id = sim_id or str(_uuid.uuid4())[:8]
        n = len(AGENT_PERSONAS)
        print(f"\n[SimWorld] ═══ {sim_id} | {symbol} @ {current_price} | {n} agents | {len(self.tokens)} tokens ═══")

        if not self.tokens:
            raise RuntimeError("No JWT tokens. Set QWEN_TOKEN_1..5")

        # Broadcast sim start — semua node jadi THINKING di frontend
        try:
            ws = _get_ws()
            if ws:
                await ws.broadcast("sim_start", {
                    "symbol":       symbol,
                    "current_price": current_price,
                    "agent_count":  n,
                    "agents": [{"id": p["id"], "name": p["name"]} for p in AGENT_PERSONAS],
                })
        except Exception:
            pass

        # [IMAGE UPLOAD DINONAKTIFKAN] — text-only mode
        # Generate candlestick charts (base64) — akan di-upload ke OSS per agent call
        # loop = asyncio.get_event_loop()
        charts: Dict[str, str] = {}
        # if HAS_CHARTS:
        #     try:
        #         charts = await loop.run_in_executor(
        #             None,
        #             lambda: {
        #                 tf: img for tf in ["5m", "15m", "30m", "1h", "4h"]
        #                 if (img := _draw_chart(candles_by_tf.get(tf, []), symbol, tf))
        #             }
        #         )
        #         print(f"[SimWorld] 📊 Charts ready: {list(charts.keys())}")
        #     except Exception as e:
        #         logger.warning(f"Chart generation error: {e}")
        # else:
        #     print("[SimWorld] ⚠️  matplotlib not installed — text-only mode")
        print("[SimWorld] 📝 Text-only mode (image upload dinonaktifkan)")

        # Build OHLCV text
        tf_blocks = []
        for tf in ["5m", "15m", "30m", "1h", "4h"]:
            candles = candles_by_tf.get(tf, [])
            if not candles:
                continue
            lines = [f"=== {symbol} | {tf} | last {min(len(candles), 150)} candles ===",
                     "timestamp, open, high, low, close, volume"]
            for c in candles[-150:]:
                lines.append(f"{c[0]}, {c[1]}, {c[2]}, {c[3]}, {c[4]}, {c[5]}")
            tf_blocks.append("\n".join(lines))
        ohlcv_text = "\n\n".join(tf_blocks) or "No data"

        async def _broadcast_round(rnd, opinions):
            try:
                ws = _get_ws()
                if ws:
                    await ws.broadcast("round_done", {
                        "round_num": rnd,
                        "opinions": [{"agent_id": o.agent_id, "agent_name": o.agent_name,
                                      "decision": o.decision, "confidence": o.confidence,
                                      "reason": o.reason[:120], "entry": o.entry,
                                      "tp1": o.tp1, "sl": o.sl} for o in opinions],
                    })
            except Exception:
                pass

        # Round 1 — Independent
        print(f"\n[SimWorld] ─── ROUND 1 ───")
        r1 = await self._run_round(1, symbol, candles_by_tf, current_price, charts, ohlcv_text,
                                    market_context="", progress_cb=progress_cb)
        await _broadcast_round(1, r1)

        # Round 2 — Deliberasi
        r1_ctx = "ROUND 1 OPINIONS:\n" + _build_room_context(r1)
        print(f"\n[SimWorld] ─── ROUND 2 ───")
        r2 = await self._run_round(2, symbol, candles_by_tf, current_price, charts, ohlcv_text,
                                    market_context=r1_ctx, progress_cb=progress_cb)
        await _broadcast_round(2, r2)

        # Round 3 — Final
        r2_ctx = "ROUND 1:\n" + _build_room_context(r1) + "\n\nROUND 2:\n" + _build_room_context(r2)
        print(f"\n[SimWorld] ─── ROUND 3 ───")
        r3 = await self._run_round(3, symbol, candles_by_tf, current_price, charts, ohlcv_text,
                                    market_context=r2_ctx, progress_cb=progress_cb)
        await _broadcast_round(3, r3)

        # Consensus
        vote   = _weighted_vote(r3)
        final  = vote["winner"]
        pct    = vote["pct"].get(final, 0)
        if pct < 40 or final == "NO TRADE":
            if final != "NO TRADE":
                print(f"[SimWorld] Weak consensus ({pct:.1f}%) → NO TRADE")
                final = "NO TRADE"

        levels    = _aggregate_levels(r3, final)
        narrative = _build_narrative(symbol, current_price, r1, r2, r3, vote, final, levels, len(self.tokens))

        result = ConsensusResult(
            simulation_id=sim_id, symbol=symbol, current_price=current_price,
            timestamp=time.time(), agent_count=n, token_count=len(self.tokens),
            round1_opinions=r1, round2_opinions=r2, round3_opinions=r3,
            final_decision=final,
            consensus_entry=levels.get("entry"), consensus_tp1=levels.get("tp1"),
            consensus_tp2=levels.get("tp2"), consensus_tp_max=levels.get("tp_max"),
            consensus_sl=levels.get("sl"), consensus_confidence=pct,
            vote_breakdown=vote, narrative=narrative,
        )
        self.simulation_log.append(result)
        self._persist_latest(result)
        print(f"\n[SimWorld] ═══ FINAL: {final} | conf={pct:.1f}% | entry={levels.get('entry')} ═══\n")
        return result

    def get_agent_status(self) -> List[dict]:
        return [
            {"id": p["id"], "name": p["name"], "archetype": p["archetype"],
             "preferred_tf": p["preferred_tf"], "risk": p["risk"], "weight": p["weight"],
             "token_slot": ((p["id"] - 1) % len(self.tokens)) + 1 if self.tokens else None}
            for p in AGENT_PERSONAS
        ]

    def get_bearer_status(self) -> List[dict]:
        return [{"slot": i + 1, "active": True} for i in range(len(self.tokens))]

    async def close(self):
        pass  # httpx client dibuat per-call, tidak ada yang perlu di-close


# Singleton
trading_world = TradingWorldSimulation()
