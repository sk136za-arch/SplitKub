import { describe, expect, it, vi } from "vitest";
import { SharedSubscriptionController, type SharedSubscriptionCallbacks } from "../lib/sharedSubscription";

describe("shared realtime reconnect controller", () => {
  it("replaces a stale channel before opening one fresh channel and ignores old callbacks", async () => {
    let active = 0;
    let maxActive = 0;
    const channels: Array<{ change: () => void; status: (status: string) => void }> = [];
    const subscribe = vi.fn(async (_billId: string, change: () => void, _error: (error: unknown) => void, status: (status: string) => void) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      channels.push({ change, status });
      return async () => { active -= 1; };
    });
    const controller = new SharedSubscriptionController(subscribe);
    const onChange = vi.fn();
    const onStatus = vi.fn();
    const onError = vi.fn();
    const callbacks: SharedSubscriptionCallbacks = { onChange, onStatus, onError };

    await controller.restart("bill", callbacks);
    expect(active).toBe(1);
    channels[0].status("SUBSCRIBED");
    channels[0].status("CHANNEL_ERROR");
    const staleChange = channels[0].change;

    await controller.restart("bill", callbacks);
    expect(subscribe).toHaveBeenCalledTimes(2);
    expect(active).toBe(1);
    expect(maxActive).toBe(1);
    staleChange();
    channels[1].change();
    expect(onChange).toHaveBeenCalledOnce();
    expect(onStatus).toHaveBeenCalledWith("SUBSCRIBED");
    await controller.stop();
    expect(active).toBe(0);
  });

  it("serializes repeated reconnect requests while a previous subscribe is pending", async () => {
    let finishFirst: ((cleanup: () => void) => void) | undefined;
    let active = 0;
    let maxActive = 0;
    let count = 0;
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const subscribe = async () => {
      count += 1;
      active += 1;
      maxActive = Math.max(maxActive, active);
      markStarted?.();
      if (count === 1) {
        return new Promise<() => void>((resolve) => { finishFirst = resolve; });
      }
      return () => { active -= 1; };
    };
    const controller = new SharedSubscriptionController(subscribe);
    const callbacks: SharedSubscriptionCallbacks = { onChange: () => {}, onStatus: () => {}, onError: () => {} };
    const first = controller.restart("bill", callbacks);
    await started;
    expect(count).toBe(1);
    const second = controller.restart("bill", callbacks);
    finishFirst?.(() => { active -= 1; });
    await Promise.all([first, second]);
    expect(count).toBe(2);
    expect(active).toBe(1);
    expect(maxActive).toBe(1);
    await controller.stop();
    expect(active).toBe(0);
  });
});
