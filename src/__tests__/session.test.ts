import { describe, expect, it } from "vitest";
import { calculateBill } from "../lib/calculateBill";
import { emptySession, sessionReducer } from "../lib/billState";
import type { SplitSession } from "../types/bill";

const people = [
  { id: "a", name: "A", promptPay: "" },
  { id: "b", name: "B", promptPay: "" },
  { id: "c", name: "C", promptPay: "" },
];
function example(): SplitSession {
  return {
    ...emptySession(), participants: people, receipts: [
      { id: "r1", title: "Lunch", paidByParticipantId: "a", items: [{ id: "food", name: "Food", price: 10001, participantIds: ["c", "a", "b"] }] },
      { id: "r2", title: "Drinks", paidByParticipantId: "b", items: [{ id: "drinks", name: "Drinks", price: 6000, participantIds: ["a", "b"] }] },
    ],
  };
}

describe("session calculation", () => {
  it("balances receipts, paid, owed and net with deterministic rounding", () => {
    const result = calculateBill(example());
    expect(result.total).toBe(16001);
    expect(result.receipts.map((receipt) => receipt.total)).toEqual([10001, 6000]);
    expect(result.people.map(({ paid, owed, net }) => [paid, owed, net])).toEqual([
      [10001, 6334, 3667], [6000, 6334, -334], [0, 3333, -3333],
    ]);
    expect(result.people[0].breakdown).toEqual([
      { receiptId: "r1", receiptTitle: "Lunch", itemId: "food", itemName: "Food", amount: 3334 },
      { receiptId: "r2", receiptTitle: "Drinks", itemId: "drinks", itemName: "Drinks", amount: 3000 },
    ]);
    expect(result.people.reduce((sum, person) => sum + person.paid, 0)).toBe(result.total);
    expect(result.people.reduce((sum, person) => sum + person.owed, 0)).toBe(result.total);
    expect(result.people.reduce((sum, person) => sum + person.net, 0)).toBe(0);
  });
  it("assigns one minor unit to the first participant in bill order", () => {
    const session = example();
    session.receipts = [{ id: "r", title: "Tiny", paidByParticipantId: "c", items: [{ id: "i", name: "Tiny", price: 1, participantIds: ["c", "b", "a"] }] }];
    const result = calculateBill(session);
    expect(result.people.map((person) => person.owed)).toEqual([1, 0, 0]);
    expect(result.people.map((person) => person.net)).toEqual([-1, 0, 1]);
  });
  it("refuses missing payer, invalid assignment, and overflow", () => {
    const session = example();
    session.receipts[0].paidByParticipantId = "";
    expect(() => calculateBill(session)).toThrow(/ผู้จ่าย/);
    session.receipts[0].paidByParticipantId = "a";
    session.receipts[0].items[0].participantIds = [];
    expect(() => calculateBill(session)).toThrow(/ผู้ร่วม/);
    session.receipts[0].items[0].participantIds = ["missing"];
    expect(() => calculateBill(session)).toThrow(/ผู้ร่วม/);
    session.receipts[0].items[0].participantIds = ["a"];
    session.receipts[0].items[0].price = Number.MAX_SAFE_INTEGER;
    expect(() => calculateBill(session)).toThrow(/สูงเกิน/);
  });
});

describe("session reducer", () => {
  it("keeps each receipt's items and payer independent", () => {
    let session = sessionReducer(emptySession(), { type: "add-person", id: "a", name: "A" });
    session = sessionReducer(session, { type: "add-receipt", id: "r1", title: "Lunch", paidByParticipantId: "a" });
    session = sessionReducer(session, { type: "add-item", receiptId: "r1", id: "i", name: "Food", price: 100 });
    session = sessionReducer(session, { type: "add-person", id: "b", name: "B" });
    session = sessionReducer(session, { type: "add-receipt", id: "r2", title: "Drinks" });
    session = sessionReducer(session, { type: "add-item", receiptId: "r2", id: "j", name: "Beer", price: 200 });
    expect(session.receipts[0].items[0].participantIds).toEqual(["a"]);
    expect(session.receipts[1].items[0].participantIds).toEqual(["a", "b"]);
    session = sessionReducer(session, { type: "remove-person", id: "a" });
    expect(session.receipts[0].paidByParticipantId).toBe("");
    expect(session.receipts[0].items[0].participantIds).toEqual([]);
    expect(session.receipts[1].items[0].participantIds).toEqual(["b"]);
  });
  it("keeps the remote revision unchanged during local edits", () => {
    let session = sessionReducer(emptySession(), { type: "set-remote-state", id: "remote", revision: 3, expiresAt: "2026-10-05T00:00:00Z" });
    session = sessionReducer(session, { type: "set-title", title: "Trip" });
    expect(session.revision).toBe(3);
    expect(session.title).toBe("Trip");
  });
});
