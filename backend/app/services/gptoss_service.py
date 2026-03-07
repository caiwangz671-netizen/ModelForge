"""
GPT-OSS Service - Special handling for OpenAI's GPT-OSS models

GPT-OSS Features:
- Harmony Chat Format with special tokens
- Reasoning levels (low/medium/high)
- Tool use capabilities (browsing, Python, dev functions)
- Chain of Thought (CoT) reasoning
- MXFP4 quantization support
"""
import re
from typing import Optional, Dict, Any, List, Tuple
from enum import Enum


class ReasoningLevel(str, Enum):
    """GPT-OSS reasoning levels"""
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class GPTOSSService:
    """Service for handling GPT-OSS specific features"""
    
    # GPT-OSS model identifiers
    GPTOSS_MODELS = [
        'gpt-oss',
        'gpt-oss-20b',
        'gpt-oss-120b',
        'gpt-oss-20b-mxfp4',
        'gpt-oss-120b-mxfp4',
    ]
    
    # Harmony Chat Format special tokens
    HARMONY_TOKENS = {
        'system_start': '<|system|>',
        'system_end': '<|/system|>',
        'developer_start': '<|developer|>',
        'developer_end': '<|/developer|>',
        'user_start': '<|user|>',
        'user_end': '<|/user|>',
        'assistant_start': '<|assistant|>',
        'assistant_end': '<|/reasoning|>',  # Note: ends with reasoning tag
        'reasoning_start': '<|reasoning|>',
        'reasoning_end': '<|/reasoning|>',
        'tool_start': '<|tool|>',
        'tool_end': '<|/tool|>',
        'analysis_channel': '<|analysis|>',
        'commentary_channel': '<|commentary|>',
        'final_output_channel': '<|final|>',
    }
    
    # Reasoning patterns specific to GPT-OSS
    REASONING_PATTERNS = [
        r'<\|reasoning\|>(.*?)<\|/reasoning\|>',
        r'<\|analysis\|>(.*?)<\|/analysis\|>',
        r'<\|commentary\|>(.*?)<\|/commentary\|>',
    ]
    
    @classmethod
    def is_gptoss_model(cls, model_name: str) -> bool:
        """Check if model is GPT-OSS"""
        model_lower = model_name.lower()
        return any(gptoss in model_lower for gptoss in cls.GPTOSS_MODELS)
    
    @classmethod
    def apply_harmony_format(
        cls,
        messages: List[Dict[str, str]],
        reasoning_level: ReasoningLevel = ReasoningLevel.MEDIUM
    ) -> str:
        """
        Convert messages to GPT-OSS Harmony Chat Format
        
        Harmony Format:
        <|system|>system message<|/system|>
        <|user|>user message<|/user|>
        <|assistant|><|reasoning|>thinking...<|/reasoning|>response<|/reasoning|>
        """
        formatted = []
        
        # Add reasoning level hint in system/developer message
        reasoning_hint = f"Reasoning: {reasoning_level.value}"
        
        for msg in messages:
            role = msg.get('role', 'user')
            content = msg.get('content', '')
            
            if role == 'system':
                formatted.append(f"{cls.HARMONY_TOKENS['system_start']}{content}\n{reasoning_hint}{cls.HARMONY_TOKENS['system_end']}")
            elif role == 'developer':
                formatted.append(f"{cls.HARMONY_TOKENS['developer_start']}{content}{cls.HARMONY_TOKENS['developer_end']}")
            elif role == 'user':
                formatted.append(f"{cls.HARMONY_TOKENS['user_start']}{content}{cls.HARMONY_TOKENS['user_end']}")
            elif role == 'assistant':
                # Assistant messages may contain reasoning
                formatted.append(f"{cls.HARMONY_TOKENS['assistant_start']}{content}{cls.HARMONY_TOKENS['assistant_end']}")
            elif role == 'tool':
                formatted.append(f"{cls.HARMONY_TOKENS['tool_start']}{content}{cls.HARMONY_TOKENS['tool_end']}")
        
        return '\n'.join(formatted)
    
    @classmethod
    def parse_harmony_response(cls, response: str) -> Dict[str, Any]:
        """
        Parse GPT-OSS Harmony format response
        
        Returns:
            {
                'content': str,  # Main response
                'reasoning': str | None,  # Reasoning content
                'analysis': str | None,  # Analysis channel content
                'tool_calls': List[Dict],  # Tool calls if any
            }
        """
        result = {
            'content': response,
            'reasoning': None,
            'analysis': None,
            'commentary': None,
            'tool_calls': [],
        }
        
        # Extract reasoning blocks
        reasoning_blocks = []
        for pattern in cls.REASONING_PATTERNS:
            matches = re.findall(pattern, response, re.DOTALL)
            reasoning_blocks.extend(matches)
        
        if reasoning_blocks:
            result['reasoning'] = '\n\n'.join(block.strip() for block in reasoning_blocks)
            # Remove reasoning from main content
            content = response
            for pattern in cls.REASONING_PATTERNS:
                content = re.sub(pattern, '', content, flags=re.DOTALL)
            result['content'] = content.strip()
        
        # Extract analysis channel
        analysis_match = re.search(
            r'<\|analysis\|>(.*?)<\|/analysis\|>', 
            response, 
            re.DOTALL
        )
        if analysis_match:
            result['analysis'] = analysis_match.group(1).strip()
        
        # Extract commentary channel
        commentary_match = re.search(
            r'<\|commentary\|>(.*?)<\|/commentary\|>', 
            response, 
            re.DOTALL
        )
        if commentary_match:
            result['commentary'] = commentary_match.group(1).strip()
        
        # Extract tool calls
        tool_pattern = r'<\|tool\|>(.*?)<\|/tool\|>'
        tool_matches = re.findall(tool_pattern, response, re.DOTALL)
        for match in tool_matches:
            try:
                import json
                tool_data = json.loads(match.strip())
                result['tool_calls'].append(tool_data)
            except:
                result['tool_calls'].append({'raw': match.strip()})
        
        return result
    
    @classmethod
    def get_system_prompt_for_facts(cls) -> str:
        """
        Get system prompt that helps model understand it needs to use 
        current knowledge and tools to access factual world information
        """
        return """You are an AI assistant with access to the current world.
Your knowledge has a cutoff date, but you can:
1. Use tools to browse the web for current information
2. Use Python interpreter for calculations and data analysis
3. Indicate when information might be outdated

When answering questions about current events, recent developments, or time-sensitive information:
- Acknowledge your knowledge limitations if you cannot verify current status
- Use available tools to get current information when possible
- Clearly distinguish between factual knowledge and inferred information

Format mathematical expressions using LaTeX syntax: $...$ for inline, $$...$$ for display.
Format code blocks with appropriate language tags for syntax highlighting.
"""
    
    @classmethod
    def enhance_prompt_for_current_knowledge(cls, prompt: str) -> str:
        """
        Enhance user prompt to encourage using current knowledge/tools
        """
        # Add timestamp context
        from datetime import datetime
        current_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        
        enhanced = f"""[Current time: {current_time}]

When responding to this query, please:
- Use tools (browse, Python) if you need current/real-time information
- For math problems, show step-by-step reasoning with LaTeX formatting
- For code, provide complete, runnable examples with explanations

User query: {prompt}
"""
        return enhanced
    
    @classmethod
    def detect_code_language(cls, code: str) -> str:
        """Detect programming language from code snippet"""
        patterns = {
            'python': [
                r'^\s*(import|from)\s+\w+',
                r'^\s*def\s+\w+\s*\(',
                r'^\s*class\s+\w+',
                r'print\s*\(',
            ],
            'javascript': [
                r'const\s+\w+\s*=',
                r'let\s+\w+\s*=',
                r'function\s+\w+\s*\(',
                r'=>\s*\{',
                r'console\.log',
            ],
            'typescript': [
                r':\s*(string|number|boolean|any)\s*[;,=)]',
                r'interface\s+\w+',
                r'type\s+\w+\s*=',
            ],
            'rust': [
                r'^\s*fn\s+\w+',
                r'^\s*let\s+mut\s+',
                r'^\s*use\s+\w+::',
            ],
            'go': [
                r'^\s*func\s+\w+',
                r'^\s*package\s+\w+',
            ],
            'java': [
                r'^\s*public\s+(class|static|void)',
                r'System\.out\.print',
            ],
            'cpp': [
                r'^\s*#include',
                r'std::',
                r'int\s+main\s*\(',
            ],
        }
        
        for lang, patterns_list in patterns.items():
            for pattern in patterns_list:
                if re.search(pattern, code, re.MULTILINE):
                    return lang
        
        return 'text'
    
    @classmethod
    def format_math_expressions(cls, text: str) -> str:
        """
        Ensure math expressions are properly formatted for LaTeX rendering
        
        Converts common math notations to LaTeX:
        - x^2 -> $x^2$
        - sin(x) -> $\sin(x)$
        - Integrals, summations, etc.
        """
        # Already in LaTeX format
        if '$' in text or '\\(' in text or '\\[' in text:
            return text
        
        # Common math patterns to convert
        conversions = [
            # Powers: x^2, a_n
            (r'(?<![\$\\\w])([a-zA-Z])\^([0-9n])', r'$\1^\2$'),
            # Subscripts: a_n
            (r'(?<![\$\\\w])([a-zA-Z])_([0-9n])', r'$\1_\2$'),
            # Functions
            (r'(?<![\$\\\w])(sin|cos|tan|log|ln|exp|sqrt)\s*\(', r'$\\\1('),
            # Fractions
            (r'(\d+)/(\d+)(?![\d/])', r'$\frac{\1}{\2}$'),
        ]
        
        result = text
        for pattern, replacement in conversions:
            result = re.sub(pattern, replacement, result)
        
        return result


# Singleton instance
gptoss_service = GPTOSSService()
