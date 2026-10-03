import type { Bill, Currency, Receipt, SplitSession } from "@/types/bill";

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

export const emptySession = (): SplitSession => ({
  id: "", title: "บิลของเรา", currency: "THB", revision: 0, expiresAt: "",
  settlementMode: "direct", collectorParticipantId: "", participants: [], receipts: [],
});

export type SessionAction =
  | { type: "set-title"; title: string }
  | { type: "currency"; currency: Currency }
  | { type: "set-remote-state"; id: string; revision: number; expiresAt: string }
  | { type: "set-settlement-mode"; mode: "direct" | "collector" }
  | { type: "set-collector"; participantId: string }
  | { type: "add-person"; id: string; name: string; promptPay?: string }
  | { type: "edit-person"; id: string; name: string }
  | { type: "set-person-promptpay"; id: string; value: string }
  | { type: "remove-person"; id: string }
  | { type: "add-receipt"; id: string; title: string; paidByParticipantId?: string }
  | { type: "edit-receipt"; id: string; title: string }
  | { type: "remove-receipt"; id: string }
  | { type: "set-receipt-payer"; receiptId: string; paidByParticipantId: string }
  | { type: "add-item"; receiptId: string; id: string; name: string; price: number }
  | { type: "edit-item"; receiptId: string; id: string; name: string; price: number }
  | { type: "remove-item"; receiptId: string; id: string }
  | { type: "toggle"; receiptId: string; itemId: string; participantId: string }
  | { type: "select-item"; receiptId: string; itemId: string; selected: boolean }
  | { type: "restore"; session: SplitSession }
  | { type: "clear" };

function updateReceipt(session: SplitSession, receiptId: string, update: (receipt: Receipt) => Receipt): SplitSession {
  const receipts = session.receipts.map((receipt) => receipt.id === receiptId ? update(receipt) : receipt);
  return receipts.every((receipt, index) => receipt === session.receipts[index]) ? session : { ...session, receipts };
}

export function sessionReducer(session: SplitSession, action: SessionAction): SplitSession {
  switch (action.type) {
    case "set-title": return action.title.trim() ? { ...session, title: action.title } : session;
    case "currency": return session.receipts.some((receipt) => receipt.items.length > 0) ? session : { ...session, currency: action.currency, participants: action.currency === "USD" ? session.participants.map((person) => ({ ...person, promptPay: "" })) : session.participants };
    case "set-remote-state": return Number.isSafeInteger(action.revision) && action.revision >= 0 ? { ...session, id: action.id, revision: action.revision, expiresAt: action.expiresAt } : session;
    case "set-settlement-mode": return action.mode === "direct"
      ? { ...session, settlementMode: "direct", collectorParticipantId: "" }
      : session.participants.some((person) => person.id === session.collectorParticipantId)
        ? { ...session, settlementMode: "collector" }
        : session;
    case "set-collector": return action.participantId && !session.participants.some((person) => person.id === action.participantId)
      ? session
      : { ...session, settlementMode: action.participantId ? "collector" : "direct", collectorParticipantId: action.participantId };
    case "add-person": return !action.id || !action.name.trim() || session.participants.some((person) => person.id === action.id) ? session : { ...session, participants: [...session.participants, { id: action.id, name: action.name, promptPay: action.promptPay ?? "" }] };
    case "edit-person": return !action.name.trim() ? session : { ...session, participants: session.participants.map((person) => person.id === action.id ? { ...person, name: action.name } : person) };
    case "set-person-promptpay": return { ...session, participants: session.participants.map((person) => person.id === action.id ? { ...person, promptPay: action.value } : person) };
    case "remove-person": return {
      ...session,
      settlementMode: session.collectorParticipantId === action.id ? "direct" : session.settlementMode,
      collectorParticipantId: session.collectorParticipantId === action.id ? "" : session.collectorParticipantId,
      participants: session.participants.filter((person) => person.id !== action.id),
      receipts: session.receipts.map((receipt) => ({
        ...receipt,
        paidByParticipantId: receipt.paidByParticipantId === action.id ? "" : receipt.paidByParticipantId,
        items: receipt.items.map((item) => ({ ...item, participantIds: item.participantIds.filter((id) => id !== action.id) })),
      })),
    };
    case "add-receipt": return !action.id || !action.title.trim() || session.receipts.some((receipt) => receipt.id === action.id) || (action.paidByParticipantId && !session.participants.some((person) => person.id === action.paidByParticipantId)) ? session : { ...session, receipts: [...session.receipts, { id: action.id, title: action.title, paidByParticipantId: action.paidByParticipantId ?? "", items: [] }] };
    case "edit-receipt": return !action.title.trim() ? session : updateReceipt(session, action.id, (receipt) => ({ ...receipt, title: action.title }));
    case "remove-receipt": return { ...session, receipts: session.receipts.filter((receipt) => receipt.id !== action.id) };
    case "set-receipt-payer": return action.paidByParticipantId && !session.participants.some((person) => person.id === action.paidByParticipantId) ? session : updateReceipt(session, action.receiptId, (receipt) => ({ ...receipt, paidByParticipantId: action.paidByParticipantId }));
    case "add-item": return !action.id || !action.name.trim() || !Number.isSafeInteger(action.price) || action.price <= 0 ? session : updateReceipt(session, action.receiptId, (receipt) => receipt.items.some((item) => item.id === action.id) ? receipt : { ...receipt, items: [...receipt.items, { id: action.id, name: action.name, price: action.price, participantIds: session.participants.map((person) => person.id) }] });
    case "edit-item": return !action.name.trim() || !Number.isSafeInteger(action.price) || action.price <= 0 ? session : updateReceipt(session, action.receiptId, (receipt) => ({ ...receipt, items: receipt.items.map((item) => item.id === action.id ? { ...item, name: action.name, price: action.price } : item) }));
    case "remove-item": return updateReceipt(session, action.receiptId, (receipt) => ({ ...receipt, items: receipt.items.filter((item) => item.id !== action.id) }));
    case "toggle": return !session.participants.some((person) => person.id === action.participantId) ? session : updateReceipt(session, action.receiptId, (receipt) => ({ ...receipt, items: receipt.items.map((item) => item.id === action.itemId ? { ...item, participantIds: item.participantIds.includes(action.participantId) ? item.participantIds.filter((id) => id !== action.participantId) : [...item.participantIds, action.participantId] } : item) }));
    case "select-item": return updateReceipt(session, action.receiptId, (receipt) => ({ ...receipt, items: receipt.items.map((item) => item.id === action.itemId ? { ...item, participantIds: action.selected ? session.participants.map((person) => person.id) : [] } : item) }));
    case "restore": return action.session;
    case "clear": return emptySession();
  }
}
