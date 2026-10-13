import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "../components/LanguageProvider";
import { ReceiptEditor } from "../components/ReceiptEditor";
import { SettlementSettings } from "../components/SettlementSettings";
import { emptySession } from "../lib/billState";
import { defaultReceiptAdjustments } from "../lib/receiptAdjustments";
import type { SplitSession } from "../types/bill";

function session(): SplitSession {
  return {
    ...emptySession(), participants: [{ id: "a", name: "มะลิ", promptPay: "" }],
    receipts: [{ id: "r", title: "ร้านอาหาร", paidByParticipantId: "a", adjustments: defaultReceiptAdjustments(),
      items: [{ id: "i", name: "ข้าว", price: 100, participantIds: ["a"] }] }],
  };
}

function renderReceipt(language: "th" | "en") {
  const bill = session();
  return renderToStaticMarkup(createElement(LanguageProvider, { initialLanguage: language }, createElement(ReceiptEditor, {
    receipt: bill.receipts[0], session: bill, participants: bill.participants, currency: bill.currency,
    onRename: vi.fn(async () => true), onRemove: vi.fn(), onSetPayer: vi.fn(),
    onSetAdjustments: vi.fn(async () => true), onAddItem: vi.fn(async () => true),
    onEditItem: vi.fn(async () => true), onRemoveItem: vi.fn(), onToggle: vi.fn(), onSelectAll: vi.fn(),
  })));
}

describe("editor language", () => {
  it("keeps Thai as the default editor language", () => {
    const markup = renderReceipt("th");
    expect(markup).toContain("คนที่จ่ายใบเสร็จนี้");
    expect(markup).toContain("ใครร่วมรายการนี้");
    expect(markup).toContain("ร้านอาหาร");
  });

  it("renders English receipt actions, labels, and accessible names without translating user data", () => {
    const markup = renderReceipt("en");
    expect(markup).toContain("Person who paid this receipt");
    expect(markup).toContain("Who shares this item?");
    expect(markup).toContain("Additional calculations");
    expect(markup).toContain("Remove receipt ร้านอาหาร");
    expect(markup).toContain("Participants for ข้าว");
    expect(markup).toContain("ร้านอาหาร");
    expect(markup).toContain("มะลิ");
    expect(markup).not.toContain("คนที่จ่ายใบเสร็จนี้");
  });

  it("renders both settlement modes in English without changing participant names", () => {
    const bill = session();
    const props = { session: bill, disabled: false, onChange: vi.fn() };
    const direct = renderToStaticMarkup(createElement(LanguageProvider, { initialLanguage: "en" }, createElement(SettlementSettings, props)));
    expect(direct).toContain("Payment method");
    expect(direct).toContain("Direct transfers (default)");
    expect(direct).toContain("Collect through มะลิ");
    const collector = renderToStaticMarkup(createElement(LanguageProvider, { initialLanguage: "en" }, createElement(SettlementSettings, {
      ...props, session: { ...bill, settlementMode: "collector" as const, collectorParticipantId: "a" },
    })));
    expect(collector).toContain("Everyone sends their full share to the collector");
  });
});
