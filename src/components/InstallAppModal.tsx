import React, { useEffect, useState } from 'react';
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  Loader2,
  MoreVertical,
  Share2,
  Smartphone,
  WifiOff,
  X,
} from 'lucide-react';
import QRCode from 'qrcode';
import {
  copyTextSafe,
  getChromeIntentUrl,
  getDedicatedInstallUrl,
  useOnlineStatus,
  usePWAInstall,
} from '../hooks/usePWAInstall';
import { useLanguage } from '../i18n';
import { SwappyLogo } from './SwappyLogo';

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();
  if (isOnline) return null;

  return (
    <div className="absolute top-14 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-xl bg-amber-500/95 px-3.5 py-2 text-xs font-semibold text-slate-950 shadow-lg backdrop-blur-md whitespace-nowrap">
      <WifiOff className="w-4 h-4 shrink-0" />
      <span>Tryb offline · wyświetlane są zapisane filmy</span>
    </div>
  );
};

interface WebsiteInstallBannerProps {
  dismissed: boolean;
  onDismiss: () => void;
  onOpenModal: () => void;
}

/**
 * Single Website-Only Install Prompt.
 * Shown ONLY on the web page (browser / preview) and NEVER inside the installed application.
 */
export const WebsiteInstallBanner: React.FC<WebsiteInstallBannerProps> = ({
  dismissed,
  onDismiss,
  onOpenModal,
}) => {
  const { t } = useLanguage();
  const {
    isInstallable,
    isRunningInApp,
    isInstalled,
    isIOS,
    isInIframe,
    isInAppBrowser,
    install,
    waitAndInstall,
  } = usePWAInstall();

  const [isInstalling, setIsInstalling] = useState(false);
  const [iconFailed, setIconFailed] = useState(false);

  // Strictly NEVER render inside the installed standalone app, after installation, or once dismissed
  if (isRunningInApp || isInstalled || dismissed) {
    return null;
  }

  const handleInstallAction = async () => {
    // When native prompt is immediately ready in top-level Chromium, trigger 1-click OS install
    if (isInstallable && !isInIframe && !isInAppBrowser && !isIOS) {
      setIsInstalling(true);
      try {
        const accepted = await install();
        if (!accepted) {
          onOpenModal();
        }
      } finally {
        setIsInstalling(false);
      }
      return;
    }

    // Try waiting briefly if top-level Android/Desktop browser hasn't fired beforeinstallprompt yet
    if (!isInIframe && !isInAppBrowser && !isIOS) {
      setIsInstalling(true);
      try {
        const outcome = await waitAndInstall();
        if (outcome === 'unavailable') {
          onOpenModal();
        }
      } finally {
        setIsInstalling(false);
      }
      return;
    }

    // In iframe preview, iOS Safari, or social WebView: open the full install sheet with direct action & QR
    onOpenModal();
  };

  return (
    <div
      role="region"
      aria-label={t('installApp')}
      className="absolute top-13 inset-x-2.5 z-30 rounded-2xl bg-[#141418]/95 border border-white/15 p-2.5 text-white shadow-2xl backdrop-blur-md"
    >
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onOpenModal}
          className="flex items-center gap-2.5 min-w-0 text-left cursor-pointer"
        >
          <div className="w-9 h-9 rounded-xl bg-[#0A0A0C] border border-white/15 overflow-hidden flex items-center justify-center shrink-0">
            {!iconFailed ? (
              <img
                src="/pwa-192x192.png"
                alt="Swappy"
                referrerPolicy="no-referrer"
                onError={() => setIconFailed(true)}
                className="w-full h-full object-cover"
              />
            ) : (
              <SwappyLogo showWordmark={false} size="sm" />
            )}
          </div>
          <div className="min-w-0">
            <div className="text-xs font-extrabold text-white truncate">
              {t('installApp')} · Swappy
            </div>
            <div className="text-[11px] text-zinc-400 truncate">
              {t('installBannerSub')}
            </div>
          </div>
        </button>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={handleInstallAction}
            disabled={isInstalling}
            className="min-h-[36px] px-3 rounded-xl bg-[#FE2C55] hover:bg-[#e6254b] disabled:opacity-75 active:scale-95 transition-all text-xs font-extrabold text-white flex items-center gap-1.5 whitespace-nowrap shadow-md cursor-pointer"
          >
            {isInstalling ? (
              <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin" />
            ) : (
              <Download className="w-3.5 h-3.5 shrink-0" />
            )}
            <span>{t('downloadBtn')}</span>
          </button>

          <button
            type="button"
            onClick={onDismiss}
            aria-label="Ukryj pasek instalacji"
            className="min-h-[34px] min-w-[34px] rounded-xl text-zinc-400 hover:text-white hover:bg-white/10 flex items-center justify-center transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};

interface InstallAppModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const InstallAppModal: React.FC<InstallAppModalProps> = ({ isOpen, onClose }) => {
  const {
    isInstallable,
    isRunningInApp,
    isInstalled,
    isIOS,
    isAndroid,
    isInIframe,
    isInAppBrowser,
    waitAndInstall,
  } = usePWAInstall();

  const [isCheckingPrompt, setIsCheckingPrompt] = useState(false);
  const [showManualHint, setShowManualHint] = useState(false);
  const [copied, setCopied] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [iconFailed, setIconFailed] = useState(false);

  const installPageUrl =
    typeof window !== 'undefined' ? `${window.location.origin}/instaluj` : '/instaluj';
  const autoInstallUrl = getDedicatedInstallUrl(true);
  const chromeIntentUrl = getChromeIntentUrl(autoInstallUrl);

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    QRCode.toDataURL(installPageUrl, {
      width: 176,
      margin: 1,
      color: {
        dark: '#0A0A0C',
        light: '#FFFFFF',
      },
    })
      .then((url) => {
        if (active) setQrDataUrl(url);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [isOpen, installPageUrl]);

  if (!isOpen || isRunningInApp) {
    return null;
  }

  const needsExternalBrowserTab = !isInstalled && (isInIframe || isInAppBrowser);

  const handleDirectInstall = async () => {
    if (isIOS) {
      setShowManualHint(true);
      return;
    }

    setIsCheckingPrompt(true);
    try {
      const outcome = await waitAndInstall();
      if (outcome === 'accepted') {
        onClose();
      } else if (outcome === 'unavailable') {
        setShowManualHint(true);
      }
    } finally {
      setIsCheckingPrompt(false);
    }
  };

  const handleCopyLink = async () => {
    await copyTextSafe(installPageUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2200);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Zainstaluj aplikację Swappy"
      className="absolute inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-3"
    >
      <div className="w-full max-w-[400px] max-h-[88dvh] overflow-y-auto no-scrollbar rounded-3xl bg-[#141418] border border-white/15 p-5 text-white shadow-2xl space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-14 h-14 rounded-2xl bg-[#0A0A0C] border border-white/15 overflow-hidden flex items-center justify-center shrink-0">
              {!iconFailed ? (
                <img
                  src="/pwa-192x192.png"
                  alt="Swappy"
                  referrerPolicy="no-referrer"
                  onError={() => setIconFailed(true)}
                  className="w-full h-full object-cover"
                />
              ) : (
                <SwappyLogo showWordmark={false} size="md" />
              )}
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-extrabold text-white leading-tight">
                Zainstaluj aplikację Swappy
              </h2>
              <p className="text-xs text-zinc-400 mt-0.5">
                Ikona na ekranie telefonu · Android i iPhone
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Zamknij okno instalacji"
            className="min-h-[38px] min-w-[38px] rounded-xl bg-white/[0.07] hover:bg-white/[0.14] flex items-center justify-center text-zinc-300 cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {isInstalled ? (
          <div className="rounded-2xl bg-emerald-500/15 border border-emerald-500/35 p-4 text-center space-y-2">
            <div className="flex items-center justify-center gap-2 text-sm font-extrabold text-emerald-300">
              <Check className="w-4 h-4 shrink-0" />
              <span>Aplikacja Swappy jest już zainstalowana!</span>
            </div>
            <p className="text-xs text-zinc-300">
              Otwórz ją bezpośrednio z ikony Swappy na ekranie głównym swojego telefonu.
            </p>
          </div>
        ) : needsExternalBrowserTab ? (
          <div className="space-y-2.5">
            <a
              href={isAndroid && !isInIframe ? chromeIntentUrl : autoInstallUrl}
              target={isAndroid && !isInIframe ? '_top' : '_blank'}
              rel="noopener noreferrer"
              className="w-full min-h-[50px] rounded-2xl bg-[#FE2C55] hover:bg-[#e6254b] active:scale-[0.98] transition-all px-4 py-3 text-sm font-extrabold text-white flex items-center justify-center gap-2 shadow-lg whitespace-nowrap"
            >
              <Download className="w-4 h-4 shrink-0" />
              <span>Otwórz instalator w pełnym oknie</span>
              <ExternalLink className="w-3.5 h-3.5 shrink-0 opacity-90" />
            </a>
            <p className="text-[11px] text-zinc-400 text-center leading-relaxed">
              Kliknij przycisk powyżej, aby otworzyć pełny ekran przeglądarki i zainstalować aplikację jednym kliknięciem.
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            <button
              type="button"
              onClick={handleDirectInstall}
              disabled={isCheckingPrompt}
              className="w-full min-h-[50px] rounded-2xl bg-[#FE2C55] hover:bg-[#e6254b] disabled:opacity-75 active:scale-[0.98] transition-all px-4 py-3 text-sm font-extrabold text-white flex items-center justify-center gap-2 shadow-lg cursor-pointer whitespace-nowrap"
            >
              {isCheckingPrompt ? (
                <>
                  <Loader2 className="w-4 h-4 shrink-0 animate-spin" />
                  <span>Uruchamianie instalatora...</span>
                </>
              ) : (
                <>
                  <Download className="w-4 h-4 shrink-0" />
                  <span>
                    {isInstallable
                      ? 'Zainstaluj teraz (1 kliknięcie)'
                      : 'Zainstaluj aplikację Swappy'}
                  </span>
                </>
              )}
            </button>

            {(showManualHint || isIOS) && !isInstallable && (
              <div className="rounded-2xl bg-white/[0.06] border border-[#25F4EE]/35 p-3.5 text-xs text-zinc-200 leading-relaxed space-y-1.5">
                {isIOS ? (
                  <>
                    <div className="font-extrabold text-white flex items-center gap-1.5">
                      <Share2 className="w-3.5 h-3.5 text-[#25F4EE]" />
                      <span>Jak zainstalować na iPhone / iPad:</span>
                    </div>
                    <p>
                      1. Stuknij ikonę <strong>Udostępnij</strong> na pasku Safari.
                      <br />
                      2. Wybierz <strong>Dodaj do ekranu początkowego</strong>.
                    </p>
                  </>
                ) : (
                  <>
                    <div className="font-extrabold text-white flex items-center gap-1.5">
                      <MoreVertical className="w-3.5 h-3.5 text-[#25F4EE]" />
                      <span>Jak zainstalować z menu przeglądarki:</span>
                    </div>
                    <p>
                      1. Stuknij trzy kropki <strong>⋮</strong> w prawym górnym rogu Chrome.
                      <br />
                      2. Wybierz <strong>Zainstaluj aplikację</strong> (lub{' '}
                      <strong>Dodaj do ekranu głównego</strong>).
                    </p>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* QR Code + Copy Install Link for quick phone installation */}
        <div className="rounded-2xl bg-black/40 border border-white/10 p-3.5 space-y-3">
          <div className="flex items-center gap-3">
            {qrDataUrl && (
              <img
                src={qrDataUrl}
                alt="Kod QR pobrania Swappy"
                referrerPolicy="no-referrer"
                className="w-20 h-20 rounded-xl bg-white p-1.5 shrink-0"
              />
            )}
            <div className="min-w-0 space-y-1">
              <div className="text-xs font-extrabold text-[#25F4EE] flex items-center gap-1.5">
                <Smartphone className="w-3.5 h-3.5 shrink-0" />
                <span>Pobierz na telefon</span>
              </div>
              <p className="text-[11px] text-zinc-300 leading-snug">
                Zeskanuj kod QR aparatem telefonu albo skopiuj link instalacyjny poniżej.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="text"
              readOnly
              value={installPageUrl}
              aria-label="Link do instalacji aplikacji Swappy"
              className="flex-1 min-w-0 min-h-[38px] rounded-xl bg-black/60 border border-white/10 px-2.5 text-[11px] font-mono text-zinc-300 focus:outline-none"
            />
            <button
              type="button"
              onClick={handleCopyLink}
              className="min-h-[38px] px-3 rounded-xl bg-white text-black hover:bg-zinc-200 text-xs font-extrabold flex items-center gap-1.5 shrink-0 cursor-pointer whitespace-nowrap"
            >
              {copied ? (
                <Check className="w-3.5 h-3.5 text-emerald-600" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
              <span>{copied ? 'Skopiowano' : 'Kopiuj link'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
