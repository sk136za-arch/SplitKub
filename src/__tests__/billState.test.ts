import { describe, expect, it } from "vitest";
import { billReducer, emptyBill } from "../lib/billState";

describe("bill reducer", () => {
  it("selects existing people for new items, not later people", () => {
    let state = billReducer(emptyBill(), { type: "add-person", id: "a", name: "A" });
    state = billReducer(state, { type: "add-item", id: "i", name: "Food", price: 100 });
    state = billReducer(state, { type: "add-person", id: "b", name: "B" });
    expect(state.items[0].participantIds).toEqual(["a"]);
    state = billReducer(state, { type: "remove-person", id: "a" });
    expect(state.items[0].participantIds).toEqual([]);
  });
  it("locks currency once an item exists", () => {
    let state = billReducer(emptyBill(), { type: "currency", currency: "USD" });
    state = billReducer(state, { type: "add-item", id: "i", name: "Food", price: 100 });
    expect(billReducer(state, { type: "currency", currency: "THB" }).currency).toBe("USD");
    state = billReducer(state, { type: "remove-item", id: "i" });
    expect(billReducer(state, { type: "currency", currency: "THB" }).currency).toBe("THB");
  });
});
