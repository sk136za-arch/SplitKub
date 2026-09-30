import { describe, expect, it, vi } from "vitest";
import { createClientId } from "../lib/id";

describe("createClientId", () => {
  it("uses randomUUID when the browser provides it", () => {
    const randomUUID = vi.fn(() => "00000000-0000-4000-8000-000000000001" as const);
    const source = { randomUUID, getRandomValues: vi.fn() } as unknown as Crypto;

    expect(createClientId(source)).toBe("00000000-0000-4000-8000-000000000001");
    expect(randomUUID).toHaveBeenCalledOnce();
  });

  it("falls back to getRandomValues when randomUUID is unavailable", () => {
    const source = {
      getRandomValues: (values: Uint32Array) => {
        values.set([1, 2, 3, 4]);
        return values;
      },
    } as unknown as Crypto;

    expect(createClientId(source)).toBe("0000001-0000002-0000003-0000004");
  });

  it("still returns distinct IDs when Web Crypto is unavailable", () => {
    expect(createClientId(null)).not.toBe(createClientId(null));
  });
});
