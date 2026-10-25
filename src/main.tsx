import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { InstallOnlyPage } from './components/InstallOnlyPage.tsx';
import { detectRunningInApp } from './hooks/usePWAInstall.ts';
import { LanguageProvider } from './i18n.tsx';
import './index.css';

function shouldShowDedicatedInstallerPage(): boolean {
  if (typeof window === 'undefined') return false;

  const inApp = detectRunningInApp();
  const path = window.location.pathname.toLowerCase().replace(/\/+$/, '');
  const params = new URLSearchParams(window.location.search);
  const explicitInstallRoute =
    path === '/instaluj' ||
    path === '/install' ||
    path === '/pobierz' ||
    params.get('install') === 'only' ||
    params.get('install') === '1';

  // Installed standalone mobile app: always launch Swappy directly, never show installer
  if (inApp) {
    if (explicitInstallRoute) {
      window.history.replaceState(null, '', '/');
    }
    return false;
  }

  return explicitInstallRoute;
}

const showMobileInstallerGate = shouldShowDedicatedInstallerPage();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LanguageProvider>
      <ErrorBoundary>
        {showMobileInstallerGate ? <InstallOnlyPage /> : <App />}
      </ErrorBoundary>
    </LanguageProvider>
  </StrictMode>
);
