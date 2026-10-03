import { describe, expect, it, vi } from "vitest";
import type { SessionResult } from "../lib/calculateBill";
import type { SplitSession } from "../types/bill";
import { buildSessionShareText, qrDestinationKey, resolveQrRecipient, sessionSharingAvailability } from "../lib/share";
import { createSessionSummaryImage, sessionSummaryImageCacheKey, sessionSummaryImageHeight } from "../lib/summaryImage";

const session: SplitSession = {
  id: "bill", title: "วันเกิด", currency: "THB", revision: 2, expiresAt: "", settlementMode: "direct", collectorParticipantId: "",
  participants: [
    { id: "a", name: "Boss", promptPay: "089-123-4567" },
    { id: "b", name: "Boss", promptPay: "" },
  ],
  receipts: [
    { id: "r1", title: "อาหาร", paidByParticipantId: "a", items: [{ id: "same", name: "ข้าว", price: 10000, participantIds: ["a", "b"] }] },
    { id: "r2", title: "น้ำ", paidByParticipantId: "b", items: [{ id: "same", name: "ชา", price: 2000, participantIds: ["a", "b"] }] },
  ],
};
const result: SessionResult = {
  total: 12000,
  transfers: [{ fromParticipantId: "b", toParticipantId: "a", amount: 4000, kind: "direct", receiptBreakdown: [] }],
  receipts: [
    { receiptId: "r1", title: "อาหาร", paidByParticipantId: "a", total: 10000 },
    { receiptId: "r2", title: "น้ำ", paidByParticipantId: "b", total: 2000 },
  ],
  people: [
    { participantId: "a", name: "Boss", paid: 10000, owed: 6000, net: 4000, total: 6000, breakdown: [{ receiptId: "r1", receiptTitle: "อาหาร", itemId: "same", itemName: "ข้าว", amount: 5000 }, { receiptId: "r2", receiptTitle: "น้ำ", itemId: "same", itemName: "ชา", amount: 1000 }] },
    { participantId: "b", name: "Boss", paid: 2000, owed: 6000, net: -4000, total: 6000, breakdown: [{ receiptId: "r1", receiptTitle: "อาหาร", itemId: "same", itemName: "ข้าว", amount: 5000 }, { receiptId: "r2", receiptTitle: "น้ำ", itemId: "same", itemName: "ชา", amount: 1000 }] },
  ],
};

