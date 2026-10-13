import type { AppLanguage } from "./language";

const english: Record<string, string> = {
  "ยอดบิลสูงเกินขอบเขตที่รองรับ": "Bill total exceeds the supported range",
  "ไม่มีผู้ร่วมใบเสร็จ": "This receipt has no participants",
  "ฐานแบ่งค่าบริการไม่ถูกต้อง": "Service charge basis is invalid",
  "เพิ่มรายการและคนก่อนคำนวณ": "Add items and people before calculating",
  "เพิ่มคนและใบเสร็จก่อนคำนวณ": "Add people and receipts before calculating",
  "ข้อมูลคนในบิลไม่ถูกต้อง": "Participant data is invalid",
  "รายการหรือราคาไม่ถูกต้อง": "An item or price is invalid",
  "ข้อมูลผู้ร่วมรายการไม่ถูกต้อง": "Item participant data is invalid",
  "วิธีชำระเงินไม่ถูกต้อง": "Payment method is invalid",
  "เลือกคนรวบรวมเงินก่อนคำนวณ": "Choose a collector before calculating",
  "ข้อมูลใบเสร็จไม่ถูกต้อง": "Receipt data is invalid",
  "ส่วนลดหรือค่าบริการไม่ถูกต้อง": "Discount or service charge is invalid",
  "ส่วนลดก่อนค่าบริการมากกว่าส่วนของบางคน": "The pre-service discount exceeds someone's share",
  "ส่วนลดก่อนค่าบริการมากกว่ายอดใบเสร็จ": "The pre-service discount exceeds the receipt total",
  "ส่วนลดหลังภาษีมากกว่ายอดใบเสร็จ": "The post-tax discount exceeds the receipt total",
  "ส่วนลดหลังภาษีมากกว่าส่วนของบางคน": "The post-tax discount exceeds someone's share",
  "ยอดหารไม่ตรงกับยอดใบเสร็จ": "The split does not match the receipt total",
  "ยอดโอนเงินไม่ตรงกับยอดสุทธิ": "Transfers do not match net balances",
  "ยอดสุทธิไม่สมดุล": "Net balances do not reconcile",
  "จำนวนผู้ร่วมรายการไม่ถูกต้อง": "Item participant count is invalid",
  "ยอดแสดงผลต้องไม่ติดลบ": "Displayed amount cannot be negative",
  "ยอดแสดงผลสูงเกินขอบเขตที่รองรับ": "Displayed amount exceeds the supported range",
  "เส้นทางโอนอ้างอิงคนที่ไม่มีในบิล": "A transfer refers to someone not on this bill",
  "ไม่พบใบเสร็จนี้": "Receipt not found",
  "ข้อมูลบิลไม่ถูกต้อง": "Bill data is invalid",
  "กรุณาบันทึกเลข PromptPay ให้คนที่เลือกก่อน": "Save PromptPay for the selected person first",
  "ยังไม่ได้รับการยืนยันจากเซิร์ฟเวอร์": "The server has not confirmed this bill",
  "ยังไม่ได้บันทึกบิลล่าสุดในเครื่อง": "The latest bill has not been saved on this device",
  "ข้อมูลบิลในเครื่องไม่ถูกต้อง": "The bill stored on this device is invalid",
  "บิลในเครื่องยังไม่ตรงกับข้อมูลที่เซิร์ฟเวอร์ยืนยัน": "The local bill does not match the server-confirmed version",
  "ยังบันทึก PromptPay เดิมไม่สำเร็จ จึงเก็บบิลเก่าไว้ก่อน": "The old PromptPay has not been saved, so the previous bill is retained",
};

const dynamicPrefixes: readonly [string, string][] = [
  ["เลือกรายชื่อผู้ร่วมสำหรับ ", "Select participants for "],
  ["เลือกผู้จ่ายสำหรับ ", "Select a payer for "],
  ["เพิ่มรายการใน ", "Add items to "],
];

export function domainErrorMessage(error: unknown, language: AppLanguage = "th"): string {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (language === "th") return message;
  if (english[message]) return english[message];
  for (const [thai, translated] of dynamicPrefixes) {
    if (message.startsWith(thai)) return translated + message.slice(thai.length);
  }
  return message || "Something went wrong";
}
