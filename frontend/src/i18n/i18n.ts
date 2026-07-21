import { createInstance } from "i18next";
import { initReactI18next } from "react-i18next";

import {
  type AppLanguage,
  normalizeAppLanguage,
  persistLanguage,
  resolveInitialLanguage,
  supportedLanguages,
} from "@/i18n/languages";
import { resources } from "@/i18n/resources";

const i18n = createInstance();
const initialLanguage = resolveInitialLanguage();

void i18n.use(initReactI18next).init({
  fallbackLng: "en",
  initAsync: false,
  interpolation: {
    escapeValue: false,
  },
  lng: initialLanguage,
  react: {
    useSuspense: false,
  },
  resources,
  returnNull: false,
  supportedLngs: supportedLanguages,
});

const syncDocumentLanguage = (language: string) => {
  if (typeof document !== "undefined") {
    document.documentElement.lang = normalizeAppLanguage(language);
  }
};

syncDocumentLanguage(initialLanguage);
i18n.on("languageChanged", syncDocumentLanguage);

export const changeAppLanguage = async (language: AppLanguage) => {
  persistLanguage(language);
  await i18n.changeLanguage(language);
};

export const currentAppLanguage = () =>
  normalizeAppLanguage(i18n.resolvedLanguage ?? i18n.language);

export default i18n;
