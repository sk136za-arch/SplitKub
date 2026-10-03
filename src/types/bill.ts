export type Currency = "THB" | "USD";
export type SettlementMode = "direct" | "collector";
/** Integer satang for THB or integer cents for USD. */
export type Money = number;

export interface Participant { id: string; name: string; promptPay?: string }
export interface BillItem { id: string; name: string; price: Money; participantIds: string[] }
export interface Bill {
  currency: Currency;
  participants: Participant[];
  items: BillItem[];
  promptPay: string;
}

export interface SessionParticipant extends Participant { promptPay: string }
export interface Receipt {
  id: string;
  title: string;
  /** Empty only while a draft or migrated receipt awaits payer selection. */
  paidByParticipantId: string;
  items: BillItem[];
}
export interface SplitSession {
  id: string;
  title: string;
  currency: Currency;
  /** Remote optimistic-concurrency revision; local edits do not advance it. */
  revision: number;
  /** ISO expiry from the remote service; empty on a local-only draft. */
  expiresAt: string;
  settlementMode: SettlementMode;
  /** Empty unless a valid participant is selected in collector mode. */
  collectorParticipantId: string;
  participants: SessionParticipant[];
  receipts: Receipt[];
}
