"use client";

import Image from "next/image";
import Link from "next/link";
import { AppShell } from "./AppShell";
import { useLanguage } from "./LanguageProvider";

const comingSoon = ["recurring", "groups", "line"] as const;

export function LandingPage() {
  const { language } = useLanguage();
  const t = (th: string, en: string) => language === "en" ? en : th;
  const comingCopy = {
    recurring: [t("บิลรายเดือน", "Recurring bills"), t("ติดตามค่าใช้จ่ายประจำและแบ่งยอดซ้ำอย่างเป็นระเบียบ", "Track recurring expenses and repeat splits neatly.")],
    groups: [t("กลุ่มเพื่อน", "Friend groups"), t("จัดเก็บรายชื่อกลุ่มไว้ใช้ในบิลครั้งถัดไป", "Keep groups ready for your next bill.")],
    line: [t("LINE Reminders", "LINE reminders"), t("เตือนเพื่อนเรื่องยอดค้างชำระผ่าน LINE", "Remind friends about outstanding balances through LINE.")],
  };
  return <AppShell><main>
    <section className="hero-shell">
      <div className="hero-copy"><p className="kicker">SPLITKUB · {t("ฟรี ไม่ต้องสมัครสมาชิก", "FREE · NO ACCOUNT")}</p><h1>{t("หารบิลกันง่าย ๆ", "Split bills easily")}<br/><span>{t("จบในที่เดียว", "in one place")}</span></h1><p className="hero-description">{t("เพิ่มรายการ เลือกคนร่วมจ่าย คำนวณยอดให้เลย แล้วแชร์สรุปให้เพื่อนได้ทันที", "Add items, choose who shares, calculate instantly, and share the real summary with friends.")}</p><Link href="/bills" className="button button-primary">{t("เริ่มสร้างบิล", "Create a bill")} <span aria-hidden="true">→</span></Link><ul className="hero-points"><li>{t("ไม่ต้องสมัครสมาชิก", "No account required")}</li><li>{t("บันทึกข้อมูลในเบราว์เซอร์ของคุณ", "Saved in your browser")}</li><li>{t("แบ่งยอดจริง พร้อมสรุปยอดโอน", "Real split totals and transfer summary")}</li></ul></div>
      <div className="hero-visual"><div className="hero-orb"/><Image src="/brand/splitkub-mascot.png" width={720} height={720} alt={t("มาสคอต SplitKub ยิ้มต้อนรับ", "SplitKub mascot welcoming you")} priority/><div className="hero-note">{t("สร้างบิลแล้ว", "Create a bill,")}<br/><strong>{t("แชร์ให้เพื่อนได้เลย", "then share it with friends")}</strong></div></div>
    </section>
    <section id="coming-soon" className="feature-grid" aria-label={t("ความสามารถของ SplitKub", "SplitKub features")}><article className="feature-card feature-live"><p className="feature-label">{t("พร้อมใช้", "AVAILABLE")}</p><h2>{t("หารบิลครั้งเดียว", "One-time split")}</h2><p>{t("เพิ่มคน รายการ และเลือกผู้ร่วมจ่ายเพื่อคำนวณยอดจริง", "Add people and items, then choose participants for a real calculation.")}</p><Link href="/bills" className="text-link">{t("สร้างบิลใหม่", "Create a bill")} →</Link></article>{comingSoon.map((key) => { const [title, description] = comingCopy[key]; return <article className="feature-card" key={key}><p className="feature-label">{t("เร็ว ๆ นี้", "COMING SOON")}</p><h2>{title}</h2><p>{description}</p><span className="coming-soon" aria-label={`${title} ${t("เร็ว ๆ นี้", "coming soon")}`}>{t("เร็ว ๆ นี้", "Coming soon")}</span></article>; })}</section>
    <section id="help" className="trust-section"><div><p className="kicker">LOCAL-FIRST</p><h2>{t("ข้อมูลอยู่กับคุณ", "Your data stays with you")}</h2><p>{t("SplitKub ไม่ต้องเข้าสู่ระบบ และไม่แสดงยอดหรือรายการจำลอง ข้อมูลบิลจะเก็บไว้ในเบราว์เซอร์เครื่องนี้เท่านั้น", "SplitKub needs no sign-in and shows no fabricated bills. Your bill data stays in this browser only.")}</p></div><Link href="/bills" className="button button-secondary">{t("ดูบิลของฉัน", "View my bills")}</Link></section>
  </main></AppShell>;
}
