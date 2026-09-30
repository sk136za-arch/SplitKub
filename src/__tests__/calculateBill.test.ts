import { describe, expect, it } from "vitest";
import { calculateBill } from "../lib/calculateBill";
import type { Bill } from "../types/bill";

const people = [{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }];
function bill(price: number, ids = ["a", "b", "c"]): Bill {
  return { currency: "THB", promptPay: "", participants: people, items: [{ id: "item", name: "Food", price, participantIds: ids }] };
}

describe("calculateBill", () => {
  it("splits an equal amount", () => {
    expect(calculateBill(bill(10000, ["a", "b"])).people.map((p) => p.total)).toEqual([5000, 5000, 0]);
  });
  it("distributes residual units in bill participant order", () => {
    const result = calculateBill(bill(10000, ["c", "a", "b"]));
    expect(result.people.map((p) => p.total)).toEqual([3334, 3333, 3333]);
    expect(result.people.reduce((sum, person) => sum + person.total, 0)).toBe(result.total);
  });
  it("handles different people per item and cents or satang", () => {
    const data: Bill = { currency: "USD", promptPay: "", participants: people, items: [
      { id: "food", name: "Food", price: 1999, participantIds: ["a", "b", "c"] },
      { id: "beer", name: "Beer", price: 1200, participantIds: ["a", "b"] },
      { id: "cake", name: "Cake", price: 500, participantIds: ["b", "c"] },
    ] };
    const result = calculateBill(data);
    expect(result.total).toBe(3699);
    expect(result.people.map((p) => p.total)).toEqual([1267, 1516, 916]);
    expect(result.people.reduce((sum, person) => sum + person.total, 0)).toBe(3699);
  });
  it("assigns all of one item to one person", () => {
    expect(calculateBill(bill(1, ["c"])).people.map((p) => p.total)).toEqual([0, 0, 1]);
  });
  it("rejects an item without selected people and stale references", () => {
    expect(() => calculateBill(bill(100, []))).toThrow();
    expect(() => calculateBill(bill(100, ["deleted"]))).toThrow();
  });
});
