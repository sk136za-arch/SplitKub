"use client";

import { participantLabels } from "@/lib/participantLabels";
import type { SessionAction } from "@/lib/billState";
import type { SplitSession } from "@/types/bill";

export function SettlementSettings({ session, disabled, onChange }: {
  session: SplitSession;
  disabled: boolean;
  onChange: (action: SessionAction) => void;
}) {
  const labels = participantLabels(session.participants);
  return <section className="card p-5 sm:p-7" aria-labelledby="settlement-title">
    <h2 id="settlement-title" className="section-title">วิธีชำระเงิน</h2>
    <p className="muted mt-2 text-sm">เลือกให้โอนตรงตามยอดสุทธิ หรือให้คนหนึ่งรวบรวมยอดที่ต้องหารแล้วคืนเงินผู้ที่ออกให้</p>
    <label htmlFor="settlement-collector" className="mb-1 mt-4 block text-sm font-bold">คนรวบรวมเงิน</label>
    <select id="settlement-collector" className="field max-w-xl" disabled={disabled || session.participants.length === 0}
      value={session.settlementMode === "collector" ? session.collectorParticipantId : ""}
      onChange={(event) => onChange(event.target.value
        ? { type: "set-collector", participantId: event.target.value }
        : { type: "set-settlement-mode", mode: "direct" })}>
      <option value="">โอนตรงระหว่างคน (ค่าเริ่มต้น)</option>
      {session.participants.map((person) => <option key={person.id} value={person.id}>รวบรวมผ่าน {labels.get(person.id)}</option>)}
    </select>
    <p className="muted mt-2 text-xs">{session.settlementMode === "collector"
      ? "ทุกคนโอนส่วนที่ต้องหารเต็มจำนวนให้คนรวบรวม จากนั้นคนรวบรวมคืนยอดที่ผู้อื่นออกให้เต็มจำนวน โดยไม่หักกลบกัน"
      : "ระบบจับคู่ผู้ที่ต้องจ่ายกับผู้ที่ต้องรับตามลำดับคนในบิล"}</p>
  </section>;
}
