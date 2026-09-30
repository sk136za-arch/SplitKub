import { describe, expect, it } from "vitest";
import { isValidPromptPay } from "../lib/promptpay";

describe("PromptPay", () => {
  it("accepts mobile and national ID shapes", () => {
    expect(isValidPromptPay("0891234567")).toBe(true);
    expect(isValidPromptPay("1234567890121")).toBe(true);
    expect(isValidPromptPay("089-123-4567")).toBe(true);
    expect(isValidPromptPay("123-456789-0121")).toBe(true);
  });
  it("rejects malformed IDs", () => {
    expect(isValidPromptPay("123")).toBe(false);
    expect(isValidPromptPay("0012345678")).toBe(false);
    expect(isValidPromptPay("1234567890123")).toBe(false);
    expect(isValidPromptPay("1234567890120")).toBe(false);
  });
});
