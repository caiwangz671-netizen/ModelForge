import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './i18n'  // Initialize i18n before app renders
import './index.css'
import App from './App.tsx'

  // Apply saved theme BEFORE React mounts to avoid flash of wrong theme.
  ; (() => {
    const saved = localStorage.getItem('theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const isDark = saved === 'dark' || (saved === null && prefersDark);
    if (isDark) document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
  })()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
