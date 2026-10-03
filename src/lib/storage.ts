import type { Bill, SplitSession } from "@/types/bill";
import { emptyBill } from "./billState";

export const STORAGE_KEY = "splitkub:bill:v1";
const VERSION = 1;
export const V2_SESSION_STORAGE_KEY = "splitkub:session:v2";
export const SESSION_STORAGE_KEY = "splitkub:session:v3";
const SESSION_VERSION = 3;
export const SESSION_MIGRATION_NOTICE_KEY = "splitkub:session:migration-notice:v1";
export const SESSION_PENDING_PROMPTPAY_KEY = "splitkub:session:pending-promptpay:v1";
export const SESSION_PROMPTPAY_MIGRATION_RESOLVED_KEY = "splitkub:session:promptpay-migration-resolved:v1";
export function legacyPromptPayMigrationNotice(value: string): string {
  return `พบ PromptPay เดิม (${value}) ซึ่งยังไม่ได้ผูกกับคนใด กรุณาเลือกผู้รับ หรือทิ้งเลขนี้อย่างชัดเจน`;
}

export function shouldPersistBill(started: boolean, bill: Bill): boolean {
  return started || bill.items.length > 0 || bill.participants.length > 0 || bill.promptPay.trim().length > 0;
}

export function saveBill(storage: Pick<Storage, "setItem">, bill: Bill, started = true): void {
  storage.setItem(STORAGE_KEY, JSON.stringify({ version: VERSION, started, bill }));
}

export function loadBill(storage: Pick<Storage, "getItem">): Bill | null {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const envelope = JSON.parse(raw) as { version?: unknown; started?: unknown; bill?: unknown };
    if (envelope.version !== VERSION || !isBill(envelope.bill)) return null;
    if (!shouldPersistBill(envelope.started === true, envelope.bill)) return null;
    return envelope.bill;
  } catch { return null; }
}

/** Safely resolves browser storage too, since accessing window.localStorage may itself throw. */
export function loadBillSafely(getStorage: () => Pick<Storage, "getItem">): Bill | null {
  try { return loadBill(getStorage()); } catch { return null; }
}

export function resolveStorageSafely<T extends object>(getStorage: () => T): T | null {
  try { return getStorage(); } catch { return null; }
}

function isBill(value: unknown): value is Bill {
  if (!value || typeof value !== "object") return false;
  const bill = value as Record<string, unknown>;
  if (bill.currency !== "THB" && bill.currency !== "USD") return false;
  if (typeof bill.promptPay !== "string" || !Array.isArray(bill.participants) || !Array.isArray(bill.items)) return false;
  const people = bill.participants as unknown[];
  const personIds = new Set<string>();
  for (const value of people) {
    if (!value || typeof value !== "object") return false;
    const person = value as Record<string, unknown>;
    if (typeof person.id !== "string" || !person.id || personIds.has(person.id) || typeof person.name !== "string" || !person.name.trim()) return false;
    personIds.add(person.id);
  }
  const itemIds = new Set<string>();
  for (const value of bill.items as unknown[]) {
    if (!value || typeof value !== "object") return false;
    const item = value as Record<string, unknown>;
    if (typeof item.id !== "string" || !item.id || itemIds.has(item.id) || typeof item.name !== "string" || !item.name.trim() || typeof item.price !== "number" || !Number.isSafeInteger(item.price) || item.price <= 0 || !Array.isArray(item.participantIds)) return false;
    if (item.participantIds.some((id: unknown) => typeof id !== "string" || !personIds.has(id)) || new Set(item.participantIds).size !== item.participantIds.length) return false;
    itemIds.add(item.id);
  }
  return true;
}

export function clearBillStorage(storage: Pick<Storage, "removeItem">): void {
  storage.removeItem(STORAGE_KEY);
}

export { emptyBill };

