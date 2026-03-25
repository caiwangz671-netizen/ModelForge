"""
Model Capabilities Service
Detects model types and capabilities based on name and Ollama metadata
"""
from typing import Dict, List, Optional, Set
from dataclasses import dataclass
import re

from app.utils.model_names import normalize_model_name, base_model_name


@dataclass
class ModelCapabilities:
    """Model capability flags"""
    name: str
    family: str = ""
    parameter_size: str = ""
    quantization: str = ""
    
    # Capabilities
    supports_reasoning: bool = False
    supports_video: bool = False
    supports_vision: bool = False
    supports_ocr: bool = False
    supports_tools: bool = False
    supports_embedding: bool = False
    supports_code: bool = False
    is_multilingual: bool = False
    
    # Display tags
    tags: List[str] = None
    
    def __post_init__(self):
        if self.tags is None:
            self.tags = []


class ModelCapabilityService:
    """Service for detecting model capabilities"""
    
    # Model family patterns
    REASONING_MODELS: Set[str] = {
        'deepseek-r1', 'deepseek-reasoner',
        'qwq', 'qwq-32b', 'qwq-14b',
        'o1', 'o1-mini', 'o3', 'o3-mini',
        'gpt-oss', 'gpt-oss-20b', 'gpt-oss-120b',
        'kimi-k2',
        'glm-z1',
    }
    
    VISION_MODELS: Set[str] = {
        'llava', 'bakllava', 'llava-phi3',
        'moondream', 'bunny', 'yi-vl',
        'qwen-vl', 'glm-4v',
        'minicpm-v', 'llama3.2-vision', 'gemma3',
    }

    OCR_MODELS: Set[str] = {
        'glm-ocr', 'got-ocr', 'olmocr', 'ocr',
    }
    
    CODE_MODELS: Set[str] = {
        'codellama', 'codegemma', 'deepseek-coder',
        'starcoder', 'wizardcoder', 'phind-codellama',
        'qwen-coder', 'qwen2.5-coder',
    }
    
    EMBEDDING_MODELS: Set[str] = {
        'nomic-embed', 'nomic-embed-text',
        'all-minilm', 'snowflake-arctic-embed',
        'mxbai-embed', 'bge-m3', 'bge-large',
        'jina-embeddings', 'text-embedding',
        'multilingual-e5', 'gte-',
    }

    EMBEDDING_KEYWORDS: Set[str] = {
        'embed', 'embedding', 'e5', 'bge', 'gte', 'retrieval',
    }
    
    MULTILINGUAL_MODELS: Set[str] = {
        'qwen', 'glm', 'yi', 'baichuan',
        'internlm', 'chatglm', 'alphageo',
    }

    OCR_KEYWORDS: Set[str] = {
        'ocr', 'olmocr', 'glmocr', 'gotocr',
    }

    VIDEO_KEYWORDS: Set[str] = {
        'video', 'video_input', 'video-input', 'video-capable',
    }
    
    TOOL_SUPPORTED_MODELS: Set[str] = {
        'gpt-oss', 'qwen3', 'glm-4.5',
        'llama3.1', 'llama3.2', 'mistral-large',
    }

    # Runtime-detected reasoning models (learned from streaming responses)
    RUNTIME_REASONING_MODELS: Set[str] = set()

    REASONING_KEYWORDS: Set[str] = {
        "reason", "reasoning", "think", "thinking", "cot", "chain-of-thought",
    }

    @staticmethod
    def _normalize_model_name(name: str) -> str:
        return normalize_model_name(name)

    @staticmethod
    def _base_model_name(name: str) -> str:
        return base_model_name(name)

    @classmethod
    def mark_reasoning_model(cls, name: str):
        """Mark model as reasoning-capable based on observed runtime behavior."""
        normalized = cls._normalize_model_name(name)
        if not normalized:
            return
        cls.RUNTIME_REASONING_MODELS.add(normalized)
        cls.RUNTIME_REASONING_MODELS.add(cls._base_model_name(normalized))

    @classmethod
    def _details_indicate_reasoning(cls, details: Optional[Dict]) -> bool:
        if not details:
            return False

        direct_keys = ("reasoning", "supports_reasoning", "thinking", "supports_thinking")
        for key in direct_keys:
            value = details.get(key)
            if isinstance(value, bool) and value:
                return True

        capabilities = details.get("capabilities")
        if isinstance(capabilities, dict):
            for key in direct_keys:
                value = capabilities.get(key)
                if isinstance(value, bool) and value:
                    return True

        family_candidates = []
        family = details.get("family")
        if isinstance(family, str) and family:
            family_candidates.append(family.lower())
        families = details.get("families")
        if isinstance(families, list):
            family_candidates.extend(str(f).lower() for f in families if f)

        for fam in family_candidates:
            if any(keyword in fam for keyword in cls.REASONING_KEYWORDS):
                return True

        return False

    @classmethod
    def _name_indicates_reasoning(cls, name_lower: str) -> bool:
        # Explicit curated identifiers
        if any(rm in name_lower for rm in cls.REASONING_MODELS):
            return True

        # Generic keyword-based detection
        if any(keyword in name_lower for keyword in cls.REASONING_KEYWORDS):
            return True

        # Common naming patterns like xxx-r1 / xxx_r1 / xxx:r1
        if re.search(r'(^|[-_:])r\d+($|[-_:])', name_lower):
            return True

        return False

    @classmethod
    def supports_reasoning(cls, name: str, details: Optional[Dict] = None) -> bool:
        """Detect reasoning capability using curated rules + runtime learning."""
        name_lower = cls._normalize_model_name(name)
        base_name = cls._base_model_name(name_lower)

        if name_lower in cls.RUNTIME_REASONING_MODELS or base_name in cls.RUNTIME_REASONING_MODELS:
            return True

        if cls._details_indicate_reasoning(details):
            return True

        return cls._name_indicates_reasoning(name_lower) or cls._name_indicates_reasoning(base_name)

    @classmethod
    def supports_reasoning_static(cls, name: str, details: Optional[Dict] = None) -> bool:
        """
        Detect reasoning capability without runtime-learned cache.
        Useful for conservative default routing (e.g. whether to send think by default).
        """
        name_lower = cls._normalize_model_name(name)
        base_name = cls._base_model_name(name_lower)
        if cls._details_indicate_reasoning(details):
            return True
        return cls._name_indicates_reasoning(name_lower) or cls._name_indicates_reasoning(base_name)

    @classmethod
    def _details_indicate_embedding(cls, details: Optional[Dict]) -> bool:
        if not details:
            return False

        direct_keys = ("embedding", "supports_embedding", "embeddings")
        for key in direct_keys:
            value = details.get(key)
            if isinstance(value, bool) and value:
                return True

        capabilities = details.get("capabilities")
        if isinstance(capabilities, dict):
            for key in direct_keys:
                value = capabilities.get(key)
                if isinstance(value, bool) and value:
                    return True

        family_candidates = []
        for key in ("family", "architecture", "format"):
            value = details.get(key)
            if isinstance(value, str) and value:
                family_candidates.append(value.lower())
        families = details.get("families")
        if isinstance(families, list):
            family_candidates.extend(str(f).lower() for f in families if f)

        if any("bert" in fam for fam in family_candidates):
            return True
        return any(keyword in fam for fam in family_candidates for keyword in cls.EMBEDDING_KEYWORDS)

    @classmethod
    def _name_indicates_embedding(cls, name_lower: str) -> bool:
        if any(em in name_lower for em in cls.EMBEDDING_MODELS):
            return True
        if "-e5" in name_lower or "_e5" in name_lower or ":e5" in name_lower:
            return True
        if re.search(r'(^|[-_:])(gte|bge)(-|$|[_:])', name_lower):
            return True
        return any(keyword in name_lower for keyword in cls.EMBEDDING_KEYWORDS)

    @classmethod
    def supports_embedding(cls, name: str, details: Optional[Dict] = None) -> bool:
        """Detect embedding capability from metadata + naming heuristics."""
        name_lower = cls._normalize_model_name(name)
        base_name = cls._base_model_name(name_lower)
        if cls._details_indicate_embedding(details):
            return True
        return cls._name_indicates_embedding(name_lower) or cls._name_indicates_embedding(base_name)

    @classmethod
    def _details_indicate_vision(cls, details: Optional[Dict]) -> bool:
        if not details:
            return False

        direct_keys = ("vision", "supports_vision", "multimodal")
        for key in direct_keys:
            value = details.get(key)
            if isinstance(value, bool) and value:
                return True

        capabilities = details.get("capabilities")
        if isinstance(capabilities, dict):
            for key in direct_keys:
                value = capabilities.get(key)
                if isinstance(value, bool) and value:
                    return True

        family_candidates = []
        for key in ("family", "architecture", "format"):
            value = details.get(key)
            if isinstance(value, str) and value:
                family_candidates.append(value.lower())
        families = details.get("families")
        if isinstance(families, list):
            family_candidates.extend(str(f).lower() for f in families if f)

        return any(
            any(keyword in fam for keyword in ("vision", "vl", "multimodal", "ocr"))
            for fam in family_candidates
        )

    @classmethod
    def supports_vision(
        cls,
        name: str,
        details: Optional[Dict] = None,
        official_caps: Optional[Set[str]] = None,
    ) -> bool:
        name_lower = cls._normalize_model_name(name)
        base_name = cls._base_model_name(name_lower)
        normalized_caps = {str(cap).strip().lower() for cap in (official_caps or set()) if cap}
        if "vision" in normalized_caps:
            return True
        if cls._details_indicate_vision(details):
            return True
        return any(vm in name_lower for vm in cls.VISION_MODELS) or any(vm in base_name for vm in cls.VISION_MODELS)

    @classmethod
    def _details_indicate_video(cls, details: Optional[Dict]) -> bool:
        if not details:
            return False

        direct_keys = ("video", "supports_video", "video_input", "supports_video_input")
        for key in direct_keys:
            value = details.get(key)
            if isinstance(value, bool) and value:
                return True

        capabilities = details.get("capabilities")
        if isinstance(capabilities, dict):
            for key in direct_keys:
                value = capabilities.get(key)
                if isinstance(value, bool) and value:
                    return True

        family_candidates = []
        for key in ("family", "architecture", "format"):
            value = details.get(key)
            if isinstance(value, str) and value:
                family_candidates.append(value.lower())
        families = details.get("families")
        if isinstance(families, list):
            family_candidates.extend(str(f).lower() for f in families if f)

        return any(
            any(keyword in fam for keyword in cls.VIDEO_KEYWORDS)
            for fam in family_candidates
        )

    @classmethod
    def supports_video(
        cls,
        name: str,
        details: Optional[Dict] = None,
        official_caps: Optional[Set[str]] = None,
    ) -> bool:
        normalized_caps = {str(cap).strip().lower() for cap in (official_caps or set()) if cap}
        if {"video", "videos", "video_input", "video-input"} & normalized_caps:
            return True

        name_lower = cls._normalize_model_name(name)
        base_name = cls._base_model_name(name_lower)
        if cls._details_indicate_video(details):
            return True
        return any(keyword in name_lower for keyword in cls.VIDEO_KEYWORDS) or any(
            keyword in base_name for keyword in cls.VIDEO_KEYWORDS
        )

    @classmethod
    def _details_indicate_ocr(cls, details: Optional[Dict]) -> bool:
        if not details:
            return False

        direct_keys = ("ocr", "supports_ocr")
        for key in direct_keys:
            value = details.get(key)
            if isinstance(value, bool) and value:
                return True

        capabilities = details.get("capabilities")
        if isinstance(capabilities, dict):
            for key in direct_keys:
                value = capabilities.get(key)
                if isinstance(value, bool) and value:
                    return True

        family_candidates = []
        for key in ("family", "architecture", "format"):
            value = details.get(key)
            if isinstance(value, str) and value:
                family_candidates.append(value.lower())
        families = details.get("families")
        if isinstance(families, list):
            family_candidates.extend(str(f).lower() for f in families if f)

        return any(
            any(keyword in fam for keyword in cls.OCR_KEYWORDS)
            for fam in family_candidates
        )

    @classmethod
    def _name_indicates_ocr(cls, name_lower: str) -> bool:
        if any(ocr_model in name_lower for ocr_model in cls.OCR_MODELS):
            return True
        return any(keyword in name_lower for keyword in cls.OCR_KEYWORDS)

    @classmethod
    def supports_ocr(
        cls,
        name: str,
        details: Optional[Dict] = None,
        official_caps: Optional[Set[str]] = None,
    ) -> bool:
        """
        OCR is intentionally stricter than vision.
        Only dedicated OCR/document-reading models should be flagged here.
        """
        name_lower = cls._normalize_model_name(name)
        base_name = cls._base_model_name(name_lower)

        if cls._name_indicates_ocr(name_lower) or cls._name_indicates_ocr(base_name):
            return True
        if cls._details_indicate_ocr(details):
            return True
        normalized_caps = {str(cap).strip().lower() for cap in (official_caps or set()) if cap}
        if "ocr" in normalized_caps:
            return True
        return False
    
    @classmethod
    def analyze_model(cls, name: str, details: Optional[Dict] = None) -> ModelCapabilities:
        """Analyze model capabilities from name and Ollama details"""
        name_lower = name.lower()
        
        # Extract from details if available
        family = details.get('family', '') if details else ''
        parameter_size = details.get('parameter_size', '') if details else ''
        quantization = details.get('quantization_level', '') if details else ''
        
        # Detect capabilities
        supports_reasoning = cls.supports_reasoning(name, details)
        supports_video = cls.supports_video(name, details)
        supports_vision = cls.supports_vision(name, details)
        supports_ocr = cls.supports_ocr(name, details)
        supports_code = any(cm in name_lower for cm in cls.CODE_MODELS)
        supports_embedding = cls.supports_embedding(name, details)
        is_multilingual = any(mm in name_lower for mm in cls.MULTILINGUAL_MODELS)
        supports_tools = any(tm in name_lower for tm in cls.TOOL_SUPPORTED_MODELS)
        
        # Build tags
        tags = []
        
        # Parameter size tag
        if parameter_size:
            tags.append(parameter_size)
        
        # Quantization tag
        if quantization:
            tags.append(quantization)
        
        # Capability tags
        if supports_reasoning:
            tags.append('推理')
        if supports_video:
            tags.append('视频')
        if supports_vision:
            tags.append('视觉')
        if supports_ocr:
            tags.append('OCR')
        if supports_code:
            tags.append('代码')
        if supports_embedding:
            tags.append('嵌入')
        if is_multilingual:
            tags.append('多语言')
        if supports_tools:
            tags.append('工具')
        
        # Family-specific tags
        if 'llama' in name_lower:
            tags.append('Llama')
        if 'qwen' in name_lower:
            tags.append('Qwen')
        if 'glm' in name_lower:
            tags.append('GLM')
        if 'mistral' in name_lower:
            tags.append('Mistral')
        if 'deepseek' in name_lower:
            tags.append('DeepSeek')
        if 'phi' in name_lower:
            tags.append('Phi')
        if 'gemma' in name_lower:
            tags.append('Gemma')
        
        return ModelCapabilities(
            name=name,
            family=family,
            parameter_size=parameter_size,
            quantization=quantization,
            supports_reasoning=supports_reasoning,
            supports_video=supports_video,
            supports_vision=supports_vision,
            supports_ocr=supports_ocr,
            supports_tools=supports_tools,
            supports_embedding=supports_embedding,
            supports_code=supports_code,
            is_multilingual=is_multilingual,
            tags=list(dict.fromkeys(tags))
        )
    
    @classmethod
    def get_model_badge_color(cls, capability: str) -> str:
        """Get badge color for a capability"""
        colors = {
            '推理': 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
            '视觉': 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
            'OCR': 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200',
            '代码': 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
            '嵌入': 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
            '多语言': 'bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-200',
            '工具': 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200',
        }
        return colors.get(capability, 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200')


# Model families info for UI display
MODEL_FAMILY_INFO = {
    'llama': {
        'name': 'Llama',
        'description': 'Meta 开源大模型',
        'origin': 'Meta AI',
    },
    'qwen': {
        'name': 'Qwen',
        'description': '阿里通义千问',
        'origin': 'Alibaba Cloud',
    },
    'glm': {
        'name': 'GLM',
        'description': '智谱 AI 大模型',
        'origin': 'Zhipu AI',
    },
    'mistral': {
        'name': 'Mistral',
        'description': 'Mistral AI 大模型',
        'origin': 'Mistral AI',
    },
    'deepseek': {
        'name': 'DeepSeek',
        'description': '深度求索大模型',
        'origin': 'DeepSeek',
    },
    'phi': {
        'name': 'Phi',
        'description': 'Microsoft 小语言模型',
        'origin': 'Microsoft',
    },
    'gemma': {
        'name': 'Gemma',
        'description': 'Google 开源模型',
        'origin': 'Google',
    },
    'nomic-bert': {
        'name': 'Nomic Embed',
        'description': 'Nomic 嵌入模型',
        'origin': 'Nomic AI',
    },
}
