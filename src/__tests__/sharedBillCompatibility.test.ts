import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptySession } from "../lib/billState";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), getSession: vi.fn(), signInAnonymously: vi.fn() }));
vi.mock("../lib/supabase/client", () => ({
  getSharedBillClient: () => ({ rpc: mocks.rpc, auth: { getSession: mocks.getSession, signInAnonymously: mocks.signInAnonymously } }),
  sharedBillAvailable: () => true,
}));

import { applyOwnerAction, createSharedBill, joinSharedBill, mapSharedBillError } from "../lib/supabase/sharedBill";

function draft() {
  return { ...emptySession(), participants: [{ id: "a", name: "A", promptPay: "" }] };
}

function oldSnapshot() {
  const old: Record<string, unknown> = { ...draft(), id: "bill", revision: 1, expiresAt: "2027-01-01T00:00:00Z" };
  delete old.settlementMode;
  delete old.collectorParticipantId;
  return old;
}

function created(snapshot: unknown) {
  return { publicId: "public", billId: "bill", friendToken: "f".repeat(43), ownerToken: "o".repeat(43), snapshot };
}

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.getSession.mockReset().mockResolvedValue({ data: { session: { access_token: "test" } }, error: null });
  mocks.signInAnonymously.mockReset();
});

describe("shared backend routing compatibility", () => {
  it("keeps the authenticated RPC role when opening a friend-token URL", async () => {
    mocks.rpc.mockResolvedValue({ data: { publicId: "public", billId: "bill", role: "owner", snapshot: oldSnapshot() }, error: null });
    const opened = await joinSharedBill("public", "f".repeat(43));
    expect(opened.role).toBe("owner");
    expect(opened.snapshot.settlementMode).toBe("direct");
  });

  it("maps a missing capability RPC to a migration-required error", () => {
    expect(mapSharedBillError({ code: "PGRST202", message: "Could not find the function" }).code).toBe("migration_required");
  });

  it("accepts an old direct snapshot missing both routing fields", async () => {
    mocks.rpc.mockResolvedValue({ data: created(oldSnapshot()), error: null });
    const result = await createSharedBill(draft());
    expect(result.snapshot).toMatchObject({ settlementMode: "direct", collectorParticipantId: "" });
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual(["create_shared_bill"]);
  });

  it("rejects a partial remote snapshot instead of silently defaulting it", async () => {
    const partial = { ...oldSnapshot(), settlementMode: "collector" };
    mocks.rpc.mockResolvedValue({ data: created(partial), error: null });
    await expect(createSharedBill(draft())).rejects.toMatchObject({ code: "unknown" });
  });

  it("blocks collector creation before writing when the backend lacks the capability RPC", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "Could not find the function" } });
    const collector = { ...draft(), settlementMode: "collector" as const, collectorParticipantId: "a" };
    await expect(createSharedBill(collector)).rejects.toMatchObject({ code: "migration_required" });
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual(["shared_bill_capabilities"]);
  });

  it("blocks collector creation for an old advertised protocol version", async () => {
    mocks.rpc.mockResolvedValue({ data: { settlementRoutingVersion: 0 }, error: null });
    const collector = { ...draft(), settlementMode: "collector" as const, collectorParticipantId: "a" };
    await expect(createSharedBill(collector)).rejects.toMatchObject({ code: "migration_required" });
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual(["shared_bill_capabilities"]);
  });

  it("blocks collector owner update before writing on an old backend", async () => {
    mocks.rpc.mockImplementation(async (name: string) => name === "fetch_shared_bill"
      ? { data: { publicId: "public", billId: "bill", snapshot: oldSnapshot() }, error: null }
      : { data: null, error: { code: "PGRST202", message: "Could not find the function" } });
    await expect(applyOwnerAction("bill", 1, { type: "set-collector", participantId: "a" }))
      .rejects.toMatchObject({ code: "migration_required" });
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual(["fetch_shared_bill", "shared_bill_capabilities"]);
  });

  it("rejects a backend that advertises routing but returns a downgraded collector snapshot", async () => {
    mocks.rpc.mockImplementation(async (name: string) => name === "shared_bill_capabilities"
      ? { data: { settlementRoutingVersion: 1 }, error: null }
      : { data: created(oldSnapshot()), error: null });
    const collector = { ...draft(), settlementMode: "collector" as const, collectorParticipantId: "a" };
    await expect(createSharedBill(collector)).rejects.toMatchObject({ code: "migration_required" });
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual(["shared_bill_capabilities", "create_shared_bill"]);
  });

  it("commits a collector owner update only after a compatible capability response", async () => {
    const collector = { ...draft(), id: "bill", revision: 2, expiresAt: "2027-01-01T00:00:00Z", settlementMode: "collector" as const, collectorParticipantId: "a" };
    mocks.rpc.mockImplementation(async (name: string) => name === "fetch_shared_bill"
      ? { data: { publicId: "public", billId: "bill", snapshot: oldSnapshot() }, error: null }
      : name === "shared_bill_capabilities"
        ? { data: { settlementRoutingVersion: 2 }, error: null }
        : { data: collector, error: null });
    expect(await applyOwnerAction("bill", 1, { type: "set-collector", participantId: "a" })).toEqual(collector);
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual(["fetch_shared_bill", "shared_bill_capabilities", "apply_owner_action"]);
  });
});
