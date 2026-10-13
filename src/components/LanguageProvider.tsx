"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { DEFAULT_LANGUAGE, readLanguage, saveLanguage, type AppLanguage } from "../lib/language";

const LanguageContext = createContext<{ language: AppLanguage; setLanguage: (language: AppLanguage) => void } | null>(null);
const TITLES: Record<AppLanguage, string> = {
  th: "SplitKub — หารบิลง่ายในไม่กี่นาที",
  en: "SplitKub — Split bills in minutes",
};

export function LanguageProvider({ children, initialLanguage = DEFAULT_LANGUAGE }: { children?: React.ReactNode; initialLanguage?: AppLanguage }) {
  const [language, setLanguageState] = useState<AppLanguage>(initialLanguage);
  /* eslint-disable react-hooks/set-state-in-effect -- Restore browser-only preference after hydration. */
  useEffect(() => {
    let storage: Storage | null = null;
    try { storage = window.localStorage; } catch { /* Keep default Thai. */ }
    setLanguageState(readLanguage(storage));
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */
  useEffect(() => {
    document.documentElement.lang = language;
    document.title = TITLES[language];
  }, [language]);
  const setLanguage = useCallback((next: AppLanguage) => {
    setLanguageState(next);
    let storage: Storage | null = null;
    try { storage = window.localStorage; } catch { /* In-memory switching still works. */ }
    saveLanguage(storage, next);
  }, []);
  const value = useMemo(() => ({ language, setLanguage }), [language, setLanguage]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const value = useContext(LanguageContext);
  if (!value) throw new Error("LanguageProvider is missing");
  return value;
}
