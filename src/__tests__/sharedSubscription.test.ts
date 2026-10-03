import { describe, expect, it, vi } from "vitest";
import { refreshWithTrailingDirty, SharedSubscriptionController, shouldMarkSubscriptionLive, type SharedSubscriptionCallbacks } from "../lib/sharedSubscription";

describe("live subscription readiness", () => {
  it("requires a successful canonical refresh and the current subscribed generation", () => {
    expect(shouldMarkSubscriptionLive(true, 3, 3, 3)).toBe(true);
    expect(shouldMarkSubscriptionLive(false, 3, 3, 3)).toBe(false);
    expect(shouldMarkSubscriptionLive(true, 2, 3, 2)).toBe(false);
    expect(shouldMarkSubscriptionLive(true, 3, 3, -1)).toBe(false);
    expect(shouldMarkSubscriptionLive(true, 3, 4, 3)).toBe(false);
  });

  it("runs exactly one trailing canonical refresh for notifications during a fetch", async () => {
    let markFetchStarted: (() => void) | undefined;
    let finishFetch: (() => void) | undefined;
    const fetchStarted = new Promise<void>((resolve) => { markFetchStarted = resolve; });
    const fetchCanFinish = new Promise<void>((resolve) => { finishFetch = resolve; });
    let dirty = false;
    let dirtySignals = 0;
    const markDirty = () => { dirty = true; dirtySignals += 1; };
    let calls = 0;
    const pending = refreshWithTrailingDirty(async () => {
      calls += 1;
      if (calls === 1) { markFetchStarted?.(); await fetchCanFinish; }
      return true;
    }, () => dirty, () => { dirty = false; });
    await fetchStarted;
    markDirty();
    markDirty();
    finishFetch?.();
    await expect(pending).resolves.toBe(true);
    expect(calls).toBe(2);
    expect(dirtySignals).toBe(2);
    expect(dirty).toBe(false);
  });

  it("waits for a third fetch when the trailing fetch fails and is dirtied again", async () => {
    let dirty = false;
    let calls = 0;
    let markSecondFetchStarted: (() => void) | undefined;
    let finishSecondFetch: (() => void) | undefined;
    const secondFetchStarted = new Promise<void>((resolve) => { markSecondFetchStarted = resolve; });
    let live = false;
    const pending = refreshWithTrailingDirty(async () => {
      calls += 1;
      if (calls === 1) { dirty = true; return true; }
      if (calls === 2) {
        markSecondFetchStarted?.();
        return new Promise<boolean>((resolve) => {
          finishSecondFetch = () => { dirty = true; resolve(false); };
        });
      }
      return true;
    }, () => dirty, () => { dirty = false; }).then((succeeded) => {
      live = shouldMarkSubscriptionLive(succeeded, 7, 7, 7);
      return succeeded;
    });
    await secondFetchStarted;
    expect(calls).toBe(2);
    expect(live).toBe(false);
    finishSecondFetch?.();
    await expect(pending).resolves.toBe(true);
    expect(calls).toBe(3);
    expect(live).toBe(true);
    expect(dirty).toBe(false);
    expect(shouldMarkSubscriptionLive(true, 7, 7, 7, false)).toBe(false);
  });
});

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
