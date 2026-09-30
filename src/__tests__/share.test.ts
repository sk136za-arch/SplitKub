import { describe, expect, it, vi } from "vitest";
import { buildShareText, copyTextWithFallback, isShareCancelled, prepareNativeShareFile, sharingAvailability } from "../lib/share";
import { createSummaryImage, preparedImageMatchesKey, summaryImageCacheKey, summaryImageHeight } from "../lib/summaryImage";
import type { BillResult } from "../lib/calculateBill";

const result: BillResult = {
  total: 10001,
  people: [
    { participantId: "a", name: "Boss", total: 5001, breakdown: [] },
    { participantId: "b", name: "Boss", total: 5000, breakdown: [] },
  ],
};

function fakeDocument(copySucceeds: boolean) {
  const textarea = {
    value: "", readOnly: false, style: {} as CSSStyleDeclaration,
    setAttribute: vi.fn(), focus: vi.fn(), select: vi.fn(), setSelectionRange: vi.fn(), remove: vi.fn(),
  };
  const document = {
    createElement: vi.fn(() => textarea),
    body: { appendChild: vi.fn() },
    execCommand: vi.fn(() => copySucceeds),
  };
  return { document: document as unknown as Document, textarea, execCommand: document.execCommand };
}

describe("payment-first sharing", () => {
  it("keys a prepared image to every value rendered in the image and rejects stale keys", () => {
    const baseKey = summaryImageCacheKey(result, "THB", "0891234567", "blob:qr-1");
    expect(preparedImageMatchesKey(baseKey, baseKey)).toBe(true);
    expect(preparedImageMatchesKey(baseKey, null)).toBe(false);
    expect(preparedImageMatchesKey(baseKey, summaryImageCacheKey(result, "USD", "0891234567", "blob:qr-1"))).toBe(false);
    expect(preparedImageMatchesKey(baseKey, summaryImageCacheKey(result, "THB", "0891234568", "blob:qr-1"))).toBe(false);
    expect(preparedImageMatchesKey(baseKey, summaryImageCacheKey(result, "THB", "0891234567", "blob:qr-2"))).toBe(false);
    expect(preparedImageMatchesKey(baseKey, summaryImageCacheKey({ ...result, total: result.total + 1 }, "THB", "0891234567", "blob:qr-1"))).toBe(false);
    expect(preparedImageMatchesKey(baseKey, summaryImageCacheKey({ ...result, people: [{ ...result.people[0], name: "New name" }, result.people[1]] }, "THB", "0891234567", "blob:qr-1"))).toBe(false);
    expect(preparedImageMatchesKey(baseKey, summaryImageCacheKey({ ...result, people: [{ ...result.people[0], total: result.people[0].total + 1 }, result.people[1]] }, "THB", "0891234567", "blob:qr-1"))).toBe(false);
    expect(preparedImageMatchesKey(baseKey, summaryImageCacheKey({ ...result, people: [{ ...result.people[0], participantId: "changed" }, result.people[1]] }, "THB", "0891234567", "blob:qr-1"))).toBe(false);
  });

  it("requires a valid PromptPay for THB text and uploaded QR for an image", () => {
    expect(sharingAvailability("THB", "089-123-4567", false)).toEqual({ canCopy: true, canShareImage: false });
    expect(sharingAvailability("THB", "123", true)).toEqual({ canCopy: false, canShareImage: true });
    expect(sharingAvailability("USD", "", true)).toEqual({ canCopy: false, canShareImage: true });
    expect(sharingAvailability("USD", "", false)).toEqual({ canCopy: false, canShareImage: false });
  });

  it("includes totals, disambiguated names, and a compact PromptPay number", () => {
    const text = buildShareText(result, "THB", "089-123-4567");
    expect(text).toContain("ยอดรวม: ฿100.01");
    expect(text).toContain("1. Boss: ฿50.01");
    expect(text).toContain("2. Boss: ฿50.00");
    expect(text).toContain("PromptPay: 0891234567");
  });

  it("uses currency-specific text and does not show PromptPay for USD", () => {
    const text = buildShareText(result, "USD", "0891234567");
    expect(text).toContain("$100.01");
    expect(text).toContain("ชำระผ่าน QR ในรูปสรุปบิล");
    expect(text).not.toContain("PromptPay:");
  });

  it("copies with Clipboard API when available", async () => {
    const browser = fakeDocument(true);
    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
    expect(await copyTextWithFallback("summary", browser.document, clipboard)).toBe(true);
    expect(clipboard.writeText).toHaveBeenCalledWith("summary");
    expect(browser.execCommand).not.toHaveBeenCalled();
  });

  it("uses legacy copy when Clipboard API is absent or rejected and removes its textarea", async () => {
    const browser = fakeDocument(true);
    const clipboard = { writeText: vi.fn().mockRejectedValue(new Error("not secure")) };
    expect(await copyTextWithFallback("summary", browser.document, clipboard)).toBe(true);
    expect(browser.execCommand).toHaveBeenCalledWith("copy");
    expect(browser.textarea.value).toBe("summary");
    expect(browser.textarea.remove).toHaveBeenCalled();
    expect(await copyTextWithFallback("summary", browser.document)).toBe(true);
  });

  it("returns failure when both copy paths fail so UI can offer selectable text", async () => {
    const browser = fakeDocument(false);
    expect(await copyTextWithFallback("summary", browser.document, { writeText: vi.fn().mockRejectedValue(new Error("denied")) })).toBe(false);
    expect(browser.textarea.remove).toHaveBeenCalled();
  });

  it("distinguishes user cancellation from other share failures", () => {
    expect(isShareCancelled(Object.assign(new Error("cancelled"), { name: "AbortError" }))).toBe(true);
    expect(isShareCancelled(new Error("no permission"))).toBe(false);
  });

  it("creates a native share File only when the actual prepared image is accepted", () => {
    const blob = new Blob(["png"], { type: "image/png" });
    const file = { name: "splitkub-summary.png", type: "image/png" } as File;
    const createFile = vi.fn(() => file);
    expect(prepareNativeShareFile(blob, false, createFile, () => true)).toBeNull();
    expect(createFile).not.toHaveBeenCalled();
    expect(prepareNativeShareFile(blob, true, createFile, (candidate) => candidate === file)).toBe(file);
    expect(createFile).toHaveBeenCalledOnce();
    expect(prepareNativeShareFile(blob, true, () => file, () => false)).toBeNull();
    expect(prepareNativeShareFile(blob, true, () => file, () => { throw new Error("unsupported"); })).toBeNull();
  });

  it("grows the PNG canvas for many participants and rejects unsupported heights", () => {
    expect(summaryImageHeight(20)).toBeGreaterThan(summaryImageHeight(2));
    expect(() => summaryImageHeight(200)).toThrow(/มากเกินไป/);
  });

  it("waits for a decodable QR before exporting the PNG", async () => {
    class BrokenImage {
      onerror: (() => void) | null = null;
      set src(_value: string) { queueMicrotask(() => this.onerror?.()); }
    }
    const createElement = vi.fn();
    vi.stubGlobal("Image", BrokenImage);
    vi.stubGlobal("document", { createElement });
    try {
      await expect(createSummaryImage(result, "THB", "0891234567", "blob:broken")).rejects.toThrow(/อ่านรูป QR/);
      expect(createElement).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("draws the uploaded QR and payment details into a PNG", async () => {
    class WorkingImage {
      onload: (() => void) | null = null;
      naturalWidth = 320;
      naturalHeight = 320;
      set src(_value: string) { queueMicrotask(() => this.onload?.()); }
    }
    const fillText = vi.fn();
    const drawImage = vi.fn();
    const ctx = {
      fillRect: vi.fn(), beginPath: vi.fn(), arc: vi.fn(), fill: vi.fn(), moveTo: vi.fn(),
      lineTo: vi.fn(), quadraticCurveTo: vi.fn(), closePath: vi.fn(), fillText, drawImage,
      measureText: (text: string) => ({ width: text.length * 15 }),
    };
    const png = new Blob(["png"], { type: "image/png" });
    const canvas = { width: 0, height: 0, getContext: () => ctx, toBlob: (callback: (blob: Blob) => void) => callback(png) };
    vi.stubGlobal("Image", WorkingImage);
    vi.stubGlobal("document", { createElement: () => canvas });
    try {
      expect(await createSummaryImage(result, "THB", "0891234567", "blob:valid")).toBe(png);
      expect(canvas.height).toBe(summaryImageHeight(2));
      expect(drawImage).toHaveBeenCalledTimes(2);
      expect(drawImage.mock.calls.some(([image]) => image instanceof WorkingImage)).toBe(true);
      expect(fillText.mock.calls.some(([text]) => text === "0891234567")).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("uses the text brand fallback when the mascot fails without dropping the QR", async () => {
    class SelectiveImage {
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
    const png = new Blob(["png"], { type: "image/png" });
    vi.stubGlobal("Image", SelectiveImage);
    vi.stubGlobal("document", { createElement: () => ({ width: 0, height: 0, getContext: () => ctx, toBlob: (callback: (blob: Blob) => void) => callback(png) }) });
    try {
      expect(await createSummaryImage(result, "THB", "0891234567", "blob:valid")).toBe(png);
      expect(drawImage).toHaveBeenCalledOnce();
      expect(fillText.mock.calls.some(([text]) => text === "✦ SplitKub")).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
