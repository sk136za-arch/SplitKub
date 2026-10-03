import { describe, expect, it, vi } from "vitest";
import {
  buildSharedBillUrl,
  awaitRealtimeSubscribed,
  mapSharedBillError,
  parseSharedBillFragment,
  SharedBillError,
} from "../sharedBill";

const token = "a".repeat(43);

describe("shared bill capability URLs", () => {
  it("puts friend and owner tokens only in the URL fragment", () => {
    const friendUrl = new URL(buildSharedBillUrl("public-id", token, "friend", "https://splitkub.example"));
    expect(friendUrl.pathname).toBe("/b/public-id");
    expect(friendUrl.search).toBe("");
    expect(parseSharedBillFragment(friendUrl.hash)).toEqual({ role: "friend", token });

    const ownerUrl = new URL(buildSharedBillUrl("public-id", token, "owner", "https://splitkub.example"));
    expect(ownerUrl.pathname).toBe("/b/public-id");
    expect(ownerUrl.search).toBe("");
    expect(parseSharedBillFragment(ownerUrl.hash)).toEqual({ role: "owner", token });
  });

  it("rejects malformed, duplicated, or ambiguous fragments", () => {
    expect(parseSharedBillFragment("#token=short")).toBeNull();
    expect(parseSharedBillFragment(`#token=${token}&owner=${token}`)).toBeNull();
    expect(parseSharedBillFragment(`#token=${token}&token=${token}`)).toBeNull();
    expect(parseSharedBillFragment("#owner=")).toBeNull();
  });
});

describe("shared bill error mapping", () => {
  it("maps database conflict, unavailable item, and service errors without exposing raw text", () => {
    expect(mapSharedBillError({ code: "40001", message: "REVISION_CONFLICT" }).code).toBe("revision_conflict");
    expect(mapSharedBillError({ message: "ITEM_NOT_IN_RECEIPT" }).code).toBe("item_not_in_receipt");
    const secret = `INVALID_TOKEN ${token}`;
    const mapped = mapSharedBillError({ message: secret });
    expect(mapped).toMatchObject({ code: "invalid_token", message: "This share link is invalid." });
    expect(mapped.message).not.toContain(token);
  });

  it("preserves already-normalized errors and maps network failures", () => {
    const existing = new SharedBillError("disabled", "off");
    expect(mapSharedBillError(existing)).toBe(existing);
    expect(mapSharedBillError(new TypeError("network failure")).code).toBe("network");
  });
});

describe("private Realtime subscription lifecycle", () => {
  it("resolves only on SUBSCRIBED and reports later channel failures", async () => {
    let reportStatus: ((status: string) => void) | undefined;
    const onError = vi.fn();
    const onStatus = vi.fn();
    const connected = awaitRealtimeSubscribed((callback) => { reportStatus = callback; }, onError, onStatus);
    reportStatus?.("JOINING");
    expect(onStatus).toHaveBeenCalledWith("JOINING");
    reportStatus?.("SUBSCRIBED");
    await expect(connected).resolves.toBeUndefined();
    reportStatus?.("CHANNEL_ERROR");
    expect(onError).toHaveBeenCalledOnce();
  });

  it("rejects initial CHANNEL_ERROR or timeout instead of reporting a live connection", async () => {
    let reportStatus: ((status: string) => void) | undefined;
    const connection = awaitRealtimeSubscribed((callback) => { reportStatus = callback; });
    reportStatus?.("CHANNEL_ERROR");
    await expect(connection).rejects.toMatchObject({ code: "unavailable" });

    vi.useFakeTimers();
    try {
      const timeout = awaitRealtimeSubscribed(() => {}, undefined, undefined, 50);
      const rejected = expect(timeout).rejects.toMatchObject({ code: "unavailable" });
      await vi.advanceTimersByTimeAsync(50);
      await rejected;
    } finally { vi.useRealTimers(); }
  });
});
