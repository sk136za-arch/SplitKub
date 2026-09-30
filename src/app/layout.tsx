import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SplitKub — หารบิลง่ายในไม่กี่นาที",
  description: "เพิ่มรายการ เลือกคนที่ร่วมจ่าย แล้วแชร์ยอดให้เพื่อน โดยไม่ต้องสมัครสมาชิก",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="th"><body>{children}</body></html>;
}
