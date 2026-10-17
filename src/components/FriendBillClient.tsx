"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { calculateBill } from "@/lib/calculateBill";
import { formatMoney } from "@/lib/money";
import { readFriendSelection, reconcileFriendSelection, rememberFriendSelection } from "@/lib/friendSelection";
import { participantLabels } from "@/lib/participantLabels";
import { matchesRequestedParticipant, shouldApplyRemoteSnapshot } from "@/lib/sharedSnapshot";
import { refreshWithTrailingDirty, SharedSubscriptionController, shouldMarkSubscriptionLive } from "@/lib/sharedSubscription";
import type { SplitSession } from "@/types/bill";
import { confirmSharedParticipant, selectSharedParticipant, openSharedBill, parseShareFragment, refreshSharedBill, sharedErrorMessage, sharingIsAvailable, subscribeSharedBill, toggleSharedParticipation, type SharedOpen } from "@/hooks/sharedBillAdapter";
import { SessionSummary } from "./SessionSummary";
import { OwnerApp } from "./OwnerApp";
import { PaymentTracking } from "./PaymentTracking";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { useLanguage } from "./LanguageProvider";
import { uiText, type UiTextKey } from "@/lib/uiText";
import { SuccessToast, type ToastMessage } from "./SuccessToast";

type ViewStatus = "loading" | "ready" | "error";
type SyncStatus = "live" | "connecting" | "offline" | "stale";

function selectionStorage(): Storage | null {
  try { return window.sessionStorage; } catch { return null; }
}

