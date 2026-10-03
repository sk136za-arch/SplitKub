import { describe, expect, it, vi } from "vitest";
import { emptySession } from "../lib/billState";
import { calculateBill } from "../lib/calculateBill";
import { buildSessionShareText } from "../lib/share";
import { createSessionSummaryImage, sessionSummaryImageHeight } from "../lib/summaryImage";
import { displayPaymentTotals, summaryTransferRows } from "../lib/summaryTransferPresentation";
import type { SplitSession } from "../types/bill";

function sharedItem(price: number, count = 3, payerId = "A"): SplitSession {
  const people = ["A", "B", "C", "D", "E"].slice(0, count);
  return {
    ...emptySession(), participants: people.map((id) => ({ id, name: id, promptPay: "" })),
    receipts: [{ id: "r", title: "Receipt", paidByParticipantId: payerId,
      items: [{ id: "i", name: "Item", price, participantIds: people }] }],
  };
}

describe("consistent rounded payment presentation", () => {
  it("rounds display amounts up without changing ledger endpoints, order, or kinds", () => {
    const session = sharedItem(200000); // ฿2,000.00 / 3 = ฿666.666…
    const result = calculateBill(session);
    const original = structuredClone(result);
    const text = buildSessionShareText(result, session);
    expect(result.transfers.map((route) => route.amount)).toEqual([66667, 66666]);
    expect(summaryTransferRows(session, result).map((route) => route.amount)).toEqual([66667, 66667]);
    expect(summaryTransferRows(session, result).map(({ fromParticipantId, toParticipantId, kind }) => [fromParticipantId, toParticipantId, kind]))
      .toEqual(result.transfers.map(({ fromParticipantId, toParticipantId, kind }) => [fromParticipantId, toParticipantId, kind]));
    expect(summaryTransferRows(session, result).every((route, index) => route.amount >= result.transfers[index].amount)).toBe(true);
    expect(result).toEqual(original);
    expect(buildSessionShareText(result, session)).toBe(text);
    expect(text).toContain("C → A: ฿666.67");
    expect(text).toContain("C: ต้องโอน ฿666.67 · จะรับ ฿0.00");
    expect(displayPaymentTotals(["A", "B", "C"], summaryTransferRows(session, result)))
      .toEqual([{ participantId: "A", outgoing: 0, incoming: 133334 }, { participantId: "B", outgoing: 66667, incoming: 0 }, { participantId: "C", outgoing: 66667, incoming: 0 }]);
  });

  it("leaves exact direct amounts unchanged", () => {
    const session = sharedItem(510000); // ฿5,100.00 / 3 = ฿1,700.00
    const result = calculateBill(session);
    expect(summaryTransferRows(session, result)).toEqual(result.transfers);
  });

  it("adds a direct rounding delta only to the payer's last existing route", () => {
    const session: SplitSession = {
      ...emptySession(), participants: ["A", "B", "C"].map((id) => ({ id, name: id, promptPay: "" })),
      receipts: [
        { id: "r1", title: "R1", paidByParticipantId: "A", items: [{ id: "i1", name: "I1", price: 3, participantIds: ["A", "B"] }] },
        { id: "r2", title: "R2", paidByParticipantId: "C", items: [{ id: "i2", name: "I2", price: 5, participantIds: ["B", "C"] }] },
        { id: "r3", title: "R3", paidByParticipantId: "A", items: [{ id: "i3", name: "I3", price: 1, participantIds: ["A", "B", "C"] }] },
      ],
    };
    const result = calculateBill(session);
    const before = structuredClone(result);
    const display = summaryTransferRows(session, result);
    expect(result.transfers.map(({ fromParticipantId, toParticipantId, amount }) => [fromParticipantId, toParticipantId, amount]))
      .toEqual([["B", "A", 1], ["B", "C", 3]]);
    expect(display.map(({ fromParticipantId, toParticipantId, amount }) => [fromParticipantId, toParticipantId, amount]))
      .toEqual([["B", "A", 1], ["B", "C", 4]]);
    expect(result).toEqual(before);
  });

  it("aggregates multiple raw item shares before a single collector ceiling", () => {
    const session = sharedItem(2, 5);
    session.receipts[0].items.push({ id: "i2", name: "Second", price: 2, participantIds: ["A", "B", "C", "D", "E"] });
    session.settlementMode = "collector";
    session.collectorParticipantId = "B";
    const result = calculateBill(session);
    const ledgerCollection = result.transfers.find((route) => route.kind === "collection" && route.fromParticipantId === "A")!;
    const displayCollection = summaryTransferRows(session, result).find((route) => route.kind === "collection" && route.fromParticipantId === "A")!;
    expect([ledgerCollection.toParticipantId, ledgerCollection.amount]).toEqual(["B", 2]);
    expect([displayCollection.toParticipantId, displayCollection.amount]).toEqual(["B", 2]);
    expect(summaryTransferRows(session, result).map(({ fromParticipantId, toParticipantId, kind }) => [fromParticipantId, toParticipantId, kind]))
      .toEqual(result.transfers.map(({ fromParticipantId, toParticipantId, kind }) => [fromParticipantId, toParticipantId, kind]));
  });

  it("keeps the ledger direction for two 0.01 receipts split among A, B, and C", () => {
    const session: SplitSession = {
      ...emptySession(), participants: ["A", "B", "C"].map((id) => ({ id, name: id, promptPay: "" })),
      receipts: ["A", "B"].map((payerId, index) => ({
        id: `r${index}`, title: `Receipt ${index}`, paidByParticipantId: payerId,
        items: [{ id: `i${index}`, name: "Item", price: 1, participantIds: ["A", "B", "C"] }],
      })),
    };
    const result = calculateBill(session);
    const display = summaryTransferRows(session, result);
    expect(result.transfers.map(({ fromParticipantId, toParticipantId }) => [fromParticipantId, toParticipantId])).toEqual([["A", "B"]]);
    expect(display.map(({ fromParticipantId, toParticipantId, kind }) => [fromParticipantId, toParticipantId, kind]))
      .toEqual(result.transfers.map(({ fromParticipantId, toParticipantId, kind }) => [fromParticipantId, toParticipantId, kind]));
    expect(display).toHaveLength(1);
    expect(display[0].amount).toBeGreaterThanOrEqual(result.transfers[0].amount);
  });

  it("ceil-rounds aggregate collector debt on the existing route without adding recipients", () => {
    const session: SplitSession = {
      ...emptySession(), settlementMode: "collector", collectorParticipantId: "A",
      participants: ["A", "B", "C"].map((id) => ({ id, name: id, promptPay: "" })),
      receipts: [
        { id: "single", title: "Single", paidByParticipantId: "A", items: [{ id: "single-item", name: "Single", price: 1, participantIds: ["B"] }] },
        ...[1, 2, 3, 4].map((index) => ({ id: `shared-${index}`, title: `Shared ${index}`, paidByParticipantId: "A", items: [{ id: `shared-item-${index}`, name: "Shared", price: 1, participantIds: ["A", "B", "C"] }] })),
      ],
    };
    const result = calculateBill(session);
    const before = structuredClone(result);
    const display = summaryTransferRows(session, result);
    expect(result.transfers.map(({ fromParticipantId, toParticipantId, amount, kind }) => [fromParticipantId, toParticipantId, amount, kind]))
      .toEqual([["B", "A", 1, "collection"]]);
    expect(display.map(({ fromParticipantId, toParticipantId, amount, kind }) => [fromParticipantId, toParticipantId, amount, kind]))
      .toEqual([["B", "A", 3, "collection"]]);
    expect(result).toEqual(before);
  });

  it("ceil-rounds collector inbound routes but keeps reimbursements at exact paid amounts", () => {
    const session = sharedItem(200000, 3, "B");
    session.settlementMode = "collector";
    session.collectorParticipantId = "A";
    const result = calculateBill(session);
    expect(summaryTransferRows(session, result).map((route) => [route.kind, route.amount])).toEqual([
      ["collection", 66667], ["collection", 66667], ["reimbursement", 200000],
    ]);
    expect(result.transfers.map((route) => [route.kind, route.amount])).toEqual([
      ["collection", 66667], ["collection", 66666], ["reimbursement", 200000],
    ]);
    expect(summaryTransferRows(session, result)[2]).toEqual(result.transfers[2]);
    expect(summaryTransferRows(session, result)[2].receiptBreakdown).toEqual([{ receiptId: "r", receiptTitle: "Receipt", amount: 200000 }]);
  });

  it("renders the same presentation amounts in PNG and copied text", async () => {
    const session = sharedItem(200000);
    const result = calculateBill(session);
    class BrowserImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      naturalWidth = 320;
      naturalHeight = 320;
      set src(value: string) { queueMicrotask(() => value.includes("splitkub-mascot") ? this.onerror?.() : this.onload?.()); }
    }
    const rendered: string[] = [];
    const ctx = {
      fillRect: vi.fn(), beginPath: vi.fn(), arc: vi.fn(), fill: vi.fn(), moveTo: vi.fn(),
      lineTo: vi.fn(), quadraticCurveTo: vi.fn(), closePath: vi.fn(), drawImage: vi.fn(),
      fillText: (text: string) => { rendered.push(text); },
      measureText: (text: string) => ({ width: text.length * 15 }),
    };
    vi.stubGlobal("Image", BrowserImage);
    vi.stubGlobal("document", { createElement: () => ({ width: 0, height: 0, getContext: () => ctx,
      toBlob: (callback: (value: Blob) => void) => callback(new Blob(["png"])) }) });
    try {
      await createSessionSummaryImage(result, session, "blob:qr", "A");
      expect(sessionSummaryImageHeight(1, 3, 1) - sessionSummaryImageHeight(1, 2, 1)).toBe(160);
      expect(rendered).toContain("ต้องโอน ฿666.67");
      expect(rendered).toContain("ยอดสุทธิในบัญชี: ต้องจ่ายสุทธิ ฿666.66");
      expect(rendered.filter((line) => line.includes("฿666.66"))).toEqual(["ยอดสุทธิในบัญชี: ต้องจ่ายสุทธิ ฿666.66"]);
      expect(rendered[rendered.indexOf("B → A") + 1]).toBe("฿666.67");
      expect(rendered[rendered.indexOf("C → A") + 1]).toBe("฿666.67");
      expect(buildSessionShareText(result, session)).toContain("C → A: ฿666.67");
    } finally { vi.unstubAllGlobals(); }
  });

  it("shows both display totals for collector cards", async () => {
    const session = sharedItem(200000, 3, "B");
    session.settlementMode = "collector";
    session.collectorParticipantId = "A";
    const result = calculateBill(session);
    class BrowserImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      naturalWidth = 320;
      naturalHeight = 320;
      set src(value: string) { queueMicrotask(() => value.includes("splitkub-mascot") ? this.onerror?.() : this.onload?.()); }
    }
    const rendered: string[] = [];
    const ctx = {
      fillRect: vi.fn(), beginPath: vi.fn(), arc: vi.fn(), fill: vi.fn(), moveTo: vi.fn(),
      lineTo: vi.fn(), quadraticCurveTo: vi.fn(), closePath: vi.fn(), drawImage: vi.fn(),
      fillText: (text: string) => { rendered.push(text); },
      measureText: (text: string) => ({ width: text.length * 15 }),
    };
    vi.stubGlobal("Image", BrowserImage);
    vi.stubGlobal("document", { createElement: () => ({ width: 0, height: 0, getContext: () => ctx,
      toBlob: (callback: (value: Blob) => void) => callback(new Blob(["png"])) }) });
    try {
      await createSessionSummaryImage(result, session, "blob:qr", "A");
      expect(rendered).toContain("ต้องโอน ฿2,000.00 · จะรับ ฿1,333.34");
      expect(rendered).toContain("ต้องโอน ฿666.67 · จะรับ ฿2,000.00");
    } finally { vi.unstubAllGlobals(); }
  });

  it("labels a person with no payment routes and retains their exact zero net", async () => {
    const session: SplitSession = {
      ...emptySession(), participants: ["A", "B", "C"].map((id) => ({ id, name: id, promptPay: "" })),
      receipts: [{ id: "r", title: "Receipt", paidByParticipantId: "A", items: [{ id: "i", name: "Item", price: 10000, participantIds: ["A", "B"] }] }],
    };
    const result = calculateBill(session);
    class BrowserImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      naturalWidth = 320;
      naturalHeight = 320;
      set src(value: string) { queueMicrotask(() => value.includes("splitkub-mascot") ? this.onerror?.() : this.onload?.()); }
    }
    const rendered: string[] = [];
    const ctx = {
      fillRect: vi.fn(), beginPath: vi.fn(), arc: vi.fn(), fill: vi.fn(), moveTo: vi.fn(),
      lineTo: vi.fn(), quadraticCurveTo: vi.fn(), closePath: vi.fn(), drawImage: vi.fn(),
      fillText: (text: string) => { rendered.push(text); },
      measureText: (text: string) => ({ width: text.length * 15 }),
    };
    vi.stubGlobal("Image", BrowserImage);
    vi.stubGlobal("document", { createElement: () => ({ width: 0, height: 0, getContext: () => ctx,
      toBlob: (callback: (value: Blob) => void) => callback(new Blob(["png"])) }) });
    try {
      await createSessionSummaryImage(result, session, "blob:qr", "A");
      expect(rendered).toContain("ไม่มีรายการโอน");
      expect(rendered).toContain("ยอดสุทธิในบัญชี: พอดี ฿0.00");
    } finally { vi.unstubAllGlobals(); }
  });
});
