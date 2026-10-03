import { describe, expect, it } from "vitest";
import { emptySession } from "../lib/billState";
import { normalizeRemoteSessionSnapshot, shouldApplyRemoteRevision } from "../lib/sharedSnapshot";

describe("remote session revision ordering", () => {
  it("accepts equal or newer snapshots and rejects late older responses", () => {
    expect(shouldApplyRemoteRevision(4, 4)).toBe(true);
    expect(shouldApplyRemoteRevision(4, 5)).toBe(true);
    expect(shouldApplyRemoteRevision(5, 4)).toBe(false);
  });
  it("rejects unsafe revision values", () => {
    expect(shouldApplyRemoteRevision(0, Number.MAX_SAFE_INTEGER + 1)).toBe(false);
  });
});

describe("remote routing snapshot compatibility", () => {
  it("defaults only an old snapshot missing both fields to direct without mutating input", () => {
    const old: Record<string, unknown> = { ...emptySession() };
    delete old.settlementMode;
    delete old.collectorParticipantId;
    expect(normalizeRemoteSessionSnapshot(old)).toEqual({ ...old, settlementMode: "direct", collectorParticipantId: "" });
    expect(old).not.toHaveProperty("settlementMode");
  });
  it("preserves valid collector snapshots and rejects partial or invalid routing", () => {
    const collector = { ...emptySession(), participants: [{ id: "a", name: "A", promptPay: "" }], settlementMode: "collector", collectorParticipantId: "a" };
    expect(normalizeRemoteSessionSnapshot(collector)).toEqual(collector);
    expect(normalizeRemoteSessionSnapshot({ ...collector, collectorParticipantId: undefined })).toBeNull();
    const partial: Record<string, unknown> = { ...collector };
    delete partial.collectorParticipantId;
    expect(normalizeRemoteSessionSnapshot(partial)).toBeNull();
    expect(normalizeRemoteSessionSnapshot({ ...collector, collectorParticipantId: "other" })).toBeNull();
  });
});
