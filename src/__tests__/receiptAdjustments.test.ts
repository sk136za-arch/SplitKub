import { describe, expect, it } from "vitest";
import { emptySession, sessionReducer } from "../lib/billState";
import { calculateBill } from "../lib/calculateBill";
import { defaultReceiptAdjustments } from "../lib/receiptAdjustments";
import { previewReceiptAdjustments } from "../lib/receiptAdjustmentValidation";
import type { ReceiptAdjustments, SplitSession } from "../types/bill";

const adjusted = (override: Partial<ReceiptAdjustments>): ReceiptAdjustments => ({ ...defaultReceiptAdjustments(), ...override });

function fixture(adjustments: ReceiptAdjustments): SplitSession {
  return {
    ...emptySession(), participants: ["A", "B", "C"].map((id) => ({ id, name: id, promptPay: "" })),
    receipts: [{ id: "r", title: "Receipt", paidByParticipantId: "A", adjustments, items: [
      { id: "ab", name: "A and B", price: 10000, participantIds: ["A", "B"] },
      { id: "ac", name: "A and C", price: 5001, participantIds: ["A", "C"] },
      { id: "bc", name: "B and C", price: 2003, participantIds: ["B", "C"] },
    ] }],
  };
}

describe("per-receipt adjustments", () => {
  it("applies pre-discount, service, and VAT in order with largest remainders", () => {
    const session = fixture(adjusted({ preDiscountEnabled: true, preDiscount: 1001,
      serviceChargeEnabled: true, vatEnabled: true }));
    const result = calculateBill(session);
    expect(result.receipts[0]).toMatchObject({ subtotal: 17004, preDiscount: 1001, serviceCharge: 1600,
      vat: 1232, postDiscount: 0, total: 18835 });
    expect(result.people.map((person) => person.owed)).toEqual([8435, 6671, 3729]);
    expect(result.people.map((person) => person.paid)).toEqual([18835, 0, 0]);
    for (const person of result.people) {
      expect(person.breakdown.reduce((sum, row) => sum + row.amount, 0)).toBe(person.owed);
      expect(person.breakdown.filter((row) => row.kind === "item").every((row) => row.amount >= 0)).toBe(true);
    }
    expect(result.people.reduce((sum, person) => sum + person.net, 0)).toBe(0);
  });

  it("applies post-discount only after service and VAT", () => {
    const result = calculateBill(fixture(adjusted({ serviceChargeEnabled: true, vatEnabled: true,
      postDiscountEnabled: true, postDiscount: 1001 })));
    expect(result.receipts[0]).toMatchObject({ subtotal: 17004, preDiscount: 0, serviceCharge: 1700,
      vat: 1309, postDiscount: 1001, total: 19012 });
    expect(result.people.map((person) => person.owed)).toEqual([8494, 6730, 3788]);
  });

  it("rounds tiny fees half-up and breaks equal remainders in participant order", () => {
    const session = fixture(adjusted({ serviceChargeEnabled: true, serviceChargeRateBps: 500,
      vatEnabled: true }));
    session.receipts[0].items = ["A", "B", "C"].map((id) => ({ id, name: id, price: 10,
      participantIds: [id] }));
    const result = calculateBill(session);
    expect(result.receipts[0]).toMatchObject({ subtotal: 30, serviceCharge: 2, vat: 2, total: 34 });
    expect(result.people.map((person) => person.owed)).toEqual([12, 12, 10]);
  });

  it("rejects a discount that makes any participant negative, but permits zero final", () => {
    const session = fixture(adjusted({ preDiscountEnabled: true, preDiscount: 2 }));
    session.receipts[0].items = [
      { id: "a", name: "Small", price: 1, participantIds: ["A"] },
      { id: "b", name: "Large", price: 99, participantIds: ["B"] },
    ];
    session.receipts[0].adjustments.preDiscount = 3;
    expect(() => calculateBill(session)).toThrow(/ส่วนของบางคน/);
    session.receipts[0].adjustments = adjusted({ postDiscountEnabled: true, postDiscount: 3 });
    expect(() => calculateBill(session)).toThrow(/ส่วนของบางคน/);
    session.receipts[0].adjustments.postDiscount = 2;
    expect(calculateBill(session).people.map((person) => person.owed)).toEqual([0, 98, 0]);
  });

  it("keeps disabled stored values inert and reducer defaults independent", () => {
    const session = fixture(adjusted({ vatRateBps: 900, serviceChargeRateBps: 1200,
      preDiscount: 999, postDiscount: 777 }));
    expect(calculateBill(session).total).toBe(17004);
    const next = sessionReducer(session, { type: "add-receipt", id: "r2", title: "Second" });
    expect(next.receipts[1].adjustments).toEqual(defaultReceiptAdjustments());
    expect(next.receipts[1].adjustments).not.toBe(session.receipts[0].adjustments);
    expect(sessionReducer(next, { type: "set-receipt-adjustments", receiptId: "r2",
      adjustments: adjusted({ vatEnabled: true, vatRateBps: 0 }) })).toBe(next);
  });

  it("uses exact signed intermediates when a large fee is cancelled by a large discount", () => {
    const max = BigInt(Number.MAX_SAFE_INTEGER);
    const aTotal = Number(BigInt(3) * max / BigInt(4));
    const aFirst = Math.floor(aTotal / 2);
    const session = fixture(adjusted({ serviceChargeEnabled: true, serviceChargeRateBps: 10000,
      postDiscountEnabled: true, postDiscount: Number(max) }));
    session.participants = ["A", "B"].map((id) => ({ id, name: id, promptPay: "" }));
    session.receipts[0].items = [
      { id: "a1", name: "A one", price: aFirst, participantIds: ["A"] },
      { id: "a2", name: "A two", price: aTotal - aFirst, participantIds: ["A"] },
      { id: "b", name: "B", price: Number(max) - aTotal, participantIds: ["B"] },
    ];
    const result = calculateBill(session);
    expect(result.receipts[0].total).toBe(Number(max));
    expect(result.total).toBe(Number(max));
    expect(result.people.map((person) => person.owed)).toEqual([Number(max) - 1, 1]);
  });

  it("previews and rejects an adjustment that would make one participant negative", () => {
    const session = fixture(adjusted({}));
    session.receipts[0].items = [
      { id: "a", name: "Small", price: 1, participantIds: ["A"] },
      { id: "b", name: "Large", price: 99, participantIds: ["B"] },
    ];
    const preview = previewReceiptAdjustments(session, "r", adjusted({ preDiscountEnabled: true, preDiscount: 3 }));
    expect(preview.total).toBeNull();
    expect(preview.error).toContain("ส่วนของบางคน");
    expect(session.receipts[0].adjustments).toEqual(adjusted({}));
  });

  it("previews the full subtotal-to-final chain for a valid candidate", () => {
    const session = fixture(adjusted({}));
    const preview = previewReceiptAdjustments(session, "r", adjusted({ serviceChargeEnabled: true }));
    expect(preview.error).toBeNull();
    expect(preview.total).toMatchObject({ subtotal: 17004, preDiscount: 0, serviceCharge: 1700, vat: 0, postDiscount: 0, total: 18704 });
  });
});
