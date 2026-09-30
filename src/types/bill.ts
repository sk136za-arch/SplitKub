export type Currency = "THB" | "USD";
/** Integer satang for THB or integer cents for USD. */
export type Money = number;

export interface Participant { id: string; name: string }
export interface BillItem { id: string; name: string; price: Money; participantIds: string[] }
export interface Bill {
  currency: Currency;
  participants: Participant[];
  items: BillItem[];
  promptPay: string;
}
