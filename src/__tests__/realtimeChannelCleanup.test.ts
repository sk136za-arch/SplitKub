import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ channel: vi.fn(), removeChannel: vi.fn(), getSession: vi.fn() }));
vi.mock("../lib/supabase/client", () => ({
  getSharedBillClient: () => ({ channel: mocks.channel, removeChannel: mocks.removeChannel,
    auth: { getSession: mocks.getSession } }),
  sharedBillAvailable: () => true,
}));

import { subscribeToSharedBill } from "../lib/supabase/sharedBill";

function fakeChannel() {
  let status: ((value: string) => void) | undefined;
  let broadcast: ((event: { payload: { revision: number } }) => void) | undefined;
  const channel = {
    on: vi.fn((_kind: string, _filter: unknown, callback: typeof broadcast) => { broadcast = callback; return channel; }),
    subscribe: vi.fn((callback: typeof status) => { status = callback; return channel; }),
  };
  mocks.channel.mockReturnValue(channel);
  return { channel, reportStatus: (value: string) => status?.(value), reportBroadcast: (revision: number) => broadcast?.({ payload: { revision } }) };
}

beforeEach(() => {
  mocks.channel.mockReset();
  mocks.removeChannel.mockReset().mockResolvedValue("ok");
  mocks.getSession.mockReset().mockResolvedValue({ data: { session: { access_token: "test" } }, error: null });
});

describe("idempotent Realtime channel cleanup", () => {
  it("removes once when initial subscription fails and ignores later channel events", async () => {
    const fake = fakeChannel();
    const onChange = vi.fn();
    const onError = vi.fn();
    const opening = subscribeToSharedBill("bill", onChange, onError);
    await vi.waitFor(() => expect(fake.channel.subscribe).toHaveBeenCalledOnce());
    fake.reportStatus("CHANNEL_ERROR");
    await expect(opening).rejects.toMatchObject({ code: "realtime_unavailable" });
    fake.reportStatus("CLOSED");
    fake.reportBroadcast(2);
    expect(mocks.removeChannel).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledOnce();
    expect(onChange).not.toHaveBeenCalled();
    expect(mocks.channel).toHaveBeenCalledWith("shared-bill:bill", { config: { private: true } });
  });

  it("removes once across a post-subscribe failure and repeated explicit cleanup", async () => {
    const fake = fakeChannel();
    const onError = vi.fn();
    const opening = subscribeToSharedBill("bill", vi.fn(), onError);
    await vi.waitFor(() => expect(fake.channel.subscribe).toHaveBeenCalledOnce());
    fake.reportStatus("SUBSCRIBED");
    const cleanup = await opening;
    fake.reportStatus("TIMED_OUT");
    await Promise.all([cleanup(), cleanup()]);
    fake.reportStatus("CHANNEL_ERROR");
    expect(mocks.removeChannel).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledOnce();
  });

  it("does not reenter removal when removeChannel synchronously reports CLOSED", async () => {
    const fake = fakeChannel();
    const onError = vi.fn();
    mocks.removeChannel.mockImplementation(() => { fake.reportStatus("CLOSED"); return Promise.resolve("ok"); });
    const opening = subscribeToSharedBill("bill", vi.fn(), onError);
    await vi.waitFor(() => expect(fake.channel.subscribe).toHaveBeenCalledOnce());
    fake.reportStatus("SUBSCRIBED");
    const cleanup = await opening;
    await cleanup();
    expect(mocks.removeChannel).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledOnce();
  });
});
