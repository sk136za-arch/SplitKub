import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SessionSummary } from "../components/SessionSummary";
import { emptySession } from "../lib/billState";
import { calculateBill } from "../lib/calculateBill";

describe("rounded payment summary", () => {
  it("shows display transfer totals while keeping integer ledger details available", () => {
    const session = {
      ...emptySession(), participants: ["A", "B", "C"].map((id) => ({ id, name: id, promptPay: "" })),
      receipts: [{ id: "r", title: "Receipt", paidByParticipantId: "A", items: [{ id: "i", name: "Item", price: 200000, participantIds: ["A", "B", "C"] }] }],
    };
    const result = calculateBill(session);
    const markup = renderToStaticMarkup(createElement(SessionSummary, { result, session }));
    expect(markup).toContain("ต้องโอน ฿666.67");
    expect(markup).toContain("จะรับ ฿1,333.34");
    expect(markup).toContain("ยอดสุทธิในบัญชี");
    expect(markup).toContain("฿666.66");
  });

  it("shows both outgoing and incoming payment totals for a collector-mode payer", () => {
    const session = {
      ...emptySession(), settlementMode: "collector" as const, collectorParticipantId: "A",
      participants: ["A", "B", "C"].map((id) => ({ id, name: id, promptPay: "" })),
      receipts: [{ id: "r", title: "Receipt", paidByParticipantId: "B", items: [{ id: "i", name: "Item", price: 200000, participantIds: ["A", "B", "C"] }] }],
    };
    const markup = renderToStaticMarkup(createElement(SessionSummary, { result: calculateBill(session), session }));
    expect(markup).toContain("ต้องโอน ฿666.67");
    expect(markup).toContain("จะรับ ฿2,000.00");
  });
});
