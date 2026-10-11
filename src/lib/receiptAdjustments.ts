import type { ReceiptAdjustments, SplitSession } from "@/types/bill";

export const defaultReceiptAdjustments = (): ReceiptAdjustments => ({
  vatEnabled: false, vatRateBps: 700,
  serviceChargeEnabled: false, serviceChargeRateBps: 1000,
  preDiscountEnabled: false, preDiscount: 0,
  postDiscountEnabled: false, postDiscount: 0,
});

export function isReceiptAdjustments(value: unknown): value is ReceiptAdjustments {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const adjustment = value as Record<string, unknown>;
  return typeof adjustment.vatEnabled === "boolean"
    && Number.isSafeInteger(adjustment.vatRateBps) && (adjustment.vatRateBps as number) >= 1 && (adjustment.vatRateBps as number) <= 10000
    && typeof adjustment.serviceChargeEnabled === "boolean"
    && Number.isSafeInteger(adjustment.serviceChargeRateBps) && (adjustment.serviceChargeRateBps as number) >= 1 && (adjustment.serviceChargeRateBps as number) <= 10000
    && typeof adjustment.preDiscountEnabled === "boolean"
    && Number.isSafeInteger(adjustment.preDiscount) && (adjustment.preDiscount as number) >= 0
    && (!adjustment.preDiscountEnabled || (adjustment.preDiscount as number) > 0)
    && typeof adjustment.postDiscountEnabled === "boolean"
    && Number.isSafeInteger(adjustment.postDiscount) && (adjustment.postDiscount as number) >= 0
    && (!adjustment.postDiscountEnabled || (adjustment.postDiscount as number) > 0);
}

export function sessionHasEnabledAdjustments(session: SplitSession): boolean {
  return session.receipts.some(({ adjustments }) => adjustments.vatEnabled || adjustments.serviceChargeEnabled
    || adjustments.preDiscountEnabled || adjustments.postDiscountEnabled);
}

/** Detects every persisted value that differs from the original schema defaults, even while disabled. */
export function sessionHasNonDefaultAdjustments(session: SplitSession): boolean {
  const defaults = defaultReceiptAdjustments();
  return session.receipts.some(({ adjustments }) => Object.keys(defaults).some((key) =>
    adjustments[key as keyof ReceiptAdjustments] !== defaults[key as keyof ReceiptAdjustments]));
}

/** Compatibility is limited to a wholly absent field; partial data stays invalid. */
export function addMissingReceiptAdjustments(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const candidate = value as Record<string, unknown>;
  if (!Array.isArray(candidate.receipts)) return value;
  return { ...candidate, receipts: candidate.receipts.map((receipt: unknown) => {
    if (!receipt || typeof receipt !== "object" || Array.isArray(receipt) || "adjustments" in receipt) return receipt;
    return { ...receipt, adjustments: defaultReceiptAdjustments() };
  }) };
}