export function shouldPersistSession(started: boolean, session: SplitSession): boolean {
  return started || session.receipts.length > 0 || session.participants.length > 0 || Boolean(session.id);
}

export function saveSession(storage: Pick<Storage, "setItem">, session: SplitSession, started = true): void {
  if (!isSession(session)) throw new Error("ข้อมูลบิลไม่ถูกต้อง");
  storage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ version: SESSION_VERSION, started, session }));
}

/** Reads V3 first. Valid V2/V1 drafts are copied into V3; original keys remain intact. */
export function loadSession(storage: Pick<Storage, "getItem" | "setItem">): SplitSession | null {
  const pendingLegacyPromptPay = preserveLegacyPromptPay(storage);
  try {
    const raw = storage.getItem(SESSION_STORAGE_KEY);
    if (raw) {
      const envelope = JSON.parse(raw) as { version?: unknown; started?: unknown; session?: unknown };
      if (envelope.version === SESSION_VERSION && isSession(envelope.session) && shouldPersistSession(envelope.started === true, envelope.session)) {
        if (pendingLegacyPromptPay) ensureMigrationNotice(storage);
        return envelope.session;
      }
    }
  } catch { /* Fall back to V2 or the independent V1 copy. */ }
  try {
    const rawV2 = storage.getItem(V2_SESSION_STORAGE_KEY);
    if (rawV2) {
      const envelope = JSON.parse(rawV2) as { version?: unknown; started?: unknown; session?: unknown };
      const migratedV2 = migrateV2Session(envelope.version === 2 ? envelope.session : null);
      if (migratedV2 && shouldPersistSession(envelope.started === true, migratedV2)) {
        try { saveSession(storage, migratedV2, envelope.started === true); } catch { /* Keep V2 as a recoverable copy. */ }
        if (pendingLegacyPromptPay) ensureMigrationNotice(storage);
        return migratedV2;
      }
    }
  } catch { /* Fall back to V1. */ }
  const legacy = loadBill(storage);
  if (!legacy) return null;
  const migrated = migrateLegacyBill(legacy);
  if (legacy.promptPay.trim()) ensureMigrationNotice(storage);
  if (legacy.promptPay.trim() && !pendingLegacyPromptPay) return migrated;
  try { saveSession(storage, migrated); } catch { /* Keep the usable in-memory draft and original V1 key. */ }
  return migrated;
}

export function loadSessionSafely(getStorage: () => Pick<Storage, "getItem" | "setItem">): SplitSession | null {
  try { return loadSession(getStorage()); } catch { return null; }
}

export function migrateLegacyBill(bill: Bill): SplitSession {
  return {
    id: "", title: "บิลของเรา", currency: bill.currency, revision: 0, expiresAt: "",
    settlementMode: "direct", collectorParticipantId: "",
    participants: bill.participants.map((person) => ({ ...person, promptPay: "" })),
    receipts: [{ id: "legacy-receipt-1", title: "ใบเสร็จที่ 1", paidByParticipantId: "", items: bill.items.map((item) => ({ ...item, participantIds: [...item.participantIds] })) }],
  };
}

/** Accepts only a structurally valid V2 session and adds routing defaults without mutating it. */
export function migrateV2Session(value: unknown): SplitSession | null {
  if (!value || typeof value !== "object") return null;
  const migrated = { ...value, settlementMode: "direct", collectorParticipantId: "" };
  return isSession(migrated) ? migrated : null;
}

export function sessionMigrationNotice(storage: Pick<Storage, "getItem">): string {
  try {
    const value = pendingLegacyPromptPay(storage);
    return value ? legacyPromptPayMigrationNotice(value) : "";
  } catch { return ""; }
}

export function pendingLegacyPromptPay(storage: Pick<Storage, "getItem">): string {
  try {
    if (storage.getItem(SESSION_PROMPTPAY_MIGRATION_RESOLVED_KEY)) return "";
    const pending = storage.getItem(SESSION_PENDING_PROMPTPAY_KEY);
    if (pending) return pending;
    return loadBill(storage)?.promptPay ?? "";
  } catch { return ""; }
}

