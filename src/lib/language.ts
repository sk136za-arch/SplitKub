export type AppLanguage = "th" | "en";

export const LANGUAGE_STORAGE_KEY = "splitkub:language:v1";
export const DEFAULT_LANGUAGE: AppLanguage = "th";

export function parseLanguage(value: unknown): AppLanguage {
  return value === "en" ? "en" : "th";
}

export function readLanguage(storage: Pick<Storage, "getItem"> | null | undefined): AppLanguage {
  try { return parseLanguage(storage?.getItem(LANGUAGE_STORAGE_KEY)); }
  catch { return DEFAULT_LANGUAGE; }
}

export function saveLanguage(storage: Pick<Storage, "setItem"> | null | undefined, language: AppLanguage): void {
  try { storage?.setItem(LANGUAGE_STORAGE_KEY, language); }
  catch { /* Browser storage is optional; React state still changes. */ }
}

export function localize(language: AppLanguage, thai: string, english: string): string {
  return language === "en" ? english : thai;
}

export function dateLocale(language: AppLanguage): "th-TH" | "en-US" {
  return language === "en" ? "en-US" : "th-TH";
}
