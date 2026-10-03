import {
  applyOwnerAction, claimParticipant, createSharedBill, fetchSharedBill, joinSharedBill,
  parseSharedBillFragment, setSharedParticipation, sharedBillAvailable, subscribeToSharedBill,
  type SharedBillCreateResponse, type SharedBillJoinResponse,
} from "@/lib/supabase/sharedBill";
import type { SessionAction } from "@/lib/billState";
import type { SplitSession } from "@/types/bill";

export type SharedOpen = SharedBillJoinResponse;
export type SharedCreated = SharedBillCreateResponse;

export function sharingIsAvailable(): boolean { return sharedBillAvailable(); }
export function parseShareFragment(hash: string) { return parseSharedBillFragment(hash); }
export function openSharedBill(publicId: string, token: string, mode: "friend" | "owner"): Promise<SharedOpen> {
  return joinSharedBill(publicId, token, mode);
}
export function createSharedSession(session: SplitSession): Promise<SharedCreated> { return createSharedBill(session); }
export async function refreshSharedBill(billId: string): Promise<SplitSession> { return (await fetchSharedBill(billId)).snapshot; }
export async function claimSharedParticipant(billId: string, participantId: string): Promise<SplitSession> { return (await claimParticipant(billId, participantId)).snapshot; }
export function toggleSharedParticipation(billId: string, receiptId: string, itemId: string, selected: boolean, expectedRevision: number): Promise<SplitSession> {
  return setSharedParticipation(billId, receiptId, itemId, selected, expectedRevision);
}
export function saveSharedOwnerAction(billId: string, revision: number, action: SessionAction): Promise<SplitSession> {
  return applyOwnerAction(billId, revision, action);
}
export function subscribeSharedBill(billId: string, onChange: () => void, onError?: (error: unknown) => void, onStatus?: (status: string) => void): Promise<() => Promise<void>> {
  return subscribeToSharedBill(billId, onChange, onError, onStatus);
}

export function sharedErrorMessage(error: unknown): string {
  if (!error || typeof error !== "object") return "เกิดข้อผิดพลาด กรุณาลองอีกครั้ง";
  const value = error as { code?: string; message?: string };
  if (value.code === "invalid_token" || value.code === "unavailable") return "ลิงก์นี้ไม่ถูกต้องหรือหมดอายุแล้ว";
  if (value.code === "auth_required") return "ลิงก์นี้ไม่มีสิทธิ์แก้ไขบิล";
  if (value.code === "revision_conflict") return "ข้อมูลเปลี่ยนระหว่างแก้ไข กำลังโหลดข้อมูลล่าสุด";
  if (value.code === "disabled" || value.code === "not_configured") return "การแชร์ออนไลน์ยังไม่พร้อมใช้งาน";
  if (value.code === "migration_required") return "ฐานข้อมูลบิลออนไลน์ยังไม่รองรับคนรวบรวมเงิน กรุณาอัปเดต migration ล่าสุดก่อนลองอีกครั้ง";
  if (value.code === "participant_claimed") return "ชื่อนี้มีคนเลือกแล้ว กรุณาเลือกชื่อของคุณ";
  if (value.code === "network") return "เชื่อมต่อไม่สำเร็จ ตรวจอินเทอร์เน็ตแล้วลองอีกครั้ง";
  return value.message || "เกิดข้อผิดพลาด กรุณาลองอีกครั้ง";
}
