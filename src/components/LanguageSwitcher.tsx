"use client";

import { useLanguage } from "./LanguageProvider";

export function LanguageSwitcher() {
  const { language, setLanguage } = useLanguage();
  return <div role="group" aria-label={language === "en" ? "Language" : "ภาษา"} className="inline-flex rounded-full border border-[#ddd5f3] bg-white p-1 text-sm">
    <button type="button" lang="th" aria-pressed={language === "th"} className="rounded-full px-3 py-1 font-bold aria-pressed:bg-[#eee8ff]" onClick={() => setLanguage("th")}>ไทย</button>
    <button type="button" lang="en" aria-pressed={language === "en"} className="rounded-full px-3 py-1 font-bold aria-pressed:bg-[#eee8ff]" onClick={() => setLanguage("en")}>EN</button>
  </div>;
}
