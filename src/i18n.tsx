import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  ALL_TRANSLATION_TUPLES,
  LanguageCode,
  TRANSLATION_KEYS,
  TranslationKey,
} from './translationsData';

export type { LanguageCode, TranslationKey };

export interface LanguageOption {
  code: LanguageCode;
  nativeName: string;
  polishName: string;
  englishName: string;
  rtl?: boolean;
}

export const WORLD_LANGUAGES: LanguageOption[] = [
  { code: 'pl', nativeName: 'Polski (Oryginalny)', polishName: 'Polski — domyślny', englishName: 'Polish' },
  { code: 'en', nativeName: 'English', polishName: 'Angielski', englishName: 'English' },
  { code: 'uk', nativeName: 'Українська', polishName: 'Ukraiński', englishName: 'Ukrainian' },
  { code: 'de', nativeName: 'Deutsch', polishName: 'Niemiecki', englishName: 'German' },
  { code: 'es', nativeName: 'Español', polishName: 'Hiszpański', englishName: 'Spanish' },
  { code: 'fr', nativeName: 'Français', polishName: 'Francuski', englishName: 'French' },
  { code: 'it', nativeName: 'Italiano', polishName: 'Włoski', englishName: 'Italian' },
  { code: 'pt', nativeName: 'Português', polishName: 'Portugalski', englishName: 'Portuguese' },
  { code: 'cs', nativeName: 'Čeština', polishName: 'Czeski', englishName: 'Czech' },
  { code: 'sk', nativeName: 'Slovenčina', polishName: 'Słowacki', englishName: 'Slovak' },
  { code: 'nl', nativeName: 'Nederlands', polishName: 'Niderlandzki', englishName: 'Dutch' },
  { code: 'sv', nativeName: 'Svenska', polishName: 'Szwedzki', englishName: 'Swedish' },
  { code: 'no', nativeName: 'Norsk', polishName: 'Norweski', englishName: 'Norwegian' },
  { code: 'da', nativeName: 'Dansk', polishName: 'Duński', englishName: 'Danish' },
  { code: 'fi', nativeName: 'Suomi', polishName: 'Fiński', englishName: 'Finnish' },
  { code: 'ro', nativeName: 'Română', polishName: 'Rumuński', englishName: 'Romanian' },
  { code: 'hu', nativeName: 'Magyar', polishName: 'Węgierski', englishName: 'Hungarian' },
  { code: 'bg', nativeName: 'Български', polishName: 'Bułgarski', englishName: 'Bulgarian' },
  { code: 'hr', nativeName: 'Hrvatski', polishName: 'Chorwacki', englishName: 'Croatian' },
  { code: 'sr', nativeName: 'Српски / Srpski', polishName: 'Serbski', englishName: 'Serbian' },
  { code: 'sl', nativeName: 'Slovenščina', polishName: 'Słoweński', englishName: 'Slovenian' },
  { code: 'bs', nativeName: 'Bosanski', polishName: 'Bośniacki', englishName: 'Bosnian' },
  { code: 'sq', nativeName: 'Shqip', polishName: 'Albański', englishName: 'Albanian' },
  { code: 'lt', nativeName: 'Lietuvių', polishName: 'Litewski', englishName: 'Lithuanian' },
  { code: 'lv', nativeName: 'Latviešu', polishName: 'Łotewski', englishName: 'Latvian' },
  { code: 'et', nativeName: 'Eesti', polishName: 'Estoński', englishName: 'Estonian' },
  { code: 'el', nativeName: 'Ελληνικά', polishName: 'Grecki', englishName: 'Greek' },
  { code: 'tr', nativeName: 'Türkçe', polishName: 'Turecki', englishName: 'Turkish' },
  { code: 'ru', nativeName: 'Русский', polishName: 'Rosyjski', englishName: 'Russian' },
  { code: 'be', nativeName: 'Беларуская', polishName: 'Białoruski', englishName: 'Belarusian' },
  { code: 'ca', nativeName: 'Català', polishName: 'Kataloński', englishName: 'Catalan' },
  { code: 'eu', nativeName: 'Euskara', polishName: 'Baskijski', englishName: 'Basque' },
  { code: 'gl', nativeName: 'Galego', polishName: 'Galicyjski', englishName: 'Galician' },
  { code: 'ga', nativeName: 'Gaeilge', polishName: 'Irlandzki', englishName: 'Irish' },
  { code: 'is', nativeName: 'Íslenska', polishName: 'Islandzki', englishName: 'Icelandic' },
  { code: 'mt', nativeName: 'Malti', polishName: 'Maltański', englishName: 'Maltese' },
  { code: 'ar', nativeName: 'العربية', polishName: 'Arabski', englishName: 'Arabic', rtl: true },
  { code: 'he', nativeName: 'עברית', polishName: 'Hebrajski', englishName: 'Hebrew', rtl: true },
  { code: 'fa', nativeName: 'فارسی', polishName: 'Perski', englishName: 'Persian', rtl: true },
  { code: 'ur', nativeName: 'اردو', polishName: 'Urdu', englishName: 'Urdu', rtl: true },
  { code: 'hi', nativeName: 'हिन्दी', polishName: 'Hindi', englishName: 'Hindi' },
  { code: 'bn', nativeName: 'বাংলা', polishName: 'Bengalski', englishName: 'Bengali' },
  { code: 'pa', nativeName: 'ਪੰਜਾਬੀ', polishName: 'Pendżabski', englishName: 'Punjabi' },
  { code: 'ta', nativeName: 'தமிழ்', polishName: 'Tamilski', englishName: 'Tamil' },
  { code: 'te', nativeName: 'తెలుగు', polishName: 'Telugu', englishName: 'Telugu' },
  { code: 'mr', nativeName: 'मराठी', polishName: 'Marathi', englishName: 'Marathi' },
  { code: 'gu', nativeName: 'ગુજરાતી', polishName: 'Gudżarati', englishName: 'Gujarati' },
  { code: 'kn', nativeName: 'ಕನ್ನಡ', polishName: 'Kannada', englishName: 'Kannada' },
  { code: 'ml', nativeName: 'മലയാളം', polishName: 'Malajalam', englishName: 'Malayalam' },
  { code: 'si', nativeName: 'සිංහල', polishName: 'Syngaleski', englishName: 'Sinhala' },
  { code: 'th', nativeName: 'ไทย', polishName: 'Tajski', englishName: 'Thai' },
  { code: 'vi', nativeName: 'Tiếng Việt', polishName: 'Wietnamski', englishName: 'Vietnamese' },
  { code: 'id', nativeName: 'Bahasa Indonesia', polishName: 'Indonezyjski', englishName: 'Indonesian' },
  { code: 'ms', nativeName: 'Bahasa Melayu', polishName: 'Malajski', englishName: 'Malay' },
  { code: 'tl', nativeName: 'Tagalog / Filipino', polishName: 'Filipiński', englishName: 'Filipino' },
  { code: 'zh', nativeName: '中文 (简体)', polishName: 'Chiński uproszczony', englishName: 'Chinese Simplified' },
  { code: 'zh-TW', nativeName: '中文 (繁體)', polishName: 'Chiński tradycyjny', englishName: 'Chinese Traditional' },
  { code: 'ja', nativeName: '日本語', polishName: 'Japoński', englishName: 'Japanese' },
  { code: 'ko', nativeName: '한국어', polishName: 'Koreański', englishName: 'Korean' },
  { code: 'kk', nativeName: 'Қазақша', polishName: 'Kazachski', englishName: 'Kazakh' },
  { code: 'uz', nativeName: 'Oʻzbekcha', polishName: 'Uzbecki', englishName: 'Uzbek' },
  { code: 'az', nativeName: 'Azərbaycan', polishName: 'Azerbejdżański', englishName: 'Azerbaijani' },
  { code: 'ka', nativeName: 'ქართული', polishName: 'Gruziński', englishName: 'Georgian' },
  { code: 'hy', nativeName: 'Հայերեն', polishName: 'Ormiański', englishName: 'Armenian' },
  { code: 'mn', nativeName: 'Монгол', polishName: 'Mongolski', englishName: 'Mongolian' },
  { code: 'sw', nativeName: 'Kiswahili', polishName: 'Suahili', englishName: 'Swahili' },
  { code: 'am', nativeName: 'አማርኛ', polishName: 'Amharski', englishName: 'Amharic' },
  { code: 'yo', nativeName: 'Yorùbá', polishName: 'Joruba', englishName: 'Yoruba' },
  { code: 'ha', nativeName: 'Hausa', polishName: 'Hausa', englishName: 'Hausa' },
  { code: 'zu', nativeName: 'isiZulu', polishName: 'Zuluski', englishName: 'Zulu' },
  { code: 'af', nativeName: 'Afrikaans', polishName: 'Afrykanerski', englishName: 'Afrikaans' },
];

