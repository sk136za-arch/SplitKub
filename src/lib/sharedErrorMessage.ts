import type { AppLanguage } from "./language";
import { localize } from "./language";
import type { SharedBillErrorCode } from "./supabase/sharedBill";

export const SHARED_ERROR_MESSAGES: Record<SharedBillErrorCode, { th: string; en: string }> = {
  disabled: { th: "การแชร์ออนไลน์ยังไม่พร้อมใช้งาน", en: "Online sharing is unavailable" },
  not_configured: { th: "การแชร์ออนไลน์ยังไม่พร้อมใช้งาน", en: "Online sharing is unavailable" },
  auth_required: { th: "ลิงก์นี้ไม่มีสิทธิ์แก้ไขบิล", en: "This link does not have permission to edit the bill" },
  invalid_token: { th: "ลิงก์เข้าถึงไม่ถูกต้อง กรุณาขอลิงก์ใหม่จากเจ้าของบิล", en: "Invalid access link. Ask the bill owner for a new one" },
  unavailable: { th: "ไม่พบบิลนี้ หรือบิลหมดอายุแล้ว", en: "This bill is unavailable or has expired" },
  revision_conflict: { th: "ข้อมูลเปลี่ยนระหว่างแก้ไข กำลังโหลดข้อมูลล่าสุด", en: "The bill changed while you were editing. Loading the latest version" },
  participant_not_claimed: { th: "กรุณาเลือกชื่อของคุณก่อนเปลี่ยนรายการที่ร่วมจ่าย", en: "Select your name before changing your shared items" },
  owner_cannot_claim: { th: "เจ้าของบิลไม่สามารถเลือกตัวตนของเพื่อนได้", en: "The bill owner cannot select a friend's identity" },
  item_not_in_receipt: { th: "ไม่พบรายการนี้ในใบเสร็จ กรุณาโหลดข้อมูลล่าสุด", en: "This item is not in the receipt. Refresh the bill and try again" },
  validation: { th: "ข้อมูลไม่ถูกต้องหรือเปลี่ยนไม่ได้ กรุณาตรวจข้อมูลแล้วลองอีกครั้ง", en: "The information is invalid or cannot be changed. Check it and try again" },
  migration_required: { th: "ฐานข้อมูลบิลออนไลน์ยังไม่รองรับฟีเจอร์ล่าสุด กรุณาอัปเดต migration ก่อนลองอีกครั้ง", en: "The shared-bill database needs its latest migration. Update it and try again" },
  realtime_unavailable: { th: "การเชื่อมต่อสดขัดข้อง กรุณาโหลดข้อมูลล่าสุดและเชื่อมต่อใหม่", en: "Live updates are unavailable. Refresh and reconnect" },
  bill_closed: { th: "บิลนี้ปิดแล้ว แก้ไขหรือยืนยันเพิ่มเติมไม่ได้", en: "This bill is closed; no further edits or confirmations are allowed" },
  confirmations_incomplete: { th: "ยังมีคนที่ไม่ได้ยืนยันยอดล่าสุด กรุณารับทราบในหน้าต่างยืนยันบิล", en: "Some people have not confirmed the latest bill. Acknowledge this in the confirmation dialog" },
  payment_actor_required: { th: "เลือกชื่อของคุณก่อนอัปเดตสถานะการจ่าย", en: "Select your participant identity before updating payment status" },
  payment_not_submitted: { th: "รายการนี้ยังไม่ได้แจ้งว่าจ่ายแล้ว", en: "This payment has not been submitted yet" },
  rate_limited: { th: "มีการใช้งานถี่เกินไป กรุณารอสักครู่แล้วลองอีกครั้ง", en: "Too many requests. Please wait and try again" },
  network: { th: "เชื่อมต่อไม่สำเร็จ ตรวจอินเทอร์เน็ตแล้วลองอีกครั้ง", en: "Could not connect. Check your internet and try again" },
  unknown: { th: "เกิดข้อผิดพลาด กรุณาลองอีกครั้ง", en: "Something went wrong. Please try again" },
};

export function sharedErrorMessage(error: unknown, language: AppLanguage = "th"): string {
  if (!error || typeof error !== "object") return SHARED_ERROR_MESSAGES.unknown[language];
  const code = (error as { code?: unknown }).code;
  if (typeof code === "string" && Object.hasOwn(SHARED_ERROR_MESSAGES, code)) {
    return SHARED_ERROR_MESSAGES[code as SharedBillErrorCode][language];
  }
  return localize(language, SHARED_ERROR_MESSAGES.unknown.th, SHARED_ERROR_MESSAGES.unknown.en);
}