export function dismissSessionMigrationNotice(storage: Pick<Storage, "setItem" | "removeItem">): void {
  resolveLegacyPromptPayMigration(storage, "explicitly-discarded");
}

function resolveLegacyPromptPayMigration(storage: Pick<Storage, "setItem" | "removeItem">, resolution: "assigned" | "explicitly-discarded"): void {
  storage.setItem(SESSION_PROMPTPAY_MIGRATION_RESOLVED_KEY, resolution);
  storage.removeItem(SESSION_PENDING_PROMPTPAY_KEY);
  storage.removeItem(SESSION_MIGRATION_NOTICE_KEY);
}

/** Persist an explicit participant assignment before retiring the separate pending value. */
export function saveAssignedLegacyPromptPay(
  storage: Pick<Storage, "setItem" | "removeItem">,
  session: SplitSession,
  pendingValue: string,
): void {
  if (!pendingValue || !session.participants.some((person) => person.promptPay === pendingValue)) {
    throw new Error("กรุณาบันทึกเลข PromptPay ให้คนที่เลือกก่อน");
  }
  saveSession(storage, session, true);
  resolveLegacyPromptPayMigration(storage, "assigned");
}

function ensureMigrationNotice(storage: Pick<Storage, "setItem">): void {
  try { storage.setItem(SESSION_MIGRATION_NOTICE_KEY, "legacy-promptpay-unassigned"); } catch { /* The pending value is the source of truth. */ }
}

/** Copies the exact old global value before any flow can retire the V1 bill. */
function preserveLegacyPromptPay(storage: Pick<Storage, "getItem" | "setItem">): string {
  try {
    if (storage.getItem(SESSION_PROMPTPAY_MIGRATION_RESOLVED_KEY)) return "";
    const pending = storage.getItem(SESSION_PENDING_PROMPTPAY_KEY);
    if (pending) return pending;
    const legacy = loadBill(storage);
    if (!legacy?.promptPay.trim()) return "";
    storage.setItem(SESSION_PENDING_PROMPTPAY_KEY, legacy.promptPay);
    ensureMigrationNotice(storage);
    return legacy.promptPay;
  } catch { return ""; }
}

/** Call only after the remote service has confirmed this session is saved. */
export function confirmRemoteSession(storage: Pick<Storage, "getItem" | "setItem" | "removeItem">, confirmedSession: SplitSession): void {
  if (!confirmedSession.id || !Number.isSafeInteger(confirmedSession.revision) || confirmedSession.revision < 0 || !confirmedSession.expiresAt) {
    throw new Error("ยังไม่ได้รับการยืนยันจากเซิร์ฟเวอร์");
  }
  const raw = storage.getItem(SESSION_STORAGE_KEY);
  if (!raw) throw new Error("ยังไม่ได้บันทึกบิลล่าสุดในเครื่อง");
  let stored: unknown;
  try { stored = JSON.parse(raw); } catch { throw new Error("ข้อมูลบิลในเครื่องไม่ถูกต้อง"); }
  if (!stored || typeof stored !== "object" || !("session" in stored) || !("version" in stored) || stored.version !== SESSION_VERSION || !isSession(stored.session) ||
    stored.session.id !== confirmedSession.id || stored.session.revision !== confirmedSession.revision) {
    throw new Error("บิลในเครื่องยังไม่ตรงกับข้อมูลที่เซิร์ฟเวอร์ยืนยัน");
  }
  const legacy = loadBill(storage);
  const pending = preserveLegacyPromptPay(storage);
  const migrationResolved = Boolean(storage.getItem(SESSION_PROMPTPAY_MIGRATION_RESOLVED_KEY));
  if (legacy?.promptPay.trim() && !migrationResolved && pending !== legacy.promptPay) {
    throw new Error("ยังบันทึก PromptPay เดิมไม่สำเร็จ จึงเก็บบิลเก่าไว้ก่อน");
  }
  storage.removeItem(STORAGE_KEY);
  storage.removeItem(V2_SESSION_STORAGE_KEY);
}

