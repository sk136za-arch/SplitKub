"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { openSharedBill, refreshSharedBill, subscribeSharedBill } from "@/hooks/sharedBillAdapter";
import { saveLocalBill, type LocalBillRecord } from "@/lib/localBills";
import type { SplitSession } from "@/types/bill";
import { PaymentTracking } from "./PaymentTracking";

export function PaymentTrackingDialog({ bill, onClose, onPersist }: { bill: LocalBillRecord; onClose: () => void; onPersist: () => void }) {
  const [snapshot, setSnapshot] = useState<SplitSession | null>(null);
  const [billId, setBillId] = useState("");
  const [error, setError] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  const persist = useCallback((next: SplitSession) => {
    setSnapshot(next);
    try { saveLocalBill(window.localStorage, bill.id, next); onPersist(); }
    catch { setError("บันทึกข้อมูลล่าสุดในเบราว์เซอร์ไม่สำเร็จ"); }
  }, [bill.id, onPersist]);

  useEffect(() => {
    let active = true; let cleanup: (() => void | Promise<void>) | undefined;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onCloseRef.current(); };
    window.addEventListener("keydown", onKeyDown);
    void (async () => {
      try {
        if (!bill.shared) throw new Error("ไม่มีสิทธิ์เจ้าของสำหรับบิลนี้");
        const opened = await openSharedBill(bill.shared.publicId, bill.shared.ownerToken, "owner");
        if (!active) return;
        if (opened.role !== "owner") throw new Error("สิทธิ์เจ้าของไม่ถูกต้อง");
        setBillId(opened.billId); setSnapshot(opened.snapshot); dialogRef.current?.focus();
        cleanup = await subscribeSharedBill(opened.billId, () => {
          void refreshSharedBill(opened.billId).then((next) => { if (active) persist(next); });
        });
      } catch { if (active) setError("เปิดข้อมูลติดตามการจ่ายไม่สำเร็จ กรุณาลองใหม่อีกครั้ง"); }
    })();
    return () => { active = false; window.removeEventListener("keydown", onKeyDown); void cleanup?.(); };
  }, [bill.shared, persist]);

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="payment-tracking-title" tabIndex={-1} className="card max-h-[90vh] w-full max-w-2xl overflow-y-auto p-5 sm:p-7">
      <div className="mb-4 flex items-start justify-between gap-3"><div><p className="eyebrow">PAYMENT TRACKING</p><h2 id="payment-tracking-title" className="section-title mt-1">{bill.title}</h2></div><button type="button" className="btn-secondary" aria-label="ปิด" onClick={onClose}>×</button></div>
      {error ? <p role="alert" className="error">{error}</p> : !snapshot ? <p role="status" className="muted">กำลังเปิดข้อมูลติดตามการจ่าย…</p> : <PaymentTracking billId={billId} session={snapshot} selectedParticipantId="" owner allowOwnerActor onSession={persist}/>} 
    </div>
  </div>;
}
