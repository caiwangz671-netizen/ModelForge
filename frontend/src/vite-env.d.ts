/// <reference types="vite/client" />

interface Window {
  desktopInfo?: {
    isDesktop?: boolean;
    pickDirectories?: (options?: { multiple?: boolean }) => Promise<string[]>;
    getOllamaStatus?: () => Promise<{
      platform: string;
      installed: boolean;
      running: boolean;
      host?: string;
      install_state?: string;
      install_started_at?: number | null;
      install_completed_at?: number | null;
      install_command?: string;
      download_url?: string;
      recommended_model?: string;
      background?: boolean;
      last_error?: string | null;
    }>;
    installOllama?: (options?: { background?: boolean }) => Promise<{
      platform: string;
      installed: boolean;
      running: boolean;
      host?: string;
      install_state?: string;
      install_started_at?: number | null;
      install_completed_at?: number | null;
      install_command?: string;
      download_url?: string;
      recommended_model?: string;
      background?: boolean;
      last_error?: string | null;
    }>;
    openExternal?: (targetUrl: string) => Promise<boolean>;
  };
}
