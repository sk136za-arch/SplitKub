import { describe, expect, it } from "vitest";
import { closeLocalBill, createLocalBill, deleteLocalBill, findLocalBill, loadLocalBills, LOCAL_BILLS_KEY, saveLocalBill } from "../lib/localBills";
import { sessionReducer } from "../lib/billState";

function storage() {
  const data = new Map<string, string>();
  return { data, getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
}

describe("local bill workspace", () => {
  it("creates, updates, and finds an actual browser-local bill", () => {
    const store = storage();
    const bill = createLocalBill(store);
    const updated = sessionReducer(bill.session, { type: "set-title", title: "Dinner" });
    expect(saveLocalBill(store, bill.id, updated)?.title).toBe("Dinner");
    expect(findLocalBill(store, bill.id)?.session.title).toBe("Dinner");
    expect(loadLocalBills(store)).toHaveLength(1);
  });

  it("ignores an invalid workspace payload", () => {
    const store = storage();
    store.data.set(LOCAL_BILLS_KEY, "{");
    expect(loadLocalBills(store)).toEqual([]);
  });

  it("closes and deletes only the requested local bill", () => {
    const store = storage();
    const first = createLocalBill(store);
    const second = createLocalBill(store);
    expect(closeLocalBill(store, first.id)?.status).toBe("closed");
    expect(deleteLocalBill(store, first.id)).toBe(true);
    expect(findLocalBill(store, first.id)).toBeNull();
    expect(findLocalBill(store, second.id)).not.toBeNull();
  });
});
