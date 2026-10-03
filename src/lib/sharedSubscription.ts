export type SharedSubscriptionCallbacks = {
  onChange: () => void;
  onError: (error: unknown) => void;
  onStatus: (status: string) => void;
};

export type SharedSubscriptionFactory = (
  billId: string,
  onChange: () => void,
  onError: (error: unknown) => void,
  onStatus: (status: string) => void,
) => Promise<() => void | Promise<void>>;

export function shouldMarkSubscriptionLive(refreshSucceeded: boolean, callbackGeneration: number, activeGeneration: number, subscribedGeneration: number, sessionIsCurrent = true): boolean {
  return refreshSucceeded && callbackGeneration === activeGeneration && subscribedGeneration === callbackGeneration && sessionIsCurrent;
}

/** Drains queued notifications; each extra fetch is caused by a dirty signal, never an automatic retry. */
export async function refreshWithTrailingDirty(
  refresh: () => Promise<boolean>,
  isDirty: () => boolean,
  clearDirty: () => void,
): Promise<boolean> {
  let succeeded = false;
  do {
    succeeded = await refresh();
    if (!isDirty()) return succeeded;
    clearDirty();
  } while (true);
}

/** Serializes teardown/reconnect and ignores late callbacks from replaced channels. */
export class SharedSubscriptionController {
  private generation = 0;
  private cleanup: (() => void | Promise<void>) | undefined;
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly subscribe: SharedSubscriptionFactory) {}

  restart(billId: string, callbacks: SharedSubscriptionCallbacks): Promise<void> {
    const generation = ++this.generation;
    const operation = this.queue.then(async () => {
      const previousCleanup = this.cleanup;
      this.cleanup = undefined;
      await previousCleanup?.();
      if (generation !== this.generation) return;

      let reportedError = false;
      try {
        const cleanup = await this.subscribe(
          billId,
          () => { if (generation === this.generation) callbacks.onChange(); },
          (error) => { if (generation === this.generation) { reportedError = true; callbacks.onError(error); } },
          (status) => { if (generation === this.generation) callbacks.onStatus(status); },
        );
        if (generation !== this.generation) await cleanup();
        else this.cleanup = cleanup;
      } catch (error) {
        if (generation === this.generation && !reportedError) callbacks.onError(error);
      }
    });
    this.queue = operation.catch(() => {});
    return operation;
  }

  stop(): Promise<void> {
    ++this.generation;
    const operation = this.queue.then(async () => {
      const cleanup = this.cleanup;
      this.cleanup = undefined;
      await cleanup?.();
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
}
