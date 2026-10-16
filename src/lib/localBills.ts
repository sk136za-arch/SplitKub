import type { Currency, SplitSession } from "@/types/bill";
import { createClientId } from "./id";
import { emptySession } from "./billState";
import { isSplitSession, loadSessionSafely } from "./storage";

export const LOCAL_BILLS_KEY = "splitkub:local-bills:v1";
const LOCAL_BILLS_VERSION = 1;

export type LocalBillStatus = "draft" | "closed";

export interface LocalBillRecord {
  id: string;
  title: string;
  currency: Currency;
  status: LocalBillStatus;
  createdAt: string;
  updatedAt: string;
  session: SplitSession;
}

interface LocalBillEnvelope { version: number; bills: LocalBillRecord[] }

function isRecord(value: unknown): value is LocalBillRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === "string" && Boolean(record.id) &&
    typeof record.title === "string" && Boolean(record.title.trim()) &&
    (record.currency === "THB" || record.currency === "USD") &&
    (record.status === "draft" || record.status === "closed") &&
    typeof record.createdAt === "string" && typeof record.updatedAt === "string" &&
    isSplitSession(record.session);
}

function ordered(bills: LocalBillRecord[]): LocalBillRecord[] {
  return [...bills].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function loadLocalBills(storage: Pick<Storage, "getItem" | "setItem">): LocalBillRecord[] {
  try {
    const raw = storage.getItem(LOCAL_BILLS_KEY);
    if (raw) {
      const value = JSON.parse(raw) as Partial<LocalBillEnvelope>;
      if (value.version === LOCAL_BILLS_VERSION && Array.isArray(value.bills) && value.bills.every(isRecord)) return ordered(value.bills);
    }
  } catch { /* Fall through to a safe legacy import. */ }

  const legacy = loadSessionSafely(() => storage);
  if (!legacy) return [];
  const now = new Date().toISOString();
  const record: LocalBillRecord = {
    id: createClientId(), title: legacy.title, currency: legacy.currency,
    status: legacy.closedAt ? "closed" : "draft", createdAt: now, updatedAt: now, session: legacy,
  };
  try { saveLocalBills(storage, [record]); } catch { /* The legacy draft remains the recovery source. */ }
  return [record];
}

export function saveLocalBills(storage: Pick<Storage, "setItem">, bills: LocalBillRecord[]): void {
  storage.setItem(LOCAL_BILLS_KEY, JSON.stringify({ version: LOCAL_BILLS_VERSION, bills: ordered(bills) } satisfies LocalBillEnvelope));
}

export function createLocalBill(storage: Pick<Storage, "getItem" | "setItem">): LocalBillRecord {
  const now = new Date().toISOString();
  const session = emptySession();
  const bill: LocalBillRecord = { id: createClientId(), title: session.title, currency: session.currency, status: "draft", createdAt: now, updatedAt: now, session };
  saveLocalBills(storage, [bill, ...loadLocalBills(storage)]);
  return bill;
}

export function findLocalBill(storage: Pick<Storage, "getItem" | "setItem">, id: string): LocalBillRecord | null {
  return loadLocalBills(storage).find((bill) => bill.id === id) ?? null;
}

export function saveLocalBill(storage: Pick<Storage, "getItem" | "setItem">, id: string, session: SplitSession): LocalBillRecord | null {
  const bills = loadLocalBills(storage);
  const previous = bills.find((bill) => bill.id === id);
  if (!previous) return null;
  const next: LocalBillRecord = {
    ...previous, title: session.title, currency: session.currency, status: session.closedAt ? "closed" : "draft",
    updatedAt: new Date().toISOString(), session,
  };
  saveLocalBills(storage, bills.map((bill) => bill.id === id ? next : bill));
  return next;
}

export function closeLocalBill(storage: Pick<Storage, "getItem" | "setItem">, id: string): LocalBillRecord | null {
  const existing = findLocalBill(storage, id);
  if (!existing || existing.status === "closed") return existing;
  return saveLocalBill(storage, id, { ...existing.session, closedAt: new Date().toISOString() });
}

export function deleteLocalBill(storage: Pick<Storage, "getItem" | "setItem">, id: string): boolean {
  const bills = loadLocalBills(storage);
  if (!bills.some((bill) => bill.id === id)) return false;
  saveLocalBills(storage, bills.filter((bill) => bill.id !== id));
  return true;
}
