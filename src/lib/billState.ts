import type { Bill, Currency } from "@/types/bill";

export const emptyBill = (): Bill => ({ currency: "THB", participants: [], items: [], promptPay: "" });

export type BillAction =
  | { type: "currency"; currency: Currency }
  | { type: "add-person"; id: string; name: string }
  | { type: "edit-person"; id: string; name: string }
  | { type: "remove-person"; id: string }
  | { type: "add-item"; id: string; name: string; price: number }
  | { type: "edit-item"; id: string; name: string; price: number }
  | { type: "remove-item"; id: string }
  | { type: "toggle"; itemId: string; participantId: string }
  | { type: "select-item"; itemId: string; selected: boolean }
  | { type: "promptpay"; value: string }
  | { type: "restore"; bill: Bill }
  | { type: "clear" };

export function billReducer(bill: Bill, action: BillAction): Bill {
  switch (action.type) {
    case "currency": return bill.items.length ? bill : { ...bill, currency: action.currency, promptPay: action.currency === "USD" ? "" : bill.promptPay };
    case "add-person": return { ...bill, participants: [...bill.participants, { id: action.id, name: action.name }] };
    case "edit-person": return { ...bill, participants: bill.participants.map((p) => p.id === action.id ? { ...p, name: action.name } : p) };
    case "remove-person": return { ...bill, participants: bill.participants.filter((p) => p.id !== action.id), items: bill.items.map((item) => ({ ...item, participantIds: item.participantIds.filter((id) => id !== action.id) })) };
    case "add-item": return { ...bill, items: [...bill.items, { id: action.id, name: action.name, price: action.price, participantIds: bill.participants.map((p) => p.id) }] };
    case "edit-item": return { ...bill, items: bill.items.map((item) => item.id === action.id ? { ...item, name: action.name, price: action.price } : item) };
    case "remove-item": return { ...bill, items: bill.items.filter((item) => item.id !== action.id) };
    case "toggle": return { ...bill, items: bill.items.map((item) => item.id !== action.itemId || !bill.participants.some((p) => p.id === action.participantId) ? item : { ...item, participantIds: item.participantIds.includes(action.participantId) ? item.participantIds.filter((id) => id !== action.participantId) : [...item.participantIds, action.participantId] }) };
    case "select-item": return { ...bill, items: bill.items.map((item) => item.id === action.itemId ? { ...item, participantIds: action.selected ? bill.participants.map((p) => p.id) : [] } : item) };
    case "promptpay": return { ...bill, promptPay: action.value };
    case "restore": return action.bill;
    case "clear": return emptyBill();
  }
}
