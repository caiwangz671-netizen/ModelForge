export type ComputerUseSessionStatus =
  | 'idle'
  | 'running'
  | 'waiting_approval'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type ComputerUseApprovalMode = 'review_all' | 'hands_free';

export interface ComputerUseAction {
  id: string;
  tool_name: string;
  risk_level: string;
  input_payload: Record<string, unknown>;
  output_payload: Record<string, unknown>;
  status: string;
  requires_approval: boolean;
  error?: string | null;
  created_at?: number;
  updated_at?: number;
}

export interface ComputerUseApproval {
  id: string;
  action_id: string;
  tool_name: string;
  status: string;
  reason?: string | null;
  edited_input?: Record<string, unknown> | null;
  created_at?: number;
  resolved_at?: number | null;
}

export interface ComputerUseArtifact {
  id: string;
  kind: string;
  mime_type: string;
  summary?: string | null;
  created_at?: number;
  url: string;
}

export interface ComputerUseSession {
  id: string;
  model: string;
  goal: string;
  approval_mode: ComputerUseApprovalMode;
  parent_session_id?: string | null;
  cwd: string;
  allowed_paths: string[];
  status: ComputerUseSessionStatus;
  latest_artifact_id?: string | null;
  latest_artifact_url?: string | null;
  latest_screen_summary?: string | null;
  thinking_text: string;
  assistant_text: string;
  error?: string | null;
  created_at?: number;
  updated_at?: number;
  started_at?: number | null;
  completed_at?: number | null;
  actions: ComputerUseAction[];
  approvals: ComputerUseApproval[];
  artifacts: ComputerUseArtifact[];
}

export interface ComputerUseSessionListItem {
  id: string;
  model: string;
  goal: string;
  approval_mode: ComputerUseApprovalMode;
  parent_session_id?: string | null;
  status: ComputerUseSessionStatus;
  latest_artifact_id?: string | null;
  latest_artifact_url?: string | null;
  error?: string | null;
  created_at?: number;
  updated_at?: number;
  started_at?: number | null;
  completed_at?: number | null;
}

export interface ComputerUseStatusPayload {
  desktop_mode: boolean;
  desktop_available: boolean;
  snapshot_available?: boolean;
  controlled_browser_available?: boolean;
  helper: {
    ok?: boolean;
    error?: string;
    desktop_available?: boolean;
    snapshot_available?: boolean;
    controlled_browser_available?: boolean;
    limitations?: string[];
    permissions?: {
      accessibility?: boolean;
      screen_recording?: boolean;
    };
  };
  ocr: {
    available: boolean;
    source?: 'ollama' | 'local' | 'none';
    local_engine_available?: boolean;
    local_engine_name?: string;
    installed_model_available?: boolean;
    installed_models?: string[];
    selected_model?: string | null;
    recommended: string;
    install_hint: string;
    fallback_install_hint?: string;
  };
  recommended_ocr: {
    name: string;
    install_hint: string;
    fallback_name?: string;
    fallback_install_hint?: string;
  };
  default_cwd: string;
  default_allowed_paths: string[];
}

export interface ComputerUseStreamEvent {
  type: string;
  delta?: string;
  error?: string;
  session?: ComputerUseSession;
  action?: ComputerUseAction;
  approval?: {
    id: string;
    action_id: string;
    tool_name: string;
    reason?: string | null;
    metadata?: Record<string, unknown>;
    input_payload?: Record<string, unknown>;
  };
  approval_id?: string;
  status?: string;
  edited_input?: Record<string, unknown>;
  reason?: string;
}
