import asyncio
import os
import time
from fastapi import APIRouter, Request, WebSocket, WebSocketDisconnect, Depends, Query
from pydantic import BaseModel
from typing import Optional
from services.ws_manager import ws_manager
from services.virtual_exchange import virtual_exchange
from services.bot_manager import bot_manager
from services.auth_service import decode_token
from services.database import get_user_by_id, db_get_signals

router = APIRouter()

def _get_user_id(request: Request) -> Optional[str]:
    token = request.headers.get("authorization", "")
    if token.startswith("Bearer "):
        payload = decode_token(token[7:])
        if payload:
            return payload.get("sub")
    user_param = request.query_params.get("user")
    return user_param if user_param else None

@router.post("/verify-pin")
async def verify_pin(request: Request):
    body    = await request.json()
    entered = str(body.get("pin", "")).strip()
    correct = str(os.getenv("BOT_PIN", "")).strip()
    if not correct:
        return {"ok": True}
    return {"ok": entered == correct}

class BotConfig(BaseModel):
    symbol:   str
    tp_pct:   float = 0.004
    sl_pct:   float = 0.002
    interval: int   = 60

@router.post("/start")
async def start_bot(config: BotConfig, request: Request, user_id: Optional[str] = Depends(_get_user_id)):
    if user_id:
        result = await bot_manager.start_user_bot(user_id, config.dict())
        if not result.get("ok"):
            return result
        engine = bot_manager.get_engine(user_id)
    else:
        engine = bot_manager.global_engine

    def listener(event, data):
        asyncio.create_task(ws_manager.broadcast(event, data))
    engine.add_listener(listener)
    return await engine.start(config.dict())

@router.post("/stop")
async def stop_bot(request: Request, user_id: Optional[str] = Depends(_get_user_id)):
    if user_id:
        return await bot_manager.stop_user_bot(user_id)
    return await bot_manager.global_engine.stop()

@router.get("/state")
async def get_state(request: Request, user: Optional[str] = Query(None)):
    user_id = user or _get_user_id(request)
    engine = bot_manager.get_engine(user_id) or bot_manager.global_engine
    return engine.get_state()

@router.get("/signals")
async def get_signals(request: Request, limit: int = 50, user: Optional[str] = Query(None)):
    user_id = user or _get_user_id(request)
    signals = db_get_signals(user_id=user_id, limit=limit)
    return {"data": signals, "total": len(signals)}

@router.get("/stats")
async def get_stats(request: Request, user: Optional[str] = Query(None)):
    user_id = user or _get_user_id(request)
    
    if user_id:
        signals = db_get_signals(user_id=user_id, limit=10000)
    else:
        signals = db_get_signals(user_id=None, limit=10000)
        
    wins      = sum(1 for s in signals if s.get("result") == "TP")
    losses    = sum(1 for s in signals if s.get("result") == "SL")
    total_pct = sum(float(s.get("pnl_pct") or 0) for s in signals if s.get("result") in ("TP", "SL"))
    total_usd = sum(float(s.get("pnl_usdt") or 0) for s in signals if s.get("result") in ("TP", "SL"))
    closed    = wins + losses
    winrate   = round(wins / closed * 100, 2) if closed > 0 else 0.0
    
    if user_id:
        user = get_user_by_id(user_id)
        balance = user["balance"] if user else INITIAL_BALANCE
        leverage = user["leverage"] if user else 10
        entry_usdt = user["margin"] if user else 100
    else:
        info = virtual_exchange.get_info()
        balance = info["balance"]
        leverage = info["leverage"]
        entry_usdt = info["entry_usdt"]

    return {
        "data": {
            "trade_count":         closed,
            "win_count":           wins,
            "loss_count":          losses,
            "no_trade_count":      0,
            "winrate":             winrate,
            "total_pnl_pct":       round(total_pct, 4),
            "total_pnl_usdt":      round(total_usd, 4),
            "balance":             balance,
            "leverage":            leverage,
            "entry_usdt":          entry_usdt,
            "active_signal_count": sum(1 for s in signals if s.get("status") == "OPEN"),
            "max_active_signals":  int(os.getenv("MAX_ACTIVE_SIGNALS", "20")),
        }
    }

@router.post("/reset")
async def reset_stats(request: Request, user_id: Optional[str] = Depends(_get_user_id)):
    if user_id:
        engine = bot_manager.get_engine(user_id)
        if engine:
            engine.reset_stats()
        virtual_exchange.reset(user_id)
    else:
        bot_manager.global_engine.reset_stats()
        virtual_exchange.reset()
        
    await ws_manager.broadcast("reset_all", {
        "trade_count":         0,
        "win_count":           0,
        "loss_count":          0,
        "no_trade_count":      0,
        "total_pnl_pct":       0.0,
        "total_pnl_usdt":      0.0,
        "balance":             virtual_exchange.get_info(user_id)["balance"],
        "signals":             [],
        "active_signal_count": 0,
        "timestamp":           int(time.time() * 1000),
    })
    return {"ok": True}

@router.get("/balance")
async def get_balance(request: Request, user: Optional[str] = Query(None)):
    user_id = user or _get_user_id(request)
    return {"data": virtual_exchange.get_info(user_id)}

@router.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws_manager.connect(ws)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        ws_manager.disconnect(ws)

@router.get("/status/debug")
async def debug_status(request: Request, user_id: Optional[str] = Depends(_get_user_id)):
    engine = bot_manager.get_engine(user_id) or bot_manager.global_engine
    wins   = engine.state["win_count"]
    losses = engine.state["loss_count"]
    closed = wins + losses
    active = engine._active_count()
    return {
        "running":      engine.running,
        "task_exists":  engine._task is not None,
        "task_done":    engine._task.done()      if engine._task else None,
        "task_cancelled": engine._task.cancelled() if engine._task else None,
        "balance":      virtual_exchange.get_info(user_id)["balance"],
        "state_summary": {
            "status":              engine.state["status"],
            "trade_count":         closed,
            "win_count":           wins,
            "loss_count":          losses,
            "winrate":             round(wins / closed * 100, 2) if closed > 0 else 0.0,
            "active_signal_count": active,
            "max_active_signals":  int(os.getenv("MAX_ACTIVE_SIGNALS", "20")),
        },
    }