export function FriendBillClient({ publicId }: { publicId: string }) {
  const { language } = useLanguage();
  const t = (value: UiTextKey) => uiText(language, value);
  const languageRef = useRef(language);
  const previousLanguage = useRef(language);
  useEffect(() => { languageRef.current = language; }, [language]);
  const [viewStatus, setViewStatus] = useState<ViewStatus>("loading");
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("connecting");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const toastId = useRef(0);
  const [snapshot, setSnapshot] = useState<SplitSession | null>(null);
  const [billId, setBillId] = useState("");
  const [selectedPersonId, setSelectedPersonId] = useState("");
  const [pending, setPending] = useState(false);
  const [ownerRecovery, setOwnerRecovery] = useState<{ publicId: string; ownerToken: string } | null>(null);
  const [joinedOwner, setJoinedOwner] = useState<SharedOpen | null>(null);
  const [hashRevision, setHashRevision] = useState(0);
  const openGeneration = useRef(0);
  const revisionSeen = useRef(-1);
  const confirmationRevisionSeen = useRef(-1);
  const reloadSequence = useRef(0);
  const selectedPersonIdRef = useRef("");
  const reloadInFlight = useRef<{ id: string; generation: number; participantId: string; dirty: boolean; promise: Promise<boolean> } | null>(null);
  const subscribedGeneration = useRef(-1);
  const subscriptionGeneration = useRef(0);
  const [subscriptionController] = useState(() => new SharedSubscriptionController(subscribeSharedBill));

  useEffect(() => {
    if (previousLanguage.current === language) return;
    previousLanguage.current = language;
    setNotice("");
    setError(viewStatus === "error"
      ? uiText(language, "ลิงก์นี้เปิดไม่ได้ กรุณาตรวจลิงก์แล้วลองใหม่")
      : "");
  }, [language, viewStatus]);

  useEffect(() => { selectedPersonIdRef.current = selectedPersonId; }, [selectedPersonId]);

  // The callback intentionally coordinates mutable generation/request refs across async refreshes.
  const reload = useCallback((id: string, generation = openGeneration.current, participantId = selectedPersonIdRef.current): Promise<boolean> => {
    if (generation !== openGeneration.current) return Promise.resolve(false);
    if (reloadInFlight.current?.id === id && reloadInFlight.current.generation === generation) {
      reloadInFlight.current.dirty = true;
      reloadInFlight.current.participantId = participantId;
      return reloadInFlight.current.promise;
    }
    const sequence = ++reloadSequence.current;
    const request = { id, generation, participantId, dirty: false, promise: Promise.resolve(false) };
    const promise = (async () => {
      const refreshOnce = async () => {
        const requestedParticipantId = request.participantId;
        try {
          const next = await refreshSharedBill(id, requestedParticipantId || undefined);
          if (sequence !== reloadSequence.current || generation !== openGeneration.current) return false;
          if (!matchesRequestedParticipant(requestedParticipantId, selectedPersonIdRef.current)) {
            request.participantId = selectedPersonIdRef.current;
            request.dirty = true;
            return false;
          }
          if (shouldApplyRemoteSnapshot({ revision: revisionSeen.current, confirmationRevision: confirmationRevisionSeen.current }, next)) {
            revisionSeen.current = next.revision;
            confirmationRevisionSeen.current = next.confirmationRevision;
            setSnapshot(next);
          }
          setError("");
          return true;
        } catch (caught) {
          if (sequence === reloadSequence.current && generation === openGeneration.current) {
            if (!matchesRequestedParticipant(requestedParticipantId, selectedPersonIdRef.current)) {
              request.participantId = selectedPersonIdRef.current;
              request.dirty = true;
              return false;
            }
            setSyncStatus(navigator.onLine ? "stale" : "offline");
            setError(sharedErrorMessage(caught, languageRef.current));
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
    onError: (caught) => { if (subscriptionToken !== subscriptionGeneration.current || openSessionGeneration !== openGeneration.current) return; subscribedGeneration.current = -1; setSyncStatus("stale"); setError(sharedErrorMessage(caught, languageRef.current)); },
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
    setViewStatus("loading"); setError(""); setSnapshot(null); setBillId(""); selectedPersonIdRef.current = ""; setSelectedPersonId(""); setOwnerRecovery(null); setJoinedOwner(null); setPending(false);
    revisionSeen.current = -1;
    confirmationRevisionSeen.current = -1;
    /* eslint-enable react-hooks/set-state-in-effect */
    const capability = parseShareFragment(window.location.hash);
    if (!capability) { setViewStatus("error"); setError(uiText(languageRef.current, "ลิงก์นี้ไม่มีรหัสเข้าถึง กรุณาขอลิงก์ใหม่จากเจ้าของบิล")); return; }
    if (!sharingIsAvailable()) { setViewStatus("error"); setError(uiText(languageRef.current, "การแชร์ออนไลน์ยังไม่พร้อมใช้งาน")); return; }
    if (capability.role === "owner") { setOwnerRecovery({ publicId, ownerToken: capability.token }); return; }

    void openSharedBill(publicId, capability.token).then((opened) => {
      if (!isCurrent()) return;
      if (opened.role === "owner") { setJoinedOwner(opened); return; }
      if (!shouldApplyRemoteSnapshot({ revision: revisionSeen.current, confirmationRevision: confirmationRevisionSeen.current }, opened.snapshot)) return;
      setBillId(opened.billId);
      revisionSeen.current = opened.snapshot.revision;
      confirmationRevisionSeen.current = opened.snapshot.confirmationRevision;
      setSnapshot(opened.snapshot);
      setViewStatus("ready");
      setSyncStatus(navigator.onLine ? "connecting" : "offline");
      // The membership identity is the source of truth after a friend confirms.
      // Browser storage remains only as a pre-confirmation fallback.
      const serverSelection = opened.snapshot.participants.some((person) => person.id === opened.participantId)
        ? opened.participantId
        : "";
      const remembered = serverSelection || readFriendSelection(selectionStorage(), publicId, opened.snapshot.participants);
      if (serverSelection) rememberFriendSelection(selectionStorage(), publicId, serverSelection);
      if (remembered && opened.snapshot.closedAt) {
        selectedPersonIdRef.current = remembered;
        setSelectedPersonId(remembered);
        setPending(true);
        void refreshSharedBill(opened.billId, remembered).then((next) => {
          if (!isCurrent()) return;
          if (shouldApplyRemoteSnapshot({ revision: revisionSeen.current, confirmationRevision: confirmationRevisionSeen.current }, next)) {
            revisionSeen.current = next.revision;
            confirmationRevisionSeen.current = next.confirmationRevision;
            setSnapshot(next);
          }
        }, (caught) => { if (isCurrent()) setError(sharedErrorMessage(caught, languageRef.current)); })
          .finally(() => { if (isCurrent()) setPending(false); });
      } else if (remembered) {
        setPending(true);
        // A remembered name is a local preference, not server authorization.
        // Re-select it for the current anonymous user before enabling edits.
        void selectSharedParticipant(opened.billId, remembered).then((next) => {
          if (!isCurrent()) return;
          if (shouldApplyRemoteSnapshot({ revision: revisionSeen.current, confirmationRevision: confirmationRevisionSeen.current }, next)) {
            revisionSeen.current = next.revision;
            confirmationRevisionSeen.current = next.confirmationRevision;
            setSnapshot(next);
          }
          selectedPersonIdRef.current = remembered;
          setSelectedPersonId(remembered);
        }, (caught) => {
          if (isCurrent()) setError(sharedErrorMessage(caught, languageRef.current));
        }).finally(() => { if (isCurrent()) setPending(false); });
      }
    }, (caught) => {
      if (isCurrent()) { setViewStatus("error"); setError(sharedErrorMessage(caught, languageRef.current)); }
    });

    return () => {
      cancelled = true;
      reloadSequence.current += 1;
      void subscriptionController.stop();
    };
  }, [publicId, hashRevision, subscriptionController]);

  useEffect(() => {
    if (!snapshot || !selectedPersonId) return;
    if (reconcileFriendSelection(selectionStorage(), publicId, selectedPersonId, snapshot.participants)) return;
    /* eslint-disable react-hooks/set-state-in-effect -- A remote owner edit can remove this selected participant. */
    selectedPersonIdRef.current = "";
    setSelectedPersonId("");
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [publicId, selectedPersonId, snapshot]);

  useEffect(() => {
    if (!billId || viewStatus !== "ready") return;
    void reconnectRealtime(billId);
    const onOffline = () => { setSyncStatus("offline"); setNotice(uiText(languageRef.current, "ออฟไลน์อยู่ การเลือกผู้ร่วมรายการจะใช้ได้เมื่อเชื่อมต่ออีกครั้ง")); };
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
  const canEdit = Boolean(currentPerson && billId && !snapshot?.closedAt && !pending && syncStatus === "live");

  async function choosePerson(participantId: string) {
    if (!participantId) {
      selectedPersonIdRef.current = "";
      setSelectedPersonId("");
      rememberFriendSelection(selectionStorage(), publicId, "");
      return;
    }
    if (!billId || snapshot?.closedAt || pending || syncStatus === "offline") return;
    const generation = openGeneration.current;
    const previousParticipantId = selectedPersonIdRef.current;
    selectedPersonIdRef.current = participantId;
    setPending(true); setError(""); setNotice("");
    try {
      const next = await selectSharedParticipant(billId, participantId);
      if (generation !== openGeneration.current) return;
      if (shouldApplyRemoteSnapshot({ revision: revisionSeen.current, confirmationRevision: confirmationRevisionSeen.current }, next)) {
        revisionSeen.current = next.revision;
        confirmationRevisionSeen.current = next.confirmationRevision;
        setSnapshot(next);
      }
      setSelectedPersonId(participantId);
      rememberFriendSelection(selectionStorage(), publicId, participantId);
      void reload(billId, generation, participantId);
    } catch (caught) {
      if (generation === openGeneration.current) {
        selectedPersonIdRef.current = previousParticipantId;
        setError(sharedErrorMessage(caught, language));
        void reload(billId, generation, previousParticipantId);
      }
    }
    finally { if (generation === openGeneration.current) setPending(false); }
  }

  async function toggle(receiptId: string, itemId: string, selected: boolean) {
    if (!canEdit || !snapshot) return;
    const generation = openGeneration.current;
    setPending(true); setError(""); setNotice("");
    try {
      const next = await toggleSharedParticipation(billId, receiptId, itemId, selectedPersonId, selected, snapshot.revision);
      if (generation !== openGeneration.current) return;
      if (shouldApplyRemoteSnapshot({ revision: revisionSeen.current, confirmationRevision: confirmationRevisionSeen.current }, next)) {
        revisionSeen.current = next.revision;
        confirmationRevisionSeen.current = next.confirmationRevision;
        setSnapshot(next);
      }
    } catch (caught) {
      if (generation !== openGeneration.current) return;
      const message = sharedErrorMessage(caught, language);
      await reload(billId);
      if (generation !== openGeneration.current) return;
      setNotice(message);
    } finally { if (generation === openGeneration.current) setPending(false); }
  }

  async function confirmOwnStatus(confirmed: boolean) {
    if (!canEdit || !snapshot || !selectedPersonId) return;
    const generation = openGeneration.current;
    setPending(true); setError("");
    try {
      const next = await confirmSharedParticipant(billId, selectedPersonId, confirmed, snapshot.revision);
      if (generation !== openGeneration.current) return;
      if (shouldApplyRemoteSnapshot({ revision: revisionSeen.current, confirmationRevision: confirmationRevisionSeen.current }, next)) {
        revisionSeen.current = next.revision; confirmationRevisionSeen.current = next.confirmationRevision; setSnapshot(next);
      }
      if (confirmed) { toastId.current += 1; setToast({ id: toastId.current, text: t("ยืนยันยอดสำเร็จแล้ว") }); }
    } catch (caught) { if (generation === openGeneration.current) { await reload(billId); setError(sharedErrorMessage(caught, language)); } }
    finally { if (generation === openGeneration.current) setPending(false); }
  }

  if (ownerRecovery) return <OwnerApp recovery={ownerRecovery}/>;
  if (joinedOwner) return <OwnerApp joinedOwner={joinedOwner}/>;

  return <main className="min-h-screen">
    <SuccessToast toast={toast} onDismiss={() => setToast(null)}/>
    <header className="border-b border-[#e9e4f7] bg-white/80"><div className="shell flex min-h-18 items-center justify-between gap-3 py-4"><Link href="/" className="inline-flex min-h-11 items-center gap-2 text-xl font-black text-[#5331aa]"><Image src="/brand/splitkub-icon.png" width={44} height={44} alt="" className="h-11 w-11"/>SplitKub</Link><div className="flex flex-wrap items-center justify-end gap-2"><LanguageSwitcher/><span className="rounded-full bg-[#f1ecff] px-3 py-2 text-xs font-bold text-[#6040ac]">{t("บิลที่เพื่อนแชร์")}</span></div></div></header>
    <div className="shell space-y-6 py-8">
      {viewStatus === "loading" && <div role="status" className="card p-6">{t("กำลังเปิดบิลที่แชร์…")}</div>}
      {viewStatus === "error" && <div role="alert" className="card p-6"><h1 className="section-title">{t("เปิดบิลไม่ได้")}</h1><p className="error mt-3">{error}</p><button className="btn-secondary mt-4" onClick={() => window.location.reload()}>{t("ลองเปิดใหม่")}</button></div>}
      {viewStatus === "ready" && snapshot && <>
        <div className="card p-5 sm:p-7"><p className="eyebrow">{language === "en" ? "Shared bill" : "บิลที่แชร์"}</p><h1 className="mt-2 break-words text-3xl font-black">{snapshot.title}</h1><p className="muted mt-2 text-sm">{snapshot.closedAt ? t("บิลยืนยันแล้ว ดูสรุปได้อย่างเดียว") : t("เลือกชื่อของคุณ แล้วเลือกเฉพาะรายการที่ร่วมจ่าย")}</p>{snapshot.closedAt && <p role="status" className="mt-2 rounded-full bg-[#eee9fa] px-3 py-1 text-sm font-bold">{t("ยืนยันบิลแล้ว")}</p>}<p role="status" aria-live="polite" className={`mt-3 text-sm ${syncStatus === "offline" || syncStatus === "stale" ? "error" : "muted"}`}>{syncStatus === "live" ? t("เชื่อมต่อสดแล้ว") : syncStatus === "connecting" ? t("กำลังเชื่อมต่อข้อมูลล่าสุด…") : syncStatus === "offline" ? t("ออฟไลน์อยู่") : t("การเชื่อมต่อสดขัดข้อง กดโหลดใหม่ได้")}</p><button type="button" className="btn-secondary mt-3" onClick={reloadAndReconnect} disabled={pending || !navigator.onLine}>{t("โหลดข้อมูลล่าสุดและเชื่อมต่อใหม่")}</button></div>
        <div className="card p-5 sm:p-7"><label htmlFor="friend-identity" className="mb-2 block font-bold">{t("ฉันคือ")}</label><select id="friend-identity" className="field" value={selectedPersonId} disabled={pending || Boolean(snapshot.closedAt)} onChange={(event) => void choosePerson(event.target.value)}><option value="">{t("เลือกชื่อของคุณ")}</option>{snapshot.participants.map((person) => <option key={person.id} value={person.id}>{labels.get(person.id)}</option>)}</select>{currentPerson && <p className="muted mt-2 text-sm">{snapshot.closedAt ? t("กำลังดูสรุปของ") : t("กำลังแก้ไขรายการของ")} {labels.get(currentPerson.id)}</p>}</div>
        {currentPerson && <div className="card p-5 sm:p-7"><h2 className="section-title">{t("ตรวจยอดของฉัน")}</h2>{(() => { const status = snapshot.confirmations.find((entry) => entry.participantId === currentPerson.id); const current = status?.confirmedContentRevision === snapshot.revision; return <><p className="muted mt-2">{current ? t("ยืนยันยอดล่าสุดแล้ว") : status?.viewedAt ? t("ดูแล้ว ยังไม่ยืนยันยอดล่าสุด") : t("ยังไม่ยืนยันยอดล่าสุด")}</p><button type="button" className="btn-primary mt-4" disabled={!canEdit} onClick={() => void confirmOwnStatus(!current)}>{current ? t("ยกเลิกคำยืนยัน") : t("ยืนยันยอดของฉัน")}</button></>; })()}</div>}
        {error && <p role="alert" className="error rounded-xl bg-white p-4">{error}</p>}{notice && <p role="status" className="muted rounded-xl bg-white p-4">{notice}</p>}
        <section aria-label={t("ใบเสร็จและรายการ")} className="space-y-5">{snapshot.receipts.map((receipt) => <div key={receipt.id} className="card p-5 sm:p-7"><h2 className="section-title wrap-anywhere">{receipt.title}</h2><p className="muted mt-1 text-sm wrap-anywhere">{t("จ่ายโดย")} {labels.get(receipt.paidByParticipantId) ?? t("ยังไม่ระบุ")}</p><ul className="mt-4 space-y-3">{receipt.items.map((item) => { const selected = Boolean(currentPerson && item.participantIds.includes(currentPerson.id)); return <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#eeeaf6] p-4"><div className="min-w-0 flex-1"><p className="font-bold wrap-anywhere">{item.name}</p><p className="muted text-sm">{formatMoney(item.price, snapshot.currency)}  {t("· ร่วม")} {item.participantIds.length}  {t("คน")}</p></div><button type="button" className="chip min-w-24 shrink-0" data-selected={selected} aria-pressed={selected} aria-label={language === "en" ? `${selected ? "Remove me from" : "Join"} item ${receipt.title} · ${item.name}` : `${selected ? "เลิกร่วม" : "ร่วม"}รายการ ${receipt.title} · ${item.name}`} disabled={!canEdit} onClick={() => void toggle(receipt.id, item.id, !selected)}>{selected ? t("✓ ร่วมจ่าย") : t("ร่วมจ่าย")}</button></li>; })}</ul></div>)}</section>
        {result ? <section aria-labelledby="friend-summary-title"><h2 id="friend-summary-title" className="section-title mb-4">{t("สรุปยอดล่าสุด")}</h2><SessionSummary result={result} session={snapshot} focusParticipantId={currentPerson?.id ?? ""}/></section> : <p className="muted card p-5">{t("เมื่อรายการและผู้จ่ายครบ สรุปยอดจะปรากฏที่นี่")}</p>}
        {snapshot.closedAt && <PaymentTracking billId={billId} session={snapshot} selectedParticipantId={selectedPersonId} owner={false} lockParticipantIdentity={Boolean(selectedPersonId)} onSession={setSnapshot}/>}
        <p className="muted text-xs">{t("QR ที่เจ้าของบิลอัปโหลดอยู่บนอุปกรณ์ของเจ้าของเท่านั้น เพื่อนจะเห็นเลข PromptPay ที่เจ้าของระบุไว้เมื่อมี")}</p>
        <div className="pb-2 text-center"><Link href="/bills" className="btn-secondary inline-flex">← {t("กลับไปบิลของฉัน")}</Link></div>
      </>}
    </div>
  </main>;
}
