/// <reference types="vite/client" />

interface Window {
  desktopInfo?: {
    platform?: string;
    isDesktop?: boolean;
    pickDirectories?: (options?: { multiple?: boolean }) => Promise<string[]>;
  };
}
