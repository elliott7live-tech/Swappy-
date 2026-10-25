import React, { useEffect, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  ExternalLink,
  Loader2,
  Share2,
  ShieldCheck,
  Smartphone,
} from 'lucide-react';
import QRCode from 'qrcode';
import {
  copyTextSafe,
  getChromeIntentUrl,
  getDedicatedInstallUrl,
  usePWAInstall,
} from '../hooks/usePWAInstall';
import { SwappyLogo } from './SwappyLogo';

export { getDedicatedInstallUrl };

export const InstallOnlyPage: React.FC = () => {
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

  const [installDone, setInstallDone] = useState(false);
  const [isCheckingPrompt, setIsCheckingPrompt] = useState(false);
  const [showBrowserMenuHint, setShowBrowserMenuHint] = useState(false);
  const [showShareDrawer, setShowShareDrawer] = useState(false);
  const [copied, setCopied] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [iconFailed, setIconFailed] = useState(false);

  const installUrl = getDedicatedInstallUrl(false);
  const autoInstallUrl = getDedicatedInstallUrl(true);
  const chromeIntentUrl = getChromeIntentUrl(autoInstallUrl);
  const isDesktopBrowser = !isAndroid && !isIOS && !isInIframe;

  // If opened from the installed Home Screen icon (standalone mode), launch the app
  useEffect(() => {
    if (isRunningInApp) {
      window.location.replace('/');
    }
  }, [isRunningInApp]);

  useEffect(() => {
    if (!showShareDrawer && !isDesktopBrowser) return;
    let active = true;
    QRCode.toDataURL(installUrl, {
      width: 200,
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
  }, [installUrl, showShareDrawer, isDesktopBrowser]);

  const handlePrimaryInstall = async () => {
    if (isIOS) {
      setShowBrowserMenuHint(true);
      return;
    }

    setIsCheckingPrompt(true);
    try {
      const result = await waitAndInstall();
      if (result === 'accepted') {
        setInstallDone(true);
        setShowBrowserMenuHint(false);
      } else if (result === 'unavailable') {
        setShowBrowserMenuHint(true);
      }
    } finally {
      setIsCheckingPrompt(false);
    }
  };

  const handleCopyInstallLink = async () => {
    await copyTextSafe(installUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2200);
  };

  const handleShareInstallLink = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Zainstaluj aplikację mobilną Swappy',
          text: 'Pobierz i zainstaluj aplikację mobilną Swappy na telefon:',
          url: installUrl,
        });
        return;
      } catch {
        // User dismissed share sheet
      }
    }
    setShowShareDrawer(true);
    await handleCopyInstallLink();
  };

  if (isRunningInApp) {
    return null;
  }

  const needsBreakoutToBrowser = !isInstalled && !installDone && (isInIframe || isInAppBrowser);

  return (
    <div className="relative min-h-dvh w-full bg-[#050507] text-white overflow-y-auto flex items-center justify-center px-4 py-8">
      <main className="w-full max-w-[420px] rounded-3xl bg-[#131318] border border-white/10 p-6 sm:p-7 shadow-2xl space-y-6">
        {/* App Identity Header */}
        <div className="flex flex-col items-center text-center space-y-3.5">
          <div className="w-24 h-24 rounded-[26px] bg-[#0A0A0C] border border-white/15 shadow-xl overflow-hidden flex items-center justify-center">
            {!iconFailed ? (
              <img
                src="/pwa-192x192.png"
                alt="Ikona aplikacji Swappy"
                referrerPolicy="no-referrer"
                onError={() => setIconFailed(true)}
                className="w-full h-full object-cover"
              />
            ) : (
              <SwappyLogo showWordmark={false} size="lg" />
            )}
          </div>

          <div className="space-y-1">
            <h1 className="text-2xl font-extrabold tracking-tight text-white">
              Swappy
            </h1>
            <p className="text-xs text-zinc-400">
              Aplikacja mobilna na telefon · Android · iPhone
            </p>
          </div>

          <div className="grid grid-cols-3 w-full pt-1 divide-x divide-white/10 text-center">
            <div>
              <div className="text-xs font-extrabold text-white">Tylko aplikacja</div>
              <div className="text-[10px] text-zinc-400">Bez wersji WWW</div>
            </div>
            <div>
              <div className="text-xs font-extrabold text-[#25F4EE]">LIVE + Filmy</div>
              <div className="text-[10px] text-zinc-400">Muzyka ze świata</div>
            </div>
            <div>
              <div className="text-xs font-extrabold text-white">Bezpłatna</div>
              <div className="text-[10px] text-zinc-400">Szybka instalacja</div>
            </div>
          </div>
        </div>

        {/* PRIMARY INSTALLATION / MOBILE-ONLY GATE */}
        <div className="space-y-3">
          {isInstalled || installDone ? (
            <div className="rounded-2xl bg-emerald-500/15 border border-emerald-500/35 p-4 text-center space-y-3">
              <div className="flex items-center justify-center gap-2 text-sm font-extrabold text-emerald-300">
                <Check className="w-5 h-5 text-emerald-400 shrink-0" />
                <span>Aplikacja Swappy zainstalowana!</span>
              </div>
              <p className="text-xs text-zinc-300 leading-relaxed">
                Otwórz aplikację <strong>Swappy</strong> bezpośrednio z ikony na ekranie głównym swojego telefonu.
              </p>
              <a
                href="/"
                className="w-full min-h-[48px] rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-extrabold text-sm flex items-center justify-center gap-2 transition-colors whitespace-nowrap"
              >
                <span>Otwórz aplikację Swappy</span>
              </a>
            </div>
          ) : isDesktopBrowser ? (
            <div className="rounded-2xl bg-white/[0.04] border border-white/10 p-4 space-y-4 text-center">
              <button
                type="button"
                onClick={handlePrimaryInstall}
                disabled={isCheckingPrompt}
                className="w-full min-h-[52px] rounded-2xl bg-[#FE2C55] hover:bg-[#e6254b] disabled:opacity-75 active:scale-[0.98] transition-all px-5 py-3.5 text-sm font-extrabold text-white flex items-center justify-center gap-2 shadow-xl cursor-pointer whitespace-nowrap"
              >
                {isCheckingPrompt ? (
                  <>
                    <Loader2 className="w-4 h-4 shrink-0 animate-spin" />
                    <span>Uruchamianie instalatora...</span>
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4 shrink-0" />
                    <span>Zainstaluj aplikację Swappy</span>
                  </>
                )}
              </button>

              {showBrowserMenuHint && !isInstallable && (
                <p className="text-xs text-zinc-300 bg-white/[0.06] border border-[#25F4EE]/35 rounded-xl p-3 leading-relaxed">
                  Kliknij ikonę instalacji w prawym rogu paska adresu przeglądarki (Chrome / Edge) lub menu <strong>⋮ → Zainstaluj Swappy</strong>.
                </p>
              )}

              <div className="flex items-center justify-center gap-2 text-xs font-extrabold text-[#25F4EE] pt-1">
                <Smartphone className="w-4 h-4 shrink-0" />
                <span>Lub zeskanuj kod QR telefonem</span>
              </div>

              {qrDataUrl && (
                <div className="flex justify-center">
                  <img
                    src={qrDataUrl}
                    alt="Kod QR pobrania aplikacji mobilnej Swappy"
                    referrerPolicy="no-referrer"
                    className="w-40 h-40 rounded-2xl bg-white p-2 shadow-lg"
                  />
                </div>
              )}

              <button
                type="button"
                onClick={handleCopyInstallLink}
                className="w-full min-h-[44px] rounded-xl bg-white/[0.08] hover:bg-white/[0.14] border border-white/10 text-xs font-extrabold text-white flex items-center justify-center gap-2 transition-colors cursor-pointer whitespace-nowrap"
              >
                {copied ? <Check className="w-4 h-4 shrink-0 text-emerald-400" /> : <Copy className="w-4 h-4 shrink-0" />}
                <span>{copied ? 'Skopiowano link na telefon' : 'Kopiuj link instalacyjny na telefon'}</span>
              </button>
            </div>
          ) : needsBreakoutToBrowser ? (
            <div className="space-y-2.5">
              {isAndroid ? (
                <a
                  href={chromeIntentUrl}
                  target="_top"
                  rel="noopener noreferrer"
                  className="w-full min-h-[54px] rounded-2xl bg-[#FE2C55] hover:bg-[#e6254b] active:scale-[0.98] transition-all px-5 py-3.5 text-base font-extrabold text-white flex items-center justify-center gap-2.5 shadow-lg whitespace-nowrap"
                >
                  <Download className="w-5 h-5 shrink-0" />
                  <span>Pobierz aplikację Swappy</span>
                </a>
              ) : (
                <a
                  href={autoInstallUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full min-h-[54px] rounded-2xl bg-[#FE2C55] hover:bg-[#e6254b] active:scale-[0.98] transition-all px-5 py-3.5 text-base font-extrabold text-white flex items-center justify-center gap-2.5 shadow-lg whitespace-nowrap"
                >
                  <ExternalLink className="w-5 h-5 shrink-0" />
                  <span>Otwórz instalator Swappy</span>
                </a>
              )}

              {isAndroid && isInIframe && (
                <a
                  href={autoInstallUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full min-h-[44px] rounded-xl bg-white/[0.07] hover:bg-white/[0.12] border border-white/10 px-4 text-xs font-bold text-white flex items-center justify-center gap-2 transition-colors whitespace-nowrap"
                >
                  <ExternalLink className="w-4 h-4 text-[#25F4EE] shrink-0" />
                  <span>Otwórz w przeglądarce telefonu</span>
                </a>
              )}

              <p className="text-center text-[11px] text-zinc-400 leading-relaxed">
                Stuknij przycisk powyżej, aby zainstalować aplikację mobilną Swappy bezpośrednio na telefonie.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {isInstallable && (
                <div className="flex items-center justify-center gap-2 text-xs font-bold text-emerald-300">
                  <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>Pakiet aplikacji mobilnej gotowy do instalacji</span>
                </div>
              )}

              <button
                type="button"
                onClick={handlePrimaryInstall}
                disabled={isCheckingPrompt}
                className="w-full min-h-[56px] rounded-2xl bg-[#FE2C55] hover:bg-[#e6254b] disabled:opacity-75 active:scale-[0.98] transition-all px-5 py-4 text-base font-extrabold text-white flex items-center justify-center gap-2.5 shadow-xl cursor-pointer whitespace-nowrap"
              >
                {isCheckingPrompt ? (
                  <>
                    <Loader2 className="w-5 h-5 shrink-0 animate-spin" />
                    <span>Uruchamianie instalatora...</span>
                  </>
                ) : (
                  <>
                    <Download className="w-5 h-5 shrink-0" />
                    <span>Zainstaluj aplikację Swappy</span>
                  </>
                )}
              </button>

              {isIOS && !showBrowserMenuHint && (
                <p className="text-center text-[11px] text-zinc-400 leading-relaxed">
                  Na iPhone otwórz w Safari, stuknij <strong>Udostępnij</strong> i wybierz <strong>Dodaj do ekranu początkowego</strong>.
                </p>
              )}

              {showBrowserMenuHint && !isInstallable && (
                <div className="rounded-2xl bg-white/[0.06] border border-[#25F4EE]/35 p-4 space-y-2.5">
                  {isIOS ? (
                    <>
                      <div className="text-xs font-extrabold text-white">
                        Instalacja aplikacji na iPhone / iPad:
                      </div>
                      <ol className="text-xs text-zinc-200 space-y-1.5 list-decimal list-inside leading-relaxed">
                        <li>
                          Stuknij ikonę <strong>Udostępnij</strong> na pasku Safari.
                        </li>
                        <li>
                          Wybierz <strong>Dodaj do ekranu początkowego</strong> i potwierdź <strong>Dodaj</strong>.
                        </li>
                      </ol>
                    </>
                  ) : (
                    <>
                      <div className="text-xs font-extrabold text-white">
                        Zainstaluj aplikację z menu przeglądarki:
                      </div>
                      <ol className="text-xs text-zinc-200 space-y-1.5 list-decimal list-inside leading-relaxed">
                        <li>
                          Stuknij trzy kropki <strong>⋮</strong> w prawym górnym rogu Chrome.
                        </li>
                        <li>
                          Wybierz <strong>Zainstaluj aplikację</strong> (lub{' '}
                          <strong>Dodaj do ekranu głównego</strong>).
                        </li>
                      </ol>
                      <p className="text-[11px] text-zinc-400">
                        Po zainstalowaniu uruchamiaj Swappy wyłącznie z ikony aplikacji na ekranie telefonu.
                      </p>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="pt-1 flex flex-col items-center gap-2">
            <a
              href="/"
              className="text-xs font-bold text-zinc-300 hover:text-white underline underline-offset-4 transition-colors"
            >
              Przejdź do podglądu aplikacji Swappy
            </a>
            <div className="flex items-center justify-center gap-2 text-[11px] text-zinc-400">
              <ShieldCheck className="w-4 h-4 text-[#25F4EE] shrink-0" />
              <span>Bezpieczna instalacja bez sklepu · Android i iPhone</span>
            </div>
          </div>
        </div>

        {/* Share Section for Sending Mobile Installer to Friends */}
        <div className="pt-2 border-t border-white/10">
          <button
            type="button"
            onClick={() => setShowShareDrawer((prev) => !prev)}
            className="w-full min-h-[44px] flex items-center justify-between text-xs font-semibold text-zinc-400 hover:text-white transition-colors cursor-pointer"
          >
            <span className="flex items-center gap-2">
              <Share2 className="w-3.5 h-3.5 text-[#25F4EE]" />
              <span>Udostępnij aplikację znajomym</span>
            </span>
            {showShareDrawer ? (
              <ChevronUp className="w-4 h-4" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )}
          </button>

          {showShareDrawer && (
            <div className="mt-3 space-y-3">
              <button
                type="button"
                onClick={handleShareInstallLink}
                className="w-full min-h-[44px] rounded-xl bg-white/[0.08] hover:bg-white/[0.14] border border-white/10 text-xs font-bold text-white flex items-center justify-center gap-2 transition-colors cursor-pointer whitespace-nowrap"
              >
                <Share2 className="w-4 h-4 text-[#25F4EE] shrink-0" />
                <span>Wyślij link do pobrania aplikacji</span>
              </button>

              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={installUrl}
                  aria-label="Link do pobrania aplikacji mobilnej"
                  className="flex-1 min-w-0 min-h-[44px] rounded-xl bg-black/55 border border-white/10 px-3 text-xs font-mono text-zinc-300 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={handleCopyInstallLink}
                  className="min-h-[44px] px-3.5 rounded-xl bg-white text-black hover:bg-zinc-200 text-xs font-bold flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {copied ? (
                    <Check className="w-4 h-4 text-emerald-600" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                  <span>{copied ? 'Skopiowano' : 'Kopiuj link'}</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};