// Build O(1) key-index lookup map once at module load
const KEY_INDEX_MAP: Record<TranslationKey, number> = (() => {
  const map = {} as Record<TranslationKey, number>;
  TRANSLATION_KEYS.forEach((key, idx) => {
    map[key] = idx;
  });
  return map;
})();

export function resolveLanguageCode(raw: string | null | undefined): LanguageCode {
  if (!raw) return 'pl';
  const cleaned = raw.trim();
  if (!cleaned) return 'pl';

  const exact = WORLD_LANGUAGES.find(
    (item) => item.code.toLowerCase() === cleaned.toLowerCase()
  );
  if (exact) return exact.code;

  const base = cleaned.split(/[-_]/)[0]?.toLowerCase() ?? '';
  const baseMatch = WORLD_LANGUAGES.find((item) => item.code.toLowerCase() === base);
  if (baseMatch) return baseMatch.code;

  return 'pl';
}

export function translateForLanguage(code: LanguageCode, key: TranslationKey): string {
  const idx = KEY_INDEX_MAP[key];
  const tuple = ALL_TRANSLATION_TUPLES[code] ?? ALL_TRANSLATION_TUPLES.pl;
  return tuple[idx] ?? ALL_TRANSLATION_TUPLES.pl[idx];
}

const LEGACY_STORAGE_KEY = 'swappy_app_lang_v1';
const STORAGE_KEY = 'swappy_app_lang_v2';

