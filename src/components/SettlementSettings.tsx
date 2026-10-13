"use client";

import { participantLabels } from "../lib/participantLabels";
import { localize } from "../lib/language";
import type { SessionAction } from "../lib/billState";
import type { SplitSession } from "../types/bill";
import { useLanguage } from "./LanguageProvider";

export function SettlementSettings({ session, disabled, onChange }: {
  session: SplitSession;
  disabled: boolean;
  onChange: (action: SessionAction) => void;
}) {
  const { language } = useLanguage();
  const t = (thai: string, english: string) => localize(language, thai, english);
  const labels = participantLabels(session.participants);
  return <section className="card p-5 sm:p-7" aria-labelledby="settlement-title">
    <h2 id="settlement-title" className="section-title">{t("วิธีชำระเงิน", "Payment method")}</h2>
    <p className="muted mt-2 text-sm">{t("เลือกให้โอนตรงตามยอดสุทธิ หรือให้คนหนึ่งรวบรวมยอดที่ต้องหารแล้วคืนเงินผู้ที่ออกให้", "Choose direct transfers based on net balances, or let one person collect shares and reimburse those who paid.")}</p>
    <label htmlFor="settlement-collector" className="mb-1 mt-4 block text-sm font-bold">{t("คนรวบรวมเงิน", "Collector")}</label>
    <select id="settlement-collector" className="field max-w-xl" disabled={disabled || session.participants.length === 0}
      value={session.settlementMode === "collector" ? session.collectorParticipantId : ""}
      onChange={(event) => onChange(event.target.value
        ? { type: "set-collector", participantId: event.target.value }
        : { type: "set-settlement-mode", mode: "direct" })}>
      <option value="">{t("โอนตรงระหว่างคน (ค่าเริ่มต้น)", "Direct transfers (default)")}</option>
      {session.participants.map((person) => <option key={person.id} value={person.id}>{t("รวบรวมผ่าน", "Collect through")} {labels.get(person.id)}</option>)}
    </select>
    <p className="muted mt-2 text-xs">{session.settlementMode === "collector"
      ? t("ทุกคนโอนส่วนที่ต้องหารเต็มจำนวนให้คนรวบรวม จากนั้นคนรวบรวมคืนยอดที่ผู้อื่นออกให้เต็มจำนวน โดยไม่หักกลบกัน", "Everyone sends their full share to the collector. The collector then reimburses each person who paid in full, without offsetting the two amounts.")
      : t("ระบบจับคู่ผู้ที่ต้องจ่ายกับผู้ที่ต้องรับตามลำดับคนในบิล", "The app matches payers and receivers in the participant order shown on the bill.")}</p>
  </section>;
}
