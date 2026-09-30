import type { Bill, Money } from "@/types/bill";

export interface BreakdownRow { itemId: string; itemName: string; amount: Money }
export interface ParticipantTotal { participantId: string; name: string; total: Money; breakdown: BreakdownRow[] }
export interface BillResult { total: Money; people: ParticipantTotal[] }

export function calculateBill(bill: Bill): BillResult {
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
