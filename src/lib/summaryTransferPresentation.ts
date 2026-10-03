import type { SessionResult, SettlementTransfer } from "./calculateBill";
import type { SplitSession } from "../types/bill";

type Fraction = { numerator: bigint; denominator: bigint };
export type SummaryTransferRow = SettlementTransfer;
export interface DisplayPaymentTotal { participantId: string; outgoing: number; incoming: number }

const ZERO: Fraction = { numerator: BigInt(0), denominator: BigInt(1) };

function gcd(a: bigint, b: bigint): bigint {
  while (b !== BigInt(0)) [a, b] = [b, a % b];
  return a < BigInt(0) ? -a : a;
}

function fraction(numerator: bigint, denominator: bigint): Fraction {
  if (denominator <= BigInt(0)) throw new Error("จำนวนผู้ร่วมรายการไม่ถูกต้อง");
  if (numerator === BigInt(0)) return ZERO;
  const divisor = gcd(numerator, denominator);
  return { numerator: numerator / divisor, denominator: denominator / divisor };
}

function add(a: Fraction, b: Fraction): Fraction {
  return fraction(a.numerator * b.denominator + b.numerator * a.denominator, a.denominator * b.denominator);
}

function subtract(a: Fraction, b: Fraction): Fraction {
  return fraction(a.numerator * b.denominator - b.numerator * a.denominator, a.denominator * b.denominator);
}

function compare(a: Fraction, b: Fraction): number {
  const difference = a.numerator * b.denominator - b.numerator * a.denominator;
  return difference < BigInt(0) ? -1 : difference > BigInt(0) ? 1 : 0;
}

function ceilMinorUnits(value: Fraction): number {
  if (value.numerator < BigInt(0)) throw new Error("ยอดแสดงผลต้องไม่ติดลบ");
  const rounded = (value.numerator + value.denominator - BigInt(1)) / value.denominator;
  const amount = Number(rounded);
  if (!Number.isSafeInteger(amount)) throw new Error("ยอดแสดงผลสูงเกินขอบเขตที่รองรับ");
  return amount;
}

function safeAddMinorUnits(left: number, right: number): number {
  const result = left + right;
  if (!Number.isSafeInteger(result) || result < 0) throw new Error("ยอดแสดงผลสูงเกินขอบเขตที่รองรับ");
  return result;
}

/** Exact pre-allocation shares, using integer minor units and rational arithmetic only. */
function rawOwed(session: SplitSession): Map<string, Fraction> {
  const owed = new Map(session.participants.map((person) => [person.id, ZERO]));
  for (const receipt of session.receipts) {
    for (const item of receipt.items) {
      const share = fraction(BigInt(item.price), BigInt(item.participantIds.length));
      for (const id of item.participantIds) owed.set(id, add(owed.get(id) ?? ZERO, share));
    }
  }
  return owed;
}

/** Display amounts keep the ledger route graph and only round up existing rows. */
export function summaryTransferRows(session: SplitSession, result: SessionResult): SummaryTransferRow[] {
  const owed = rawOwed(session);
  if (session.settlementMode === "collector") {
    return result.transfers.map((transfer) => {
      if (transfer.kind !== "collection") return transfer;
      const displayTarget = Math.max(transfer.amount, ceilMinorUnits(owed.get(transfer.fromParticipantId) ?? ZERO));
      return displayTarget === transfer.amount ? transfer : { ...transfer, amount: displayTarget };
    });
  }

  // Keep the canonical route graph fixed. Any fractional rounding adjustment is
  // added to the payer's final existing direct route in ledger order.
  const outgoingTotals = new Map<string, number>();
  const lastOutgoingIndex = new Map<string, number>();
  result.transfers.forEach((transfer, index) => {
    if (transfer.kind !== "direct") return;
    outgoingTotals.set(transfer.fromParticipantId,
      safeAddMinorUnits(outgoingTotals.get(transfer.fromParticipantId) ?? 0, transfer.amount));
    lastOutgoingIndex.set(transfer.fromParticipantId, index);
  });

  const roundingDelta = new Map<string, number>();
  for (const person of result.people) {
    const ledgerOutgoing = outgoingTotals.get(person.participantId);
    if (ledgerOutgoing === undefined) continue;
    const rawDebt = subtract(owed.get(person.participantId) ?? ZERO, fraction(BigInt(person.paid), BigInt(1)));
    const exactDebt = compare(rawDebt, ZERO) > 0 ? rawDebt : ZERO;
    const presentationTarget = Math.max(ledgerOutgoing, ceilMinorUnits(exactDebt));
    roundingDelta.set(person.participantId, presentationTarget - ledgerOutgoing);
  }

  return result.transfers.map((transfer, index) => {
    if (transfer.kind !== "direct" || lastOutgoingIndex.get(transfer.fromParticipantId) !== index) return transfer;
    const delta = roundingDelta.get(transfer.fromParticipantId) ?? 0;
    return delta > 0 ? { ...transfer, amount: safeAddMinorUnits(transfer.amount, delta) } : transfer;
  });
}

/** Per-person payment instructions for Summary, copy text, and PNG consumers. */
export function displayPaymentTotals(participantIds: readonly string[], rows: readonly SummaryTransferRow[]): DisplayPaymentTotal[] {
  const totals = new Map(participantIds.map((participantId) => [participantId, { participantId, outgoing: 0, incoming: 0 }]));
  for (const row of rows) {
    const payer = totals.get(row.fromParticipantId);
    const receiver = totals.get(row.toParticipantId);
    if (!payer || !receiver) throw new Error("เส้นทางโอนอ้างอิงคนที่ไม่มีในบิล");
    payer.outgoing = safeAddMinorUnits(payer.outgoing, row.amount);
    receiver.incoming = safeAddMinorUnits(receiver.incoming, row.amount);
  }
  return [...totals.values()];
}
