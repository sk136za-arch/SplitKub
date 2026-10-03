import { settlementDestinations, type BillResult, type SessionResult } from "./calculateBill";
import { formatMoney } from "./money";
import { participantLabels } from "./participantLabels";
import { isValidPromptPay } from "./promptpay";
import { displayPaymentTotals, summaryTransferRows } from "./summaryTransferPresentation";
import type { Currency, SplitSession } from "../types/bill";

export const SHARE_TITLE = "Dinner 🍻";

export type QrRecipientSelection = { destinationKey: string; participantId: string };

export function qrDestinationKey(destinationIds: string[]): string {
  return JSON.stringify(destinationIds);
}

/** A saved QR recipient is valid only for the exact current destination set. */
export function resolveQrRecipient(destinationIds: string[], selection: QrRecipientSelection | null): string {
  if (selection?.destinationKey === qrDestinationKey(destinationIds) && destinationIds.includes(selection.participantId)) {
    return selection.participantId;
  }
  return destinationIds.length === 1 ? destinationIds[0] : "";
}

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

export function sessionSharingAvailability(result: SessionResult | null, session: SplitSession, hasQr: boolean, qrReceiverId = "") {
  const receivers = result ? settlementDestinations(result, session) : [];
  const qrReceiverIsKnown = receivers.includes(qrReceiverId) || (receivers.length === 1 && !qrReceiverId);
  return {
    canCopy: Boolean(result && session.currency === "THB" && (receivers.length === 0 || receivers.every((id) => isValidPromptPay(session.participants.find((person) => person.id === id)?.promptPay ?? "")))),
    canShareImage: Boolean(result && hasQr && receivers.length > 0 && qrReceiverIsKnown),
  };
}

export function buildSessionShareText(result: SessionResult, session: SplitSession): string {
  const labels = participantLabels(session.participants);
  const displayTransfers = summaryTransferRows(session, result);
  const paymentTotals = displayPaymentTotals(session.participants.map((person) => person.id), displayTransfers);
  const lines = [
    session.title,
    `ยอดรวม: ${formatMoney(result.total, session.currency)}`,
    "",
    "ใบเสร็จ",
    ...result.receipts.map((receipt) => `${receipt.title} · จ่ายโดย ${labels.get(receipt.paidByParticipantId)}: ${formatMoney(receipt.total, session.currency)}`),
    "",
    "ยอดที่ต้องโอนและรับ",
    ...paymentTotals.map((person) => `${labels.get(person.participantId)}: ต้องโอน ${formatMoney(person.outgoing, session.currency)} · จะรับ ${formatMoney(person.incoming, session.currency)}`),
    "",
    "ยอดสุทธิรายคน",
    ...result.people.map((person) => `${labels.get(person.participantId)}: จ่ายไป ${formatMoney(person.paid, session.currency)} · ส่วนที่หาร ${formatMoney(person.owed, session.currency)} · ${person.net > 0 ? "รับคืน" : person.net < 0 ? "ต้องจ่าย" : "พอดี"} ${formatMoney(Math.abs(person.net), session.currency)}`),
  ];
  lines.push("", session.settlementMode === "collector" ? "เส้นทางโอนผ่านคนรวบรวมเงิน" : "เส้นทางโอนตรง");
  if (displayTransfers.length === 0) lines.push("ไม่มีรายการโอนเงิน");
  for (const transfer of displayTransfers) {
    lines.push(`${labels.get(transfer.fromParticipantId)} → ${labels.get(transfer.toParticipantId)}: ${formatMoney(transfer.amount, session.currency)}`);
    if (transfer.kind === "reimbursement") {
      for (const receipt of transfer.receiptBreakdown) lines.push(`  คืน ${receipt.receiptTitle}: ${formatMoney(receipt.amount, session.currency)}`);
    }
  }
  const receivers = settlementDestinations(result, session);
  if (session.currency === "THB" && receivers.length > 0) {
    lines.push("", "ช่องทางรับเงิน");
    for (const id of receivers) {
      const promptPay = session.participants.find((person) => person.id === id)?.promptPay ?? "";
      if (isValidPromptPay(promptPay)) lines.push(`${labels.get(id)} · PromptPay: ${normalizedPromptPay(promptPay)}`);
    }
  } else if (session.currency === "USD" && receivers.length > 0) {
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
