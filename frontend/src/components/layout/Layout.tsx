import { Link, useLocation } from 'react-router-dom';
import {
  Home,
  MessageSquare,
  Download,
  Brain,
  Settings,
  Menu,
  X,
  MonitorSmartphone,
} from 'lucide-react';
import { AnimatePresence, LayoutGroup, motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';

const navItems = [
  { path: '/', labelKey: 'nav.home', icon: Home },
  { path: '/models', labelKey: 'nav.models', icon: Brain },
  { path: '/chat', labelKey: 'nav.chat', icon: MessageSquare },
  { path: '/downloads', labelKey: 'nav.downloads', icon: Download },
  { path: '/computer-use', labelKey: 'nav.computerUse', icon: MonitorSmartphone },
  { path: '/memory', labelKey: 'nav.memory', icon: Brain },
  { path: '/settings', labelKey: 'nav.settings', icon: Settings },
];

interface LayoutProps {
  children: React.ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { t } = useTranslation();
  const isChatPage = location.pathname === '/chat';
  const isComputerUsePage = location.pathname === '/computer-use';

  return (
    <div className="relative flex h-screen flex-col overflow-hidden bg-background">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <motion.div
          className="absolute -top-24 left-[12%] h-[320px] w-[320px] rounded-full bg-[radial-gradient(circle,rgba(14,165,233,0.14),transparent_70%)] blur-3xl dark:bg-[radial-gradient(circle,rgba(34,211,238,0.16),transparent_70%)]"
          animate={{ x: [0, 42, -18, 0], y: [0, 26, -12, 0], scale: [1, 1.06, 0.97, 1] }}
          transition={{ duration: 24, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute right-[-80px] top-[18%] h-[360px] w-[360px] rounded-full bg-[radial-gradient(circle,rgba(15,23,42,0.09),transparent_72%)] blur-3xl dark:bg-[radial-gradient(circle,rgba(59,130,246,0.12),transparent_72%)]"
          animate={{ x: [0, -34, 16, 0], y: [0, -18, 12, 0], scale: [1, 0.97, 1.05, 1] }}
          transition={{ duration: 28, repeat: Infinity, ease: 'easeInOut' }}
        />
      </div>

      {/* Mobile header */}
      <div className="relative z-10 border-b border-border/70 bg-background/80 p-4 backdrop-blur lg:hidden">
        <h1 className="text-xl font-bold">ModelForge</h1>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setSidebarOpen(!sidebarOpen)}
        >
          {sidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </Button>
      </div>

      <div className="relative z-10 flex flex-1 min-h-0">
        {/* Sidebar */}
        <aside
          className={cn(
            'fixed inset-y-0 left-0 z-50 w-64 border-r shadow-[0_30px_80px_-70px_rgba(15,23,42,0.35)] backdrop-blur-xl transform transition-transform duration-300 ease-out',
            isComputerUsePage
              ? 'border-white/10 bg-[linear-gradient(180deg,rgba(5,12,25,0.9),rgba(3,9,20,0.96))]'
              : 'border-border/70 bg-background/82 dark:bg-[linear-gradient(180deg,rgba(9,15,28,0.94),rgba(7,12,22,0.98))] dark:shadow-[0_30px_80px_-70px_rgba(2,6,23,0.85)]',
            'lg:translate-x-0',
            sidebarOpen ? 'translate-x-0' : '-translate-x-full',
          )}
        >
          <div className="p-6">
            <h1 className="text-2xl font-bold hidden lg:block">ModelForge</h1>
          </div>

          <nav className="px-4 space-y-1">
            <LayoutGroup id="sidebar-navigation">
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = location.pathname === item.path;

                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    onClick={() => setSidebarOpen(false)}
                    className={cn(
                      'relative block overflow-hidden rounded-xl px-3 py-2 text-sm font-medium transition-colors',
                      isActive
                        ? 'text-primary-foreground'
                        : isComputerUsePage
                          ? 'text-slate-400 hover:text-slate-50'
                          : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {isActive && (
                      <motion.span
                        layoutId="sidebar-active-pill"
                        className="absolute inset-0 rounded-xl bg-primary shadow-[0_18px_40px_-30px_rgba(15,23,42,0.9)]"
                        transition={{ type: 'spring', stiffness: 360, damping: 32, mass: 0.7 }}
                      />
                    )}
                    <motion.span
                      whileHover={{ x: isActive ? 0 : 3 }}
                      whileTap={{ scale: 0.985 }}
                      className="relative flex items-center gap-3"
                    >
                      <Icon className="h-5 w-5" />
                      {t(item.labelKey)}
                    </motion.span>
                  </Link>
                );
              })}
            </LayoutGroup>
          </nav>
        </aside>

        {/* Overlay for mobile */}
        <AnimatePresence>
          {sidebarOpen && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.22, ease: 'easeOut' }}
              className="fixed inset-0 z-40 bg-slate-950/40 backdrop-blur-[2px] lg:hidden"
              onClick={() => setSidebarOpen(false)}
            />
          )}
        </AnimatePresence>

        {/* Main content */}
        <main className={cn(
          'flex-1 min-h-0 overflow-y-auto lg:ml-64',
          isComputerUsePage
            ? 'bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.08),transparent_24%),radial-gradient(circle_at_80%_0%,rgba(59,130,246,0.1),transparent_22%),linear-gradient(180deg,#020617_0%,#030916_100%)]'
            : 'bg-background dark:bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.06),transparent_22%),radial-gradient(circle_at_82%_0%,rgba(59,130,246,0.08),transparent_20%),linear-gradient(180deg,#070d18_0%,#050912_100%)]',
        )}>
          <motion.div
            layout
            transition={{ layout: { duration: 0.36, ease: [0.22, 1, 0.36, 1] } }}
            className={cn(
              "h-full p-6 transition-all duration-300 lg:p-8",
              isChatPage
                ? ""
                : isComputerUsePage
                  ? "mx-auto w-full max-w-[1560px]"
                  : "mx-auto w-full max-w-6xl"
            )}
          >
            {children}
          </motion.div>
        </main>
      </div>
    </div>
  );
}
