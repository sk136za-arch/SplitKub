import { describe, expect, it } from "vitest";
import { calculateBill, settlementDestinations } from "../lib/calculateBill";
import { emptySession, sessionReducer } from "../lib/billState";
import type { SplitSession } from "../types/bill";

function fixture(): SplitSession {
  return {
    ...emptySession(), participants: ["A", "B", "C", "D"].map((name) => ({ id: name, name, promptPay: "" })),
    receipts: [
      { id: "r1", title: "Food", paidByParticipantId: "A", items: [{ id: "i1", name: "Food", price: 60, participantIds: ["C", "D"] }] },
      { id: "r2", title: "Drinks", paidByParticipantId: "B", items: [{ id: "i2", name: "Drinks", price: 20, participantIds: ["C"] }] },
    ],
  };
}

function expectBalanced(session: SplitSession) {
  const result = calculateBill(session);
  for (const person of result.people) {
    const received = result.transfers.filter((route) => route.toParticipantId === person.participantId).reduce((sum, route) => sum + route.amount, 0);
    const sent = result.transfers.filter((route) => route.fromParticipantId === person.participantId).reduce((sum, route) => sum + route.amount, 0);
    expect(received - sent).toBe(person.net);
  }
  expect(result.transfers.every((route) => route.amount > 0 && route.fromParticipantId !== route.toParticipantId)).toBe(true);
  return result;
}

describe("settlement routing", () => {
  it("uses deterministic participant-order direct routes", () => {
    const session = fixture();
    const result = expectBalanced(session);
    expect(result.transfers.map(({ fromParticipantId, toParticipantId, amount }) => [fromParticipantId, toParticipantId, amount])).toEqual([
      ["C", "A", 50], ["D", "A", 10], ["D", "B", 20],
    ]);
    expect(settlementDestinations(result, session)).toEqual(["A", "B"]);
    expect(calculateBill(session).transfers).toEqual(result.transfers);
  });

  it("collects gross owed and reimburses gross paid without netting", () => {
    const session: SplitSession = {
      ...emptySession(), settlementMode: "collector", collectorParticipantId: "A",
      participants: ["A", "B", "C"].map((name) => ({ id: name, name, promptPay: "" })),
      receipts: [
        { id: "r1", title: "Food", paidByParticipantId: "B", items: [{ id: "i1", name: "Food", price: 12000, participantIds: ["A", "B", "C"] }] },
        { id: "r2", title: "Drinks", paidByParticipantId: "C", items: [{ id: "i2", name: "Drinks", price: 6000, participantIds: ["A", "C"] }] },
        { id: "r3", title: "Taxi", paidByParticipantId: "A", items: [{ id: "i3", name: "Taxi", price: 3000, participantIds: ["A", "B"] }] },
      ],
    };
    const result = expectBalanced(session);
    expect(result.people.map(({ paid, owed, net }) => [paid, owed, net])).toEqual([[3000, 8500, -5500], [12000, 5500, 6500], [6000, 7000, -1000]]);
    expect(result.transfers.map(({ fromParticipantId, toParticipantId, amount }) => [fromParticipantId, toParticipantId, amount])).toEqual([
      ["B", "A", 5500], ["C", "A", 7000], ["A", "B", 12000], ["A", "C", 6000],
    ]);
    expect(result.transfers[2].receiptBreakdown).toEqual([{ receiptId: "r1", receiptTitle: "Food", amount: 12000 }]);
    expect(result.transfers[3].receiptBreakdown).toEqual([{ receiptId: "r2", receiptTitle: "Drinks", amount: 6000 }]);
    expect(settlementDestinations(result, session)).toEqual(["A", "B", "C"]);
  });

  it("omits zero and self routes, including balanced sessions", () => {
    const session: SplitSession = {
      ...emptySession(), participants: [{ id: "A", name: "A", promptPay: "" }],
      receipts: [{ id: "r", title: "Solo", paidByParticipantId: "A", items: [{ id: "i", name: "Solo", price: 1, participantIds: ["A"] }] }],
    };
    expect(expectBalanced(session).transfers).toEqual([]);
    session.settlementMode = "collector";
    session.collectorParticipantId = "A";
    expect(expectBalanced(session).transfers).toEqual([]);
    expect(settlementDestinations(calculateBill(session), session)).toEqual([]);
  });

  it("rejects an invalid collector and resets to direct after deletion", () => {
    const session = fixture();
    expect(sessionReducer(session, { type: "set-settlement-mode", mode: "collector" })).toBe(session);
    expect(sessionReducer(session, { type: "set-collector", participantId: "missing" })).toBe(session);
    const collector = sessionReducer(session, { type: "set-collector", participantId: "A" });
    expect(collector.settlementMode).toBe("collector");
    expect(collector.collectorParticipantId).toBe("A");
    const afterRemoval = sessionReducer(collector, { type: "remove-person", id: "A" });
    expect(afterRemoval.settlementMode).toBe("direct");
    expect(afterRemoval.collectorParticipantId).toBe("");
    expect(() => calculateBill({ ...session, settlementMode: "collector", collectorParticipantId: "missing" })).toThrow(/รวบรวม/);
  });
});
