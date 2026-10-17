"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { useLanguage } from "./LanguageProvider";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isBills = pathname.startsWith("/bills"); const isGroups = pathname.startsWith("/groups");
  const { language } = useLanguage();
  const t = (th: string, en: string) => language === "en" ? en : th;
  return <div className="app-frame">
    <header className="site-header">
      <Link href="/" className="brand" aria-label={t("SplitKub หน้าหลัก", "SplitKub home")}><Image src="/brand/splitkub-icon.png" width={38} height={38} alt="" priority/> <span>SplitKub</span></Link>
      <nav className="site-nav" aria-label={t("เมนูหลัก", "Main navigation")}>
        <Link href="/" aria-current={!isBills ? "page" : undefined}>{t("หน้าหลัก", "Home")}</Link>
        <Link href="/bills" aria-current={isBills ? "page" : undefined}>{t("บิลของฉัน", "My bills")}</Link>
        <Link href="/groups" aria-current={isGroups ? "page" : undefined}>{t("กลุ่มเพื่อน", "Groups")}</Link>
        <Link href="/#coming-soon">{t("ราคา", "Pricing")}</Link><Link href="/#help">{t("ช่วยเหลือ", "Help")}</Link>
      </nav>
      <LanguageSwitcher/>
    </header>
    {children}
    <nav className="mobile-nav" aria-label={t("เมนูมือถือ", "Mobile navigation")}><Link href="/">{t("หน้าหลัก", "Home")}</Link><Link href="/bills">{t("บิลของฉัน", "My bills")}</Link><Link href="/groups">{t("กลุ่มเพื่อน", "Groups")}</Link></nav>
  </div>;
}
