from fastapi import APIRouter, Request
from typing import List
from services.token_manager import token_manager
from services.qwen_ai import qwen_ai

router = APIRouter()

@router.get("/tokens")
async def get_tokens(request: Request):
    """Get current token slots (masked)."""
    tokens = token_manager.get_tokens()
    masked = []
    for i, t in enumerate(tokens, 1):
        masked.append({
            "slot": i,
            "token": f"{t[:8]}...{t[-4:]}" if len(t) > 12 else "***",
            "active": True
        })
    # Tambah slot kosong
    for i in range(len(tokens) + 1, 6):
        masked.append({"slot": i, "token": None, "active": False})
    return {"data": masked}

@router.post("/tokens")
async def update_tokens(request: Request):
    """Update Qwen tokens (admin only)."""
    body = await request.json()
    tokens = body.get("tokens", [])
    
    # Validasi minimal 1 token
    valid = [t.strip() for t in tokens if t and len(t.strip()) > 20]
    if not valid:
        return {"ok": False, "detail": "At least 1 valid token required"}
    
    # Update
    token_manager.update_tokens(valid)
    
    # Hot-reload Qwen AI clients
    qwen_ai.reload_tokens()
    
    return {
        "ok": True,
        "message": f"{len(valid)} token(s) updated & reloaded",
        "tokens": [f"{t[:8]}...{t[-4:]}" for t in valid]
    }
