import os
import time
from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

API_KEY = os.getenv("API_KEY", "agent-x-dev-key-change-in-production")
RATE_LIMIT_ENABLED = os.getenv("RATE_LIMIT_ENABLED", "true").lower() == "true"
_rate_limit_store = {}

class SecurityMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        path = request.url.path

        # Bypass untuk health check, WebSocket upgrade, CORS preflight
        if path in ("/api/health", "/api/bot/ws") or request.method == "OPTIONS":
            return await call_next(request)

        # 1. API Key
        api_key = request.headers.get("x-api-key")
        client_ip = request.client.host if request.client else "unknown"

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

        # 2. Timestamp (anti replay)
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

        # 3. Rate limit 60 req/min per IP
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