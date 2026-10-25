import { useCallback, useEffect, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

declare global {
  interface Window {
    __swappyDeferredPrompt?: BeforeInstallPromptEvent | null;
    __swappyInstalled?: boolean;
    __swappyRunningInApp?: boolean;
  }
}

// Register service worker immediately and force updates
if (typeof window !== 'undefined') {
  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      void updateSW(true);
    },
  });

  if ('serviceWorker' in navigator) {
    void navigator.serviceWorker
      .getRegistrations()
      .then((registrations) => {
        for (const reg of registrations) {
          void reg.update().catch(() => {});
        }
      })
      .catch(() => {});
  }
}

export function getDedicatedInstallUrl(withAutoFlag = false): string {
  if (typeof window === 'undefined') return '/instaluj';
  return `${window.location.origin}/instaluj${withAutoFlag ? '?auto=1' : ''}`;
}

export function detectInIframe(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

export function getChromeIntentUrl(targetUrl?: string): string {
  if (typeof window === 'undefined') return '/instaluj';
  const fullUrl = targetUrl || getDedicatedInstallUrl(true);
  try {
    const parsed = new URL(fullUrl, window.location.origin);
    const scheme = parsed.protocol.replace(':', '') || 'https';
    const pathAndQuery = `${parsed.host}${parsed.pathname}${parsed.search}`;
    return `intent://${pathAndQuery}#Intent;scheme=${scheme};package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(parsed.href)};end`;
  } catch {
    return fullUrl;
  }
}

export async function copyTextSafe(text: string): Promise<boolean> {
  if (typeof window === 'undefined') return false;

  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Blocked by iframe permissions policy — fall through to textarea copy
    }
  }

  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', 'true');
    textarea.style.position = 'fixed';
    textarea.style.top = '-9999px';
    textarea.style.left = '-9999px';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    const copiedOk = document.execCommand('copy');
    document.body.removeChild(textarea);
    return copiedOk;
  } catch {
    return false;
  }
}

/**
 * Returns true ONLY when the user is running Swappy inside the installed app
 * (PWA standalone / fullscreen / minimal-ui / window-controls-overlay, iOS Home Screen app,
 * Android TWA WebAPK, or launched from Home Screen start_url `/?pwa=1`).
 * Returns false when visiting the website in a browser tab or web preview.
 */
