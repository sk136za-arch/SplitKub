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
import { setSharedParticipation } from "../sharedBill";

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
});
