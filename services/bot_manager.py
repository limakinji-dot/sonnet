import asyncio
from typing import Dict, Optional
from services.bot_engine import BotEngine

class BotManager:
    def __init__(self):
        self.global_engine = BotEngine(user_id=None)
        self.user_engines: Dict[str, BotEngine] = {}
        self._running_state: Dict[str, bool] = {}  # Persist state

    async def start_user_bot(self, user_id: str, config: dict):
        if user_id in self.user_engines and self.user_engines[user_id].running:
            return {"ok": False, "reason": "Bot already running for this user"}
        
        # Stop engine lama kalau ada tapi mati
        if user_id in self.user_engines:
            await self.user_engines[user_id].shutdown()
        
        engine = BotEngine(user_id=user_id)
        self.user_engines[user_id] = engine
        self._running_state[user_id] = True
        return await engine.start(config)

    async def stop_user_bot(self, user_id: str):
        engine = self.user_engines.get(user_id)
        if engine:
            result = await engine.stop()
            self._running_state[user_id] = False
            return result
        self._running_state[user_id] = False
        return {"ok": False, "reason": "No bot running for this user"}

    def get_engine(self, user_id: Optional[str] = None):
        if user_id:
            return self.user_engines.get(user_id)
        return self.global_engine

    def is_running(self, user_id: Optional[str] = None) -> bool:
        """Cek status bot (persist setelah refresh)."""
        if user_id:
            # Cek engine aktif dulu
            engine = self.user_engines.get(user_id)
            if engine and engine.running:
                return True
            # Fallback ke state persist
            return self._running_state.get(user_id, False)
        return self.global_engine.running

    async def shutdown(self):
        await self.global_engine.shutdown()
        for engine in list(self.user_engines.values()):
            await engine.shutdown()
        self.user_engines.clear()
        self._running_state.clear()

bot_manager = BotManager()
