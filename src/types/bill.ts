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
export interface ReceiptAdjustments {
  vatEnabled: boolean;
  vatRateBps: number;
  serviceChargeEnabled: boolean;
  serviceChargeRateBps: number;
  preDiscountEnabled: boolean;
  preDiscount: Money;
  postDiscountEnabled: boolean;
  postDiscount: Money;
}
export interface Receipt {
  id: string;
  title: string;
  /** Empty only while a draft or migrated receipt awaits payer selection. */
  paidByParticipantId: string;
  adjustments: ReceiptAdjustments;
  items: BillItem[];
}
export interface ParticipantConfirmation {
  participantId: string;
  viewedAt: string;
  confirmedAt: string;
  confirmedContentRevision: number | null;
}
export interface SplitSession {
  id: string;
  title: string;
  currency: Currency;
  /** Remote optimistic-concurrency revision; local edits do not advance it. */
  revision: number;
  /** ISO expiry from the remote service; empty on a local-only draft. */
  expiresAt: string;
  closedAt: string;
  confirmationRevision: number;
  /** Owner sees every status; a friend receives only their selected identity. */
  confirmations: ParticipantConfirmation[];
  settlementMode: SettlementMode;
  /** Empty unless a valid participant is selected in collector mode. */
  collectorParticipantId: string;
  participants: SessionParticipant[];
  receipts: Receipt[];
}