/** Persist the exact server-confirmed V3 draft before retiring its V1/V2 copies. */
export function saveConfirmedRemoteSession(
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">,
  confirmedSession: SplitSession,
): void {
  saveSession(storage, confirmedSession, true);
  confirmRemoteSession(storage, confirmedSession);
}

/** Explicit user clear removes all copies so an older bill cannot reappear. */
export function clearSessionStorage(storage: Pick<Storage, "removeItem">): void {
  storage.removeItem(SESSION_STORAGE_KEY);
  storage.removeItem(V2_SESSION_STORAGE_KEY);
  storage.removeItem(STORAGE_KEY);
  storage.removeItem(SESSION_MIGRATION_NOTICE_KEY);
  storage.removeItem(SESSION_PENDING_PROMPTPAY_KEY);
  storage.removeItem(SESSION_PROMPTPAY_MIGRATION_RESOLVED_KEY);
}

function isSession(value: unknown): value is SplitSession {
  if (!value || typeof value !== "object") return false;
  const session = value as Record<string, unknown>;
  if (typeof session.id !== "string" || typeof session.title !== "string" || !session.title.trim() ||
    (session.currency !== "THB" && session.currency !== "USD") ||
    (session.settlementMode !== "direct" && session.settlementMode !== "collector") ||
    typeof session.collectorParticipantId !== "string" ||
    !Number.isSafeInteger(session.revision) || (session.revision as number) < 0 ||
    typeof session.expiresAt !== "string" ||
    !Array.isArray(session.participants) || !Array.isArray(session.receipts)) return false;

  const participantIds = new Set<string>();
  for (const value of session.participants as unknown[]) {
    if (!value || typeof value !== "object") return false;
    const person = value as Record<string, unknown>;
    if (typeof person.id !== "string" || !person.id || participantIds.has(person.id) ||
      typeof person.name !== "string" || !person.name.trim() || typeof person.promptPay !== "string") return false;
    participantIds.add(person.id);
  }
  if ((session.settlementMode === "direct" && session.collectorParticipantId !== "") ||
      (session.settlementMode === "collector" && !participantIds.has(session.collectorParticipantId))) return false;
  const receiptIds = new Set<string>();
  for (const value of session.receipts as unknown[]) {
    if (!value || typeof value !== "object") return false;
    const receipt = value as Record<string, unknown>;
    if (typeof receipt.id !== "string" || !receipt.id || receiptIds.has(receipt.id) ||
      typeof receipt.title !== "string" || !receipt.title.trim() ||
      typeof receipt.paidByParticipantId !== "string" ||
      (receipt.paidByParticipantId !== "" && !participantIds.has(receipt.paidByParticipantId)) ||
      !Array.isArray(receipt.items)) return false;
    receiptIds.add(receipt.id);
    const itemIds = new Set<string>();
    for (const value of receipt.items as unknown[]) {
      if (!value || typeof value !== "object") return false;
      const item = value as Record<string, unknown>;
      if (typeof item.id !== "string" || !item.id || itemIds.has(item.id) ||
        typeof item.name !== "string" || !item.name.trim() ||
        !Number.isSafeInteger(item.price) || (item.price as number) <= 0 ||
        !Array.isArray(item.participantIds) ||
        item.participantIds.some((id: unknown) => typeof id !== "string" || !participantIds.has(id)) ||
        new Set(item.participantIds).size !== item.participantIds.length) return false;
      itemIds.add(item.id);
    }
  }
  return true;
}

/** Validate an untrusted remote or local payload before restoring it into state. */
export function isSplitSession(value: unknown): value is SplitSession {
  return isSession(value);
}
