import { describe, expect, it } from "vitest";
import { calculateBill } from "../lib/calculateBill";
import { emptyBill, emptySession } from "../lib/billState";
import { clearSessionStorage, confirmRemoteSession, dismissSessionMigrationNotice, legacyPromptPayMigrationNotice, loadSession, pendingLegacyPromptPay, saveAssignedLegacyPromptPay, saveBill, saveConfirmedRemoteSession, saveSession, sessionMigrationNotice, SESSION_MIGRATION_NOTICE_KEY, SESSION_PENDING_PROMPTPAY_KEY, SESSION_PROMPTPAY_MIGRATION_RESOLVED_KEY, SESSION_STORAGE_KEY, STORAGE_KEY, V2_SESSION_STORAGE_KEY } from "../lib/storage";

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
  };
}

describe("V2 session storage", () => {
  it("copies V2 to V3 with direct routing, retaining V2 until remote confirmation", () => {
    const storage = memoryStorage();
    const v2 = { ...emptySession(), participants: [{ id: "p", name: "Pat", promptPay: "0891234567" }] };
    const oldSession: Record<string, unknown> = { ...v2 };
    delete oldSession.settlementMode;
    delete oldSession.collectorParticipantId;
    const original = JSON.stringify({ version: 2, started: true, session: oldSession });
    storage.data.set(V2_SESSION_STORAGE_KEY, original);
    const migrated = loadSession(storage)!;
    expect(migrated).toMatchObject({ settlementMode: "direct", collectorParticipantId: "", participants: v2.participants });
    expect(storage.data.get(V2_SESSION_STORAGE_KEY)).toBe(original);
    expect(JSON.parse(storage.data.get(SESSION_STORAGE_KEY)!).version).toBe(3);
    const confirmed = { ...migrated, id: "remote", revision: 1, expiresAt: "2026-10-05T00:00:00Z" };
    saveConfirmedRemoteSession(storage, confirmed);
    expect(storage.data.has(V2_SESSION_STORAGE_KEY)).toBe(false);
  });

  it("keeps a usable V2 draft and old key if copying to V3 fails", () => {
    const storage = memoryStorage();
    const oldSession: Record<string, unknown> = { ...emptySession() };
    delete oldSession.settlementMode;
    delete oldSession.collectorParticipantId;
    storage.data.set(V2_SESSION_STORAGE_KEY, JSON.stringify({ version: 2, started: true, session: oldSession }));
    const failing = { getItem: storage.getItem, setItem: () => { throw new Error("quota"); } };
    expect(loadSession(failing)?.settlementMode).toBe("direct");
    expect(storage.data.has(V2_SESSION_STORAGE_KEY)).toBe(true);
    expect(storage.data.has(SESSION_STORAGE_KEY)).toBe(false);
  });
  it("migrates V1 by copying and preserves data plus its original key", () => {
    const storage = memoryStorage();
    saveBill(storage, { ...emptyBill(), promptPay: "0891234567", participants: [{ id: "p", name: "Pat" }], items: [{ id: "i", name: "Food", price: 101, participantIds: ["p"] }] });
    const original = storage.data.get(STORAGE_KEY);
    const session = loadSession(storage)!;
    expect(session).toMatchObject({ id: "", title: "บิลของเรา", revision: 0, expiresAt: "" });
    expect(session.participants).toEqual([{ id: "p", name: "Pat", promptPay: "" }]);
    expect(sessionMigrationNotice(storage)).toBe(legacyPromptPayMigrationNotice("0891234567"));
    expect(pendingLegacyPromptPay(storage)).toBe("0891234567");
    expect(session.receipts[0]).toMatchObject({ title: "ใบเสร็จที่ 1", paidByParticipantId: "", items: [{ id: "i", price: 101, participantIds: ["p"] }] });
    expect(storage.data.get(STORAGE_KEY)).toBe(original);
    expect(storage.data.has(SESSION_STORAGE_KEY)).toBe(true);
    expect(loadSession(storage)).toEqual(session);
    expect(() => calculateBill(session)).toThrow(/ผู้จ่าย/);
  });
  it("returns an in-memory migrated draft if V2 write fails", () => {
    const legacy = JSON.stringify({ version: 1, started: true, bill: { ...emptyBill(), participants: [{ id: "p", name: "Pat" }] } });
    const storage = { getItem: (key: string) => key === STORAGE_KEY ? legacy : null, setItem: () => { throw new Error("quota"); } };
    expect(loadSession(storage)?.participants[0].id).toBe("p");
  });
  it("does not migrate the old global PromptPay onto any participant", () => {
    const storage = memoryStorage();
    saveBill(storage, { ...emptyBill(), promptPay: "0891234567", participants: [{ id: "p", name: "Pat" }, { id: "q", name: "Quinn" }] });
    const migrated = loadSession(storage)!;
    expect(migrated.participants.map((person) => person.promptPay)).toEqual(["", ""]);
    expect(storage.data.get(SESSION_MIGRATION_NOTICE_KEY)).toBe("legacy-promptpay-unassigned");
    expect(storage.data.get(SESSION_PENDING_PROMPTPAY_KEY)).toBe("0891234567");
    expect(sessionMigrationNotice(storage)).toBe(legacyPromptPayMigrationNotice("0891234567"));
  });
  it("rejects corrupt V2 and falls back to V1 without deleting it", () => {
    const storage = memoryStorage();
    saveBill(storage, { ...emptyBill(), participants: [{ id: "p", name: "Pat" }] });
    storage.data.set(SESSION_STORAGE_KEY, JSON.stringify({ version: 2, session: { ...emptySession(), receipts: [{ id: "r", title: "R", paidByParticipantId: "unknown", items: [] }] } }));
    expect(loadSession(storage)?.participants[0].name).toBe("Pat");
    expect(storage.data.has(STORAGE_KEY)).toBe(true);
  });
  it("removes V1 only after explicit remote confirmation, while user clear removes both", () => {
    const storage = memoryStorage();
    saveBill(storage, { ...emptyBill(), participants: [{ id: "p", name: "Pat" }] });
    saveSession(storage, { ...emptySession(), participants: [{ id: "p", name: "Pat", promptPay: "" }] });
    expect(() => confirmRemoteSession(storage, emptySession())).toThrow();
    expect(storage.data.has(STORAGE_KEY)).toBe(true);
    const confirmed = { ...emptySession(), id: "remote", revision: 1, expiresAt: "2026-10-05T00:00:00Z" };
    expect(() => confirmRemoteSession(storage, confirmed)).toThrow(/ไม่ตรง/);
    saveSession(storage, confirmed);
    confirmRemoteSession(storage, confirmed);
    expect(storage.data.has(STORAGE_KEY)).toBe(false);
    saveBill(storage, { ...emptyBill(), participants: [{ id: "p", name: "Pat" }] });
    storage.data.set(SESSION_MIGRATION_NOTICE_KEY, "legacy-promptpay-unassigned");
    clearSessionStorage(storage);
    expect(storage.data.has(STORAGE_KEY)).toBe(false);
    expect(storage.data.has(SESSION_STORAGE_KEY)).toBe(false);
    expect(storage.data.has(SESSION_MIGRATION_NOTICE_KEY)).toBe(false);
    expect(storage.data.has(SESSION_PENDING_PROMPTPAY_KEY)).toBe(false);
  });
  it("saves a remote snapshot before confirming it and preserves V1 if saving fails", () => {
    const storage = memoryStorage();
    saveBill(storage, { ...emptyBill(), promptPay: "0891234567", participants: [{ id: "p", name: "Pat" }] });
    const confirmed = { ...emptySession(), id: "remote", revision: 1, expiresAt: "2026-10-05T00:00:00Z" };
    saveConfirmedRemoteSession(storage, confirmed);
    expect(storage.data.has(SESSION_STORAGE_KEY)).toBe(true);
    expect(storage.data.has(STORAGE_KEY)).toBe(false);
    expect(storage.data.get(SESSION_PENDING_PROMPTPAY_KEY)).toBe("0891234567");

    const failing = {
      getItem: storage.getItem,
      setItem: () => { throw new Error("quota"); },
      removeItem: storage.removeItem,
    };
    saveBill(storage, { ...emptyBill(), participants: [{ id: "p", name: "Pat" }] });
    expect(() => saveConfirmedRemoteSession(failing, confirmed)).toThrow("quota");
    expect(storage.data.has(STORAGE_KEY)).toBe(true);
  });

  it("retains the exact V1 PromptPay outside V1 before retiring its key", () => {
    const storage = memoryStorage();
    saveBill(storage, { ...emptyBill(), promptPay: "0891234567", participants: [{ id: "p", name: "Pat" }] });
    const migrated = loadSession(storage)!;
    expect(migrated.participants[0].promptPay).toBe("");
    expect(pendingLegacyPromptPay(storage)).toBe("0891234567");
    const confirmed = { ...migrated, id: "remote", revision: 1, expiresAt: "2026-10-05T00:00:00Z" };
    saveConfirmedRemoteSession(storage, confirmed);
    expect(storage.data.has(STORAGE_KEY)).toBe(false);
    expect(storage.data.get(SESSION_PENDING_PROMPTPAY_KEY)).toBe("0891234567");
    expect(pendingLegacyPromptPay(storage)).toBe("0891234567");
    expect(sessionMigrationNotice(storage)).toContain("0891234567");
  });

  it("clears pending PromptPay only after explicit assignment is saved or explicitly discarded", () => {
    const storage = memoryStorage();
    saveBill(storage, { ...emptyBill(), promptPay: "0891234567", participants: [{ id: "p", name: "Pat" }] });
    const migrated = loadSession(storage)!;
    saveAssignedLegacyPromptPay(storage, { ...migrated, participants: [{ id: "p", name: "Pat", promptPay: "0891234567" }] }, "0891234567");
    expect(JSON.parse(storage.data.get(SESSION_STORAGE_KEY)!).session.participants[0].promptPay).toBe("0891234567");
    expect(storage.data.has(SESSION_PENDING_PROMPTPAY_KEY)).toBe(false);
    expect(storage.data.get(SESSION_PROMPTPAY_MIGRATION_RESOLVED_KEY)).toBe("assigned");
    const assigned = JSON.parse(storage.data.get(SESSION_STORAGE_KEY)!).session;
    saveConfirmedRemoteSession(storage, { ...assigned, id: "remote", revision: 1, expiresAt: "2026-10-05T00:00:00Z" });
    expect(storage.data.has(STORAGE_KEY)).toBe(false);
    expect(storage.data.has(SESSION_PENDING_PROMPTPAY_KEY)).toBe(false);
    expect(JSON.parse(storage.data.get(SESSION_STORAGE_KEY)!).session.participants[0].promptPay).toBe("0891234567");

    const discardedStorage = memoryStorage();
    saveBill(discardedStorage, { ...emptyBill(), promptPay: "0811111111", participants: [{ id: "q", name: "Quinn" }] });
    loadSession(discardedStorage);
    dismissSessionMigrationNotice(discardedStorage);
    expect(discardedStorage.data.has(SESSION_PENDING_PROMPTPAY_KEY)).toBe(false);
    expect(discardedStorage.data.get(SESSION_PROMPTPAY_MIGRATION_RESOLVED_KEY)).toBe("explicitly-discarded");
  });
});
