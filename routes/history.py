import os
from fastapi import APIRouter, Request, Query
from typing import Optional

from services.database import db_get_signals, get_user_by_username, list_users
from services.auth_service import decode_token

router = APIRouter()

# ── Helper: Ambil Admin ID dengan fallback ──
_admin_user_id = None

def _get_admin_id() -> Optional[str]:
    global _admin_user_id
    if _admin_user_id is None:
        admin_username = os.getenv("ADMIN_USERNAME", "admin")
        admin = get_user_by_username(admin_username)
        if admin:
            _admin_user_id = admin["id"]
        else:
            # 🔥 Fallback: cari user mana pun yang is_admin=1
            users = list_users()
            for u in users:
                if u.get("is_admin"):
                    _admin_user_id = u["id"]
                    print(f"[Auth] Fallback admin found: {u['username']} ({_admin_user_id})")
                    break
            if _admin_user_id is None:
                print(f"[Auth] CRITICAL: No admin user found! Checked username: {admin_username}")
    return _admin_user_id

def _get_user_id_from_request(request: Request) -> Optional[str]:
    if request is None:
        return None
    token = request.headers.get("authorization", "")
    if token.startswith("Bearer "):
        payload = decode_token(token[7:])
        if payload:
            return payload.get("sub")
    user_param = request.query_params.get("user")
    return user_param if user_param else None

def _resolve_user_id(request: Request, user_query: Optional[str]) -> Optional[str]:
    """
    Kalau ada token/user query → return user itu (private mode).
    Kalau gak ada → return admin ID (global/public mode).
    """
    user_id = user_query or _get_user_id_from_request(request)
    if user_id:
        return user_id  # ✅ User login → data milik dia
    return _get_admin_id()  # ✅ Public → data admin

def _pnl(s):
    return float(s.get("pnl_pct") or 0)

@router.get("/signals")
async def get_signal_history(
    limit: int = 100,
    request: Request = None,
    user: Optional[str] = Query(None)
):
    user_id = _resolve_user_id(request, user)
    signals = db_get_signals(user_id=user_id, limit=limit)
    return {"data": signals, "total": len(signals)}

@router.get("/signals/{symbol}")
async def get_signal_history_by_symbol(
    symbol: str,
    limit: int = 100,
    request: Request = None,
    user: Optional[str] = Query(None)
):
    user_id = _resolve_user_id(request, user)
    all_signals = db_get_signals(user_id=user_id, limit=1000)
    signals = [s for s in all_signals if s.get("symbol") == symbol]
    return {"data": signals[:limit], "total": len(signals)}

@router.get("/summary")
async def get_summary_all(
    request: Request = None,
    user: Optional[str] = Query(None)
):
    user_id = _resolve_user_id(request, user)
    signals = db_get_signals(user_id=user_id, limit=10000)

    closed = [s for s in signals if s.get("result") in ("TP", "SL")]
    wins = [s for s in closed if s.get("result") == "TP"]
    losses = [s for s in closed if s.get("result") == "SL"]
    open_sig = [s for s in signals if s.get("status") == "OPEN"]

    total_pnl = sum(_pnl(s) for s in closed)
    winrate = round(len(wins) / len(closed) * 100, 2) if closed else 0.0
    avg_pnl = round(total_pnl / len(closed), 4) if closed else 0.0

    return {
        "data": {
            "total_signals": len(signals),
            "closed_trades": len(closed),
            "open_signals": len(open_sig),
            "wins": len(wins),
            "losses": len(losses),
            "winrate": winrate,
            "total_pnl_pct": round(total_pnl, 4),
            "avg_pnl_pct": avg_pnl,
        }
    }

@router.get("/summary/{symbol}")
async def get_summary_by_symbol(
    symbol: str,
    request: Request = None,
    user: Optional[str] = Query(None)
):
    user_id = _resolve_user_id(request, user)
    all_signals = db_get_signals(user_id=user_id, limit=10000)
    signals = [s for s in all_signals if s.get("symbol") == symbol]

    closed = [s for s in signals if s.get("result") in ("TP", "SL")]
    wins = [s for s in closed if s.get("result") == "TP"]
    losses = [s for s in closed if s.get("result") == "SL"]

    total_pnl = sum(_pnl(s) for s in closed)
    winrate = round(len(wins) / len(closed) * 100, 2) if closed else 0.0
    avg_pnl = round(total_pnl / len(closed), 4) if closed else 0.0

    return {
        "data": {
            "symbol": symbol,
            "closed_trades": len(closed),
            "wins": len(wins),
            "losses": len(losses),
            "winrate": winrate,
            "total_pnl_pct": round(total_pnl, 4),
            "avg_pnl_pct": avg_pnl,
        }
    }
