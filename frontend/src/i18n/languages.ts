export const supportedLanguages = ["en", "zh-CN"] as const;

export type AppLanguage = (typeof supportedLanguages)[number];

export const languageStorageKey = "flowent:language";

export const isAppLanguage = (value: string | null): value is AppLanguage =>
  supportedLanguages.some((language) => language === value);

export const languageFromBrowser = (): AppLanguage => {
  if (typeof navigator === "undefined") {
    return "en";
  }

  const languages = navigator.languages.length
    ? navigator.languages
    : [navigator.language];
  for (const language of languages) {
    const normalizedLanguage = language.toLowerCase();
    if (normalizedLanguage.startsWith("zh")) {
      return "zh-CN";
    }
    if (normalizedLanguage.startsWith("en")) {
      return "en";
    }
  }
  return "en";
};

export const readStoredLanguage = (): AppLanguage | null => {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const language = window.localStorage.getItem(languageStorageKey);
    return isAppLanguage(language) ? language : null;
  } catch {
    return null;
  }
};

export const resolveInitialLanguage = (): AppLanguage =>
  readStoredLanguage() ?? languageFromBrowser();

export const persistLanguage = (language: AppLanguage) => {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(languageStorageKey, language);
  } catch {
    return;
  }
};

export const normalizeAppLanguage = (language?: string): AppLanguage =>
  language?.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
