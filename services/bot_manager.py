import asyncio
from typing import Dict, Optional
from services.bot_engine import BotEngine

class BotManager:
    def __init__(self):
        self.global_engine = BotEngine(user_id=None)
        self.user_engines: Dict[str, BotEngine] = {}

    async def start_user_bot(self, user_id: str, config: dict):
        if user_id in self.user_engines:
            return {"ok": False, "reason": "Bot already running for this user"}
        engine = BotEngine(user_id=user_id)
        self.user_engines[user_id] = engine
        return await engine.start(config)

    async def stop_user_bot(self, user_id: str):
        engine = self.user_engines.pop(user_id, None)
        if engine:
            return await engine.stop()
        return {"ok": False, "reason": "No bot running for this user"}

    def get_engine(self, user_id: Optional[str] = None):
        if user_id:
            return self.user_engines.get(user_id)
        return self.global_engine

    async def shutdown(self):
        await self.global_engine.shutdown()
        for engine in list(self.user_engines.values()):
            await engine.shutdown()
        self.user_engines.clear()

bot_manager = BotManager()
