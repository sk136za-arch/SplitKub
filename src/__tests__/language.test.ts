import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LanguageProvider } from "../components/LanguageProvider";
import { LanguageSwitcher } from "../components/LanguageSwitcher";
import { SuccessToast } from "../components/SuccessToast";
import { emptySession } from "../lib/billState";
import { domainErrorMessage } from "../lib/domainErrorMessage";
import { dateLocale, LANGUAGE_STORAGE_KEY, parseLanguage, readLanguage, saveLanguage } from "../lib/language";
import { buildShareText } from "../lib/share";
import { SHARED_ERROR_MESSAGES, sharedErrorMessage } from "../lib/sharedErrorMessage";
import { resolveManualCopyText } from "../lib/manualCopy";
import { legacyPromptPayMigrationNotice } from "../lib/storage";
import type { SharedBillErrorCode } from "../lib/supabase/sharedBill";
import { sessionSummaryImageCacheKey, summaryImageCacheKey } from "../lib/summaryImage";
import type { BillResult, SessionResult } from "../lib/calculateBill";

describe("language preference and presentation", () => {
  it("defaults to Thai for missing, malformed, and inaccessible storage", () => {
    expect(parseLanguage(null)).toBe("th");
    expect(parseLanguage("fr")).toBe("th");
    expect(readLanguage({ getItem: () => "en" })).toBe("en");
    expect(readLanguage({ getItem: () => "invalid" })).toBe("th");
    expect(readLanguage({ getItem: () => { throw Error("blocked"); } })).toBe("th");
    expect(() => saveLanguage({ setItem: () => { throw Error("blocked"); } }, "en")).not.toThrow();
    let saved = "";
    saveLanguage({ setItem: (key, value) => { expect(key).toBe(LANGUAGE_STORAGE_KEY); saved = value; } }, "en");
    expect(saved).toBe("en");
    expect(dateLocale("en")).toBe("en-US");
    expect(dateLocale("th")).toBe("th-TH");
  });

  it("renders an accessible bilingual switcher without changing bill data", () => {
    const english = renderToStaticMarkup(createElement(LanguageProvider, { initialLanguage: "en" }, createElement(LanguageSwitcher)));
    expect(english).toContain('aria-label="Language"');
    expect(english).toContain('lang="th"');
    expect(english).toContain('lang="en"');
    expect(english).toContain('aria-pressed="true"');
    const thai = renderToStaticMarkup(createElement(LanguageProvider, {}, createElement(LanguageSwitcher)));
    expect(thai).toContain('aria-label="ภาษา"');
  });

  it("localizes the legacy PromptPay migration banner while preserving the number", () => {
    expect(legacyPromptPayMigrationNotice("0891234567")).toContain("พบ PromptPay เดิม (0891234567)");
    expect(legacyPromptPayMigrationNotice("0891234567", "en")).toBe(
      "Found a legacy PromptPay number (0891234567) that is not assigned to anyone. Choose its recipient or explicitly discard it.",
    );
  });

  it("recomputes summary copy on language changes but preserves literal link fallback", () => {
    expect(resolveManualCopyText({ text: "Thai summary", followsLanguage: true }, "English summary")).toBe("English summary");
    expect(resolveManualCopyText({ text: "https://example.test/#token=abc", followsLanguage: false }, "English summary"))
      .toBe("https://example.test/#token=abc");
  });

  it("localizes the success toast dismiss label", () => {
    const markup = renderToStaticMarkup(createElement(LanguageProvider, { initialLanguage: "en" },
      createElement(SuccessToast, { toast: { id: 1, text: "Copied" }, onDismiss: () => {} })));
    expect(markup).toContain('aria-label="Dismiss notification"');
  });

  it("localizes known errors and preserves user-entered names", () => {
    expect(sharedErrorMessage({ code: "bill_closed" }, "en")).toContain("closed");
    expect(sharedErrorMessage({ code: "bill_closed" })).toContain("ปิดแล้ว");
    expect(domainErrorMessage(Error("เลือกผู้จ่ายสำหรับ ร้านคุณแม่"), "en")).toBe("Select a payer for ร้านคุณแม่");
  });

  it("localizes every shared-bill error code without exposing server messages", () => {
    const codes = ["disabled", "not_configured", "auth_required", "invalid_token", "unavailable", "revision_conflict",
      "participant_not_claimed", "owner_cannot_claim", "item_not_in_receipt", "validation", "migration_required",
      "realtime_unavailable", "bill_closed", "confirmations_incomplete", "rate_limited", "network", "unknown"] satisfies SharedBillErrorCode[];
    expect(Object.keys(SHARED_ERROR_MESSAGES).sort()).toEqual([...codes].sort());
    for (const code of codes) {
      const english = sharedErrorMessage({ code, message: "SERVER_ONLY_MESSAGE" }, "en");
      const thai = sharedErrorMessage({ code, message: "SERVER_ONLY_MESSAGE" }, "th");
      expect(english).toBe(SHARED_ERROR_MESSAGES[code].en);
      expect(thai).toBe(SHARED_ERROR_MESSAGES[code].th);
      expect(english).not.toContain("SERVER_ONLY_MESSAGE");
      expect(thai).not.toContain("SERVER_ONLY_MESSAGE");
    }
    expect(sharedErrorMessage({ code: "future_server_code", message: "SERVER_ONLY_MESSAGE" }, "en")).toBe(SHARED_ERROR_MESSAGES.unknown.en);
  });

  it("localizes copy while preserving amounts and changing the PNG cache identity", () => {
    const bill: BillResult = { total: 100, people: [{ participantId: "a", name: "มะลิ", total: 100, breakdown: [] }] };
    const thai = buildShareText(bill, "THB", "", "th");
    const english = buildShareText(bill, "THB", "", "en");
    expect(thai).toContain("ยอดรวม: ฿1.00");
    expect(english).toContain("Total: ฿1.00");
    expect(english).toContain("มะลิ");
    expect(english).not.toContain("ยอดรวม");
    expect(summaryImageCacheKey(bill, "THB", "", "blob:qr", "th")).not.toBe(summaryImageCacheKey(bill, "THB", "", "blob:qr", "en"));
    const session = emptySession();
    const result: SessionResult = { total: 0, receipts: [], people: [], transfers: [] };
    expect(sessionSummaryImageCacheKey(result, session, "blob:qr", "", "th")).not.toBe(sessionSummaryImageCacheKey(result, session, "blob:qr", "", "en"));
  });
});
