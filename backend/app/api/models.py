"""Models API routes"""
from fastapi import APIRouter, HTTPException
import asyncio
import logging
from typing import Optional, List, Union
from pydantic import BaseModel

from app.services.ollama import ollama_service
from app.services.library_service import library_service
from app.services.model_capabilities import ModelCapabilityService
from app.services.model_residency_service import model_residency_service
from app.utils.env import upsert_env_value

router = APIRouter()
logger = logging.getLogger(__name__)


class ModelInfo(BaseModel):
    name: str
    description: Optional[str] = None
    parameter_size: Optional[str] = None
    quantization: Optional[str] = None
    size: Optional[int] = None
    digest: Optional[str] = None
    modified_at: Optional[str] = None
    capabilities: Optional[dict] = None
    tags: Optional[List[str]] = None


class UnloadModelRequest(BaseModel):
    model: str


class LoadModelRequest(BaseModel):
    model: str
    keep_alive: Optional[Union[int, str]] = "10m"


class ModelResidencyRequest(BaseModel):
    model: str
    resident: bool


@router.get("", include_in_schema=True)
async def list_models():
    """List all available models with capabilities"""
    try:
        models = await ollama_service.list_models()
        semaphore = asyncio.Semaphore(8)

        async def _official_caps_for(model_name: str) -> set[str]:
            if not model_name:
                return set()
            async with semaphore:
                return await ollama_service.get_model_capabilities(model_name)

        # Fetch official capabilities concurrently to avoid serial /api/show latency.
        cap_results = await asyncio.gather(
            *[_official_caps_for(model.get("name", "")) for model in models],
            return_exceptions=True,
        )
        
        # Enhance models with capability analysis
        enhanced_models = []
        for model, caps_result in zip(models, cap_results):
            name = model.get('name', '')
            details = model.get('details', {})
            official_caps: set[str] = set()
            if isinstance(caps_result, set):
                official_caps = caps_result
            
            # Analyze capabilities
            caps = ModelCapabilityService.analyze_model(name, details)
            supports_ocr = ModelCapabilityService.supports_ocr(
                name,
                details,
                official_caps=official_caps,
            )
            if official_caps:
                supports_reasoning = "thinking" in official_caps
                supports_vision = "vision" in official_caps
                supports_tools = "tools" in official_caps
                supports_embedding = ("embedding" in official_caps or "embeddings" in official_caps)
            else:
                # Fallback only when official capabilities are unavailable.
                supports_reasoning = caps.supports_reasoning
                supports_vision = caps.supports_vision
                # Tools are strictly gated by official Ollama capabilities.
                # If capabilities are unavailable, expose as unsupported.
                supports_tools = False
                supports_embedding = caps.supports_embedding
            
            enhanced_model = {
                **model,
                'ollama_capabilities': sorted(list(official_caps)),
                'capabilities': {
                    'supports_reasoning': supports_reasoning,
                    'supports_vision': supports_vision,
                    'supports_ocr': supports_ocr,
                    'supports_tools': supports_tools,
                    'supports_embedding': supports_embedding,
                    'supports_code': caps.supports_code,
                    'is_multilingual': caps.is_multilingual,
                },
                'tags': caps.tags,
                'family_info': {
                    'family': caps.family,
                    'parameter_size': caps.parameter_size,
                    'quantization': caps.quantization,
                }
            }
            enhanced_models.append(enhanced_model)
        
        return {"models": enhanced_models}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/running")
async def list_running_models():
    """List currently loaded models in Ollama memory"""
    try:
        models = await ollama_service.list_running_models()
        return {"models": models}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/library")
async def list_library_models(refresh: bool = False):
    """List models from official ollama.com/library."""
    try:
        models = await library_service.list_models(refresh=refresh)
        return {"models": models}
    except Exception as e:
        logger.warning("Failed to fetch library models; returning empty list", exc_info=True)
        return {"models": [], "warning": f"Failed to fetch library models: {str(e)}"}


@router.get("/library/{model_name:path}/tags")
async def list_library_model_tags(model_name: str, refresh: bool = False):
    """List downloadable tags/variants for a library model."""
    try:
        tags = await library_service.list_model_tags(model_name=model_name, refresh=refresh)
        return {"model": model_name, "tags": tags}
    except Exception as e:
        logger.warning("Failed to fetch library tags for %s; returning latest fallback", model_name, exc_info=True)
        return {
            "model": model_name,
            "tags": [
                {
                    "full_name": model_name,
                    "tag": "latest",
                    "is_latest": True,
                    "library_url": f"https://ollama.com/library/{model_name}",
                }
            ],
            "warning": f"Failed to fetch model tags: {str(e)}",
        }


@router.post("/unload")
async def unload_model(request: UnloadModelRequest):
    """Unload a model from memory (keep_alive=0)"""
    try:
        await ollama_service.unload_model(request.model)
        return {"message": f"Model {request.model} unloaded"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/load")
async def load_model(request: LoadModelRequest):
    """Load/prewarm a model into memory."""
    try:
        await ollama_service.load_model(request.model, keep_alive=request.keep_alive)
        return {"message": f"Model {request.model} loaded", "keep_alive": request.keep_alive}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/residency")
async def get_residency():
    """Get model residency preferences and auto-unload behavior."""
    try:
        return {
            "resident_models": model_residency_service.list_resident_models(),
            "auto_unload_after_response": model_residency_service.get_auto_unload_after_response(),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/residency")
async def set_residency(request: ModelResidencyRequest):
    """Set whether a model should stay resident in memory."""
    try:
        from app.config import PROJECT_ROOT
        resident_models = model_residency_service.set_resident(
            request.model,
            resident=request.resident,
        )
        env_path = PROJECT_ROOT / ".env"
        resident_env_value = ",".join(resident_models) if resident_models else None
        upsert_env_value(env_path, "RESIDENT_MODELS", resident_env_value)
        return {
            "model": request.model,
            "resident": request.resident,
            "resident_models": resident_models,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{model_name}")
async def get_model_info(model_name: str):
    """Get model information"""
    try:
        info = await ollama_service.get_model_info(model_name)
        return info
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{model_name}")
async def delete_model(model_name: str):
    """Delete a model"""
    try:
        await ollama_service.delete_model(model_name)
        return {"message": f"Model {model_name} deleted successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
