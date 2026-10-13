import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("../client", () => ({
  getSharedBillClient: () => ({
    auth: { getSession: async () => ({ data: { session: { user: { id: "friend" } } }, error: null }) },
    rpc,
  }),
  sharedBillAvailable: () => true,
}));

import { emptySession } from "../../billState";
import { fetchSharedBillForParticipant, setSharedParticipation } from "../sharedBill";

describe("tab-bound friend participation", () => {
  beforeEach(() => {
    rpc.mockReset().mockResolvedValue({ data: emptySession(), error: null });
  });

  it("sends the locally selected participant to the atomic selection-bound RPC", async () => {
    await setSharedParticipation("bill", "receipt", "item", "person-a", false, 12);
    expect(rpc).toHaveBeenCalledWith("set_shared_participation_for_participant", {
      p_bill_id: "bill",
      p_receipt_id: "receipt",
      p_item_id: "item",
      p_participant_id: "person-a",
      p_selected: false,
      p_expected_revision: 12,
    });
  });

  it("scopes friend refresh status to the participant selected in this tab", async () => {
    const snapshot = { ...emptySession(), id: "bill", revision: 3, expiresAt: "2027-01-01T00:00:00Z",
      participants: [{ id: "person-b", name: "B", promptPay: "" }],
      confirmations: [{ participantId: "person-b", viewedAt: "", confirmedAt: "", confirmedContentRevision: null }] };
    rpc.mockResolvedValue({ data: { publicId: "public", billId: "bill", snapshot }, error: null });
    await expect(fetchSharedBillForParticipant("bill", "person-b")).resolves.toMatchObject({
      snapshot: { confirmations: [{ participantId: "person-b" }] },
    });
    expect(rpc).toHaveBeenCalledWith("fetch_shared_bill_for_participant", {
      p_bill_id: "bill", p_participant_id: "person-b",
    });
  });
});