interface LanguageContextValue {
  lang: LanguageCode;
  currentLanguage: LanguageOption;
  setLang: (code: string) => LanguageOption;
  t: (key: TranslationKey) => string;
}

const LanguageContext = createContext<LanguageContextValue>({
  lang: 'pl',
  currentLanguage: WORLD_LANGUAGES[0],
  setLang: () => WORLD_LANGUAGES[0],
  t: (key) => translateForLanguage('pl', key),
});

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Strictly default to Polish ('pl') unless the user explicitly chooses a language in v2 storage.
  // Clear legacy v1 key so any previously stuck 'de' value is wiped cleanly.
  const [lang, setLangState] = useState<LanguageCode>(() => {
    try {
      window.localStorage.removeItem(LEGACY_STORAGE_KEY);
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) {
        return resolveLanguageCode(saved);
      }
    } catch {
      // Ignore storage restrictions
    }
    return 'pl';
  });

  const currentLanguage = useMemo(
    () => WORLD_LANGUAGES.find((l) => l.code === lang) ?? WORLD_LANGUAGES[0],
    [lang]
  );

  // Block mobile Chrome / WebAPK / WebView auto-translate from hijacking the DOM into German
  // when switching app languages: keep html[lang="pl"] + translate="no" + .notranslate intact,
  // and store the active Swappy language on data-swappy-lang instead.
  useEffect(() => {
    const htmlEl = document.documentElement;
    const bodyEl = document.body;

    htmlEl.setAttribute('lang', 'pl');
    htmlEl.setAttribute('translate', 'no');
    htmlEl.classList.add('notranslate');
    htmlEl.dataset.swappyLang = currentLanguage.code;
    htmlEl.dir = currentLanguage.rtl ? 'rtl' : 'ltr';

    if (bodyEl) {
      bodyEl.setAttribute('translate', 'no');
      bodyEl.classList.add('notranslate');
    }
  }, [currentLanguage]);

  const setLang = useCallback((code: string): LanguageOption => {
    const resolved = resolveLanguageCode(code);
    const option = WORLD_LANGUAGES.find((l) => l.code === resolved) ?? WORLD_LANGUAGES[0];
    setLangState(option.code);
    try {
      window.localStorage.setItem(STORAGE_KEY, option.code);
    } catch {
      // Ignore storage errors
    }
    return option;
  }, []);

  const t = useCallback(
    (key: TranslationKey): string => translateForLanguage(lang, key),
    [lang]
  );

  const value = useMemo(
    () => ({ lang, currentLanguage, setLang, t }),
    [lang, currentLanguage, setLang, t]
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
};

export function useLanguage() {
  return useContext(LanguageContext);
}
