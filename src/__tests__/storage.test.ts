import { describe, expect, it } from "vitest";
import { emptyBill } from "../lib/billState";
import { clearBillStorage, loadBill, loadBillSafely, saveBill, shouldPersistBill, STORAGE_KEY } from "../lib/storage";

describe("storage", () => {
  it("restores the currency and bill", () => {
    const data = new Map<string, string>();
    const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
    const bill = { ...emptyBill(), currency: "USD" as const };
    saveBill(storage, bill);
    expect(loadBill(storage)).toEqual(bill);
  });
  it("ignores corrupt and unsupported payloads", () => {
    for (const raw of ["{", JSON.stringify({ version: 2, bill: emptyBill() }), JSON.stringify({ version: 1, bill: { ...emptyBill(), items: [{ id: "i", name: "Food", price: 100, participantIds: ["missing"] }] } })]) {
      expect(loadBill({ getItem: (key: string) => key === STORAGE_KEY ? raw : null })).toBeNull();
    }
  });
  it("persists only an explicitly started empty bill and does not restore legacy empty snapshots", () => {
    const data = new Map<string, string>();
    const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
    const empty = emptyBill();
    expect(shouldPersistBill(false, empty)).toBe(false);
    expect(shouldPersistBill(true, empty)).toBe(true);
    data.set(STORAGE_KEY, JSON.stringify({ version: 1, bill: empty }));
    expect(loadBill(storage)).toBeNull();
    saveBill(storage, empty, true);
    expect(loadBill(storage)).toEqual(empty);
  });
  it("restores non-empty legacy snapshots", () => {
    const bill = { ...emptyBill(), participants: [{ id: "p", name: "Pat" }] };
    expect(loadBill({ getItem: () => JSON.stringify({ version: 1, bill }) })).toEqual(bill);
  });
  it("clears only the SplitKub bill key", () => {
    const data = new Map([[STORAGE_KEY, "bill"], ["other-app:key", "preserve"]]);
    clearBillStorage({ removeItem: (key: string) => { data.delete(key); } });
    expect(data.has(STORAGE_KEY)).toBe(false);
    expect(data.get("other-app:key")).toBe("preserve");
  });
  it("handles a localStorage accessor that throws", () => {
    expect(loadBillSafely(() => { throw new DOMException("Blocked", "SecurityError"); })).toBeNull();
  });
});
