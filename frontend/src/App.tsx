import { BrowserRouter, HashRouter, Routes, Route, useLocation } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import { PageTransition } from '@/components/layout/PageTransition';
import { Layout } from '@/components/layout/Layout';
import { Home } from '@/pages/Home';
import { Models } from '@/pages/Models';
import { Chat } from '@/pages/Chat';
import { Downloads } from '@/pages/Downloads';
import { Memory } from '@/pages/Memory';
import { Settings } from '@/pages/Settings';
import { ComputerUse } from '@/pages/ComputerUse';
import { MathTest } from '@/components/MathTest';
import { Toaster } from '@/components/ui/toaster';
import { FirstLaunchGuide } from '@/components/onboarding/FirstLaunchGuide';

function AnimatedRoutes() {
  const location = useLocation();

  return (
    <AnimatePresence mode="wait">
      <Routes location={location} key={location.pathname}>
        <Route path="/" element={<PageTransition><Home /></PageTransition>} />
        <Route path="/models" element={<PageTransition><Models /></PageTransition>} />
        <Route path="/chat" element={<PageTransition><Chat /></PageTransition>} />
        <Route path="/downloads" element={<PageTransition><Downloads /></PageTransition>} />
        <Route path="/memory" element={<PageTransition><Memory /></PageTransition>} />
        <Route path="/settings" element={<PageTransition><Settings /></PageTransition>} />
        <Route path="/computer-use" element={<PageTransition><ComputerUse /></PageTransition>} />
        <Route path="/test/math" element={<PageTransition><MathTest /></PageTransition>} />
      </Routes>
    </AnimatePresence>
  );
}

function App() {
  const Router = import.meta.env.VITE_DESKTOP === 'true' ? HashRouter : BrowserRouter;

  return (
    <Router>
      <Layout>
        <AnimatedRoutes />
      </Layout>
      <FirstLaunchGuide />
      <Toaster />
    </Router>
  );
}

export default App;
