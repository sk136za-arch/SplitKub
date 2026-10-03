import type { SharedBillJoinResponse } from "./supabase/sharedBill";

export interface OwnerCapability { publicId: string; billId: string; ownerToken: string; friendToken: string }

/** An authenticated owner may open a friend link, but that token is never an owner recovery secret. */
export function ephemeralOwnerCapability(opened: SharedBillJoinResponse): OwnerCapability {
  if (opened.role !== "owner") throw new Error("สิทธิ์เจ้าของบิลไม่ถูกต้อง");
  return { publicId: opened.publicId, billId: opened.billId, ownerToken: "", friendToken: "" };
}
