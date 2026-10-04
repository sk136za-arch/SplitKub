import { describe, expect, it } from "vitest";
import { friendSelectionKey, readFriendSelection, reconcileFriendSelection, rememberFriendSelection } from "../lib/friendSelection";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

describe("friend selection", () => {
  it("remembers a participant separately for each public bill", () => {
    const storage = memoryStorage();
    rememberFriendSelection(storage, "bill-one", "a");
    rememberFriendSelection(storage, "bill-two", "b");
    expect(readFriendSelection(storage, "bill-one", [{ id: "a" }, { id: "b" }])).toBe("a");
    expect(readFriendSelection(storage, "bill-two", [{ id: "a" }, { id: "b" }])).toBe("b");
    expect(storage.values.get(friendSelectionKey("bill-one"))).toBe("a");
  });

  it("drops a deleted selection, but preserves ID through a name or position change", () => {
    const storage = memoryStorage();
    rememberFriendSelection(storage, "bill", "a");
    expect(reconcileFriendSelection(storage, "bill", "a", [{ id: "b" }, { id: "a" }])).toBe("a");
    expect(reconcileFriendSelection(storage, "bill", "a", [{ id: "b" }])).toBe("");
    expect(storage.values.has(friendSelectionKey("bill"))).toBe(false);
    expect(readFriendSelection(storage, "bill", [{ id: "b" }])).toBe("");
  });

  it("removes a remembered ID missing from a reloaded snapshot", () => {
    const storage = memoryStorage();
    rememberFriendSelection(storage, "bill", "deleted");
    expect(readFriendSelection(storage, "bill", [{ id: "other" }])).toBe("");
    expect(storage.values.has(friendSelectionKey("bill"))).toBe(false);
  });

  it("continues without browser storage when access throws", () => {
    const blocked = {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
      removeItem: () => { throw new Error("blocked"); },
    };
    expect(() => rememberFriendSelection(blocked, "bill", "a")).not.toThrow();
    expect(readFriendSelection(blocked, "bill", [{ id: "a" }])).toBe("");
    expect(reconcileFriendSelection(blocked, "bill", "a", [{ id: "a" }])).toBe("a");
  });
});
