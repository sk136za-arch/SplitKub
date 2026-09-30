import type { Currency, Money } from "@/types/bill";

/** Parses a positive decimal amount without any floating point multiplication. */
export function parseMoney(input: string): Money | null {
  const normalized = input.trim();
  if (normalized.length > 32 || !/^(?:\d+)(?:\.\d{1,2})?$/.test(normalized)) return null;
  const [whole, fraction = ""] = normalized.split(".");
  const value = BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, "0"));
  return value > BigInt(0) && value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null;
}

export function formatMoney(value: Money, currency: Currency): string {
  const minorUnits = BigInt(value);
  const whole = minorUnits / BigInt(100);
  const fraction = (minorUnits % BigInt(100)).toString().padStart(2, "0");
  const locale = currency === "THB" ? "th-TH" : "en-US";
  const currencyParts = new Intl.NumberFormat(locale, {
    style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).formatToParts(0);
  const groupedWhole = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(whole);
  let insertedWhole = false;
  return currencyParts.map((part) => {
    if (part.type === "integer") {
      if (insertedWhole) return "";
      insertedWhole = true;
      return groupedWhole;
    }
    if (part.type === "group") return "";
    if (part.type === "fraction") return fraction;
    return part.value;
  }).join("");
}

export function moneyInput(value: Money): string {
  const minorUnits = BigInt(value);
  return `${minorUnits / BigInt(100)}.${(minorUnits % BigInt(100)).toString().padStart(2, "0")}`;
}

/** Returns null when the aggregate cannot be represented as a safe integer. */
export function sumMoneyChecked(values: readonly Money[]): Money | null {
  let total = 0;
  for (const value of values) {
    if (!Number.isSafeInteger(value) || value < 0 || !Number.isSafeInteger(total + value)) return null;
    total += value;
  }
  return total;
}
