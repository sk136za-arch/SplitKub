export function sharedErrorMessage(error: unknown): string {
  if (!error || typeof error !== "object") return "เกิดข้อผิดพลาด กรุณาลองอีกครั้ง";
  const value = error as { code?: string; message?: string };
  if (value.code === "invalid_token") return "ลิงก์เข้าถึงไม่ถูกต้อง กรุณาขอลิงก์ใหม่จากเจ้าของบิล";
  if (value.code === "unavailable") return "ไม่พบบิลนี้ หรือบิลหมดอายุแล้ว";
  if (value.code === "auth_required") return "ลิงก์นี้ไม่มีสิทธิ์แก้ไขบิล";
  if (value.code === "revision_conflict") return "ข้อมูลเปลี่ยนระหว่างแก้ไข กำลังโหลดข้อมูลล่าสุด";
  if (value.code === "disabled" || value.code === "not_configured") return "การแชร์ออนไลน์ยังไม่พร้อมใช้งาน";
  if (value.code === "migration_required") return "ฐานข้อมูลบิลออนไลน์ยังไม่รองรับคนรวบรวมเงิน กรุณาอัปเดต migration ล่าสุดก่อนลองอีกครั้ง";
  if (value.code === "realtime_unavailable") return "การเชื่อมต่อสดขัดข้อง กรุณาโหลดข้อมูลล่าสุดและเชื่อมต่อใหม่";
  if (value.code === "participant_claimed") return "ชื่อนี้มีคนเลือกแล้ว กรุณาเลือกชื่อของคุณ";
  if (value.code === "network") return "เชื่อมต่อไม่สำเร็จ ตรวจอินเทอร์เน็ตแล้วลองอีกครั้ง";
  return value.message || "เกิดข้อผิดพลาด กรุณาลองอีกครั้ง";
}
