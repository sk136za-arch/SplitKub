export interface ManualCopyFallback {
  text: string;
  followsLanguage: boolean;
}

export function resolveManualCopyText(fallback: ManualCopyFallback | null, localizedSummary: string): string {
  if (!fallback) return "";
  return fallback.followsLanguage ? localizedSummary : fallback.text;
}
