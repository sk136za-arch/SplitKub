import type { Bill, Money, SplitSession } from "@/types/bill";

export interface BreakdownRow { itemId: string; itemName: string; amount: Money }
export interface ParticipantTotal { participantId: string; name: string; total: Money; breakdown: BreakdownRow[] }
export interface BillResult { total: Money; people: ParticipantTotal[] }

export interface SessionBreakdownRow extends BreakdownRow { receiptId: string; receiptTitle: string }
export interface SessionPersonTotal {
  participantId: string;
  name: string;
  paid: Money;
  owed: Money;
  net: Money;
  /** Alias for owed, retained for existing summary integrations. */
  total: Money;
  breakdown: SessionBreakdownRow[];
}
export interface ReceiptTotal { receiptId: string; title: string; paidByParticipantId: string; total: Money }
export interface ReimbursementReceipt { receiptId: string; receiptTitle: string; amount: Money }
export interface SettlementTransfer {
  fromParticipantId: string;
  toParticipantId: string;
  amount: Money;
  kind: "direct" | "collection" | "reimbursement";
  receiptBreakdown: ReimbursementReceipt[];
}
export interface SessionResult { total: Money; receipts: ReceiptTotal[]; people: SessionPersonTotal[]; transfers: SettlementTransfer[] }

/** Stable participant-order destinations that actually receive at least one transfer. */
export function settlementDestinations(result: SessionResult, session: SplitSession): string[] {
  const destinations = new Set(result.transfers.map((transfer) => transfer.toParticipantId));
  return session.participants.filter((person) => destinations.has(person.id)).map((person) => person.id);
}

export function calculateBill(bill: Bill): BillResult;
export function calculateBill(session: SplitSession): SessionResult;
export function calculateBill(input: Bill | SplitSession): BillResult | SessionResult {
  return "receipts" in input ? calculateSession(input) : calculateLegacyBill(input);
}

function calculateLegacyBill(bill: Bill): BillResult {
  if (bill.items.length === 0 || bill.participants.length === 0) {
    throw new Error("เพิ่มรายการและคนก่อนคำนวณ");
  }
  const ids = new Set(bill.participants.map((person) => person.id));
  if (ids.size !== bill.participants.length) throw new Error("ข้อมูลคนในบิลไม่ถูกต้อง");
  const people = bill.participants.map((person) => ({
    participantId: person.id, name: person.name, total: 0, breakdown: [] as BreakdownRow[],
  }));
  let total = 0;
  for (const item of bill.items) {
    if (!Number.isSafeInteger(item.price) || item.price <= 0 || !item.name.trim()) {
      throw new Error("รายการหรือราคาไม่ถูกต้อง");
    }
    if (item.participantIds.some((id) => !ids.has(id)) || new Set(item.participantIds).size !== item.participantIds.length) {
      throw new Error("ข้อมูลผู้ร่วมรายการไม่ถูกต้อง");
    }
    const selected = people.filter((person) => item.participantIds.includes(person.participantId));
    if (selected.length === 0) throw new Error(`เลือกรายชื่อผู้ร่วมสำหรับ ${item.name}`);
    if (!Number.isSafeInteger(total + item.price)) throw new Error("ยอดบิลสูงเกินขอบเขตที่รองรับ");
    total += item.price;
    const base = Math.floor(item.price / selected.length);
    const remainder = item.price % selected.length;
    selected.forEach((person, index) => {
      const amount = base + (index < remainder ? 1 : 0);
      person.total += amount;
      person.breakdown.push({ itemId: item.id, itemName: item.name, amount });
    });
  }
  return { total, people };
}

