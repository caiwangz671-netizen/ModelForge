"""
ModelForge Backend - FastAPI Application
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from app.api import models, chat, downloads, memory, system, computer_use
from app.config import get_settings
from app.services.computer_use_service import computer_use_service
from app.services.database import init_db


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler"""
    # Startup
    await init_db()
    await downloads.mark_stale_downloads_failed()
    await computer_use_service.mark_stale_sessions_failed()
    yield
    # Shutdown


app = FastAPI(
    title="ModelForge API",
    description="API for ModelForge - A web UI for managing Ollama models",
    version="1.0.0",
    lifespan=lifespan
)

settings = get_settings()

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(models.router, prefix="/api/models", tags=["models"])
app.include_router(chat.router, prefix="/api/chat", tags=["chat"])
app.include_router(downloads.router, prefix="/api/downloads", tags=["downloads"])
app.include_router(memory.router, prefix="/api/memory", tags=["memory"])
app.include_router(system.router, prefix="/api/system", tags=["system"])
app.include_router(computer_use.router, prefix="/api/computer-use", tags=["computer-use"])


@app.get("/api/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy", "version": "1.0.0"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
