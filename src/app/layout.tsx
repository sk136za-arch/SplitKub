import type { Metadata } from "next";
import "./globals.css";
import { LanguageProvider } from "@/components/LanguageProvider";

export const metadata: Metadata = {
  title: "SplitKub — หารบิลง่ายในไม่กี่นาที",
  description: "เพิ่มรายการ เลือกคนที่ร่วมจ่าย แล้วแชร์ยอดให้เพื่อน โดยไม่ต้องสมัครสมาชิก",
  icons: {
    icon: [{ url: "/brand/splitkub-icon.png", type: "image/png" }],
    apple: [{ url: "/brand/splitkub-icon.png", type: "image/png" }],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="th"><body suppressHydrationWarning><LanguageProvider>{children}</LanguageProvider></body></html>;
}
