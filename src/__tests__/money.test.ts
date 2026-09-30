import { describe, expect, it } from "vitest";
import { formatMoney, moneyInput, parseMoney, sumMoneyChecked } from "../lib/money";

describe("money", () => {
  it("parses decimal text into integer minor units", () => {
    expect(parseMoney("199.50")).toBe(19950);
    expect(parseMoney("0.01")).toBe(1);
    expect(parseMoney(" 100 ")).toBe(10000);
  });
  it.each(["", "abc", "0", "0.00", "-1", "1.234", "1.", "1,000", "9999999999999999999"])("rejects %s", (value) => {
    expect(parseMoney(value)).toBeNull();
  });
  it("formats both currencies", () => {
    expect(formatMoney(19950, "THB")).toContain("199.50");
    expect(formatMoney(1999, "USD")).toBe("$19.99");
  });
  it("preserves the largest accepted safe integer minor-unit amount", () => {
    const max = Number.MAX_SAFE_INTEGER;
    expect(parseMoney("90071992547409.91")).toBe(max);
    expect(parseMoney("90071992547409.92")).toBeNull();
    expect(moneyInput(max)).toBe("90071992547409.91");
    expect(formatMoney(max, "USD")).toBe("$90,071,992,547,409.91");
  });
  it("checks aggregate totals without overflowing safe integer precision", () => {
    expect(sumMoneyChecked([Number.MAX_SAFE_INTEGER - 1, 1])).toBe(Number.MAX_SAFE_INTEGER);
    expect(sumMoneyChecked([Number.MAX_SAFE_INTEGER, 1])).toBeNull();
    expect(sumMoneyChecked([100, Number.NaN])).toBeNull();
  });
});
