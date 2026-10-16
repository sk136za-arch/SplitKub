"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { emptySession, sessionReducer, type SessionAction } from "@/lib/billState";
import { calculateBill, settlementDestinations } from "@/lib/calculateBill";
import { createClientId } from "@/lib/id";
import { isValidPromptPay } from "@/lib/promptpay";
import { clearSessionStorage, dismissSessionMigrationNotice, legacyPromptPayMigrationNotice, loadSessionSafely, pendingLegacyPromptPay as readPendingLegacyPromptPay, resolveStorageSafely, saveAssignedLegacyPromptPay, saveConfirmedRemoteSession, saveSession, shouldPersistSession } from "@/lib/storage";
import { shouldApplyRemoteSnapshot } from "@/lib/sharedSnapshot";
import { ephemeralOwnerCapability, type OwnerCapability } from "@/lib/sharedLinkRouting";
import { participantLabels } from "@/lib/participantLabels";
import { refreshWithTrailingDirty, SharedSubscriptionController, shouldMarkSubscriptionLive } from "@/lib/sharedSubscription";
import { buildSessionShareText, copyTextWithFallback, isShareCancelled, prepareNativeShareFile, qrDestinationKey, resolveQrRecipient, sessionSharingAvailability, type QrRecipientSelection } from "@/lib/share";
import { createSessionSummaryImage, preparedImageMatchesKey, sessionSummaryImageCacheKey } from "@/lib/summaryImage";
import { closeSharedSession, confirmSharedParticipant, createSharedSession, openSharedBill, refreshSharedBill, saveSharedOwnerAction, sharedErrorMessage, sharingIsAvailable, subscribeSharedBill, type SharedCreated, type SharedOpen } from "@/hooks/sharedBillAdapter";
import type { Currency, SessionParticipant } from "@/types/bill";
import { ReceiptEditor } from "./ReceiptEditor";
import { OwnerReviewCard } from "./OwnerReviewCard";
import { SessionSummary } from "./SessionSummary";
import { SettlementSettings } from "./SettlementSettings";
import { SuccessToast, type ToastMessage } from "./SuccessToast";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { useLanguage } from "./LanguageProvider";
import { uiText, type UiTextKey } from "@/lib/uiText";
import { dateLocale } from "@/lib/language";
import { domainErrorMessage } from "@/lib/domainErrorMessage";
import { resolveManualCopyText, type ManualCopyFallback } from "@/lib/manualCopy";
import { findLocalBill, saveLocalBill } from "@/lib/localBills";

const OWNER_KEY = "splitkub:shared-owner:v1";
const MAX_QR_BYTES = 5 * 1024 * 1024;
const QR_TYPES = ["image/png", "image/jpeg", "image/webp"];

interface PreparedImage { key: string | null; status: "idle" | "preparing" | "ready" | "error"; blob?: Blob; file?: File; error?: string }

function readOwnerCapability(storage: Storage): OwnerCapability | null {
  try {
    const raw = storage.getItem(OWNER_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<OwnerCapability>;
    if (typeof value.publicId === "string" && typeof value.billId === "string" && typeof value.ownerToken === "string" && typeof value.friendToken === "string" && value.publicId && value.billId && value.ownerToken) return value as OwnerCapability;
  } catch { /* Browser storage may be unavailable. */ }
  return null;
}

function PersonRow({ person, currency, disabled, onRename, onPromptPay, onRemove }: { person: SessionParticipant; currency: Currency; disabled: boolean; onRename: (name: string) => Promise<boolean>; onPromptPay: (value: string) => Promise<boolean>; onRemove: () => void }) {
  const { language } = useLanguage();
  const t = (value: UiTextKey) => uiText(language, value);
  const previousLanguage = useRef(language);
  const [name, setName] = useState(person.name);
  const [promptPay, setPromptPay] = useState(person.promptPay);
  const [error, setError] = useState("");
  useEffect(() => {
    if (previousLanguage.current !== language) {
      previousLanguage.current = language;
      setError("");
    }
  }, [language]);
  async function saveName(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) { setError(t("กรุณาใส่ชื่อคน")); return; }
    if (name.trim() !== person.name) await onRename(name.trim());
    setError("");
  }
  async function savePromptPay(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (promptPay && !isValidPromptPay(promptPay)) { setError(t("เลข PromptPay ไม่ถูกต้อง")); return; }
    if (promptPay !== person.promptPay) await onPromptPay(promptPay);
    setError("");
  }
  return <li className="rounded-xl border border-[#eeeaf6] p-4">
    <div className="flex flex-wrap items-end gap-2"><form onSubmit={(event) => void saveName(event)} className="flex min-w-48 flex-1 flex-wrap items-end gap-2"><div className="min-w-36 flex-1"><label className="mb-1 block text-sm font-bold" htmlFor={`person-name-${person.id}`}>{t("ชื่อคน")}</label><input id={`person-name-${person.id}`} className="field" value={name} onChange={(event) => { setName(event.target.value); setError(""); }} disabled={disabled}/></div><button className="btn-secondary" type="submit" disabled={disabled || name.trim() === person.name}>{t("บันทึก")}</button></form><button className="btn-danger" type="button" disabled={disabled} onClick={onRemove} aria-label={`${t("ลบ")} ${person.name}`}>{t("ลบ")}</button></div>
    {currency === "THB" && <form onSubmit={(event) => void savePromptPay(event)} className="mt-3 flex flex-wrap items-end gap-2"><div className="min-w-48 flex-1"><label className="mb-1 block text-sm font-bold" htmlFor={`person-pay-${person.id}`}>{t("PromptPay ของ")} {person.name}</label><input id={`person-pay-${person.id}`} className="field" inputMode="numeric" value={promptPay} onChange={(event) => { setPromptPay(event.target.value); setError(""); }} placeholder={t("เบอร์มือถือหรือเลขบัตรประชาชน")} disabled={disabled}/></div><button className="btn-secondary" type="submit" disabled={disabled || promptPay === person.promptPay}>{t("บันทึกเลข")}</button></form>}
    {error && <p role="alert" className="error mt-2">{error}</p>}
  </li>;
}

