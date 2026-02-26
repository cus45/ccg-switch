import { createHashRouter, RouterProvider } from 'react-router-dom';
import './App.css';
import Layout from './components/layout/Layout';
import Dashboard from './pages/Dashboard';
import { lazy, Suspense } from 'react';
import ThemeManager from './components/common/ThemeManager';
import { useEffect } from 'react';
import { useConfigStore } from './stores/useConfigStore';
import { useTokenStore } from './stores/useTokenStore';
import { useTranslation } from 'react-i18next';

// 懒加载非首屏页面，减少 Dashboard 切换到其他页面时的渲染开销
const ClaudePage = lazy(() => import('./pages/ClaudePage'));
const McpPage = lazy(() => import('./pages/McpPage'));
const PromptsPage = lazy(() => import('./pages/PromptsPage'));
const SkillsPage = lazy(() => import('./pages/SkillsPage'));
const SubagentsPage = lazy(() => import('./pages/SubagentsPage'));
const WorkspacesPage = lazy(() => import('./pages/WorkspacesPage'));
const Settings = lazy(() => import('./pages/Settings'));

function SuspenseWrapper({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<div className="h-full w-full flex items-center justify-center"><span className="loading loading-spinner loading-sm"></span></div>}>{children}</Suspense>;
}

const router = createHashRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      {
        index: true,
        element: <Dashboard />,
      },
      {
        path: 'claude',
        element: <SuspenseWrapper><ClaudePage /></SuspenseWrapper>,
      },
      {
        path: 'workspaces',
        element: <SuspenseWrapper><WorkspacesPage /></SuspenseWrapper>,
      },
      {
        path: 'mcp',
        element: <SuspenseWrapper><McpPage /></SuspenseWrapper>,
      },
      {
        path: 'prompts',
        element: <SuspenseWrapper><PromptsPage /></SuspenseWrapper>,
      },
      {
        path: 'skills',
        element: <SuspenseWrapper><SkillsPage /></SuspenseWrapper>,
      },
      {
        path: 'subagents',
        element: <SuspenseWrapper><SubagentsPage /></SuspenseWrapper>,
      },
      {
        path: 'settings',
        element: <SuspenseWrapper><Settings /></SuspenseWrapper>,
      },
    ],
  },
]);

function App() {
  const { config, loadConfig } = useConfigStore();
  const { i18n } = useTranslation();

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  // Sync language from config
  useEffect(() => {
    if (config?.language) {
      i18n.changeLanguage(config.language);
    }
  }, [config?.language, i18n]);

  // 预热 Claude token 数据，减少从 Dashboard 切换时的首屏卡顿
  useEffect(() => {
    const warmup = () => {
      void useTokenStore.getState().loadTokens();
    };

    if ('requestIdleCallback' in window) {
      const idleId = (window as any).requestIdleCallback(warmup, { timeout: 1500 });
      return () => (window as any).cancelIdleCallback?.(idleId);
    }

    const timer = globalThis.setTimeout(warmup, 300);
    return () => globalThis.clearTimeout(timer);
  }, []);

  return (
    <>
      <ThemeManager />
      <RouterProvider router={router} />
    </>
  );
}

export default App;