describe("multi-receipt sharing", () => {
  it("requires a current explicit QR recipient for multiple destinations and auto-selects only a sole destination", () => {
    const originalDestinations = ["a", "b"];
    const selection = { destinationKey: qrDestinationKey(originalDestinations), participantId: "a" };
    expect(resolveQrRecipient(originalDestinations, null)).toBe("");
    expect(resolveQrRecipient(originalDestinations, selection)).toBe("a");
    expect(resolveQrRecipient(["a"], null)).toBe("a");
    expect(resolveQrRecipient(["a", "c"], selection)).toBe("");
    expect(resolveQrRecipient(["b"], selection)).toBe("b");
    expect(resolveQrRecipient(originalDestinations, { ...selection, participantId: "not-a-destination" })).toBe("");
  });

  it("copies receipt totals, paid/owed/net, and the positive receiver's PromptPay", () => {
    expect(sessionSharingAvailability(result, session, false)).toEqual({ canCopy: true, canShareImage: false });
    const text = buildSessionShareText(result, session);
    expect(text).toContain("วันเกิด");
    expect(text).toContain("อาหาร · จ่ายโดย 1. Boss: ฿100.00");
    expect(text).toContain("Boss: จ่ายไป ฿100.00 · ส่วนที่หาร ฿60.00 · รับคืน ฿40.00");
    expect(text).toContain("1. Boss · PromptPay: 0891234567");
    expect(text).not.toContain("PromptPay: undefined");
  });

  it("requires every positive receiver's PromptPay and a QR for the image", () => {
    const missing = { ...session, participants: [{ ...session.participants[0], promptPay: "" }, session.participants[1]] };
    expect(sessionSharingAvailability(result, missing, true)).toEqual({ canCopy: false, canShareImage: true });
    expect(sessionSharingAvailability(result, { ...session, currency: "USD" }, true)).toEqual({ canCopy: false, canShareImage: true });
    const multipleReceivers = { ...result, transfers: [...result.transfers, { fromParticipantId: "a", toParticipantId: "b", amount: 1, kind: "direct" as const, receiptBreakdown: [] }] };
    expect(sessionSharingAvailability(multipleReceivers, { ...session, currency: "USD" }, true)).toEqual({ canCopy: false, canShareImage: false });
    expect(sessionSharingAvailability(multipleReceivers, { ...session, currency: "USD" }, true, "a")).toEqual({ canCopy: false, canShareImage: true });
    expect(sessionSharingAvailability(null, session, true)).toEqual({ canCopy: false, canShareImage: false });
  });

  it("uses actual collector destinations even when a receiver has negative net", () => {
    const collectorSession: SplitSession = { ...session, settlementMode: "collector", collectorParticipantId: "b" };
    const collectorResult: SessionResult = {
      ...result,
      transfers: [
        { fromParticipantId: "a", toParticipantId: "b", amount: 6000, kind: "collection", receiptBreakdown: [] },
        { fromParticipantId: "b", toParticipantId: "a", amount: 10000, kind: "reimbursement", receiptBreakdown: [{ receiptId: "r1", receiptTitle: "อาหาร", amount: 10000 }] },
      ],
    };
    expect(sessionSharingAvailability(collectorResult, collectorSession, true, "b")).toEqual({ canCopy: false, canShareImage: true });
    const text = buildSessionShareText(collectorResult, collectorSession);
    expect(text).toContain("1. Boss → 2. Boss: ฿60.00");
    expect(text).toContain("คืน อาหาร: ฿100.00");
    expect(text).not.toContain("2. Boss · PromptPay");
    const withBothPaymentDetails = { ...collectorSession, participants: [collectorSession.participants[0], { ...collectorSession.participants[1], promptPay: "0812345678" }] };
    expect(sessionSharingAvailability(collectorResult, withBothPaymentDetails, true, "b").canCopy).toBe(true);
    expect(buildSessionShareText(collectorResult, withBothPaymentDetails)).toContain("2. Boss · PromptPay: 0812345678");
  });

  it("allows a THB summary copy without PromptPay when there are no transfers", () => {
    const balanced = { ...result, transfers: [], people: result.people.map((person) => ({ ...person, paid: 6000, owed: 6000, net: 0 })) };
    const noPaymentDetails = { ...session, participants: session.participants.map((person) => ({ ...person, promptPay: "" })) };
    expect(sessionSharingAvailability(balanced, noPaymentDetails, true)).toEqual({ canCopy: true, canShareImage: false });
    const text = buildSessionShareText(balanced, noPaymentDetails);
    expect(text).toContain("ไม่มีรายการโอนเงิน");
    expect(text).not.toContain("PromptPay:");
    expect(sessionSharingAvailability(balanced, { ...noPaymentDetails, currency: "USD" }, true).canCopy).toBe(false);
  });

  it("invalidates the image when net results or recipient payment change", () => {
    const key = sessionSummaryImageCacheKey(result, session, "blob:qr");
    expect(sessionSummaryImageCacheKey({ ...result, people: [{ ...result.people[0], net: 3000 }, result.people[1]] }, session, "blob:qr")).not.toBe(key);
    expect(sessionSummaryImageCacheKey(result, { ...session, participants: [{ ...session.participants[0], promptPay: "0812345678" }, session.participants[1]] }, "blob:qr")).not.toBe(key);
    expect(sessionSummaryImageCacheKey(result, session, "blob:new")).not.toBe(key);
    expect(sessionSummaryImageCacheKey(result, session, "blob:qr", "b")).not.toBe(key);
    const changedRawSplit = { ...session, receipts: [{ ...session.receipts[0], items: [{ ...session.receipts[0].items[0], participantIds: ["a"] }] }, session.receipts[1]] };
    expect(sessionSummaryImageCacheKey(result, changedRawSplit, "blob:qr")).not.toBe(key);
    expect(sessionSummaryImageHeight(2, 2, 1)).toBeGreaterThan(sessionSummaryImageHeight(1, 2, 1));
  });

  it("still creates a QR image if the mascot fails to load", async () => {
    class BrowserImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      naturalWidth = 320;
      naturalHeight = 320;
      set src(value: string) { queueMicrotask(() => value.includes("splitkub-mascot") ? this.onerror?.() : this.onload?.()); }
    }
    const fillText = vi.fn();
    const drawImage = vi.fn();
    const ctx = {
      fillRect: vi.fn(), beginPath: vi.fn(), arc: vi.fn(), fill: vi.fn(), moveTo: vi.fn(),
      lineTo: vi.fn(), quadraticCurveTo: vi.fn(), closePath: vi.fn(), fillText, drawImage,
      measureText: (text: string) => ({ width: text.length * 15 }),
    };
    const blob = new Blob(["png"], { type: "image/png" });
    vi.stubGlobal("Image", BrowserImage);
    vi.stubGlobal("document", { createElement: () => ({ width: 0, height: 0, getContext: () => ctx, toBlob: (callback: (value: Blob) => void) => callback(blob) }) });
    try {
      expect(await createSessionSummaryImage(result, session, "blob:qr", "a")).toBe(blob);
      expect(drawImage).toHaveBeenCalledOnce();
      expect(fillText.mock.calls.some(([value]) => value === "✦ SplitKub")).toBe(true);
      expect(fillText.mock.calls.some(([value]) => value === "จ่ายโดย 1. Boss")).toBe(true);
      expect(fillText.mock.calls.some(([value]) => value === "จ่ายโดย 2. Boss")).toBe(true);
      expect(fillText.mock.calls.some(([value]) => value === "QR ของ 1. Boss")).toBe(true);
    } finally { vi.unstubAllGlobals(); }
  });
});
