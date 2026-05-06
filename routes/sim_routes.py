"""
Simulation World Routes — API untuk jalankan dan lihat hasil simulasi.

Endpoints:
  POST /sim/run           — jalankan 1 siklus simulasi (2 ronde)
  GET  /sim/agents        — status semua agent di virtual world
  GET  /sim/log           — riwayat simulasi
  GET  /sim/log/{sim_id}  — detail 1 simulasi
  POST /sim/reload        — reload agents (setelah update token)
  WS   /sim/ws            — real-time stream progress simulasi
"""

import asyncio
import json
import logging
import time
from fastapi import APIRouter, Request, WebSocket, WebSocketDisconnect
from typing import Optional, List

from services.trading_world import trading_world, AGENT_PERSONAS
from services.ws_manager import ws_manager

logger = logging.getLogger(__name__)
router = APIRouter()

# ---------------------------------------------------------------------------
# REST endpoints
# ---------------------------------------------------------------------------

@router.get("/agents")
async def get_agents():
    """Status semua agent trader di virtual world."""
    agents = trading_world.get_agent_status()
    return {
        "ok": True,
        "total_agents": len(agents),
        "data": agents,
    }


@router.post("/run")
async def run_simulation(request: Request):
    """
    Jalankan 1 siklus simulasi.
    
    Body:
    {
        "symbol": "BTC_USDT",
        "candles_by_tf": {"5m": [...], "15m": [...], "1h": [...], "4h": [...]},
        "current_price": 65000.0
    }
    """
    body = await request.json()
    symbol = body.get("symbol", "BTC_USDT")
    candles_by_tf = body.get("candles_by_tf", {})
    current_price = float(body.get("current_price", 0))

    if not candles_by_tf:
        return {"ok": False, "error": "candles_by_tf required"}
    if current_price <= 0:
        return {"ok": False, "error": "current_price required"}
    if not trading_world.tokens:
        return {"ok": False, "error": "No agents loaded. Set QWEN_TOKEN_1..5"}

    # Broadcast start event
    await ws_manager.broadcast("sim_start", {
        "symbol": symbol,
        "current_price": current_price,
        "agent_count": len(AGENT_PERSONAS),
    })

    # Run simulation
    try:
        result = await trading_world.run_simulation(
            symbol=symbol,
            candles_by_tf=candles_by_tf,
            current_price=current_price,
        )
        data = result.to_dict()

        # Broadcast result
        await ws_manager.broadcast("sim_result", {
            "simulation_id": data["simulation_id"],
            "symbol": symbol,
            "final_decision": data["final_decision"],
            "consensus_confidence": data["consensus_confidence"],
            "consensus_entry": data["consensus_entry"],
            "consensus_tp1": data["consensus_tp1"],
            "consensus_sl": data["consensus_sl"],
            "vote_breakdown": data["vote_breakdown"],
        })

        return {"ok": True, "data": data}
    except Exception as e:
        logger.error(f"Simulation error: {e}", exc_info=True)
        return {"ok": False, "error": str(e)}


@router.get("/log")
async def get_log(limit: int = 20):
    """Riwayat simulasi (ringkas)."""
    log = trading_world.simulation_log[-limit:]
    summary = []
    for r in reversed(log):
        summary.append({
            "simulation_id": r.simulation_id,
            "symbol": r.symbol,
            "current_price": r.current_price,
            "final_decision": r.final_decision,
            "consensus_confidence": r.consensus_confidence,
            "consensus_entry": r.consensus_entry,
            "consensus_tp1": r.consensus_tp1,
            "consensus_sl": r.consensus_sl,
            "timestamp": r.timestamp,
            "agent_votes": {
                op.agent_name: op.decision
                for op in r.round2_opinions
            },
        })
    return {"ok": True, "data": summary, "total": len(summary)}


@router.get("/log/{sim_id}")
async def get_simulation_detail(sim_id: str):
    """Detail lengkap 1 simulasi."""
    result = next(
        (r for r in trading_world.simulation_log if r.simulation_id == sim_id),
        None
    )
    if not result:
        return {"ok": False, "error": "Simulation not found"}
    return {"ok": True, "data": result.to_dict()}


@router.post("/reload")
async def reload_agents():
    """Reload agents dengan token terbaru."""
    trading_world.reload()
    return {
        "ok": True,
        "message": f"{len(trading_world.agents)} agents reloaded",
        "agents": trading_world.get_agent_status(),
    }


@router.post("/reset-exhausted")
async def reset_exhausted():
    """Reset exhausted flag semua agent."""
    for agent in trading_world.agents:
        agent.exhausted = False
    return {"ok": True, "message": f"{len(trading_world.agents)} agents reset"}


# ---------------------------------------------------------------------------
# WebSocket — real-time simulation stream
# ---------------------------------------------------------------------------

@router.websocket("/ws")
async def simulation_ws(ws: WebSocket):
    """Real-time stream simulasi events."""
    await ws_manager.connect(ws)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        ws_manager.disconnect(ws)


# ---------------------------------------------------------------------------
# /sim/latest — hasil simulasi terbaru dari log (public, no auth)
# ---------------------------------------------------------------------------

@router.get("/latest")
async def get_latest():
    """
    Ambil hasil simulasi paling baru dari log bot.
    Dipanggil oleh /world page dan homepage AgentWorldSection secara polling.
    Public — tidak perlu login.
    """
    if not trading_world.simulation_log:
        return {"ok": False, "error": "No simulation data yet"}
    latest = trading_world.simulation_log[-1]
    return latest.to_dict()
