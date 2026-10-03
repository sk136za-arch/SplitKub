import { describe, expect, it } from "vitest";
import { emptySession } from "../lib/billState";
import { ephemeralOwnerCapability } from "../lib/sharedLinkRouting";

describe("actual-role owner routing", () => {
  it("opens an authenticated owner workspace without treating a friend token as recovery", () => {
    const opened = { publicId: "public", billId: "bill", role: "owner" as const, snapshot: emptySession() };
    expect(ephemeralOwnerCapability(opened)).toEqual({ publicId: "public", billId: "bill", ownerToken: "", friendToken: "" });
  });

  it("rejects a friend role from the owner workspace", () => {
    const opened = { publicId: "public", billId: "bill", role: "friend" as const, snapshot: emptySession() };
    expect(() => ephemeralOwnerCapability(opened)).toThrow(/เจ้าของ/);
  });
});