function calculateSession(session: SplitSession): SessionResult {
  if (session.participants.length === 0 || session.receipts.length === 0) {
    throw new Error("เพิ่มคนและใบเสร็จก่อนคำนวณ");
  }
  const ids = new Set(session.participants.map((person) => person.id));
  if (ids.size !== session.participants.length || ids.has("")) throw new Error("ข้อมูลคนในบิลไม่ถูกต้อง");
  if (session.settlementMode !== "direct" && session.settlementMode !== "collector") throw new Error("วิธีชำระเงินไม่ถูกต้อง");
  if (session.settlementMode === "collector" && !ids.has(session.collectorParticipantId)) throw new Error("เลือกคนรวบรวมเงินก่อนคำนวณ");
  const people: SessionPersonTotal[] = session.participants.map((person) => ({
    participantId: person.id, name: person.name, paid: 0, owed: 0, net: 0, total: 0, breakdown: [],
  }));
  const receiptIds = new Set<string>();
  const receipts: ReceiptTotal[] = [];
  let total = 0;

  for (const receipt of session.receipts) {
    if (!receipt.id || receiptIds.has(receipt.id) || !receipt.title.trim()) {
      throw new Error("ข้อมูลใบเสร็จไม่ถูกต้อง");
    }
    receiptIds.add(receipt.id);
    if (!ids.has(receipt.paidByParticipantId)) {
      throw new Error(`เลือกผู้จ่ายสำหรับ ${receipt.title}`);
    }
    if (receipt.items.length === 0) throw new Error(`เพิ่มรายการใน ${receipt.title}`);
    const itemIds = new Set<string>();
    let receiptTotal = 0;
    for (const item of receipt.items) {
      if (!item.id || itemIds.has(item.id) || !item.name.trim() || !Number.isSafeInteger(item.price) || item.price <= 0) {
        throw new Error("รายการหรือราคาไม่ถูกต้อง");
      }
      itemIds.add(item.id);
      if (item.participantIds.some((id) => !ids.has(id)) || new Set(item.participantIds).size !== item.participantIds.length) {
        throw new Error("ข้อมูลผู้ร่วมรายการไม่ถูกต้อง");
      }
      const selected = people.filter((person) => item.participantIds.includes(person.participantId));
      if (selected.length === 0) throw new Error(`เลือกรายชื่อผู้ร่วมสำหรับ ${item.name}`);
      if (!Number.isSafeInteger(receiptTotal + item.price) || !Number.isSafeInteger(total + item.price)) {
        throw new Error("ยอดบิลสูงเกินขอบเขตที่รองรับ");
      }
      receiptTotal += item.price;
      total += item.price;
      const base = Math.floor(item.price / selected.length);
      const remainder = item.price % selected.length;
      selected.forEach((person, index) => {
        const amount = base + (index < remainder ? 1 : 0);
        person.owed += amount;
        person.total = person.owed;
        person.breakdown.push({
          receiptId: receipt.id, receiptTitle: receipt.title,
          itemId: item.id, itemName: item.name, amount,
        });
      });
    }
    const payer = people.find((person) => person.participantId === receipt.paidByParticipantId)!;
    payer.paid += receiptTotal;
    receipts.push({ receiptId: receipt.id, title: receipt.title, paidByParticipantId: receipt.paidByParticipantId, total: receiptTotal });
  }
  people.forEach((person) => { person.net = person.paid - person.owed; });
  const transfers = session.settlementMode === "collector"
    ? collectorTransfers(session.collectorParticipantId, people, receipts)
    : directTransfers(people);
  for (const person of people) {
    const received = transfers.filter((transfer) => transfer.toParticipantId === person.participantId).reduce((sum, transfer) => sum + transfer.amount, 0);
    const sent = transfers.filter((transfer) => transfer.fromParticipantId === person.participantId).reduce((sum, transfer) => sum + transfer.amount, 0);
    if (received - sent !== person.net) throw new Error("ยอดโอนเงินไม่ตรงกับยอดสุทธิ");
  }
  return { total, receipts, people, transfers };
}

function directTransfers(people: SessionPersonTotal[]): SettlementTransfer[] {
  const debtors = people.filter((person) => person.net < 0).map((person) => ({ id: person.participantId, remaining: -person.net }));
  const creditors = people.filter((person) => person.net > 0).map((person) => ({ id: person.participantId, remaining: person.net }));
  const transfers: SettlementTransfer[] = [];
  let debtorIndex = 0;
  let creditorIndex = 0;
  while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
    const debtor = debtors[debtorIndex];
    const creditor = creditors[creditorIndex];
    const amount = Math.min(debtor.remaining, creditor.remaining);
    if (amount > 0) transfers.push({ fromParticipantId: debtor.id, toParticipantId: creditor.id, amount, kind: "direct", receiptBreakdown: [] });
    debtor.remaining -= amount;
    creditor.remaining -= amount;
    if (debtor.remaining === 0) debtorIndex += 1;
    if (creditor.remaining === 0) creditorIndex += 1;
  }
  if (debtorIndex !== debtors.length || creditorIndex !== creditors.length) throw new Error("ยอดสุทธิไม่สมดุล");
  return transfers;
}

function collectorTransfers(collectorId: string, people: SessionPersonTotal[], receipts: ReceiptTotal[]): SettlementTransfer[] {
  const transfers: SettlementTransfer[] = [];
  for (const person of people) {
    if (person.participantId !== collectorId && person.owed > 0) {
      transfers.push({ fromParticipantId: person.participantId, toParticipantId: collectorId, amount: person.owed, kind: "collection", receiptBreakdown: [] });
    }
  }
  for (const person of people) {
    if (person.participantId !== collectorId && person.paid > 0) {
      transfers.push({
        fromParticipantId: collectorId, toParticipantId: person.participantId,
        amount: person.paid, kind: "reimbursement",
        receiptBreakdown: receipts.filter((receipt) => receipt.paidByParticipantId === person.participantId)
          .map((receipt) => ({ receiptId: receipt.receiptId, receiptTitle: receipt.title, amount: receipt.total })),
      });
    }
  }
  return transfers;
}
