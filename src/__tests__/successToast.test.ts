import { afterEach, describe, expect, it, vi } from "vitest";
import { scheduleToastDismiss } from "../components/SuccessToast";

afterEach(() => vi.useRealTimers());

describe("success toast timer", () => {
  it("dismisses after three seconds", () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", globalThis);
    const dismiss = vi.fn();
    const cleanup = scheduleToastDismiss(dismiss);
    vi.advanceTimersByTime(2999);
    expect(dismiss).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(dismiss).toHaveBeenCalledOnce();
    cleanup();
    vi.unstubAllGlobals();
  });

  it("restarts on a new success and clears the timer on dismissal or unmount", () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", globalThis);
    const dismiss = vi.fn();
    const cleanupFirst = scheduleToastDismiss(dismiss);
    vi.advanceTimersByTime(1500);
    cleanupFirst();
    const cleanupSecond = scheduleToastDismiss(dismiss);
    vi.advanceTimersByTime(2999);
    expect(dismiss).not.toHaveBeenCalled();
    cleanupSecond();
    vi.advanceTimersByTime(3000);
    expect(dismiss).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
