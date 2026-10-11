import { calculateBill, type ReceiptTotal } from "./calculateBill";
import { isReceiptAdjustments } from "./receiptAdjustments";
import type { ReceiptAdjustments, SplitSession } from "@/types/bill";

export interface AdjustmentPreview {
  total: ReceiptTotal | null;
  error: string | null;
}

const adjustmentFailures = [
  "ส่วนลดก่อนค่าบริการมากกว่าส่วนของบางคน",
  "ส่วนลดก่อนค่าบริการมากกว่ายอดใบเสร็จ",
  "ส่วนลดหลังภาษีมากกว่ายอดใบเสร็จ",
  "ส่วนลดหลังภาษีมากกว่าส่วนของบางคน",
  "ส่วนลดหรือค่าบริการไม่ถูกต้อง",
  "ยอดบิลสูงเกินขอบเขตที่รองรับ",
];

/** Validates an edit against just its receipt, without letting unrelated incomplete receipts block drafting. */
export function previewReceiptAdjustments(
  session: SplitSession,
  receiptId: string,
  adjustments: ReceiptAdjustments,
): AdjustmentPreview {
  if (!isReceiptAdjustments(adjustments)) return { total: null, error: "ส่วนลดหรือค่าบริการไม่ถูกต้อง" };
  const receipt = session.receipts.find((candidate) => candidate.id === receiptId);
  if (!receipt) return { total: null, error: "ไม่พบใบเสร็จนี้" };
  const candidate: SplitSession = { ...session, receipts: [{ ...receipt, adjustments }] };
  try {
    const result = calculateBill(candidate);
    return { total: result.receipts[0] ?? null, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return adjustmentFailures.includes(message) ? { total: null, error: message } : { total: null, error: null };
  }
}