export function OwnerApp({ recovery, joinedOwner, localBillId }: { recovery?: { publicId: string; ownerToken: string }; joinedOwner?: SharedOpen; localBillId?: string }) {
  const { language } = useLanguage();
  const t = (value: UiTextKey) => uiText(language, value);
  const languageRef = useRef(language);
  const previousLanguage = useRef(language);
  useEffect(() => { languageRef.current = language; }, [language]);
  const router = useRouter();
  const [session, rawDispatch] = useReducer(sessionReducer, undefined, emptySession);
  const [ready, setReady] = useState(false);
  const [started, setStarted] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [personName, setPersonName] = useState("");
  const [receiptTitle, setReceiptTitle] = useState("");
  const [formError, setFormError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [pendingLegacyPromptPay, setPendingLegacyPromptPay] = useState("");
  const [migrationParticipantId, setMigrationParticipantId] = useState("");
  const [manualCopyFallback, setManualCopyFallback] = useState<ManualCopyFallback | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [shareAvailable, setShareAvailable] = useState(false);
  const [owner, setOwner] = useState<OwnerCapability | null>(null);
  const [remoteStatus, setRemoteStatus] = useState<"local" | "connecting" | "live" | "offline" | "stale">("local");
  const [pending, setPending] = useState(false);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [qrReceiverSelection, setQrReceiverSelection] = useState<QrRecipientSelection | null>(null);
  const [qrError, setQrError] = useState("");
  const [imageRetryCount, setImageRetryCount] = useState(0);
  const [preparedImage, setPreparedImage] = useState<PreparedImage>({ key: null, status: "idle" });
  const [sharingImage, setSharingImage] = useState(false);
  const qrRef = useRef<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const manualCopyRef = useRef<HTMLTextAreaElement>(null);
  const toastId = useRef(0);
  const pendingRef = useRef(false);
  const latestRevision = useRef(0);
  const latestConfirmationRevision = useRef(0);
  const [closeDialogOpen, setCloseDialogOpen] = useState(false);
  const [closeError, setCloseError] = useState("");
  const [acknowledgeIncomplete, setAcknowledgeIncomplete] = useState(false);
  const [reviewParticipantId, setReviewParticipantId] = useState("");
  const closeTriggerRef = useRef<HTMLButtonElement>(null);
  const closeCancelRef = useRef<HTMLButtonElement>(null);
  const closeDialogRef = useRef<HTMLDivElement>(null);
  const closeWasOpenRef = useRef(false);
  const remoteGeneration = useRef(0);
  const refreshInFlight = useRef<{ billId: string; generation: number; dirty: boolean; promise: Promise<boolean> } | null>(null);
  const subscribedGeneration = useRef(-1);
  const [subscriptionController] = useState(() => new SharedSubscriptionController(subscribeSharedBill));
  const dismissToast = useCallback(() => setToast(null), []);

  useEffect(() => {
    if (previousLanguage.current === language) return;
    previousLanguage.current = language;
    setActionMessage("");
    setCloseError("");
    setQrError("");
    setFormError("");
    setToast(null);
  }, [language]);

  useEffect(() => {
    if (closeDialogOpen) {
      closeWasOpenRef.current = true;
      closeCancelRef.current?.focus();
    } else if (closeWasOpenRef.current) {
      closeWasOpenRef.current = false;
      closeTriggerRef.current?.focus();
    }
    if (!closeDialogOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pendingRef.current) setCloseDialogOpen(false);
      if (event.key !== "Tab") return;
      const dialog = closeDialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )).filter((element) => element.getAttribute("aria-hidden") !== "true");
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeDialogOpen]);

  function notifySuccess(text: string) { toastId.current += 1; setToast({ id: toastId.current, text }); }
  // The callback intentionally coordinates mutable generation/request refs across async refreshes.
  const refreshRemote = useCallback((billId: string, generation = remoteGeneration.current): Promise<boolean> => {
    if (generation !== remoteGeneration.current) return Promise.resolve(false);
    if (refreshInFlight.current?.billId === billId && refreshInFlight.current.generation === generation) {
      refreshInFlight.current.dirty = true;
      return refreshInFlight.current.promise;
    }
    const request = { billId, generation, dirty: false, promise: Promise.resolve(false) };
    const promise = (async () => {
      const refreshOnce = async () => {
        try {
          const next = await refreshSharedBill(billId);
          if (generation !== remoteGeneration.current) return false;
          if (shouldApplyRemoteSnapshot({ revision: latestRevision.current, confirmationRevision: latestConfirmationRevision.current }, next)) {
            latestRevision.current = next.revision;
            latestConfirmationRevision.current = next.confirmationRevision;
            rawDispatch({ type: "restore", session: next });
          }
          setActionMessage("");
          return true;
        } catch (caught) {
          if (generation !== remoteGeneration.current) return false;
          setRemoteStatus(navigator.onLine ? "stale" : "offline"); setActionMessage(sharedErrorMessage(caught, languageRef.current));
          return false;
        }
      };
      let succeeded = false;
      try {
        succeeded = await refreshWithTrailingDirty(refreshOnce, () => request.dirty, () => { request.dirty = false; });
      } finally {
        if (refreshInFlight.current === request) refreshInFlight.current = null;
      }
      return succeeded;
    })();
    request.promise = promise;
    refreshInFlight.current = request;
    return promise;
  }, []);
  const reconnectRealtime = useCallback((billId: string) => {
    const generation = ++remoteGeneration.current;
    subscribedGeneration.current = -1;
    return subscriptionController.restart(billId, {
    onChange: () => { void refreshRemote(billId, generation); },
    onError: (caught) => { if (generation !== remoteGeneration.current) return; subscribedGeneration.current = -1; setRemoteStatus("stale"); setActionMessage(sharedErrorMessage(caught, languageRef.current)); },
    onStatus: (status) => {
      if (generation !== remoteGeneration.current) return;
      if (status === "SUBSCRIBED") {
        subscribedGeneration.current = generation;
        if (!navigator.onLine) { setRemoteStatus("offline"); return; }
        setRemoteStatus("connecting");
        void refreshRemote(billId, generation).then((refreshed) => {
          if (shouldMarkSubscriptionLive(refreshed, generation, remoteGeneration.current, subscribedGeneration.current)) setRemoteStatus(navigator.onLine ? "live" : "offline");
        });
      } else {
        subscribedGeneration.current = -1;
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") setRemoteStatus("stale");
      }
    },
  });
  }, [refreshRemote, subscriptionController]);

  /* eslint-disable react-hooks/set-state-in-effect -- Restore browser-only draft and owner capability after hydration. */
  useEffect(() => {
    let cancelled = false;
    const openedFromHash = window.location.hash;
    try {
      const storage = resolveStorageSafely(() => window.localStorage);
      if (recovery || joinedOwner) { latestRevision.current = -1; latestConfirmationRevision.current = -1; }
      const saved = recovery || joinedOwner || !storage ? null : localBillId ? findLocalBill(storage, localBillId)?.session ?? null : loadSessionSafely(() => storage!);
      if (saved) {
        rawDispatch({ type: "restore", session: saved }); setStarted(true); latestRevision.current = saved.revision; latestConfirmationRevision.current = saved.confirmationRevision;
      }
      setTitleDraft(saved?.title ?? emptySession().title);
      if (localBillId) setStarted(true);
      if (storage && !recovery && !joinedOwner) {
        setPendingLegacyPromptPay(readPendingLegacyPromptPay(storage));
      }
      setShareAvailable(sharingIsAvailable());
      if (joinedOwner) {
        const capability = ephemeralOwnerCapability(joinedOwner);
        latestRevision.current = joinedOwner.snapshot.revision;
        latestConfirmationRevision.current = joinedOwner.snapshot.confirmationRevision;
        rawDispatch({ type: "restore", session: joinedOwner.snapshot });
        setTitleDraft(joinedOwner.snapshot.title);
        setStarted(true);
        setOwner(capability);
        setRemoteStatus("connecting");
        return;
      }
      const capability = recovery
        ? { publicId: recovery.publicId, billId: "", ownerToken: recovery.ownerToken, friendToken: "" }
        : storage ? readOwnerCapability(storage) : null;
      if (capability && sharingIsAvailable()) {
        setOwner({ ...capability, billId: "" });
        setRemoteStatus("connecting");
        void openSharedBill(capability.publicId, capability.ownerToken, "owner").then((opened) => {
          if (cancelled || (recovery && window.location.hash !== openedFromHash)) return;
          const resolved = { ...capability, billId: opened.billId };
          setOwner(resolved);
          if (shouldApplyRemoteSnapshot({ revision: latestRevision.current, confirmationRevision: latestConfirmationRevision.current }, opened.snapshot)) {
            latestRevision.current = opened.snapshot.revision;
            latestConfirmationRevision.current = opened.snapshot.confirmationRevision;
            rawDispatch({ type: "restore", session: opened.snapshot });
            setTitleDraft(opened.snapshot.title);
            setStarted(true);
            setRemoteStatus("connecting");
          } else setRemoteStatus("stale");
          if (!recovery && storage) { try { storage.setItem(OWNER_KEY, JSON.stringify(resolved)); } catch { /* Link still works this session. */ } }
        }, (caught) => { if (cancelled || (recovery && window.location.hash !== openedFromHash)) return; setRemoteStatus("stale"); setActionMessage(sharedErrorMessage(caught, languageRef.current)); setOwner({ ...capability, billId: "" }); });
      } else if (capability) { setOwner(capability); setRemoteStatus("stale"); }
    } catch {
      setActionMessage(uiText(languageRef.current, "เปิดข้อมูลใน browser ไม่สำเร็จ แต่คุณยังเริ่มบิลใหม่ได้"));
    } finally {
      setReady(true);
    }
    return () => { cancelled = true; };
  }, [recovery, joinedOwner, localBillId]);
  useEffect(() => {
    if (!ready || recovery || joinedOwner) return;
    try {
      if (localBillId && shouldPersistSession(started, session)) {
        saveLocalBill(window.localStorage, localBillId, session);
      } else if (shouldPersistSession(started, session)) saveSession(window.localStorage, session, started);
      else clearSessionStorage(window.localStorage);
    } catch { setActionMessage(uiText(languageRef.current, "ไม่สามารถบันทึกข้อมูลใน browser นี้ได้")); }
  }, [ready, started, session, recovery, joinedOwner, localBillId]);
  /* eslint-enable react-hooks/set-state-in-effect */
  /* eslint-disable react-hooks/set-state-in-effect -- Remote snapshots can update the title while this client editor is open. */
  useEffect(() => { setTitleDraft(session.title); }, [session.title]);
  /* eslint-enable react-hooks/set-state-in-effect */
  useEffect(() => () => { if (qrRef.current) URL.revokeObjectURL(qrRef.current); }, []);
  useEffect(() => {
    if (!owner?.billId) return;
    void reconnectRealtime(owner.billId);
    const onOffline = () => setRemoteStatus("offline");
    const onOnline = () => { setRemoteStatus("connecting"); void reconnectRealtime(owner.billId); };
    window.addEventListener("offline", onOffline); window.addEventListener("online", onOnline);
    return () => { remoteGeneration.current += 1; void subscriptionController.stop(); window.removeEventListener("offline", onOffline); window.removeEventListener("online", onOnline); };
  }, [owner?.billId, reconnectRealtime, refreshRemote, subscriptionController]);

  function reloadRemoteAndReconnect(billId: string) {
    setRemoteStatus("connecting");
    void reconnectRealtime(billId);
  }

  async function commit(action: SessionAction): Promise<boolean> {
    if (pendingRef.current) return false;
    if (session.closedAt) { setActionMessage(t("บิลนี้ปิดแล้ว แก้ไขไม่ได้")); return false; }
    setActionMessage(""); setManualCopyFallback(null); dismissToast();
    if (!owner) { rawDispatch(action); return true; }
    if (!owner.billId || remoteStatus !== "live") { setActionMessage(t("ข้อมูลออนไลน์ยังไม่พร้อม กรุณาโหลดใหม่ก่อนแก้ไข")); return false; }
    pendingRef.current = true; setPending(true);
    try {
      const next = await saveSharedOwnerAction(owner.billId, latestRevision.current, action);
      if (shouldApplyRemoteSnapshot({ revision: latestRevision.current, confirmationRevision: latestConfirmationRevision.current }, next)) {
        latestRevision.current = next.revision;
        latestConfirmationRevision.current = next.confirmationRevision;
        rawDispatch({ type: "restore", session: next });
      } else await refreshRemote(owner.billId);
      return true;
    } catch (caught) {
      const message = sharedErrorMessage(caught, language);
      await refreshRemote(owner.billId);
      setActionMessage(message);
      return false;
    } finally { pendingRef.current = false; setPending(false); }
  }

  function clearQr() {
    if (qrRef.current) URL.revokeObjectURL(qrRef.current);
    qrRef.current = null; setQrUrl(null); setQrError(""); setQrReceiverSelection(null);
    if (fileRef.current) fileRef.current.value = "";
  }
  function newBill() {
    if (recovery || joinedOwner) { clearQr(); router.push("/"); return; }
    if (localBillId) { clearQr(); router.push("/bills"); return; }
    clearQr(); dismissToast(); rawDispatch({ type: "clear" }); setStarted(false); setOwner(null); setRemoteStatus("local");
    setPersonName(""); setReceiptTitle(""); setTitleDraft(emptySession().title); setFormError(""); setActionMessage(""); setManualCopyFallback(null);
    try { clearSessionStorage(window.localStorage); window.localStorage.removeItem(OWNER_KEY); } catch { /* Local storage may be blocked. */ }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  async function createLink() {
    if (!shareAvailable || owner || pendingRef.current || pendingLegacyPromptPay) return;
    pendingRef.current = true; setPending(true); setActionMessage("");
    try {
      const created: SharedCreated = await createSharedSession(session);
      const capability = { publicId: created.publicId, billId: created.billId, ownerToken: created.ownerToken, friendToken: created.friendToken };
      latestRevision.current = -1;
      latestConfirmationRevision.current = -1;
      if (shouldApplyRemoteSnapshot({ revision: latestRevision.current, confirmationRevision: latestConfirmationRevision.current }, created.snapshot)) {
        latestRevision.current = created.snapshot.revision;
        latestConfirmationRevision.current = created.snapshot.confirmationRevision;
        rawDispatch({ type: "restore", session: created.snapshot });
      }
      setOwner(capability); setRemoteStatus("connecting");
      const storageWarnings: string[] = [];
      try { saveConfirmedRemoteSession(window.localStorage, created.snapshot); }
      catch { storageWarnings.push(t("บันทึก snapshot ที่ยืนยันแล้วใน browser ไม่สำเร็จ ข้อมูล V1 เดิมยังเก็บไว้")); }
      try { window.localStorage.setItem(OWNER_KEY, JSON.stringify(capability)); }
      catch { storageWarnings.push(t("จำลิงก์สำรองเจ้าของใน browser ไม่สำเร็จ โปรดคัดลอกลิงก์เจ้าของเก็บไว้")); }
      if (storageWarnings.length) setActionMessage(storageWarnings.join(" "));
      notifySuccess(t("สร้างลิงก์แชร์บิลแล้ว"));
    } catch (caught) { setActionMessage(sharedErrorMessage(caught, language)); }
    finally { pendingRef.current = false; setPending(false); }
  }

  async function assignLegacyPromptPay() {
    const participant = session.participants.find((person) => person.id === migrationParticipantId);
    if (!pendingLegacyPromptPay || !participant) return;
    if (session.currency !== "THB" || !isValidPromptPay(pendingLegacyPromptPay)) {
      setActionMessage(t("เลข PromptPay เดิมไม่ถูกต้อง หรือบิลนี้ไม่ได้ใช้ THB กรุณาตรวจเลขก่อนกำหนดผู้รับ"));
      return;
    }
    const action: SessionAction = { type: "set-person-promptpay", id: participant.id, value: pendingLegacyPromptPay };
    if (!await commit(action)) return;
    try {
      const assigned = { ...sessionReducer(session, action), revision: latestRevision.current };
      saveAssignedLegacyPromptPay(window.localStorage, assigned, pendingLegacyPromptPay);
      setPendingLegacyPromptPay("");
      setMigrationParticipantId("");
      notifySuccess(language === "en" ? `Old PromptPay assigned to ${participant.name}` : `กำหนด PromptPay เดิมให้ ${participant.name} แล้ว`);
    } catch {
      setActionMessage(t("กำหนดเลขแล้ว แต่ยังเก็บข้อมูลย้ายบิลไม่สำเร็จ เลขเดิมยังคงรอการยืนยันอยู่"));
    }
  }

  function discardLegacyPromptPay() {
    try {
      dismissSessionMigrationNotice(window.localStorage);
      setPendingLegacyPromptPay("");
      setMigrationParticipantId("");
    } catch { setActionMessage(t("ลบเลขเดิมจาก browser ไม่สำเร็จ เลขยังคงถูกเก็บไว้")); }
  }

  function onQrChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (!file) return;
    clearQr(); setActionMessage("");
    if (!QR_TYPES.includes(file.type)) { setQrError(t("เลือกไฟล์ PNG, JPEG หรือ WebP เท่านั้น")); return; }
    if (file.size > MAX_QR_BYTES) { setQrError(t("รูป QR ต้องมีขนาดไม่เกิน 5 MB")); return; }
    const next = URL.createObjectURL(file); qrRef.current = next; setQrUrl(next);
  }

  const result = useMemo(() => { try { return calculateBill(session); } catch { return null; } }, [session]);
  const calculationError = useMemo(() => { try { calculateBill(session); return ""; } catch (caught) { return domainErrorMessage(caught, language) || uiText(language, "ข้อมูลบิลยังไม่ครบ"); } }, [session, language]);
  const canEdit = !session.closedAt && !pending && (!owner || remoteStatus === "live");
  const itemCount = session.receipts.reduce((count, receipt) => count + receipt.items.length, 0);
  const canCreateLink = !pendingLegacyPromptPay && session.participants.length > 0 && session.receipts.length > 0 && session.receipts.every((receipt) => receipt.paidByParticipantId && receipt.items.length > 0);
  const destinationIds = result ? settlementDestinations(result, session) : [];
  const destinationKey = qrDestinationKey(destinationIds);
  const qrReceivers = result?.people.filter((person) => destinationIds.includes(person.participantId)) ?? [];
  const effectiveQrReceiverId = resolveQrRecipient(destinationIds, qrReceiverSelection);
  const qrReceiver = qrReceivers.find((person) => person.participantId === effectiveQrReceiverId);
  const personLabels = participantLabels(session.participants);
  const migrationWarning = pendingLegacyPromptPay ? legacyPromptPayMigrationNotice(pendingLegacyPromptPay, language) : "";
  const missingDestinationLabels = destinationIds.filter((id) => !isValidPromptPay(session.participants.find((person) => person.id === id)?.promptPay ?? "")).map((id) => personLabels.get(id) ?? id);
  const shareReadiness = sessionSharingAvailability(result, session, Boolean(qrUrl), effectiveQrReceiverId);
  const shareText = result ? buildSessionShareText(result, session, language) : "";
  const manualCopyText = resolveManualCopyText(manualCopyFallback, shareText);
  const imageKey = result && qrUrl && shareReadiness.canShareImage ? sessionSummaryImageCacheKey(result, session, qrUrl, effectiveQrReceiverId, language) : null;
  const imageIsCurrent = preparedImageMatchesKey(preparedImage.key, imageKey);
  const imageStatus = imageKey === null ? "idle" : imageIsCurrent ? preparedImage.status : "preparing";
  useEffect(() => { if (manualCopyText) manualCopyRef.current?.select(); }, [manualCopyText]);
  /* eslint-disable react-hooks/set-state-in-effect -- Browser Canvas PNG is prepared whenever its input key changes. */
  useEffect(() => {
    if (!result || !qrUrl || !imageKey) { setPreparedImage({ key: null, status: "idle" }); return; }
    let cancelled = false;
    setPreparedImage({ key: imageKey, status: "preparing" });
    const timer = window.setTimeout(() => {
      void createSessionSummaryImage(result, session, qrUrl, effectiveQrReceiverId, language).then((blob) => {
        if (cancelled) return;
        const nativeShareAvailable = typeof navigator.share === "function" && typeof navigator.canShare === "function" && typeof File !== "undefined";
        const file = prepareNativeShareFile(blob, nativeShareAvailable, (imageBlob) => new File([imageBlob], "splitkub-summary.png", { type: "image/png" }), (candidate) => navigator.canShare({ files: [candidate] }));
        setPreparedImage({ key: imageKey, status: "ready", blob, ...(file ? { file } : {}) });
      }, (caught) => { if (!cancelled) setPreparedImage({ key: imageKey, status: "error", error: caught instanceof Error ? caught.message : uiText(language, "สร้างรูปสรุปไม่สำเร็จ") }); });
    }, 200);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [effectiveQrReceiverId, imageKey, imageRetryCount, language, qrUrl, result, session]);
  /* eslint-enable react-hooks/set-state-in-effect */

  async function copyText(text: string, success: string, followsLanguage = false) {
    setManualCopyFallback(null); setActionMessage(""); dismissToast();
    try { if (await copyTextWithFallback(text, document, navigator.clipboard)) { notifySuccess(success); return; } } catch { /* Show selectable text. */ }
    setManualCopyFallback({ text, followsLanguage }); setActionMessage(t("Browser ไม่อนุญาตให้คัดลอกอัตโนมัติ เลือกข้อความด้านล่างแล้วคัดลอกได้เลย"));
  }
  async function shareImage() {
    if (imageStatus === "error") { setImageRetryCount((count) => count + 1); return; }
    if (!result || !qrUrl || !imageKey || !imageIsCurrent || !preparedImage.blob || sharingImage || qrRef.current !== qrUrl) return;
    setSharingImage(true); setActionMessage("");
    try {
      if (preparedImage.file && typeof navigator.share === "function") {
        try { await navigator.share({ title: session.title, files: [preparedImage.file] }); notifySuccess(t("แชร์รูปสรุปบิลแล้ว")); return; }
        catch (caught) { if (isShareCancelled(caught)) return; }
      }
      const url = URL.createObjectURL(preparedImage.blob);
      try { const link = document.createElement("a"); link.href = url; link.download = "splitkub-summary.png"; document.body.appendChild(link); link.click(); link.remove(); }
      finally { window.setTimeout(() => URL.revokeObjectURL(url), 30_000); }
      notifySuccess(t("ดาวน์โหลดรูปสรุปบิลแล้ว"));
    } catch (caught) { setActionMessage(caught instanceof Error ? caught.message : t("แชร์รูปสรุปไม่สำเร็จ")); }
    finally { setSharingImage(false); }
  }

  async function confirmPerson(confirmed: boolean) {
    if (!owner?.billId || !canEdit || pendingRef.current || !reviewParticipantId) return;
    pendingRef.current = true; setPending(true); setActionMessage("");
    try {
      const next = await confirmSharedParticipant(owner.billId, reviewParticipantId, confirmed, latestRevision.current);
      if (shouldApplyRemoteSnapshot({ revision: latestRevision.current, confirmationRevision: latestConfirmationRevision.current }, next)) {
        latestRevision.current = next.revision; latestConfirmationRevision.current = next.confirmationRevision;
        rawDispatch({ type: "restore", session: next });
      }
    } catch (caught) { await refreshRemote(owner.billId); setActionMessage(sharedErrorMessage(caught, language)); }
    finally { pendingRef.current = false; setPending(false); }
  }

  async function closeBill() {
    if (!owner?.billId || !canEdit || pendingRef.current) return;
    pendingRef.current = true; setPending(true); setCloseError(""); setActionMessage("");
    try {
      const next = await closeSharedSession(owner.billId, latestRevision.current, acknowledgeIncomplete);
      if (shouldApplyRemoteSnapshot({ revision: latestRevision.current, confirmationRevision: latestConfirmationRevision.current }, next)) {
        latestRevision.current = next.revision; latestConfirmationRevision.current = next.confirmationRevision;
        rawDispatch({ type: "restore", session: next });
      }
      setCloseDialogOpen(false); setAcknowledgeIncomplete(false); setCloseError(""); notifySuccess(t("ปิดบิลแล้ว"));
    } catch (caught) { const message = sharedErrorMessage(caught, language); setCloseError(message); setActionMessage(message); await refreshRemote(owner.billId); }
    finally { pendingRef.current = false; setPending(false); }
  }

  const copySuccessMessage = destinationIds.length === 0 ? t("คัดลอกสรุปบิลแล้ว") : t("คัดลอกสรุปบิลและเลข PromptPay แล้ว");
  const copyHelperText = session.currency === "USD"
    ? t("USD ใช้รูปสรุปพร้อม QR สำหรับช่องทางชำระเงิน")
    : destinationIds.length === 0
      ? t("ไม่มีรายการโอนเงิน จึงคัดลอกสรุปได้โดยไม่ต้องใช้ PromptPay")
      : shareReadiness.canCopy
        ? t("รวมเส้นทางโอนและ PromptPay ของผู้รับเงินจริงทุกคน")
        : t("กรอก PromptPay ที่ถูกต้องให้ผู้รับเงินทุกคนก่อนคัดลอก");

  if (!ready) return <main className="shell py-16"><p role="status" className="muted">{t("กำลังเปิดบิล…")}</p></main>;
  const friendUrl = owner?.friendToken ? `${window.location.origin}/b/${encodeURIComponent(owner.publicId)}#token=${encodeURIComponent(owner.friendToken)}` : "";
  const ownerUrl = owner?.ownerToken ? `${window.location.origin}/b/${encodeURIComponent(owner.publicId)}#owner=${encodeURIComponent(owner.ownerToken)}` : "";
  const incompletePeople = session.participants.filter((person) =>
    !session.confirmations.some((status) => status.participantId === person.id && status.confirmedContentRevision === session.revision));

  return <main>
    <header className="border-b border-[#e9e4f7] bg-white/80"><div className="shell flex min-h-18 items-center justify-between gap-3 py-4"><Link href="/" className="inline-flex min-h-11 items-center gap-2 text-xl font-black tracking-tight text-[#5331aa]"><Image src="/brand/splitkub-icon.png" width={44} height={44} alt="" className="h-11 w-11 shrink-0 object-contain" priority/>SplitKub</Link><div className="flex flex-wrap items-center justify-end gap-2"><LanguageSwitcher/><span className="rounded-full bg-[#f1ecff] px-3 py-2 text-xs font-bold text-[#6040ac]">{t("ฟรี · ไม่ต้องสมัครสมาชิก")}</span></div></div></header>
    {migrationWarning && <div className="shell pt-4"><div role="status" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"><p>{migrationWarning}</p>{pendingLegacyPromptPay && <div className="mt-3 flex flex-wrap items-end gap-2"><div className="min-w-52 flex-1"><label htmlFor="migration-promptpay-person" className="mb-1 block font-bold">{t("กำหนดเลขนี้ให้คนที่รับเงิน")}</label><select id="migration-promptpay-person" className="field" value={migrationParticipantId} onChange={(event) => setMigrationParticipantId(event.target.value)} disabled={pending}><option value="">{t("เลือกคน")}</option>{session.participants.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></div><button type="button" className="btn-primary" onClick={() => void assignLegacyPromptPay()} disabled={!migrationParticipantId || pending || Boolean(owner && remoteStatus !== "live")}>{t("กำหนดเลขให้คนนี้")}</button><button type="button" className="btn-secondary" onClick={discardLegacyPromptPay} disabled={pending}>{t("ทิ้งเลขเดิมนี้")}</button></div>}</div></div>}
    {!started ? <section id="top" className="shell flex min-h-[75vh] flex-col items-center justify-center py-12 text-center"><div className="mb-5 flex h-64 w-64 items-center justify-center rounded-[2rem] bg-white shadow-sm sm:h-72 sm:w-72"><Image src="/brand/splitkub-mascot.png" width={288} height={288} alt={t("มาสคอตพนักงาน SplitKub ยิ้มต้อนรับ")} className="h-full w-full object-contain" priority/></div><p className="eyebrow">{language === "en" ? "Split smarter, smile more" : "หารง่าย ยิ้มได้"}</p><h1 className="mt-4 max-w-2xl text-4xl leading-tight font-black tracking-tight sm:text-6xl">{t("หารหลายบิล")}<br/><span className="text-[#7350d1]">{t("จบในที่เดียว")}</span></h1><p className="muted mt-6 max-w-lg text-lg leading-8">{t("เพิ่มหลายใบเสร็จ ระบุคนออกเงิน ให้เพื่อนเลือกของที่ร่วมจ่าย แล้วดูยอดสุทธิได้ทันที")}</p><button className="btn-primary mt-9 px-8 text-lg" onClick={() => setStarted(true)}>{t("เริ่มหารบิล →")}</button><p className="muted mt-5 text-sm">{t("ไม่ต้องล็อกอิน · บันทึกฉบับร่างใน browser ของคุณ")}</p></section> : <div id="top" className="shell space-y-6 pb-20">
      <div className="flex flex-wrap items-center justify-between gap-4 py-8"><div><p className="eyebrow">{language === "en" ? "Your split session" : "บิลของคุณ"}</p><h1 className="mt-1 break-words text-3xl font-black tracking-tight">{session.title} ✨</h1><p className="muted mt-1 text-sm">{t("เพิ่มคน ใบเสร็จ และรายการ แล้วดูว่าใครจ่ายไปเท่าไร")}</p>{session.closedAt && <p role="status" className="mt-2 inline-block rounded-full bg-[#eee9fa] px-3 py-1 text-sm font-bold">{t("ปิดบิลแล้ว · อ่านได้อย่างเดียว")}</p>}</div><button className="btn-danger" onClick={newBill}>{t("เริ่มบิลใหม่")}</button></div>
      <nav aria-label={t("ขั้นตอนการหารบิล")} className="flex gap-2 overflow-x-auto pb-2 text-sm"><a className="chip whitespace-nowrap" href="#setup">{t("1 ตั้งค่าบิล")}</a><a className="chip whitespace-nowrap" href="#people">{t("2 คนร่วมบิล")}</a><a className="chip whitespace-nowrap" href="#receipts">{t("3 ใบเสร็จ")}</a><a className="chip whitespace-nowrap" href="#summary">{t("4 สรุปและแชร์")}</a></nav>
      <section id="setup" className="card scroll-mt-5 p-5 sm:p-7"><h2 className="section-title">{t("ตั้งค่าบิล")}</h2><form onSubmit={(event) => { event.preventDefault(); if (titleDraft.trim()) void commit({ type: "set-title", title: titleDraft.trim() }); else setFormError(t("กรุณาใส่ชื่อบิล")); }} className="mt-4 flex flex-wrap items-end gap-2"><div className="min-w-48 flex-1"><label htmlFor="session-title" className="mb-1 block text-sm font-bold">{t("ชื่อบิล")}</label><input id="session-title" className="field" value={titleDraft} onChange={(event) => { setTitleDraft(event.target.value); setFormError(""); }} disabled={!canEdit}/></div><button type="submit" className="btn-secondary" disabled={!canEdit || titleDraft.trim() === session.title}>{t("บันทึกชื่อ")}</button></form><div className="mt-4"><label htmlFor="currency" className="mb-1 block text-sm font-bold">{t("สกุลเงิน")}</label><select id="currency" className="field max-w-48" value={session.currency} disabled={!canEdit || itemCount > 0} onChange={(event) => void commit({ type: "currency", currency: event.target.value as Currency })}><option value="THB">{t("THB · บาท")}</option><option value="USD">{t("USD · ดอลลาร์")}</option></select>{itemCount > 0 && <p className="muted mt-1 text-xs">{t("ลบรายการทั้งหมดก่อนเปลี่ยนสกุลเงิน")}</p>}</div></section>
      <details className="card mt-5 p-5 sm:p-7"><summary className="min-h-11 cursor-pointer font-bold text-[#5140c6]">{language === "en" ? "More options" : "ตัวเลือกเพิ่มเติม"}</summary><p className="muted mt-2 text-sm">{language === "en" ? "Set a collector and transfer routing only when needed." : "ตั้งค่าคนรวบรวมเงินและรูปแบบเส้นทางโอนได้เมื่อจำเป็น"}</p><div className="mt-4"><SettlementSettings session={session} disabled={!canEdit} onChange={(action) => { void commit(action); }}/></div></details>
      <section id="people" className="card scroll-mt-5 p-5 sm:p-7"><h2 className="section-title">{t("คนร่วมบิล")}</h2><p className="muted mt-1 text-sm">{t("ระบุทุกคนที่จ่ายหรือร่วมรายการ เลข PromptPay จะใช้กับผู้รับเงินจริงตามเส้นทางโอน")}</p><form onSubmit={(event) => { event.preventDefault(); if (!personName.trim()) { setFormError(t("กรุณาใส่ชื่อคน")); return; } void commit({ type: "add-person", id: createClientId(), name: personName.trim() }).then((ok) => { if (ok) setPersonName(""); }); }} className="mt-4 flex flex-wrap items-end gap-2"><div className="min-w-48 flex-1"><label htmlFor="new-person" className="mb-1 block text-sm font-bold">{t("เพิ่มคน")}</label><input id="new-person" className="field" value={personName} onChange={(event) => { setPersonName(event.target.value); setFormError(""); }} placeholder={t("เช่น Boss")} disabled={!canEdit}/></div><button className="btn-primary" disabled={!canEdit}>{t("+ เพิ่มคน")}</button></form>{formError && <p role="alert" className="error mt-2">{formError}</p>}{session.participants.length === 0 ? <p className="muted mt-5 rounded-xl bg-[#f8f6fd] p-4 text-sm">{t("ยังไม่มีคนร่วมบิล")}</p> : <ul className="mt-5 grid gap-3 md:grid-cols-2">{session.participants.map((person) => <PersonRow key={`${person.id}:${person.name}:${person.promptPay}`} person={person} currency={session.currency} disabled={!canEdit} onRename={(name) => commit({ type: "edit-person", id: person.id, name })} onPromptPay={(value) => commit({ type: "set-person-promptpay", id: person.id, value })} onRemove={() => void commit({ type: "remove-person", id: person.id })}/>)}</ul>}</section>
      <section id="receipts" className="scroll-mt-5 space-y-5">
        <div className="card p-5 sm:p-7"><h2 className="section-title">{t("ใบเสร็จ")}</h2><p className="muted mt-1 text-sm">{t("แต่ละใบเลือกคนจ่ายก่อน แล้วเพิ่มรายการและผู้ร่วมจ่าย")}</p><form onSubmit={(event) => { event.preventDefault(); if (!receiptTitle.trim()) { setFormError(t("กรุณาใส่ชื่อใบเสร็จ")); return; } void commit({ type: "add-receipt", id: createClientId(), title: receiptTitle.trim() }).then((ok) => { if (ok) setReceiptTitle(""); }); }} className="mt-4 flex flex-wrap items-end gap-2"><div className="min-w-48 flex-1"><label htmlFor="new-receipt" className="mb-1 block text-sm font-bold">{t("ชื่อใบเสร็จใหม่")}</label><input id="new-receipt" className="field" value={receiptTitle} onChange={(event) => { setReceiptTitle(event.target.value); setFormError(""); }} placeholder={t("เช่น ร้านอาหาร")} disabled={!canEdit}/></div><button className="btn-primary" disabled={!canEdit}>{t("+ เพิ่มใบเสร็จ")}</button></form>{session.receipts.length === 0 && <p className="muted mt-5 rounded-xl bg-[#f8f6fd] p-4 text-sm">{t("ยังไม่มีใบเสร็จ")}</p>}</div>
        {session.receipts.map((receipt) => <ReceiptEditor
          key={`${receipt.id}:${receipt.title}:${JSON.stringify(receipt.adjustments)}`} receipt={receipt} session={session} participants={session.participants} currency={session.currency} disabled={!canEdit}
          onRename={(title) => commit({ type: "edit-receipt", id: receipt.id, title })}
          onRemove={() => void commit({ type: "remove-receipt", id: receipt.id })}
          onSetPayer={(paidByParticipantId) => void commit({ type: "set-receipt-payer", receiptId: receipt.id, paidByParticipantId })}
          onSetAdjustments={(adjustments) => commit({ type: "set-receipt-adjustments", receiptId: receipt.id, adjustments })}
          onAddItem={(name, price) => commit({ type: "add-item", receiptId: receipt.id, id: createClientId(), name, price })}
          onEditItem={(id, name, price) => commit({ type: "edit-item", receiptId: receipt.id, id, name, price })}
          onRemoveItem={(id) => void commit({ type: "remove-item", receiptId: receipt.id, id })}
          onToggle={(itemId, participantId) => void commit({ type: "toggle", receiptId: receipt.id, itemId, participantId })}
          onSelectAll={(itemId, selected) => void commit({ type: "select-item", receiptId: receipt.id, itemId, selected })}
        />)}
      </section>
      <section id="summary" className="scroll-mt-5 space-y-5"><div><p className="eyebrow">{language === "en" ? "Summary" : "สรุปยอด"}</p><h2 className="section-title mt-1">{t("สรุปยอดและแชร์")}</h2></div>{result ? <SessionSummary result={result} session={session}/> : <div className="card p-5 sm:p-7"><p className="muted">{calculationError}</p></div>}
        {owner && <OwnerReviewCard session={session} selectedParticipantId={reviewParticipantId} disabled={!canEdit} onSelectParticipant={setReviewParticipantId} onConfirm={(confirmed) => void confirmPerson(confirmed)}/>}
        <div className="card p-5 sm:p-7"><h3 className="section-title">{t("แชร์ให้เพื่อนเลือกของที่ร่วมจ่าย")}</h3><p className="muted mt-2 text-sm">{t("เพื่อนเปิดลิงก์แล้วเลือกชื่อของตัวเอง การเปลี่ยนแปลงจะปรากฏกับทุกคน")}</p><p role="status" aria-live="polite" className="mt-3 text-sm">{remoteStatus === "live" ? t("เชื่อมต่อบิลออนไลน์แล้ว") : remoteStatus === "connecting" ? t("กำลังเชื่อมต่อ…") : remoteStatus === "offline" ? t("ออฟไลน์อยู่ แก้ไขได้เมื่อเชื่อมต่ออีกครั้ง") : remoteStatus === "stale" ? t("ข้อมูลออนไลน์ไม่พร้อม กดโหลดใหม่") : t("บิลฉบับร่างอยู่บนอุปกรณ์นี้")}</p>{owner?.billId && <button className="btn-secondary mt-2" onClick={() => reloadRemoteAndReconnect(owner.billId)} disabled={pending || remoteStatus === "offline"}>{t("โหลดข้อมูลล่าสุดและเชื่อมต่อใหม่")}</button>}
          {!owner ? <><button className="btn-primary mt-4 w-full sm:w-auto" onClick={() => void createLink()} disabled={!shareAvailable || pending || !canCreateLink}>{t("สร้างลิงก์ให้เพื่อน")}</button><p className="muted mt-2 text-xs">{pendingLegacyPromptPay ? t("จัดการ PromptPay เดิมด้วยการกำหนดผู้รับหรือทิ้งเลขก่อนสร้างลิงก์") : shareAvailable ? t("เพิ่มคน รายการ และเลือกคนจ่ายทุกใบเสร็จก่อนสร้างลิงก์") : t("การแชร์ออนไลน์ยังไม่พร้อมใช้งาน สามารถทำบิลบนเครื่องนี้ต่อได้")}</p></> : <div className="mt-4 space-y-3">{friendUrl ? <div><label htmlFor="friend-link" className="mb-1 block text-sm font-bold">{t("ลิงก์สำหรับเพื่อน")}</label><input id="friend-link" className="field text-sm" readOnly value={friendUrl} onFocus={(event) => event.currentTarget.select()}/><button className="btn-primary mt-2" onClick={() => void copyText(friendUrl, t("คัดลอกลิงก์สำหรับเพื่อนแล้ว"))}>{t("คัดลอกลิงก์เพื่อน")}</button></div> : <p className="muted text-sm">{t("ลิงก์เพื่อนถูกสร้างบนอุปกรณ์เดิม กรุณาใช้ลิงก์ที่บันทึกไว้")}</p>}{ownerUrl && <div><label htmlFor="owner-link" className="mb-1 block text-sm font-bold">{t("ลิงก์สำรองสำหรับเจ้าของ")}</label><input id="owner-link" className="field text-sm" readOnly value={ownerUrl} onFocus={(event) => event.currentTarget.select()}/><button className="btn-secondary mt-2" onClick={() => void copyText(ownerUrl, t("คัดลอกลิงก์เจ้าของแล้ว"))}>{t("คัดลอกลิงก์เจ้าของ")}</button></div>}{session.expiresAt && <p className="muted text-xs">{t("ลิงก์หมดอายุ:")} {new Date(session.expiresAt).toLocaleString(dateLocale(language))}</p>}</div>}
        </div>
        <div className="card p-5 sm:p-7"><h3 className="section-title">{t("ช่องทางรับเงินและส่งสรุป")}</h3><p className="muted mt-2 text-sm">{t("เลข PromptPay ระบุที่ชื่อคนด้านบน รูป QR ที่อัปโหลดจะอยู่บนอุปกรณ์นี้เท่านั้น เพื่อนที่เปิดลิงก์จะไม่เห็น QR จนกว่าคุณจะส่งรูปสรุป")}</p><div className="mt-5"><label htmlFor="qr-file" className="mb-1 block text-sm font-bold">{t("อัปโหลดรูป QR รับเงิน")}</label><input id="qr-file" ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="field !h-auto text-sm" onChange={onQrChange}/><p className="muted mt-2 text-xs">{t("PNG, JPEG หรือ WebP · สูงสุด 5 MB · รูปหายเมื่อรีเฟรช")}</p>{qrError && <p role="alert" className="error mt-2">{qrError}</p>}{qrUrl && qrReceivers.length > 1 && <div className="mt-4"><label htmlFor="qr-receiver" className="mb-1 block text-sm font-bold">{t("QR นี้เป็นของใคร")}</label><select id="qr-receiver" className="field" value={effectiveQrReceiverId} onChange={(event) => setQrReceiverSelection(event.target.value ? { destinationKey, participantId: event.target.value } : null)}><option value="">{t("เลือกคนที่รับเงินจาก QR นี้")}</option>{qrReceivers.map((person) => <option key={person.participantId} value={person.participantId}>{personLabels.get(person.participantId)}</option>)}</select><p className="muted mt-1 text-xs">{t("เลือกผู้รับเงินจริงที่เป็นเจ้าของ QR ก่อนแชร์รูป เพื่อไม่ให้เพื่อนเข้าใจว่า QR ใช้แทน PromptPay ของทุกคน")}</p></div>}{qrUrl && qrReceivers.length === 1 && <p className="muted mt-3 text-sm">{t("QR นี้จะระบุว่าเป็นของ")} {personLabels.get(qrReceivers[0].participantId)}</p>}{qrUrl && qrReceivers.length === 0 && <p className="muted mt-3 text-sm">{t("ยังไม่มีเส้นทางโอนที่มีผู้รับเงิน จึงแชร์รูป QR ไม่ได้")}</p>}{qrUrl && <div className="mt-4 rounded-xl border border-[#e8e3f2] p-3"><Image unoptimized src={qrUrl} width={288} height={288} alt={`${t("QR รับเงิน")}${qrReceiver ? ` ${t("ของ")} ${personLabels.get(qrReceiver.participantId)}` : ` ${t("ที่ยังไม่ได้ระบุผู้รับ")}`}`} className="mx-auto max-h-72 max-w-full object-contain"/><button className="btn-danger mt-3 w-full" onClick={clearQr}>{t("ลบรูป QR")}</button></div>}</div><div className="mt-6 grid gap-3"><button className="btn-primary" onClick={() => void copyText(shareText, copySuccessMessage, true)} disabled={!shareReadiness.canCopy}>{t("คัดลอกข้อความสรุป")}</button><p className="muted text-xs">{copyHelperText}</p><button className="btn-secondary" onClick={() => void shareImage()} disabled={!shareReadiness.canShareImage || imageStatus === "preparing" || sharingImage}>{sharingImage ? t("กำลังแชร์รูป…") : imageStatus === "preparing" ? t("กำลังเตรียมรูปสรุป") : imageStatus === "error" ? t("ลองเตรียมรูปอีกครั้ง") : imageIsCurrent && preparedImage.file ? t("แชร์รูปสรุป") : t("ดาวน์โหลดรูปสรุป")}</button><p className="muted text-xs">{qrUrl && qrReceivers.length > 1 && !qrReceiver ? t("เลือกผู้รับ QR ก่อนแชร์รูป") : shareReadiness.canShareImage ? t("รูป PNG มี QR ยอดรวม เส้นทางโอน ผู้จ่ายแต่ละใบ และระบุผู้รับ QR") : t("อัปโหลด QR และกรอกบิลให้ครบก่อนแชร์รูป")}</p><p role="status" aria-live="polite" className={imageStatus === "error" ? "error text-xs" : "muted text-xs"}>{imageStatus === "preparing" ? t("กำลังเตรียมรูปสรุป") : imageStatus === "ready" ? t("รูปสรุปพร้อมแล้ว") : imageStatus === "error" ? preparedImage.error : ""}</p></div>{actionMessage && <p role="alert" className="error mt-3">{actionMessage}</p>}{manualCopyText && <div className="mt-3"><label htmlFor="manual-copy" className="mb-1 block text-sm font-bold">{t("ข้อความสำหรับคัดลอกเอง")}</label><textarea id="manual-copy" ref={manualCopyRef} readOnly value={manualCopyText} rows={8} onFocus={(event) => event.currentTarget.select()} className="field !h-auto resize-y text-sm"/><button className="btn-secondary mt-2" onClick={() => manualCopyRef.current?.select()}>{t("เลือกข้อความทั้งหมด")}</button></div>}</div>
        {session.currency === "THB" && missingDestinationLabels.length > 0 && <p role="status" className="error text-sm">{t("ต้องเพิ่ม PromptPay ให้ผู้รับเงิน:")} {missingDestinationLabels.join(", ")}</p>}
      </section>
      {owner?.billId && !session.closedAt && <section className="card p-5 sm:p-7"><h2 className="section-title">{t("ปิดบิล")}</h2><p className="muted mt-2 text-sm">{t("หลังปิดบิล ทุกคนยังเปิดดูและแชร์สรุปได้ แต่แก้ไขหรือยืนยันเพิ่มเติมไม่ได้")}</p><button ref={closeTriggerRef} type="button" className="btn-danger mt-4" disabled={!canEdit} onClick={() => { setAcknowledgeIncomplete(false); setCloseError(""); setCloseDialogOpen(true); }}>{t("ปิดบิลนี้")}</button></section>}
      {closeDialogOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget && !pending) setCloseDialogOpen(false); }}><div ref={closeDialogRef} role="dialog" aria-modal="true" aria-labelledby="close-bill-title" tabIndex={-1} className="card max-h-[90vh] w-full max-w-lg overflow-y-auto p-6"><h2 id="close-bill-title" className="section-title">{t("ยืนยันการปิดบิล")}</h2><p className="mt-3">{t("ปิดแล้วจะย้อนกลับหรือแก้ไขไม่ได้")}</p>{incompletePeople.length > 0 && <><p className="error mt-4">{t("ยังไม่ยืนยันยอดล่าสุด:")} {incompletePeople.map((person) => personLabels.get(person.id)).join(", ")}</p><label className="mt-4 flex items-start gap-2"><input type="checkbox" checked={acknowledgeIncomplete} onChange={(event) => setAcknowledgeIncomplete(event.target.checked)}/><span>{t("รับทราบว่ายังมีคนไม่ยืนยัน และต้องการปิดบิลต่อ")}</span></label></>}{closeError && <p role="alert" className="error mt-4">{closeError}</p>}<div className="mt-6 flex flex-wrap gap-2"><button type="button" className="btn-danger" disabled={pending || (incompletePeople.length > 0 && !acknowledgeIncomplete)} onClick={() => void closeBill()}>{t("ยืนยันปิดบิลถาวร")}</button><button ref={closeCancelRef} type="button" className="btn-secondary" disabled={pending} onClick={() => { setCloseDialogOpen(false); setCloseError(""); }}>{t("ยกเลิก")}</button></div></div></div>}
    </div>}
    <footer className="border-t border-[#e9e4f7] py-8 text-center text-sm text-[#817b8e]">{t("SplitKub · หารบิลแล้วไปสนุกต่อ ✦")}</footer>
    <SuccessToast toast={toast} onDismiss={dismissToast}/>
  </main>;
}
