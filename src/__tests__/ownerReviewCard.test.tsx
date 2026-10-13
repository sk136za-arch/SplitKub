import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { OwnerReviewCard } from "../components/OwnerReviewCard";
import { LanguageProvider } from "../components/LanguageProvider";
import { emptySession } from "../lib/billState";
import type { SplitSession } from "../types/bill";

function reviewSession(): SplitSession {
  return {
    ...emptySession(), revision: 4,
    participants: [
      { id: "a", name: "Alex", promptPay: "" },
      { id: "b", name: "Alex", promptPay: "" },
      { id: "c", name: "Bo", promptPay: "" },
      { id: "d", name: "Dee", promptPay: "" },
    ],
    confirmations: [
      { participantId: "b", viewedAt: "2026-10-13T01:00:00Z", confirmedAt: "", confirmedContentRevision: null },
      { participantId: "c", viewedAt: "2026-10-13T02:00:00Z", confirmedAt: "2026-10-13T03:00:00Z", confirmedContentRevision: 4 },
      { participantId: "d", viewedAt: "2026-10-13T04:00:00Z", confirmedAt: "2026-10-13T05:00:00Z", confirmedContentRevision: 3 },
    ],
  };
}

function render(session = reviewSession(), selectedParticipantId = "c", disabled = false, language: "th" | "en" = "th") {
  return renderToStaticMarkup(createElement(LanguageProvider, { initialLanguage: language }, createElement(OwnerReviewCard, {
    session, selectedParticipantId, disabled,
    onSelectParticipant: vi.fn(), onConfirm: vi.fn(),
  })));
}

describe("owner review card", () => {
  it("lists every participant with stable duplicate-name labels, four states, timestamps, and current count", () => {
    const markup = render();
    expect(markup).toContain("ยืนยันแล้ว 1/4 คน");
    expect(markup).toContain("1. Alex");
    expect(markup).toContain("2. Alex");
    expect(markup).toContain("ยังไม่เปิดดู");
    expect(markup).toContain("ดูแล้ว ยังไม่ยืนยัน");
    expect(markup).toContain("ยืนยันยอดล่าสุดแล้ว");
    expect(markup).toContain("ต้องยืนยันใหม่");
    expect(markup).toContain('dateTime="2026-10-13T01:00:00Z"');
    expect(markup).toContain('dateTime="2026-10-13T05:00:00Z"');
    expect(markup).toContain("เปิดดู: ยังไม่มี");
    expect(markup).toContain("ยืนยัน: ยังไม่มี");
    expect((markup.match(/<li /g) ?? []).length).toBe(4);
    expect((markup.match(/<button /g) ?? []).length).toBe(1);
    expect(markup).toContain("ยกเลิกคำยืนยันของฉัน");
  });

  it("marks an old confirmation stale after a content revision without counting it", () => {
    const session = reviewSession();
    session.revision = 5;
    const markup = render(session);
    expect(markup).toContain("ยืนยันแล้ว 0/4 คน");
    expect((markup.match(/>ต้องยืนยันใหม่<\/span>/g) ?? []).length).toBe(2);
    expect(markup).toContain("ยืนยันยอดของฉัน");
  });

  it("keeps the full read-only status list after closing while removing confirmation controls", () => {
    const session = reviewSession();
    session.closedAt = "2026-10-13T06:00:00Z";
    const markup = render(session);
    expect(markup).toContain("ยืนยันแล้ว 1/4 คน");
    expect(markup).toContain("ต้องยืนยันใหม่");
    expect(markup).not.toContain("owner-review-identity");
    expect(markup).not.toContain("<button");
  });

  it("disables the separate owner controls while remote state is unavailable", () => {
    const markup = render(reviewSession(), "c", true);
    expect(markup).toMatch(/<select[^>]*disabled/);
    expect(markup).toMatch(/<button[^>]*disabled/);
  });

  it("renders English review states and dates while preserving duplicate participant names", () => {
    const markup = render(reviewSession(), "c", false, "en");
    expect(markup).toContain("Confirmed 1/4 people");
    expect(markup).toContain("Not viewed yet");
    expect(markup).toContain("Viewed, not confirmed");
    expect(markup).toContain("Confirmed for the latest bill");
    expect(markup).toContain("Needs reconfirmation");
    expect(markup).toContain("1. Alex");
    expect(markup).toContain("Oct");
    expect(markup).not.toContain("ยังไม่เปิดดู");
  });
});
