import { formatMoney } from "../lib/money";
import { participantLabels } from "../lib/participantLabels";
import { isValidPromptPay } from "../lib/promptpay";
import { displayPaymentTotals, summaryTransferRows } from "../lib/summaryTransferPresentation";
import type { SessionResult } from "../lib/calculateBill";
import type { SplitSession } from "../types/bill";

export function SessionSummary({ result, session, focusParticipantId }: { result: SessionResult; session: SplitSession; focusParticipantId?: string }) {
  const { participants, currency, settlementMode } = session;
  const labels = participantLabels(participants);
  const peopleById = new Map(participants.map((person) => [person.id, person]));
  const displayTransfers = summaryTransferRows(session, result);
  const paymentTotals = new Map(displayPaymentTotals(participants.map((person) => person.id), displayTransfers).map((total) => [total.participantId, total]));
  const visibleTransfers = focusParticipantId === undefined ? displayTransfers : displayTransfers.filter((transfer) => transfer.fromParticipantId === focusParticipantId || transfer.toParticipantId === focusParticipantId);
  const destinationIds = new Set(visibleTransfers.map((transfer) => transfer.toParticipantId));

  return <div className="space-y-5">
    <div className="rounded-2xl bg-[#6241b6] p-6 text-white"><p className="text-sm font-bold text-[#e9ddff]">ยอดรวมทุกใบเสร็จ</p><p className="mt-1 break-all text-4xl font-black tracking-tight">{formatMoney(result.total, currency)}</p></div>
    <div className="card p-5 sm:p-7"><h3 className="font-bold">สรุปใบเสร็จ</h3><ul className="mt-3 divide-y divide-[#eeeaf6]">{result.receipts.map((receipt) => <li key={receipt.receiptId} className="flex flex-wrap items-center justify-between gap-2 py-3"><span className="min-w-0 wrap-anywhere"><strong>{receipt.title}</strong><span className="muted ml-2 text-sm">จ่ายโดย {labels.get(receipt.paidByParticipantId) ?? "ยังไม่ระบุ"}</span></span><strong>{formatMoney(receipt.total, currency)}</strong></li>)}</ul></div>
    <div className="card p-5 sm:p-7"><h3 className="font-bold">ยอดชำระรายคน</h3><p className="muted mt-1 text-sm">ยอดโอนแสดงแบบปัดขึ้นต่อคน ส่วนยอดจ่าย หาร และสุทธิด้านในอ้างอิงบัญชีจริง</p><div className="mt-3 divide-y divide-[#eeeaf6]">{result.people.map((person) => {
      const participant = peopleById.get(person.participantId);
      const paymentTotal = paymentTotals.get(person.participantId);
      const payment = currency === "THB" && destinationIds.has(person.participantId) && participant?.promptPay && isValidPromptPay(participant.promptPay) ? participant.promptPay : "";
      return <details key={person.participantId} className="group py-3"><summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center justify-between gap-2 rounded-lg py-2"><span className="min-w-0 wrap-anywhere font-bold">{labels.get(person.participantId) ?? person.name} <span className="muted ml-1 text-xs">⌄</span></span><span className="flex flex-wrap gap-x-3 text-sm font-bold">{paymentTotal?.outgoing ? <span className="text-[#a43a53]">ต้องโอน {formatMoney(paymentTotal.outgoing, currency)}</span> : null}{paymentTotal?.incoming ? <span className="text-[#327557]">จะรับ {formatMoney(paymentTotal.incoming, currency)}</span> : null}{!paymentTotal?.outgoing && !paymentTotal?.incoming ? <span className="text-[#5331aa]">ไม่มีรายการโอน</span> : null}</span></summary><div className="mt-2 rounded-xl bg-[#f8f6fd] p-4 text-sm"><div className="flex justify-between gap-3"><span>จ่ายไป</span><strong>{formatMoney(person.paid, currency)}</strong></div><div className="mt-1 flex justify-between gap-3"><span>ส่วนที่ต้องหาร</span><strong>{formatMoney(person.owed, currency)}</strong></div><div className="mt-1 flex justify-between gap-3"><span>ยอดสุทธิในบัญชี</span><strong>{person.net > 0 ? "รับคืน " : person.net < 0 ? "ต้องจ่าย " : "พอดี "}{formatMoney(Math.abs(person.net), currency)}</strong></div>{payment && <p className="mt-3 break-all text-[#5331aa]">PromptPay: <strong>{payment}</strong></p>}{person.breakdown.length > 0 && <ul className="mt-3 space-y-1 border-t border-[#e6def7] pt-3">{person.breakdown.map((row) => <li key={`${row.receiptId}:${row.itemId}`} className="flex justify-between gap-3"><span className="min-w-0 wrap-anywhere">{row.receiptTitle} · {row.itemName}</span><span className="shrink-0">{formatMoney(row.amount, currency)}</span></li>)}</ul>}</div></details>;
    })}</div></div>
    <div className="card p-5 sm:p-7">
      <h3 className="font-bold">{settlementMode === "collector" ? "เส้นทางโอนผ่านคนรวบรวมเงิน" : "เส้นทางโอนตรง"}</h3>
      {visibleTransfers.length === 0 ? <p className="muted mt-2 text-sm">{focusParticipantId === "" ? "เลือกชื่อของคุณเพื่อดูเส้นทางโอน" : "ไม่มีรายการโอนเงินที่ต้องทำ"}</p> :
        <ol className="mt-3 divide-y divide-[#eeeaf6]">{visibleTransfers.map((transfer, index) => {
          const recipient = peopleById.get(transfer.toParticipantId);
          const pay = currency === "THB" && recipient?.promptPay && isValidPromptPay(recipient.promptPay) ? recipient.promptPay : "";
          return <li key={`${transfer.kind}:${transfer.fromParticipantId}:${transfer.toParticipantId}:${index}`} className="py-3">
            <div className="flex flex-wrap items-center justify-between gap-2"><span className="min-w-0 wrap-anywhere font-bold">{labels.get(transfer.fromParticipantId)} → {labels.get(transfer.toParticipantId)}</span><strong className="text-[#5331aa]">{formatMoney(transfer.amount, currency)}</strong></div>
            {transfer.kind === "reimbursement" && <p className="muted mt-1 text-xs">คืนเงินที่ออกให้ตามใบเสร็จ</p>}
            {transfer.receiptBreakdown.length > 0 && <ul className="muted mt-2 space-y-1 text-xs">{transfer.receiptBreakdown.map((receipt) => <li key={receipt.receiptId} className="flex justify-between gap-3"><span className="wrap-anywhere">{receipt.receiptTitle}</span><span>{formatMoney(receipt.amount, currency)}</span></li>)}</ul>}
            {pay && <p className="mt-2 break-all text-sm text-[#5331aa]">PromptPay ของ {labels.get(transfer.toParticipantId)}: <strong>{pay}</strong></p>}
          </li>;
        })}</ol>}
    </div>
  </div>;
}
