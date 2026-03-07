// Model types
export interface Model {
  name: string;
  model?: string;
  description?: string;
  parameter_size?: string;
  quantization?: string;
  size?: number;
  digest?: string;
  modified_at?: string;
  capabilities?: {
    supports_reasoning?: boolean;
    supports_vision?: boolean;
    supports_ocr?: boolean;
    supports_tools?: boolean;
    supports_embedding?: boolean;
    supports_code?: boolean;
    is_multilingual?: boolean;
  };
}

export interface LibraryModel {
  name: string;
  slug: string;
  description: string;
  capabilities: string[];
  sizes: string[];
  pull_count?: string | null;
  tag_count?: number | null;
  updated?: string | null;
  library_url: string;
}

export interface LibraryModelTag {
  full_name: string;
  tag: string;
  is_latest: boolean;
  library_url: string;
}

// Download types
export type DownloadStatus = 'idle' | 'queued' | 'downloading' | 'paused' | 'completed' | 'failed' | 'cancelled';

export interface DownloadTask {
  id: string;
  model_name: string;
  model_version: string;
  status: DownloadStatus;
  progress: number;
  downloaded_size: number;
  total_size: number;
  speed: number;
  eta: number;
  status_text?: string;
  retry_count?: number;
  error: string | null;
  created_at: number;
  updated_at: number;
}

// Chat types
export interface RagReference {
  label?: string;
  memory_id?: string;
  category?: string;
  source_name?: string;
  source_type?: string;
  title?: string;
  url?: string;
  final_url?: string;
  chunk_index?: number;
  score?: number;
  overlap?: number;
  snippet?: string;
  display?: string;
  error?: string | null;
}

export type ToolCallType = 'web_search' | 'browser' | 'python' | 'calculator' | 'terminal';

export interface ToolCall {
  id: string;
  type: ToolCallType;
  name: string;
  input: Record<string, unknown>;
  output?: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  started_at?: string;
  completed_at?: string;
}

export interface Message {
  id?: string;
  role: 'system' | 'user' | 'assistant';
  content: string;
  thinking?: string;
  tool_calls?: ToolCall[];
  rag_references?: RagReference[];
  created_at?: number;
}

export interface Conversation {
  id: string;
  title: string;
  model: string;
  created_at: number;
  updated_at: number;
  messages?: Message[];
}

// Memory types
export type MemoryType = 'short_term' | 'long_term' | 'semantic' | 'episodic';

export interface MemoryItem {
  id: string;
  type: MemoryType;
  content: string;
  embedding?: number[];
  score?: number;
  metadata: {
    sessionId?: string;
    timestamp?: number;
    importance?: number;
    tags?: string[];
    [key: string]: unknown;
  };
  created_at: number;
  updated_at: number;
}

// System types
export interface SystemHealth {
  status: string;
  ollama: {
    status: string;
    version?: string;
  };
}
