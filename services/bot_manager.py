
import asyncio
from typing import Dict, Optional
from services.bot_engine import BotEngine

class BotManager:
    def __init__(self):
        self.global_engine = BotEngine(user_id=None)
        self.user_engines: Dict[str, BotEngine] = {}
        self._running_state: Dict[str, bool] = {}

    async def start_user_bot(self, user_id: str, config: dict):
        # Stop engine lama kalau ada
        if user_id in self.user_engines:
            old = self.user_engines[user_id]
            if old.running:
                return {"ok": False, "reason": "Bot already running for this user"}
            await old.shutdown()
            del self.user_engines[user_id]

        engine = BotEngine(user_id=user_id)
        self.user_engines[user_id] = engine
        self._running_state[user_id] = True
        result = await engine.start(config)
        return result

    async def stop_user_bot(self, user_id: str):
        engine = self.user_engines.get(user_id)
        if engine and engine.running:
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
        if user_id:
            engine = self.user_engines.get(user_id)
            if engine and engine.running:
                return True
            return self._running_state.get(user_id, False)
        return self.global_engine.running

    async def shutdown(self):
        await self.global_engine.shutdown()
        for engine in list(self.user_engines.values()):
            await engine.shutdown()
        self.user_engines.clear()
        self._running_state.clear()

bot_manager = BotManager()