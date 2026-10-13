import { participantLabels } from "../lib/participantLabels";
import type { ParticipantConfirmation, SplitSession } from "../types/bill";

interface OwnerReviewCardProps {
  session: Pick<SplitSession, "participants" | "confirmations" | "revision" | "closedAt">;
  selectedParticipantId: string;
  disabled: boolean;
  onSelectParticipant: (participantId: string) => void;
  onConfirm: (confirmed: boolean) => void;
}

function reviewState(status: ParticipantConfirmation | undefined, revision: number) {
  if (status?.confirmedContentRevision === revision) {
    return { label: "ยืนยันยอดล่าสุดแล้ว", className: "bg-green-50 text-green-800" };
  }
  if (status?.confirmedContentRevision !== null && status?.confirmedContentRevision !== undefined) {
    return { label: "ต้องยืนยันใหม่", className: "bg-amber-50 text-amber-900" };
  }
  if (status?.viewedAt) {
    return { label: "ดูแล้ว ยังไม่ยืนยัน", className: "bg-amber-50 text-amber-900" };
  }
  return { label: "ยังไม่เปิดดู", className: "bg-[#f3f1f8] text-[#51476a]" };
}

function reviewTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "ไม่ทราบเวลา" : date.toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });
}

function ReviewTimestamp({ label, value }: { label: string; value: string }) {
  return <p>{label}: {value ? <time dateTime={value}>{reviewTime(value)}</time> : "ยังไม่มี"}</p>;
}

export function OwnerReviewCard({ session, selectedParticipantId, disabled, onSelectParticipant, onConfirm }: OwnerReviewCardProps) {
  const labels = participantLabels(session.participants);
  const statusByParticipantId = new Map(session.confirmations.map((status) => [status.participantId, status]));
  const confirmedCount = session.participants.filter((person) =>
    statusByParticipantId.get(person.id)?.confirmedContentRevision === session.revision).length;
  const selectedParticipant = session.participants.find((person) => person.id === selectedParticipantId);
  const selectedConfirmed = selectedParticipant
    ? statusByParticipantId.get(selectedParticipant.id)?.confirmedContentRevision === session.revision
    : false;

  return <section className="card p-5 sm:p-7" aria-labelledby="owner-review-title">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h3 id="owner-review-title" className="section-title">การตรวจยอดของทุกคน</h3>
      <p role="status" className="font-bold text-[#5331aa]">ยืนยันแล้ว {confirmedCount}/{session.participants.length} คน</p>
    </div>
    <p className="muted mt-2 text-sm">เมื่อเนื้อหาบิลเปลี่ยน คำยืนยันเดิมจะต้องยืนยันใหม่</p>
    <ul className="mt-4 space-y-2" aria-label="สถานะการตรวจยอดรายคน">
      {session.participants.map((person) => {
        const status = statusByParticipantId.get(person.id);
        const state = reviewState(status, session.revision);
        return <li key={person.id} className="flex min-w-0 flex-col gap-2 rounded-xl border border-[#e8e4f5] p-3 sm:flex-row sm:items-start sm:justify-between">
          <span className="min-w-0 font-bold wrap-anywhere">{labels.get(person.id)}</span>
          <div className="min-w-0 text-sm sm:text-right">
            <span className={`inline-block rounded-full px-3 py-1 font-bold ${state.className}`}>{state.label}</span>
            <div className="muted mt-1 space-y-0.5">
              <ReviewTimestamp label="เปิดดู" value={status?.viewedAt ?? ""}/>
              <ReviewTimestamp label="ยืนยัน" value={status?.confirmedAt ?? ""}/>
            </div>
          </div>
        </li>;
      })}
    </ul>
    {!session.closedAt && <div className="mt-5 border-t border-[#eeeaf6] pt-5">
      <label htmlFor="owner-review-identity" className="mb-1 block text-sm font-bold">ฉันคือใคร (เจ้าของบิล)</label>
      <select id="owner-review-identity" className="field" value={selectedParticipantId} disabled={disabled} onChange={(event) => onSelectParticipant(event.target.value)}>
        <option value="">เลือกชื่อของคุณเพื่อยืนยันยอด</option>
        {session.participants.map((person) => <option key={person.id} value={person.id}>{labels.get(person.id)}</option>)}
      </select>
      {selectedParticipant && <button type="button" className="btn-secondary mt-3 w-full sm:w-auto" disabled={disabled} onClick={() => onConfirm(!selectedConfirmed)}>
        {selectedConfirmed ? "ยกเลิกคำยืนยันของฉัน" : "ยืนยันยอดของฉัน"}
      </button>}
    </div>}
  </section>;
}
