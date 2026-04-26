import asyncio
import os
from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from dotenv import load_dotenv

load_dotenv()

from routes import trading, bot, market, history, auth_routes, admin_routes
from services.bot_manager import bot_manager
from services.database import init_db
from services.auth_service import seed_admin
from services.security import SecurityMiddleware
from services.ws_manager import ws_manager

@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    seed_admin()
    app.state.bot_manager = bot_manager
    yield
    await bot_manager.shutdown()

app = FastAPI(
    title="CryptoSignals API — MEXC Scanner + Virtual Trading",
    lifespan=lifespan,
)

app.add_middleware(SecurityMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[os.getenv("FRONTEND_URL", "*")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_routes.router)
app.include_router(trading.router, prefix="/api/trading", tags=["trading"])
app.include_router(bot.router,     prefix="/api/bot",     tags=["bot"])
app.include_router(market.router,  prefix="/api/market",  tags=["market"])
app.include_router(history.router, prefix="/api/history", tags=["history"])
app.include_router(admin_routes.router, prefix="/api/admin", tags=["admin"])

@app.websocket("/api/bot/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws_manager.connect(ws)
    try:
        while True:
            await ws.receive_text()
    except Exception:
        ws_manager.disconnect(ws)

@app.get("/api/health")
async def health():
    from services.virtual_exchange import virtual_exchange
    info = virtual_exchange.get_info()
    return {
        "status":   "ok",
        "data":     "MEXC (klines + contracts)",
        "balance":  info["balance"],
        "leverage": info["leverage"],
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
