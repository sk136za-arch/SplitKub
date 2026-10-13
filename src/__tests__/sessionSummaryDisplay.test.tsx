import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SessionSummary } from "../components/SessionSummary";
import { LanguageProvider } from "../components/LanguageProvider";
import { emptySession } from "../lib/billState";
import { calculateBill } from "../lib/calculateBill";
import { defaultReceiptAdjustments } from "../lib/receiptAdjustments";

describe("rounded payment summary", () => {
  it("shows display transfer totals while keeping integer ledger details available", () => {
    const session = {
      ...emptySession(), participants: ["A", "B", "C"].map((id) => ({ id, name: id, promptPay: "" })),
      receipts: [{ id: "r", title: "Receipt", paidByParticipantId: "A", adjustments: defaultReceiptAdjustments(), items: [{ id: "i", name: "Item", price: 200000, participantIds: ["A", "B", "C"] }] }],
    };
    const result = calculateBill(session);
    const markup = renderToStaticMarkup(createElement(LanguageProvider, { initialLanguage: "th" }, createElement(SessionSummary, { result, session })));
    expect(markup).toContain("ต้องโอน ฿666.67");
    expect(markup).toContain("จะรับ ฿1,333.34");
    expect(markup).toContain("ยอดสุทธิในบัญชี");
    expect(markup).toContain("฿666.66");
  });

  it("shows both outgoing and incoming payment totals for a collector-mode payer", () => {
    const session = {
      ...emptySession(), settlementMode: "collector" as const, collectorParticipantId: "A",
      participants: ["A", "B", "C"].map((id) => ({ id, name: id, promptPay: "" })),
      receipts: [{ id: "r", title: "Receipt", paidByParticipantId: "B", adjustments: defaultReceiptAdjustments(), items: [{ id: "i", name: "Item", price: 200000, participantIds: ["A", "B", "C"] }] }],
    };
    const markup = renderToStaticMarkup(createElement(LanguageProvider, { initialLanguage: "th" }, createElement(SessionSummary, { result: calculateBill(session), session })));
    expect(markup).toContain("ต้องโอน ฿666.67");
    expect(markup).toContain("จะรับ ฿2,000.00");
  });

  it("switches summary labels to English without changing participant or receipt names", () => {
    const session = {
      ...emptySession(), participants: [{ id: "a", name: "มะลิ", promptPay: "" }],
      receipts: [{ id: "r", title: "ร้านอาหาร", paidByParticipantId: "a", adjustments: defaultReceiptAdjustments(), items: [{ id: "i", name: "ข้าว", price: 100, participantIds: ["a"] }] }],
    };
    const markup = renderToStaticMarkup(createElement(LanguageProvider, { initialLanguage: "en" }, createElement(SessionSummary, { result: calculateBill(session), session })));
    expect(markup).toContain("Total across all receipts");
    expect(markup).toContain("Payments by person");
    expect(markup).toContain("ร้านอาหาร");
    expect(markup).toContain("มะลิ");
    expect(markup).not.toContain("ยอดรวมทุกใบเสร็จ");
  });
});
