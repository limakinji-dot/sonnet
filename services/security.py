import os
import time
from fastapi import Request, HTTPException
from starlette.middleware.base import BaseHTTPMiddleware

API_KEY = os.getenv("API_KEY", "agent-x-dev-key-change-in-production")
RATE_LIMIT_ENABLED = os.getenv("RATE_LIMIT_ENABLED", "true").lower() == "true"
_rate_limit_store = {}

class SecurityMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        path = request.url.path

        if path in ("/api/health", "/api/bot/ws") or request.method == "OPTIONS":
            return await call_next(request)

        # 1. API Key
        api_key = request.headers.get("x-api-key")
        if not api_key:
            raise HTTPException(status_code=401, detail="Missing X-API-Key header")
        if api_key != API_KEY:
            raise HTTPException(status_code=401, detail="Invalid API Key")

        # 2. Timestamp (anti replay)
        ts_header = request.headers.get("x-timestamp")
        if ts_header:
            try:
                ts = int(ts_header)
                now_ms = int(time.time() * 1000)
                if abs(now_ms - ts) > 300000:
                    raise HTTPException(status_code=401, detail="Request timestamp expired")
            except ValueError:
                raise HTTPException(status_code=401, detail="Invalid timestamp")

        # 3. Rate limit 60 req/min per IP
        if RATE_LIMIT_ENABLED:
            client_ip = request.client.host if request.client else "unknown"
            now = time.time()
            window = [t for t in _rate_limit_store.get(client_ip, []) if now - t < 60]
            if len(window) >= 60:
                raise HTTPException(status_code=429, detail="Rate limit exceeded (60 req/min)")
            window.append(now)
            _rate_limit_store[client_ip] = window

        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        return response
