import type { BillResult } from "./calculateBill";
import { formatMoney } from "./money";
import { participantLabels } from "./participantLabels";
import { isValidPromptPay } from "./promptpay";
import type { Currency } from "../types/bill";

export const SHARE_TITLE = "Dinner 🍻";

export function normalizedPromptPay(value: string): string {
  return value.replace(/[\s-]/g, "");
}

export function sharingAvailability(currency: Currency, promptPay: string, hasQr: boolean) {
  return {
    canCopy: currency === "THB" && isValidPromptPay(promptPay),
    canShareImage: hasQr,
  };
}

export function buildShareText(result: BillResult, currency: Currency, promptPay: string): string {
  const labels = participantLabels(result.people.map((person) => ({ id: person.participantId, name: person.name })));
  const lines = [
    SHARE_TITLE,
    `ยอดรวม: ${formatMoney(result.total, currency)}`,
    "",
    "ยอดที่แต่ละคนต้องโอน",
    ...result.people.map((person) => `${labels.get(person.participantId)}: ${formatMoney(person.total, currency)}`),
  ];
  if (currency === "THB" && isValidPromptPay(promptPay)) {
    lines.push("", `PromptPay: ${normalizedPromptPay(promptPay)}`);
  } else if (currency === "USD") {
    lines.push("", "ชำระผ่าน QR ในรูปสรุปบิลที่ส่งมาพร้อมกัน");
  }
  return lines.join("\n");
}

/** Clipboard may be unavailable on local HTTP; retain a synchronous legacy fallback. */
export async function copyTextWithFallback(text: string, browserDocument: Document, clipboard?: Pick<Clipboard, "writeText">): Promise<boolean> {
  if (clipboard?.writeText) {
    try {
      await clipboard.writeText(text);
      return true;
    } catch { /* Try the legacy copy path for insecure contexts and denied permissions. */ }
  }
  const textarea = browserDocument.createElement("textarea");
  textarea.value = text;
  textarea.readOnly = true;
  textarea.setAttribute("aria-hidden", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.left = "0";
  textarea.style.top = "0";
  browserDocument.body.appendChild(textarea);
  try {
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    return browserDocument.execCommand?.("copy") ?? false;
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}

export function isShareCancelled(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

/** Build a File only when native file sharing is available and accepts this actual PNG. */
export function prepareNativeShareFile(
  blob: Blob,
  nativeFileShareAvailable: boolean,
  createFile: (blob: Blob) => File,
  canShareFile: (file: File) => boolean,
): File | null {
  if (!nativeFileShareAvailable) return null;
  try {
    const file = createFile(blob);
    return canShareFile(file) ? file : null;
  } catch {
    return null;
  }
}
