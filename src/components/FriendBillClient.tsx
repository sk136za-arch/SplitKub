"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { calculateBill } from "@/lib/calculateBill";
import { formatMoney } from "@/lib/money";
import { participantLabels } from "@/lib/participantLabels";
import { shouldApplyRemoteRevision } from "@/lib/sharedSnapshot";
import { refreshWithTrailingDirty, SharedSubscriptionController, shouldMarkSubscriptionLive } from "@/lib/sharedSubscription";
import type { SplitSession } from "@/types/bill";
import { claimSharedParticipant, openSharedBill, parseShareFragment, refreshSharedBill, sharedErrorMessage, sharingIsAvailable, subscribeSharedBill, toggleSharedParticipation, type SharedOpen } from "@/hooks/sharedBillAdapter";
import { SessionSummary } from "./SessionSummary";
import { OwnerApp } from "./OwnerApp";

type ViewStatus = "loading" | "ready" | "error";
type SyncStatus = "live" | "connecting" | "offline" | "stale";

export function FriendBillClient({ publicId }: { publicId: string }) {
  const [viewStatus, setViewStatus] = useState<ViewStatus>("loading");
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("connecting");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [snapshot, setSnapshot] = useState<SplitSession | null>(null);
  const [billId, setBillId] = useState("");
  const [selectedPersonId, setSelectedPersonId] = useState("");
  const [pending, setPending] = useState(false);
  const [ownerRecovery, setOwnerRecovery] = useState<{ publicId: string; ownerToken: string } | null>(null);
  const [joinedOwner, setJoinedOwner] = useState<SharedOpen | null>(null);
  const [hashRevision, setHashRevision] = useState(0);
  const openGeneration = useRef(0);
  const revisionSeen = useRef(-1);
  const reloadSequence = useRef(0);
  const reloadInFlight = useRef<{ id: string; generation: number; dirty: boolean; promise: Promise<boolean> } | null>(null);
  const subscribedGeneration = useRef(-1);
  const subscriptionGeneration = useRef(0);
  const [subscriptionController] = useState(() => new SharedSubscriptionController(subscribeSharedBill));

  // The callback intentionally coordinates mutable generation/request refs across async refreshes.
  const reload = useCallback((id: string, generation = openGeneration.current): Promise<boolean> => {
    if (generation !== openGeneration.current) return Promise.resolve(false);
    if (reloadInFlight.current?.id === id && reloadInFlight.current.generation === generation) {
      reloadInFlight.current.dirty = true;
      return reloadInFlight.current.promise;
    }
    const sequence = ++reloadSequence.current;
    const request = { id, generation, dirty: false, promise: Promise.resolve(false) };
    const promise = (async () => {
      const refreshOnce = async () => {
        try {
          const next = await refreshSharedBill(id);
          if (sequence !== reloadSequence.current || generation !== openGeneration.current) return false;
          if (shouldApplyRemoteRevision(revisionSeen.current, next.revision)) {
            revisionSeen.current = next.revision;
            setSnapshot(next);
          }
          setError("");
          return true;
        } catch (caught) {
          if (sequence === reloadSequence.current && generation === openGeneration.current) {
            setSyncStatus(navigator.onLine ? "stale" : "offline");
            setError(sharedErrorMessage(caught));
          }
          return false;
        }
      };
      let succeeded = false;
      try {
        succeeded = await refreshWithTrailingDirty(refreshOnce, () => request.dirty, () => { request.dirty = false; });
      } finally {
        if (reloadInFlight.current === request) reloadInFlight.current = null;
      }
      return succeeded;
    })();
    request.promise = promise;
    reloadInFlight.current = request;
    return promise;
  }, []);
  const reconnectRealtime = useCallback((id: string) => {
    const openSessionGeneration = openGeneration.current;
    const subscriptionToken = ++subscriptionGeneration.current;
    subscribedGeneration.current = -1;
    return subscriptionController.restart(id, {
    onChange: () => { if (subscriptionToken === subscriptionGeneration.current && openSessionGeneration === openGeneration.current) void reload(id, openSessionGeneration); },
    onError: (caught) => { if (subscriptionToken !== subscriptionGeneration.current || openSessionGeneration !== openGeneration.current) return; subscribedGeneration.current = -1; setSyncStatus("stale"); setError(sharedErrorMessage(caught)); },
    onStatus: (status) => {
      if (subscriptionToken !== subscriptionGeneration.current || openSessionGeneration !== openGeneration.current) return;
      if (status === "SUBSCRIBED") {
        subscribedGeneration.current = subscriptionToken;
        if (!navigator.onLine) { setSyncStatus("offline"); return; }
        setSyncStatus("connecting");
        void reload(id, openSessionGeneration).then((refreshed) => {
          if (shouldMarkSubscriptionLive(refreshed, subscriptionToken, subscriptionGeneration.current, subscribedGeneration.current, openSessionGeneration === openGeneration.current)) setSyncStatus(navigator.onLine ? "live" : "offline");
        });
      } else {
        subscribedGeneration.current = -1;
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") setSyncStatus("stale");
      }
    },
  });
  }, [reload, subscriptionController]);

  useEffect(() => {
    const onHashChange = () => {
      openGeneration.current += 1;
      subscriptionGeneration.current += 1;
      subscribedGeneration.current = -1;
      reloadSequence.current += 1;
      void subscriptionController.stop();
      setOwnerRecovery(null); setJoinedOwner(null); setViewStatus("loading");
      setHashRevision((revision) => revision + 1);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [subscriptionController]);

  useEffect(() => {
    let cancelled = false;
    const generation = ++openGeneration.current;
    const isCurrent = () => !cancelled && generation === openGeneration.current;
    /* eslint-disable react-hooks/set-state-in-effect -- Route and fragment changes require a fresh client-only load. */
    setViewStatus("loading"); setError(""); setSnapshot(null); setBillId(""); setSelectedPersonId(""); setOwnerRecovery(null); setJoinedOwner(null); setPending(false);
    revisionSeen.current = -1;
    /* eslint-enable react-hooks/set-state-in-effect */
    const capability = parseShareFragment(window.location.hash);
    if (!capability) { setViewStatus("error"); setError("ลิงก์นี้ไม่มีรหัสเข้าถึง กรุณาขอลิงก์ใหม่จากเจ้าของบิล"); return; }
    if (!sharingIsAvailable()) { setViewStatus("error"); setError("การแชร์ออนไลน์ยังไม่พร้อมใช้งาน"); return; }
    if (capability.role === "owner") { setOwnerRecovery({ publicId, ownerToken: capability.token }); return; }

    void openSharedBill(publicId, capability.token).then((opened) => {
      if (!isCurrent()) return;
      if (opened.role === "owner") { setJoinedOwner(opened); return; }
      if (!shouldApplyRemoteRevision(revisionSeen.current, opened.snapshot.revision)) return;
      setBillId(opened.billId);
      revisionSeen.current = opened.snapshot.revision;
      setSnapshot(opened.snapshot);
      try {
        const remembered = window.sessionStorage.getItem(`splitkub:friend:${publicId}`);
        if (remembered && opened.snapshot.participants.some((person) => person.id === remembered)) setSelectedPersonId(remembered);
      } catch { /* Continue with manual selection if storage is blocked. */ }
      setViewStatus("ready");
      setSyncStatus(navigator.onLine ? "connecting" : "offline");
    }, (caught) => {
      if (isCurrent()) { setViewStatus("error"); setError(sharedErrorMessage(caught)); }
    });

    return () => {
      cancelled = true;
      reloadSequence.current += 1;
      void subscriptionController.stop();
    };
  }, [publicId, hashRevision, subscriptionController]);

  useEffect(() => {
    if (!billId || viewStatus !== "ready") return;
    void reconnectRealtime(billId);
    const onOffline = () => { setSyncStatus("offline"); setNotice("ออฟไลน์อยู่ การเลือกผู้ร่วมรายการจะใช้ได้เมื่อเชื่อมต่ออีกครั้ง"); };
    const onOnline = () => { setSyncStatus("connecting"); setNotice(""); void reconnectRealtime(billId); };
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    return () => {
      subscriptionGeneration.current += 1;
      subscribedGeneration.current = -1;
      void subscriptionController.stop();
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
    };
  }, [billId, reconnectRealtime, reload, subscriptionController, viewStatus]);

  function reloadAndReconnect() {
    if (!billId) return;
    setSyncStatus("connecting");
    void reconnectRealtime(billId);
  }

  const result = useMemo(() => {
    if (!snapshot) return null;
    try { return calculateBill(snapshot); } catch { return null; }
  }, [snapshot]);
  const labels = participantLabels(snapshot?.participants ?? []);
  const currentPerson = snapshot?.participants.find((person) => person.id === selectedPersonId);
  const canEdit = Boolean(currentPerson && billId && !pending && syncStatus === "live");

  async function choosePerson(participantId: string) {
    if (!participantId || !billId || pending || syncStatus === "offline") return;
    const generation = openGeneration.current;
    setPending(true); setError(""); setNotice("");
    try {
      const next = await claimSharedParticipant(billId, participantId);
      if (generation !== openGeneration.current) return;
      if (shouldApplyRemoteRevision(revisionSeen.current, next.revision)) {
        revisionSeen.current = next.revision;
        setSnapshot(next);
      }
      setSelectedPersonId(participantId);
      try { window.sessionStorage.setItem(`splitkub:friend:${publicId}`, participantId); } catch { /* Selection still works for this visit. */ }
    } catch (caught) { if (generation === openGeneration.current) setError(sharedErrorMessage(caught)); }
    finally { if (generation === openGeneration.current) setPending(false); }
  }

  async function toggle(receiptId: string, itemId: string, selected: boolean) {
    if (!canEdit || !snapshot) return;
    const generation = openGeneration.current;
    setPending(true); setError(""); setNotice("");
    try {
      const next = await toggleSharedParticipation(billId, receiptId, itemId, selected, snapshot.revision);
      if (generation !== openGeneration.current) return;
      if (shouldApplyRemoteRevision(revisionSeen.current, next.revision)) {
        revisionSeen.current = next.revision;
        setSnapshot(next);
      }
    } catch (caught) {
      if (generation !== openGeneration.current) return;
      const message = sharedErrorMessage(caught);
      await reload(billId);
      if (generation !== openGeneration.current) return;
      setNotice(message);
    } finally { if (generation === openGeneration.current) setPending(false); }
  }

  if (ownerRecovery) return <OwnerApp recovery={ownerRecovery}/>;
  if (joinedOwner) return <OwnerApp joinedOwner={joinedOwner}/>;

  return <main className="min-h-screen">
    <header className="border-b border-[#e9e4f7] bg-white/80"><div className="shell flex min-h-18 items-center justify-between py-4"><Link href="/" className="inline-flex min-h-11 items-center gap-2 text-xl font-black text-[#5331aa]"><Image src="/brand/splitkub-icon.png" width={44} height={44} alt="" className="h-11 w-11"/>SplitKub</Link><span className="rounded-full bg-[#f1ecff] px-3 py-2 text-xs font-bold text-[#6040ac]">บิลที่เพื่อนแชร์</span></div></header>
    <div className="shell space-y-6 py-8">
      {viewStatus === "loading" && <div role="status" className="card p-6">กำลังเปิดบิลที่แชร์…</div>}
      {viewStatus === "error" && <div role="alert" className="card p-6"><h1 className="section-title">เปิดบิลไม่ได้</h1><p className="error mt-3">{error}</p><button className="btn-secondary mt-4" onClick={() => window.location.reload()}>ลองเปิดใหม่</button></div>}
      {viewStatus === "ready" && snapshot && <>
        <div className="card p-5 sm:p-7"><p className="eyebrow">Shared bill</p><h1 className="mt-2 break-words text-3xl font-black">{snapshot.title}</h1><p className="muted mt-2 text-sm">เลือกชื่อของคุณ แล้วเลือกเฉพาะรายการที่ร่วมจ่าย</p><p role="status" aria-live="polite" className={`mt-3 text-sm ${syncStatus === "offline" || syncStatus === "stale" ? "error" : "muted"}`}>{syncStatus === "live" ? "เชื่อมต่อสดแล้ว" : syncStatus === "connecting" ? "กำลังเชื่อมต่อข้อมูลล่าสุด…" : syncStatus === "offline" ? "ออฟไลน์อยู่" : "การเชื่อมต่อสดขัดข้อง กดโหลดใหม่ได้"}</p><button type="button" className="btn-secondary mt-3" onClick={reloadAndReconnect} disabled={pending || !navigator.onLine}>โหลดข้อมูลล่าสุดและเชื่อมต่อใหม่</button></div>
        <div className="card p-5 sm:p-7"><label htmlFor="friend-identity" className="mb-2 block font-bold">ฉันคือ</label><select id="friend-identity" className="field" value={selectedPersonId} disabled={pending} onChange={(event) => void choosePerson(event.target.value)}><option value="">เลือกชื่อของคุณ</option>{snapshot.participants.map((person) => <option key={person.id} value={person.id}>{labels.get(person.id)}</option>)}</select>{currentPerson && <p className="muted mt-2 text-sm">กำลังแก้ไขรายการของ {labels.get(currentPerson.id)}</p>}</div>
        {error && <p role="alert" className="error rounded-xl bg-white p-4">{error}</p>}{notice && <p role="status" className="muted rounded-xl bg-white p-4">{notice}</p>}
        <section aria-label="ใบเสร็จและรายการ" className="space-y-5">{snapshot.receipts.map((receipt) => <div key={receipt.id} className="card p-5 sm:p-7"><h2 className="section-title wrap-anywhere">{receipt.title}</h2><p className="muted mt-1 text-sm wrap-anywhere">จ่ายโดย {labels.get(receipt.paidByParticipantId) ?? "ยังไม่ระบุ"}</p><ul className="mt-4 space-y-3">{receipt.items.map((item) => { const selected = Boolean(currentPerson && item.participantIds.includes(currentPerson.id)); return <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#eeeaf6] p-4"><div className="min-w-0 flex-1"><p className="font-bold wrap-anywhere">{item.name}</p><p className="muted text-sm">{formatMoney(item.price, snapshot.currency)} · ร่วม {item.participantIds.length} คน</p></div><button type="button" className="chip min-w-24 shrink-0" data-selected={selected} aria-pressed={selected} aria-label={`${selected ? "เลิกร่วม" : "ร่วม"}รายการ ${receipt.title} · ${item.name}`} disabled={!canEdit} onClick={() => void toggle(receipt.id, item.id, !selected)}>{selected ? "✓ ร่วมจ่าย" : "ร่วมจ่าย"}</button></li>; })}</ul></div>)}</section>
        {result ? <section aria-labelledby="friend-summary-title"><h2 id="friend-summary-title" className="section-title mb-4">สรุปยอดล่าสุด</h2><SessionSummary result={result} session={snapshot} focusParticipantId={currentPerson?.id ?? ""}/></section> : <p className="muted card p-5">เมื่อรายการและผู้จ่ายครบ สรุปยอดจะปรากฏที่นี่</p>}
        <p className="muted text-xs">QR ที่เจ้าของบิลอัปโหลดอยู่บนอุปกรณ์ของเจ้าของเท่านั้น เพื่อนจะเห็นเลข PromptPay ที่เจ้าของระบุไว้เมื่อมี</p>
      </>}
    </div>
  </main>;
}
