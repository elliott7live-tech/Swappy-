import React, { useMemo, useState } from 'react';
import { Check, Globe, RotateCcw, Search, X } from 'lucide-react';
import {
  LanguageOption,
  translateForLanguage,
  useLanguage,
  WORLD_LANGUAGES,
} from '../i18n';

interface LanguageModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLanguageSelected?: (message: string) => void;
}

export const LanguageModal: React.FC<LanguageModalProps> = ({
  isOpen,
  onClose,
  onLanguageSelected,
}) => {
  const { lang, setLang, t } = useLanguage();
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return WORLD_LANGUAGES;
    return WORLD_LANGUAGES.filter(
      (item) =>
        item.nativeName.toLowerCase().includes(q) ||
        item.polishName.toLowerCase().includes(q) ||
        item.englishName.toLowerCase().includes(q) ||
        item.code.toLowerCase().includes(q)
    );
  }, [search]);

  if (!isOpen) return null;

  const handleChooseLanguage = (option: LanguageOption) => {
    const applied = setLang(option.code);
    setSearch('');
    const labelInChosenLang = translateForLanguage(applied.code, 'languageLabel');
    onLanguageSelected?.(`${labelInChosenLang}: ${applied.nativeName}`);
    onClose();
  };

  return (
    <div
      translate="no"
      className="notranslate fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-xs p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-md h-[82dvh] sm:h-[75dvh] rounded-t-3xl sm:rounded-3xl bg-[#141418] border border-white/15 flex flex-col overflow-hidden shadow-2xl text-white"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <Globe className="w-5 h-5 text-[#25F4EE] shrink-0" />
            <h2 className="text-base font-extrabold tracking-tight truncate">
              {t('languageLabel')}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('back')}
            className="min-h-[40px] min-w-[40px] rounded-full hover:bg-white/10 flex items-center justify-center text-zinc-400 hover:text-white cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search + Quick Restore Polish Default */}
        <div className="p-4 border-b border-white/10 space-y-2.5 shrink-0 bg-[#101014]">
          <div className="relative">
            <Search className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('searchLanguages')}
              className="w-full min-h-[44px] rounded-xl bg-white/[0.07] border border-white/10 pl-10 pr-4 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-[#25F4EE]"
            />
          </div>

          {lang !== 'pl' && (
            <button
              type="button"
              onClick={() => handleChooseLanguage(WORLD_LANGUAGES[0])}
              className="w-full min-h-[42px] px-3.5 rounded-xl bg-[#FE2C55]/15 hover:bg-[#FE2C55]/25 border border-[#FE2C55]/40 text-xs font-bold text-white flex items-center justify-center gap-2 cursor-pointer transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5 text-[#FE2C55]" />
              <span>{t('restorePolish')}</span>
            </button>
          )}
        </div>

        {/* Scrollable World Languages List */}
        <div className="flex-1 overflow-y-auto divide-y divide-white/5 no-scrollbar">
          {filtered.map((item) => {
            const active = item.code === lang;
            return (
              <button
                key={item.code}
                type="button"
                onClick={() => handleChooseLanguage(item)}
                className={`w-full min-h-[56px] px-5 py-3 flex items-center justify-between gap-3 text-left transition-colors cursor-pointer ${
                  active ? 'bg-white/[0.08]' : 'hover:bg-white/[0.04]'
                }`}
              >
                <div className="min-w-0">
                  <div className="text-sm font-bold text-white truncate">
                    {item.nativeName}
                  </div>
                  <div className="text-xs text-zinc-400 truncate">
                    {item.polishName} · {item.code.toUpperCase()}
                  </div>
                </div>
                {active && (
                  <span className="w-7 h-7 rounded-full bg-[#FE2C55] flex items-center justify-center text-white shrink-0">
                    <Check className="w-4 h-4 stroke-[2.8]" />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
