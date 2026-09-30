import { describe, expect, it } from "vitest";
import { participantLabels } from "../lib/participantLabels";

describe("participant labels", () => {
  it("prefixes every name by stable order if any raw name is duplicated", () => {
    const labels = participantLabels([
      { id: "a", name: "Alex" },
      { id: "b", name: "Bee" },
      { id: "c", name: "Alex" },
    ]);
    expect([...labels]).toEqual([["a", "1. Alex"], ["b", "2. Bee"], ["c", "3. Alex"]]);
  });
  it("keeps names unique when a raw name resembles a former duplicate suffix", () => {
    const labels = participantLabels([
      { id: "a", name: "Alex" },
      { id: "b", name: "Alex" },
      { id: "c", name: "Alex (1)" },
    ]);
    expect([...labels]).toEqual([["a", "1. Alex"], ["b", "2. Alex"], ["c", "3. Alex (1)"]]);
  });
  it("preserves raw names when every name is unique", () => {
    expect([...participantLabels([{ id: "a", name: "Alex" }, { id: "b", name: "Bee" }])])
      .toEqual([["a", "Alex"], ["b", "Bee"]]);
  });
});
