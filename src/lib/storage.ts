import type { Bill } from "@/types/bill";
import { emptyBill } from "./billState";

export const STORAGE_KEY = "splitkub:bill:v1";
const VERSION = 1;

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
