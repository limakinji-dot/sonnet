import asyncio
import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from contextlib import asynccontextmanager
from dotenv import load_dotenv

load_dotenv()

from routes import trading, bot, market, history, auth_routes, admin_routes
from routes.sim_routes import router as sim_router
from routes.market_sim_routes import router as market_sim_router
from services.bot_manager import bot_manager
from services.database import init_db
from services.auth_service import seed_admin
from services.security import SecurityMiddleware
from services.ws_manager import ws_manager
from services.trading_world import trading_world


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    seed_admin()
    app.state.bot_manager = bot_manager
    yield
    await bot_manager.shutdown()
    await trading_world.close()


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

# ── Router lama (tidak berubah) ────────────────────────────────────────────
app.include_router(auth_routes.router)
app.include_router(trading.router, prefix="/api/trading", tags=["trading"])
app.include_router(bot.router,     prefix="/api/bot",     tags=["bot"])
app.include_router(market.router,  prefix="/api/market",  tags=["market"])
app.include_router(history.router, prefix="/api/history", tags=["history"])
app.include_router(admin_routes.router, prefix="/api/admin", tags=["admin"])

# ── Router baru: Trading World Simulation ─────────────────────────────────
app.include_router(sim_router,        prefix="/sim",    tags=["simulation"])
app.include_router(market_sim_router, prefix="/market", tags=["market-sim"])


# ── Endpoints lama ─────────────────────────────────────────────────────────
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


# ── Endpoint baru: Trading World dashboard ─────────────────────────────────
@app.get("/world")
async def trading_world_page():
    """Buka Trading World Simulation dashboard."""
    html_path = os.path.join("frontend", "trading_world.html")
    return FileResponse(html_path)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