export function detectRunningInApp(): boolean {
  if (typeof window === 'undefined') return false;

  // Installed standalone apps never run inside an iframe
  if (detectInIframe()) {
    return false;
  }

  if (window.__swappyRunningInApp === true) {
    return true;
  }

  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('pwa') === '1' || params.get('mode') === 'standalone') {
      window.__swappyRunningInApp = true;
      sessionStorage.setItem('swappy_running_in_app', '1');
      return true;
    }
    if (sessionStorage.getItem('swappy_running_in_app') === '1') {
      window.__swappyRunningInApp = true;
      return true;
    }
  } catch {
    // Ignore storage access errors
  }

  const standaloneMatched =
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    window.matchMedia('(display-mode: minimal-ui)').matches ||
    window.matchMedia('(display-mode: window-controls-overlay)').matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true ||
    document.referrer.startsWith('android-app://');

  if (standaloneMatched) {
    window.__swappyRunningInApp = true;
    try {
      sessionStorage.setItem('swappy_running_in_app', '1');
    } catch {
      // Ignore storage access errors
    }
    return true;
  }

  return false;
}

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(() =>
    typeof window !== 'undefined' ? window.__swappyDeferredPrompt ?? null : null
  );
  const [isRunningInApp, setIsRunningInApp] = useState<boolean>(() => detectRunningInApp());
  const [justInstalled, setJustInstalled] = useState<boolean>(() =>
    typeof window !== 'undefined' ? Boolean(window.__swappyInstalled) : false
  );
  const [isIOS, setIsIOS] = useState(false);
  const [isAndroid, setIsAndroid] = useState(false);
  const [isInIframe, setIsInIframe] = useState(false);
  const [isInAppBrowser, setIsInAppBrowser] = useState(false);
  const [swReady, setSwReady] = useState(false);

  useEffect(() => {
    const inAppNow = detectRunningInApp();
    setIsRunningInApp(inAppNow);
    if (window.__swappyInstalled) {
      setJustInstalled(true);
    }

    if (window.__swappyDeferredPrompt) {
      setDeferredPrompt(window.__swappyDeferredPrompt);
    }

    const ua = window.navigator.userAgent || '';
    const uaLower = ua.toLowerCase();

    const iosDetected =
      /iphone|ipad|ipod/.test(uaLower) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const androidDetected = /android/i.test(ua);

    setIsIOS(iosDetected);
    setIsAndroid(androidDetected);

    let iframeDetected = false;
    try {
      iframeDetected = window.self !== window.top;
    } catch {
      iframeDetected = true;
    }
    setIsInIframe(iframeDetected);

    // Detect in-app social WebViews (Messenger, Facebook, Instagram, TikTok, Google App GSA, etc.)
    const inAppBrowserDetected =
      !inAppNow &&
      (/;\s*wv\)|FBAN|FBAV|Instagram|Line\/|BytedanceWebview|TikTok|Snapchat|GSA\/|CriOS.*GSA/i.test(
        ua
      ) ||
        (androidDetected && !/Chrome\/\d+|Firefox\/\d+|SamsungBrowser\/\d+|EdgA\/\d+/i.test(ua)));
    setIsInAppBrowser(inAppBrowserDetected);

    if ('serviceWorker' in navigator) {
      void navigator.serviceWorker.ready
        .then(() => {
          setSwReady(true);
        })
        .catch(() => {});
    }

    const syncPromptFromWindow = () => {
      if (window.__swappyDeferredPrompt) {
        setDeferredPrompt(window.__swappyDeferredPrompt);
      }
    };

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      const promptEvent = e as BeforeInstallPromptEvent;
      window.__swappyDeferredPrompt = promptEvent;
      setDeferredPrompt(promptEvent);
    };

    const handleAppInstalled = () => {
      window.__swappyDeferredPrompt = null;
      window.__swappyInstalled = true;
      setJustInstalled(true);
      setDeferredPrompt(null);
    };

    const standaloneQueries = [
      window.matchMedia('(display-mode: standalone)'),
      window.matchMedia('(display-mode: fullscreen)'),
      window.matchMedia('(display-mode: minimal-ui)'),
      window.matchMedia('(display-mode: window-controls-overlay)'),
    ];

    const handleDisplayModeChange = () => {
      if (detectRunningInApp()) {
        setIsRunningInApp(true);
      }
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('swappy:beforeinstallprompt', syncPromptFromWindow);
    window.addEventListener('appinstalled', handleAppInstalled);
    window.addEventListener('swappy:appinstalled', handleAppInstalled);
    for (const mq of standaloneQueries) {
      mq.addEventListener('change', handleDisplayModeChange);
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('swappy:beforeinstallprompt', syncPromptFromWindow);
      window.removeEventListener('appinstalled', handleAppInstalled);
      window.removeEventListener('swappy:appinstalled', handleAppInstalled);
      for (const mq of standaloneQueries) {
        mq.removeEventListener('change', handleDisplayModeChange);
      }
    };
  }, []);

  const triggerPrompt = useCallback(
    async (promptEvent: BeforeInstallPromptEvent): Promise<'accepted' | 'dismissed'> => {
      await promptEvent.prompt();
      const { outcome } = await promptEvent.userChoice;
      if (outcome === 'accepted') {
        window.__swappyDeferredPrompt = null;
        window.__swappyInstalled = true;
        setJustInstalled(true);
        setDeferredPrompt(null);
        return 'accepted';
      }
      return 'dismissed';
    },
    []
  );

  const install = useCallback(async (): Promise<boolean> => {
    const activePrompt = deferredPrompt || window.__swappyDeferredPrompt || null;
    if (activePrompt) {
      const outcome = await triggerPrompt(activePrompt);
      return outcome === 'accepted';
    }
    return false;
  }, [deferredPrompt, triggerPrompt]);

  const waitAndInstall = useCallback(async (): Promise<'accepted' | 'dismissed' | 'unavailable'> => {
    const immediate = deferredPrompt || window.__swappyDeferredPrompt || null;
    if (immediate) {
      return triggerPrompt(immediate);
    }

    const delayed = await new Promise<BeforeInstallPromptEvent | null>((resolve) => {
      let settled = false;
      const onReady = () => {
        if (settled) return;
        const found = window.__swappyDeferredPrompt ?? null;
        if (found) {
          settled = true;
          cleanup();
          resolve(found);
        }
      };
      const timer = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(window.__swappyDeferredPrompt ?? null);
      }, 1500);

      function cleanup() {
        window.clearTimeout(timer);
        window.removeEventListener('swappy:beforeinstallprompt', onReady);
        window.removeEventListener('beforeinstallprompt', onReady);
      }

      window.addEventListener('swappy:beforeinstallprompt', onReady);
      window.addEventListener('beforeinstallprompt', onReady);
    });

    if (delayed) {
      return triggerPrompt(delayed);
    }

    return 'unavailable';
  }, [deferredPrompt, triggerPrompt]);

  return {
    isInstallable: Boolean(deferredPrompt),
    isRunningInApp,
    isInstalled: isRunningInApp || justInstalled,
    isIOS,
    isAndroid,
    isInIframe,
    isInAppBrowser,
    swReady,
    install,
    waitAndInstall,
  };
}

export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return isOnline;
}
