import type { Bill, Money, SplitSession } from "@/types/bill";
import { isReceiptAdjustments } from "./receiptAdjustments";

export interface BreakdownRow { itemId: string; itemName: string; amount: Money }
export interface ParticipantTotal { participantId: string; name: string; total: Money; breakdown: BreakdownRow[] }
export interface BillResult { total: Money; people: ParticipantTotal[] }

export interface SessionBreakdownRow extends BreakdownRow { receiptId: string; receiptTitle: string; kind: "item" | "pre-discount" | "post-discount" }
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
export interface ReceiptTotal {
  receiptId: string; title: string; paidByParticipantId: string;
  subtotal: Money; preDiscount: Money; serviceCharge: Money; vat: Money; postDiscount: Money; total: Money;
}
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

function safeAmount(value: bigint): number {
  if (value < BigInt(0)) throw new Error("ยอดบิลสูงเกินขอบเขตที่รองรับ");
  return safeSignedAmount(value);
}

function safeSignedAmount(value: bigint): number {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount)) throw new Error("ยอดบิลสูงเกินขอบเขตที่รองรับ");
  return amount;
}

function safeAdd(left: number, right: number): number {
  return safeAmount(BigInt(left) + BigInt(right));
}

function halfUp(amount: number, bps: number): number {
  return safeAmount((BigInt(amount) * BigInt(bps) + BigInt(5000)) / BigInt(10000));
}

function equalAllocation(amount: number, count: number): number[] {
  if (count < 1) throw new Error("ไม่มีผู้ร่วมใบเสร็จ");
  const total = BigInt(amount);
  const divisor = BigInt(count);
  const base = total / divisor;
  const remainder = total % divisor;
  return Array.from({ length: count }, (_, index) => safeAmount(base + (BigInt(index) < remainder ? BigInt(1) : BigInt(0))));
}

