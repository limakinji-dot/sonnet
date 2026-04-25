import os
import time
from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

API_KEY = os.getenv("API_KEY", "agent-x-dev-key-change-in-production")
RATE_LIMIT_ENABLED = os.getenv("RATE_LIMIT_ENABLED", "true").lower() == "true"
_rate_limit_store = {}

# Path yang selalu public (tanpa API Key)
PUBLIC_PATHS = {"/api/health", "/api/bot/ws"}

# Path read-only yang public (history, bot state, trading balance)
# Frontend tetap kirim API Key (gak masalah), tapi gak wajib
PUBLIC_GET_PATHS = {
    "/api/history/signals",
    "/api/history/summary",
    "/api/bot/state",
    "/api/bot/signals",
    "/api/bot/stats",
    "/api/trading/balance",
}

class SecurityMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        path = request.url.path

        # Selalu bypass: health, ws, options
        if path in PUBLIC_PATHS or request.method == "OPTIONS":
            return await call_next(request)

        # ── PUBLIC GET BYPASS: history, bot state, balance (read-only) ──
        # Kalau GET request ke endpoint public → bypass API Key
        # Route handler tetap baca Authorization: Bearer untuk mode private
        if request.method == "GET" and path in PUBLIC_GET_PATHS:
            return await call_next(request)

        # ── Standard API Key check untuk endpoint lain ──
        client_ip = request.client.host if request.client else "unknown"
        api_key = request.headers.get("x-api-key")

        if api_key is None:
            print(f"[Security] 🚫 401 MISSING KEY | {client_ip} | {request.method} {path}")
            return JSONResponse(
                status_code=401,
                content={"detail": "Missing X-API-Key header"}
            )
        if api_key != API_KEY:
            print(f"[Security] 🚫 401 INVALID KEY | {client_ip} | {path} | key={api_key[:8]}...")
            return JSONResponse(
                status_code=401,
                content={"detail": "Invalid API Key"}
            )

        # Timestamp (anti replay)
        ts_header = request.headers.get("x-timestamp")
        if ts_header:
            try:
                ts = int(ts_header)
                now_ms = int(time.time() * 1000)
                if abs(now_ms - ts) > 300000:
                    return JSONResponse(
                        status_code=401,
                        content={"detail": "Request timestamp expired"}
                    )
            except ValueError:
                return JSONResponse(
                    status_code=401,
                    content={"detail": "Invalid timestamp"}
                )

        # Rate limit
        if RATE_LIMIT_ENABLED:
            now = time.time()
            window = [t for t in _rate_limit_store.get(client_ip, []) if now - t < 60]
            if len(window) >= 60:
                return JSONResponse(
                    status_code=429,
                    content={"detail": "Rate limit exceeded (60 req/min)"}
                )
            window.append(now)
            _rate_limit_store[client_ip] = window

        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        return response