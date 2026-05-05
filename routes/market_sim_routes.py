"""
Market routes untuk simulation world.
GET /market/candles?symbol=BTC_USDT  — fetch candles semua TF sekaligus
GET /market/price?symbol=BTC_USDT    — fetch current price
"""

import asyncio
import logging
from fastapi import APIRouter, Query
from services.mexc_client import mexc_client

logger = logging.getLogger(__name__)
router = APIRouter()

TIMEFRAMES   = ["5m", "15m", "30m", "1h", "4h"]
CANDLE_LIMIT = 150


@router.get("/candles")
async def get_candles(symbol: str = Query("BTC_USDT")):
    """
    Fetch candles semua timeframe + current price untuk satu simbol.
    Dipakai oleh frontend trading_world.html sebelum run_simulation.
    """
    # Fetch semua TF paralel
    async def fetch_tf(tf):
        try:
            c = await mexc_client.get_candles(symbol, tf, CANDLE_LIMIT)
            return tf, c if (c and len(c) >= 5) else None
        except Exception as e:
            logger.warning(f"{symbol}/{tf}: {e}")
            return tf, None

    results = await asyncio.gather(*[fetch_tf(tf) for tf in TIMEFRAMES])
    candles_by_tf = {tf: c for tf, c in results if c}

    if not candles_by_tf:
        return {"ok": False, "error": f"No candle data for {symbol}"}

    # Current price dari ticker
    try:
        ticker = await mexc_client.get_ticker(symbol)
        current_price = float(ticker.get("lastPr") or ticker.get("last") or 0)
    except Exception:
        # Fallback ke close candle terakhir
        any_tf = next(iter(candles_by_tf.values()))
        current_price = float(any_tf[-1][4])

    if current_price <= 0:
        return {"ok": False, "error": "Could not get current price"}

    return {
        "ok": True,
        "symbol": symbol,
        "current_price": current_price,
        "candles_by_tf": candles_by_tf,
        "tf_count": len(candles_by_tf),
    }


@router.get("/price")
async def get_price(symbol: str = Query("BTC_USDT")):
    """Fetch current price saja (cepat)."""
    try:
        ticker = await mexc_client.get_ticker(symbol)
        price = float(ticker.get("lastPr") or ticker.get("last") or 0)
        return {"ok": True, "symbol": symbol, "price": price}
    except Exception as e:
        return {"ok": False, "error": str(e)}
