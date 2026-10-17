"use client";

import { useEffect, useRef, useState } from "react";
import { calculateBill } from "@/lib/calculateBill";
import { formatMoney } from "@/lib/money";
import { loadPaymentProof, readLocalImage, savePaymentProof, type LocalPaymentProof } from "@/lib/paymentProofs";
import { participantLabels } from "@/lib/participantLabels";
import { summaryTransferRows } from "@/lib/summaryTransferPresentation";
import { confirmSharedPayment, selectSharedPaymentActor, startPaymentTracking, submitSharedPayment } from "@/hooks/sharedBillAdapter";
import type { SplitSession } from "@/types/bill";

function transferKey(from: string, to: string, amount: number, index: number) { return `${from}:${to}:${amount}:${index}`; }

export function PaymentTracking({ billId, session, selectedParticipantId, owner, allowOwnerActor = false, lockParticipantIdentity = false, onSession }: { billId: string; session: SplitSession; selectedParticipantId: string; owner: boolean; allowOwnerActor?: boolean; lockParticipantIdentity?: boolean; onSession: (next: SplitSession) => void }) {
  const canActAsParticipant = !owner || allowOwnerActor;
  const [actor, setActor] = useState(selectedParticipantId); const [actorReady, setActorReady] = useState(owner && !allowOwnerActor); const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  const [proofs, setProofs] = useState<Record<string, LocalPaymentProof>>({});
  const fileRef = useRef<HTMLInputElement>(null); const pendingTransfer = useRef("");
  const labels = participantLabels(session.participants);
  const transfers = (() => { try { return summaryTransferRows(session, calculateBill(session)); } catch { return []; } })();
  useEffect(() => { setActor(selectedParticipantId); }, [selectedParticipantId]);
  useEffect(() => {
    if (owner && !allowOwnerActor) { setActorReady(true); return; }
    if (!actor) { setActorReady(false); return; }
    let active = true;
    setActorReady(false); setBusy(true); setMessage("");
    void selectSharedPaymentActor(billId, actor).then((next) => {
      if (!active) return;
      onSession(next); setActorReady(true);
    }, () => { if (active) setMessage("เลือกชื่อสำหรับติดตามการจ่ายไม่สำเร็จ"); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [actor, allowOwnerActor, billId, onSession, owner]);
  if (!session.closedAt) return null;
  async function initialize() { setBusy(true); setMessage(""); try { onSession(await startPaymentTracking(billId, transfers.map((row, index) => ({ key: transferKey(row.fromParticipantId, row.toParticipantId, row.amount, index), fromParticipantId: row.fromParticipantId, toParticipantId: row.toParticipantId, amount: row.amount })))); } catch { setMessage("เริ่มติดตามการจ่ายไม่สำเร็จ"); } finally { setBusy(false); } }
  function choose(next: string) { if (lockParticipantIdentity) return; setMessage(""); setActor(next); }
  async function submit(key: string, kind: "bank_transfer" | "cash") { setBusy(true); setMessage(""); try { onSession(await submitSharedPayment(billId, key, kind)); } catch { setMessage("บันทึกสถานะการจ่ายไม่สำเร็จ"); } finally { setBusy(false); } }
  async function uploadSlip(event: React.ChangeEvent<HTMLInputElement>) { const file = event.target.files?.[0]; const key = pendingTransfer.current; event.target.value = ""; if (!file || !key) return; setBusy(true); setMessage(""); try { const proof = await readLocalImage(file); savePaymentProof(window.localStorage, billId, key, proof); setProofs((current) => ({ ...current, [key]: proof })); await submit(key, "bank_transfer"); } catch (caught) { setMessage(caught instanceof Error ? caught.message : "บันทึกสลิปไม่สำเร็จ"); } finally { setBusy(false); } }
  async function confirm(key: string) { setBusy(true); setMessage(""); try { onSession(await confirmSharedPayment(billId, key)); } catch { setMessage("ยืนยันการรับเงินไม่สำเร็จ"); } finally { setBusy(false); } }
  return <section className="card p-5 sm:p-7"><input ref={fileRef} className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void uploadSlip(event)}/><h2 className="section-title">ติดตามการจ่าย</h2><p className="muted mt-1 text-sm">สถานะเปลี่ยนได้หลังยืนยันบิลแล้วเท่านั้น สลิปเก็บและแสดงเฉพาะในเบราว์เซอร์ของผู้โอน</p>{session.payments.length === 0 ? <div className="mt-4"><p className="muted text-sm">สร้างรายการจากเส้นทางโอนที่ล็อกไว้เพื่อเริ่มติดตาม</p>{owner && <button className="button button-primary mt-3" disabled={busy || transfers.length === 0} onClick={() => void initialize()}>เริ่มติดตามการจ่าย</button>}</div> : <><div className="mt-4">{canActAsParticipant && <><label className="mb-1 block text-sm font-bold">ฉันคือ</label><select className="field max-w-72" value={actor} disabled={busy || lockParticipantIdentity} onChange={(event) => choose(event.target.value)}><option value="">เลือกชื่อของคุณ</option>{session.participants.map((person) => <option key={person.id} value={person.id}>{labels.get(person.id)}</option>)}</select>{lockParticipantIdentity && actor && <p className="muted mt-2 text-xs">ใช้ชื่อตามที่ยืนยันในบิลแล้ว</p>}{actor && !actorReady && <p className="muted mt-2 text-xs">กำลังยืนยันตัวตนสำหรับติดตามการจ่าย…</p>}</>}</div><ul className="mt-4 divide-y divide-[#eeeaf6]">{session.payments.map((payment) => { const proof = proofs[payment.key] ?? (typeof window === "undefined" ? null : loadPaymentProof(window.localStorage, billId, payment.key)); return <li className="py-4" key={payment.key}><div className="flex flex-wrap items-center justify-between gap-2"><strong>{labels.get(payment.fromParticipantId)} → {labels.get(payment.toParticipantId)}</strong><span>{formatMoney(payment.amount, session.currency)}</span></div><p className="muted mt-1 text-sm">{payment.status === "pending" ? "ยังไม่จ่าย" : payment.status === "submitted" ? `รอยืนยัน · ${payment.proofKind === "cash" ? "เงินสด" : "โอนธนาคาร"}` : "ยืนยันแล้ว"}</p>{proof && actor === payment.fromParticipantId && <p className="muted mt-1 text-xs">สลิปในเครื่องนี้: {proof.name}</p>}{canActAsParticipant && actor === payment.fromParticipantId && payment.status === "pending" && <div className="mt-2 flex gap-2"><button className="button button-secondary" disabled={busy || !actorReady} onClick={() => { pendingTransfer.current = payment.key; fileRef.current?.click(); }}>แนบสลิปและแจ้งว่าโอนแล้ว</button><button className="button button-secondary" disabled={busy || !actorReady} onClick={() => void submit(payment.key, "cash")}>แจ้งว่าจ่ายเงินสด</button></div>}{canActAsParticipant && actor === payment.toParticipantId && payment.status === "submitted" && <button className="button button-primary mt-2" disabled={busy || !actorReady} onClick={() => void confirm(payment.key)}>ยืนยันว่าได้รับเงิน</button>}</li>; })}</ul></>}{message && <p className="error mt-3">{message}</p>}</section>;
}