/** Largest remainder; equal remainders retain the supplied stable order. */
function proportionalAllocation(amount: number, weights: readonly (number | bigint)[]): number[] {
  const normalizedWeights = weights.map((weight) => BigInt(weight));
  const sum = normalizedWeights.reduce((total, weight) => total + weight, BigInt(0));
  if (amount === 0) return weights.map(() => 0);
  if (sum === BigInt(0)) throw new Error("ฐานแบ่งค่าบริการไม่ถูกต้อง");
  const shares = normalizedWeights.map((weight) => safeAmount(BigInt(amount) * weight / sum));
  let remainder = BigInt(amount) - shares.reduce((total, share) => total + BigInt(share), BigInt(0));
  const priority = normalizedWeights.map((weight, index) => ({ index, remainder: BigInt(amount) * weight % sum }))
    .sort((a, b) => a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1);
  for (const candidate of priority) {
    if (remainder === BigInt(0)) break;
    shares[candidate.index] += 1;
    remainder -= BigInt(1);
  }
  return shares;
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
    total = safeAdd(total, item.price);
    const allocations = equalAllocation(item.price, selected.length);
    selected.forEach((person, index) => {
      const amount = allocations[index];
      person.total = safeAdd(person.total, amount);
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
    if (!isReceiptAdjustments(receipt.adjustments)) throw new Error("ส่วนลดหรือค่าบริการไม่ถูกต้อง");
    const itemIds = new Set<string>();
    let subtotal = 0;
    const rows = new Map(people.map((person) => [person.participantId, [] as { itemId: string; itemName: string; base: number }[]]));
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
      subtotal = safeAdd(subtotal, item.price);
      const allocations = equalAllocation(item.price, selected.length);
      selected.forEach((person, index) => {
        const amount = allocations[index];
        rows.get(person.participantId)!.push({ itemId: item.id, itemName: item.name, base: amount });
      });
    }
    const active = people.filter((person) => rows.get(person.participantId)!.length > 0);
    const bases = active.map((person) => rows.get(person.participantId)!.reduce((sum, row) => safeAdd(sum, row.base), 0));
    const adjustment = receipt.adjustments;
    const preDiscount = adjustment.preDiscountEnabled ? adjustment.preDiscount : 0;
    const preShares = equalAllocation(preDiscount, active.length);
    const afterPre = bases.map((base, index) => {
      const value = BigInt(base) - BigInt(preShares[index]);
      if (value < BigInt(0)) throw new Error("ส่วนลดก่อนค่าบริการมากกว่าส่วนของบางคน");
      return safeAmount(value);
    });
    const afterPreTotalValue = BigInt(subtotal) - BigInt(preDiscount);
    if (afterPreTotalValue < BigInt(0)) throw new Error("ส่วนลดก่อนค่าบริการมากกว่ายอดใบเสร็จ");
    const afterPreTotal = safeAmount(afterPreTotalValue);
    const serviceCharge = adjustment.serviceChargeEnabled ? halfUp(afterPreTotal, adjustment.serviceChargeRateBps) : 0;
    const serviceShares = proportionalAllocation(serviceCharge, afterPre);
    const vatBase = BigInt(afterPreTotal) + BigInt(serviceCharge);
    const vat = adjustment.vatEnabled
      ? safeAmount((vatBase * BigInt(adjustment.vatRateBps) + BigInt(5000)) / BigInt(10000))
      : 0;
    const vatShares = proportionalAllocation(vat, afterPre.map((amount, index) => BigInt(amount) + BigInt(serviceShares[index])));
    const postDiscount = adjustment.postDiscountEnabled ? adjustment.postDiscount : 0;
    const postShares = equalAllocation(postDiscount, active.length);
    const receiptTotalValue = BigInt(subtotal) - BigInt(preDiscount) + BigInt(serviceCharge)
      + BigInt(vat) - BigInt(postDiscount);
    if (receiptTotalValue < BigInt(0)) throw new Error("ส่วนลดหลังภาษีมากกว่ายอดใบเสร็จ");
    const receiptTotal = safeAmount(receiptTotalValue);
    active.forEach((person, index) => {
      const owedValue = BigInt(afterPre[index]) + BigInt(serviceShares[index]) + BigInt(vatShares[index]) - BigInt(postShares[index]);
      if (owedValue < BigInt(0)) throw new Error("ส่วนลดหลังภาษีมากกว่าส่วนของบางคน");
      const owed = safeAmount(owedValue);
      const itemRows = rows.get(person.participantId)!;
      const itemWeights = itemRows.map((row) => row.base);
      const serviceRows = proportionalAllocation(serviceShares[index], itemWeights);
      const vatRows = proportionalAllocation(vatShares[index], itemWeights);
      itemRows.forEach((row, rowIndex) => person.breakdown.push({
        receiptId: receipt.id, receiptTitle: receipt.title, kind: "item",
        itemId: row.itemId, itemName: row.itemName,
        amount: safeAdd(row.base, safeAdd(serviceRows[rowIndex], vatRows[rowIndex])),
      }));
      if (preShares[index]) person.breakdown.push({ receiptId: receipt.id, receiptTitle: receipt.title, kind: "pre-discount", itemId: "", itemName: "ส่วนลดก่อนค่าบริการ", amount: -preShares[index] });
      if (postShares[index]) person.breakdown.push({ receiptId: receipt.id, receiptTitle: receipt.title, kind: "post-discount", itemId: "", itemName: "ส่วนลดหลังภาษี", amount: -postShares[index] });
      person.owed = safeAdd(person.owed, owed);
      person.total = person.owed;
    });
    const payer = people.find((person) => person.participantId === receipt.paidByParticipantId)!;
    payer.paid = safeAdd(payer.paid, receiptTotal);
    total = safeAdd(total, receiptTotal);
    receipts.push({ receiptId: receipt.id, title: receipt.title, paidByParticipantId: receipt.paidByParticipantId,
      subtotal, preDiscount, serviceCharge, vat, postDiscount, total: receiptTotal });
  }
  if (people.reduce((sum, person) => sum + BigInt(person.owed), BigInt(0)) !== BigInt(total)) throw new Error("ยอดหารไม่ตรงกับยอดใบเสร็จ");
  people.forEach((person) => { person.net = safeSignedAmount(BigInt(person.paid) - BigInt(person.owed)); });
  const transfers = session.settlementMode === "collector"
    ? collectorTransfers(session.collectorParticipantId, people, receipts)
    : directTransfers(people);
  for (const person of people) {
    const received = transfers.filter((transfer) => transfer.toParticipantId === person.participantId).reduce((sum, transfer) => sum + BigInt(transfer.amount), BigInt(0));
    const sent = transfers.filter((transfer) => transfer.fromParticipantId === person.participantId).reduce((sum, transfer) => sum + BigInt(transfer.amount), BigInt(0));
    if (received - sent !== BigInt(person.net)) throw new Error("ยอดโอนเงินไม่ตรงกับยอดสุทธิ");
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
