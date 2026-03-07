/// <reference types="vite/client" />

interface Window {
  desktopInfo?: {
    isDesktop?: boolean;
    pickDirectories?: (options?: { multiple?: boolean }) => Promise<string[]>;
  };
}
