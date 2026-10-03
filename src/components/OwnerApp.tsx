"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { emptySession, sessionReducer, type SessionAction } from "@/lib/billState";
import { calculateBill, settlementDestinations } from "@/lib/calculateBill";
import { createClientId } from "@/lib/id";
import { isValidPromptPay } from "@/lib/promptpay";
import { clearSessionStorage, dismissSessionMigrationNotice, loadSessionSafely, pendingLegacyPromptPay as readPendingLegacyPromptPay, resolveStorageSafely, saveAssignedLegacyPromptPay, saveConfirmedRemoteSession, saveSession, sessionMigrationNotice, shouldPersistSession } from "@/lib/storage";
import { shouldApplyRemoteRevision } from "@/lib/sharedSnapshot";
import { ephemeralOwnerCapability, type OwnerCapability } from "@/lib/sharedLinkRouting";
import { participantLabels } from "@/lib/participantLabels";
import { refreshWithTrailingDirty, SharedSubscriptionController, shouldMarkSubscriptionLive } from "@/lib/sharedSubscription";
import { buildSessionShareText, copyTextWithFallback, isShareCancelled, prepareNativeShareFile, qrDestinationKey, resolveQrRecipient, sessionSharingAvailability, type QrRecipientSelection } from "@/lib/share";
import { createSessionSummaryImage, preparedImageMatchesKey, sessionSummaryImageCacheKey } from "@/lib/summaryImage";
import { createSharedSession, openSharedBill, refreshSharedBill, saveSharedOwnerAction, sharedErrorMessage, sharingIsAvailable, subscribeSharedBill, type SharedCreated, type SharedOpen } from "@/hooks/sharedBillAdapter";
import type { Currency, SessionParticipant } from "@/types/bill";
import { ReceiptEditor } from "./ReceiptEditor";
import { SessionSummary } from "./SessionSummary";
import { SettlementSettings } from "./SettlementSettings";
import { SuccessToast, type ToastMessage } from "./SuccessToast";

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
  const [name, setName] = useState(person.name);
  const [promptPay, setPromptPay] = useState(person.promptPay);
  const [error, setError] = useState("");
  async function saveName(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) { setError("กรุณาใส่ชื่อคน"); return; }
    if (name.trim() !== person.name) await onRename(name.trim());
    setError("");
  }
  async function savePromptPay(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (promptPay && !isValidPromptPay(promptPay)) { setError("เลข PromptPay ไม่ถูกต้อง"); return; }
    if (promptPay !== person.promptPay) await onPromptPay(promptPay);
    setError("");
  }
  return <li className="rounded-xl border border-[#eeeaf6] p-4">
    <div className="flex flex-wrap items-end gap-2"><form onSubmit={(event) => void saveName(event)} className="flex min-w-48 flex-1 flex-wrap items-end gap-2"><div className="min-w-36 flex-1"><label className="mb-1 block text-sm font-bold" htmlFor={`person-name-${person.id}`}>ชื่อคน</label><input id={`person-name-${person.id}`} className="field" value={name} onChange={(event) => { setName(event.target.value); setError(""); }} disabled={disabled}/></div><button className="btn-secondary" type="submit" disabled={disabled || name.trim() === person.name}>บันทึก</button></form><button className="btn-danger" type="button" disabled={disabled} onClick={onRemove} aria-label={`ลบ ${person.name}`}>ลบ</button></div>
    {currency === "THB" && <form onSubmit={(event) => void savePromptPay(event)} className="mt-3 flex flex-wrap items-end gap-2"><div className="min-w-48 flex-1"><label className="mb-1 block text-sm font-bold" htmlFor={`person-pay-${person.id}`}>PromptPay ของ {person.name}</label><input id={`person-pay-${person.id}`} className="field" inputMode="numeric" value={promptPay} onChange={(event) => { setPromptPay(event.target.value); setError(""); }} placeholder="เบอร์มือถือหรือเลขบัตรประชาชน" disabled={disabled}/></div><button className="btn-secondary" type="submit" disabled={disabled || promptPay === person.promptPay}>บันทึกเลข</button></form>}
    {error && <p role="alert" className="error mt-2">{error}</p>}
  </li>;
}

export function OwnerApp({ recovery, joinedOwner }: { recovery?: { publicId: string; ownerToken: string }; joinedOwner?: SharedOpen }) {
  const router = useRouter();
  const [session, rawDispatch] = useReducer(sessionReducer, undefined, emptySession);
  const [ready, setReady] = useState(false);
  const [started, setStarted] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [personName, setPersonName] = useState("");
  const [receiptTitle, setReceiptTitle] = useState("");
  const [formError, setFormError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [migrationWarning, setMigrationWarning] = useState("");
  const [pendingLegacyPromptPay, setPendingLegacyPromptPay] = useState("");
  const [migrationParticipantId, setMigrationParticipantId] = useState("");
  const [manualCopyText, setManualCopyText] = useState("");
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
  const remoteGeneration = useRef(0);
  const refreshInFlight = useRef<{ billId: string; generation: number; dirty: boolean; promise: Promise<boolean> } | null>(null);
  const subscribedGeneration = useRef(-1);
  const [subscriptionController] = useState(() => new SharedSubscriptionController(subscribeSharedBill));
  const dismissToast = useCallback(() => setToast(null), []);

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
          if (shouldApplyRemoteRevision(latestRevision.current, next.revision)) {
            latestRevision.current = next.revision;
            rawDispatch({ type: "restore", session: next });
          }
          setActionMessage("");
          return true;
        } catch (caught) {
          if (generation !== remoteGeneration.current) return false;
          setRemoteStatus(navigator.onLine ? "stale" : "offline"); setActionMessage(sharedErrorMessage(caught));
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
    onError: (caught) => { if (generation !== remoteGeneration.current) return; subscribedGeneration.current = -1; setRemoteStatus("stale"); setActionMessage(sharedErrorMessage(caught)); },
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
      if (recovery || joinedOwner) latestRevision.current = -1;
      const saved = recovery || joinedOwner || !storage ? null : loadSessionSafely(() => storage!);
      if (saved) {
        rawDispatch({ type: "restore", session: saved }); setStarted(true); latestRevision.current = saved.revision;
      }
      setTitleDraft(saved?.title ?? emptySession().title);
      if (storage && !recovery && !joinedOwner) {
        setMigrationWarning(sessionMigrationNotice(storage));
        setPendingLegacyPromptPay(readPendingLegacyPromptPay(storage));
      }
      setShareAvailable(sharingIsAvailable());
      if (joinedOwner) {
        const capability = ephemeralOwnerCapability(joinedOwner);
        latestRevision.current = joinedOwner.snapshot.revision;
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
          if (shouldApplyRemoteRevision(latestRevision.current, opened.snapshot.revision)) {
            latestRevision.current = opened.snapshot.revision;
            rawDispatch({ type: "restore", session: opened.snapshot });
            setTitleDraft(opened.snapshot.title);
            setStarted(true);
            setRemoteStatus("connecting");
          } else setRemoteStatus("stale");
          if (!recovery && storage) { try { storage.setItem(OWNER_KEY, JSON.stringify(resolved)); } catch { /* Link still works this session. */ } }
        }, (caught) => { if (cancelled || (recovery && window.location.hash !== openedFromHash)) return; setRemoteStatus("stale"); setActionMessage(sharedErrorMessage(caught)); setOwner({ ...capability, billId: "" }); });
      } else if (capability) { setOwner(capability); setRemoteStatus("stale"); }
    } catch {
      setActionMessage("เปิดข้อมูลใน browser ไม่สำเร็จ แต่คุณยังเริ่มบิลใหม่ได้");
    } finally {
      setReady(true);
    }
    return () => { cancelled = true; };
  }, [recovery, joinedOwner]);
  useEffect(() => {
    if (!ready || recovery || joinedOwner) return;
    try {
      if (shouldPersistSession(started, session)) saveSession(window.localStorage, session, started);
      else clearSessionStorage(window.localStorage);
    } catch { setActionMessage("ไม่สามารถบันทึกข้อมูลใน browser นี้ได้"); }
  }, [ready, started, session, recovery, joinedOwner]);
  /* eslint-enable react-hooks/set-state-in-effect */
  /* eslint-disable react-hooks/set-state-in-effect -- Remote snapshots can update the title while this client editor is open. */
  useEffect(() => { setTitleDraft(session.title); }, [session.title]);
  /* eslint-enable react-hooks/set-state-in-effect */
  useEffect(() => () => { if (qrRef.current) URL.revokeObjectURL(qrRef.current); }, []);
  useEffect(() => { if (manualCopyText) manualCopyRef.current?.select(); }, [manualCopyText]);
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
    setActionMessage(""); setManualCopyText(""); dismissToast();
    if (!owner) { rawDispatch(action); return true; }
    if (!owner.billId || remoteStatus !== "live") { setActionMessage("ข้อมูลออนไลน์ยังไม่พร้อม กรุณาโหลดใหม่ก่อนแก้ไข"); return false; }
    pendingRef.current = true; setPending(true);
    try {
      const next = await saveSharedOwnerAction(owner.billId, latestRevision.current, action);
      if (shouldApplyRemoteRevision(latestRevision.current, next.revision)) {
        latestRevision.current = next.revision;
        rawDispatch({ type: "restore", session: next });
      } else await refreshRemote(owner.billId);
      return true;
    } catch (caught) {
      const message = sharedErrorMessage(caught);
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
    clearQr(); dismissToast(); rawDispatch({ type: "clear" }); setStarted(false); setOwner(null); setRemoteStatus("local");
    setPersonName(""); setReceiptTitle(""); setTitleDraft(emptySession().title); setFormError(""); setActionMessage(""); setManualCopyText("");
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
      if (shouldApplyRemoteRevision(latestRevision.current, created.snapshot.revision)) {
        latestRevision.current = created.snapshot.revision;
        rawDispatch({ type: "restore", session: created.snapshot });
      }
      setOwner(capability); setRemoteStatus("connecting");
      const storageWarnings: string[] = [];
      try { saveConfirmedRemoteSession(window.localStorage, created.snapshot); }
      catch { storageWarnings.push("บันทึก snapshot ที่ยืนยันแล้วใน browser ไม่สำเร็จ ข้อมูล V1 เดิมยังเก็บไว้"); }
      try { window.localStorage.setItem(OWNER_KEY, JSON.stringify(capability)); }
      catch { storageWarnings.push("จำลิงก์สำรองเจ้าของใน browser ไม่สำเร็จ โปรดคัดลอกลิงก์เจ้าของเก็บไว้"); }
      if (storageWarnings.length) setActionMessage(storageWarnings.join(" "));
      notifySuccess("สร้างลิงก์แชร์บิลแล้ว");
    } catch (caught) { setActionMessage(sharedErrorMessage(caught)); }
    finally { pendingRef.current = false; setPending(false); }
  }

  async function assignLegacyPromptPay() {
    const participant = session.participants.find((person) => person.id === migrationParticipantId);
    if (!pendingLegacyPromptPay || !participant) return;
    if (session.currency !== "THB" || !isValidPromptPay(pendingLegacyPromptPay)) {
      setActionMessage("เลข PromptPay เดิมไม่ถูกต้อง หรือบิลนี้ไม่ได้ใช้ THB กรุณาตรวจเลขก่อนกำหนดผู้รับ");
      return;
    }
    const action: SessionAction = { type: "set-person-promptpay", id: participant.id, value: pendingLegacyPromptPay };
    if (!await commit(action)) return;
    try {
      const assigned = { ...sessionReducer(session, action), revision: latestRevision.current };
      saveAssignedLegacyPromptPay(window.localStorage, assigned, pendingLegacyPromptPay);
      setPendingLegacyPromptPay("");
      setMigrationWarning("");
      setMigrationParticipantId("");
      notifySuccess(`กำหนด PromptPay เดิมให้ ${participant.name} แล้ว`);
    } catch {
      setActionMessage("กำหนดเลขแล้ว แต่ยังเก็บข้อมูลย้ายบิลไม่สำเร็จ เลขเดิมยังคงรอการยืนยันอยู่");
    }
  }

  function discardLegacyPromptPay() {
    try {
      dismissSessionMigrationNotice(window.localStorage);
      setPendingLegacyPromptPay("");
      setMigrationWarning("");
      setMigrationParticipantId("");
    } catch { setActionMessage("ลบเลขเดิมจาก browser ไม่สำเร็จ เลขยังคงถูกเก็บไว้"); }
  }

  function onQrChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (!file) return;
    clearQr(); setActionMessage("");
    if (!QR_TYPES.includes(file.type)) { setQrError("เลือกไฟล์ PNG, JPEG หรือ WebP เท่านั้น"); return; }
    if (file.size > MAX_QR_BYTES) { setQrError("รูป QR ต้องมีขนาดไม่เกิน 5 MB"); return; }
    const next = URL.createObjectURL(file); qrRef.current = next; setQrUrl(next);
  }

  const result = useMemo(() => { try { return calculateBill(session); } catch { return null; } }, [session]);
  const calculationError = useMemo(() => { try { calculateBill(session); return ""; } catch (caught) { return caught instanceof Error ? caught.message : "ข้อมูลบิลยังไม่ครบ"; } }, [session]);
  const canEdit = !pending && (!owner || remoteStatus === "live");
  const itemCount = session.receipts.reduce((count, receipt) => count + receipt.items.length, 0);
  const canCreateLink = !pendingLegacyPromptPay && session.participants.length > 0 && session.receipts.length > 0 && session.receipts.every((receipt) => receipt.paidByParticipantId && receipt.items.length > 0);
  const destinationIds = result ? settlementDestinations(result, session) : [];
  const destinationKey = qrDestinationKey(destinationIds);
  const qrReceivers = result?.people.filter((person) => destinationIds.includes(person.participantId)) ?? [];
  const effectiveQrReceiverId = resolveQrRecipient(destinationIds, qrReceiverSelection);
  const qrReceiver = qrReceivers.find((person) => person.participantId === effectiveQrReceiverId);
  const personLabels = participantLabels(session.participants);
  const missingDestinationLabels = destinationIds.filter((id) => !isValidPromptPay(session.participants.find((person) => person.id === id)?.promptPay ?? "")).map((id) => personLabels.get(id) ?? id);
  const shareReadiness = sessionSharingAvailability(result, session, Boolean(qrUrl), effectiveQrReceiverId);
  const shareText = result ? buildSessionShareText(result, session) : "";
  const imageKey = result && qrUrl && shareReadiness.canShareImage ? sessionSummaryImageCacheKey(result, session, qrUrl, effectiveQrReceiverId) : null;
  const imageIsCurrent = preparedImageMatchesKey(preparedImage.key, imageKey);
  const imageStatus = imageKey === null ? "idle" : imageIsCurrent ? preparedImage.status : "preparing";
  /* eslint-disable react-hooks/set-state-in-effect -- Browser Canvas PNG is prepared whenever its input key changes. */
  useEffect(() => {
    if (!result || !qrUrl || !imageKey) { setPreparedImage({ key: null, status: "idle" }); return; }
    let cancelled = false;
    setPreparedImage({ key: imageKey, status: "preparing" });
    const timer = window.setTimeout(() => {
      void createSessionSummaryImage(result, session, qrUrl, effectiveQrReceiverId).then((blob) => {
        if (cancelled) return;
        const nativeShareAvailable = typeof navigator.share === "function" && typeof navigator.canShare === "function" && typeof File !== "undefined";
        const file = prepareNativeShareFile(blob, nativeShareAvailable, (imageBlob) => new File([imageBlob], "splitkub-summary.png", { type: "image/png" }), (candidate) => navigator.canShare({ files: [candidate] }));
        setPreparedImage({ key: imageKey, status: "ready", blob, ...(file ? { file } : {}) });
      }, (caught) => { if (!cancelled) setPreparedImage({ key: imageKey, status: "error", error: caught instanceof Error ? caught.message : "สร้างรูปสรุปไม่สำเร็จ" }); });
    }, 200);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [effectiveQrReceiverId, imageKey, imageRetryCount, qrUrl, result, session]);
  /* eslint-enable react-hooks/set-state-in-effect */

  async function copyText(text: string, success: string) {
    setManualCopyText(""); setActionMessage(""); dismissToast();
    try { if (await copyTextWithFallback(text, document, navigator.clipboard)) { notifySuccess(success); return; } } catch { /* Show selectable text. */ }
    setManualCopyText(text); setActionMessage("Browser ไม่อนุญาตให้คัดลอกอัตโนมัติ เลือกข้อความด้านล่างแล้วคัดลอกได้เลย");
  }
  async function shareImage() {
    if (imageStatus === "error") { setImageRetryCount((count) => count + 1); return; }
    if (!result || !qrUrl || !imageKey || !imageIsCurrent || !preparedImage.blob || sharingImage || qrRef.current !== qrUrl) return;
    setSharingImage(true); setActionMessage("");
    try {
      if (preparedImage.file && typeof navigator.share === "function") {
        try { await navigator.share({ title: session.title, files: [preparedImage.file] }); notifySuccess("แชร์รูปสรุปบิลแล้ว"); return; }
        catch (caught) { if (isShareCancelled(caught)) return; }
      }
      const url = URL.createObjectURL(preparedImage.blob);
      try { const link = document.createElement("a"); link.href = url; link.download = "splitkub-summary.png"; document.body.appendChild(link); link.click(); link.remove(); }
      finally { window.setTimeout(() => URL.revokeObjectURL(url), 30_000); }
      notifySuccess("ดาวน์โหลดรูปสรุปบิลแล้ว");
    } catch (caught) { setActionMessage(caught instanceof Error ? caught.message : "แชร์รูปสรุปไม่สำเร็จ"); }
    finally { setSharingImage(false); }
  }

  const copySuccessMessage = destinationIds.length === 0 ? "คัดลอกสรุปบิลแล้ว" : "คัดลอกสรุปบิลและเลข PromptPay แล้ว";
  const copyHelperText = session.currency === "USD"
    ? "USD ใช้รูปสรุปพร้อม QR สำหรับช่องทางชำระเงิน"
    : destinationIds.length === 0
      ? "ไม่มีรายการโอนเงิน จึงคัดลอกสรุปได้โดยไม่ต้องใช้ PromptPay"
      : shareReadiness.canCopy
        ? "รวมเส้นทางโอนและ PromptPay ของผู้รับเงินจริงทุกคน"
        : "กรอก PromptPay ที่ถูกต้องให้ผู้รับเงินทุกคนก่อนคัดลอก";

  if (!ready) return <main className="shell py-16"><p role="status" className="muted">กำลังเปิดบิล…</p></main>;
  const friendUrl = owner?.friendToken ? `${window.location.origin}/b/${encodeURIComponent(owner.publicId)}#token=${encodeURIComponent(owner.friendToken)}` : "";
  const ownerUrl = owner?.ownerToken ? `${window.location.origin}/b/${encodeURIComponent(owner.publicId)}#owner=${encodeURIComponent(owner.ownerToken)}` : "";

  return <main>
    <header className="border-b border-[#e9e4f7] bg-white/80"><div className="shell flex min-h-18 items-center justify-between py-4"><a href="#top" className="inline-flex min-h-11 items-center gap-2 text-xl font-black tracking-tight text-[#5331aa]"><Image src="/brand/splitkub-icon.png" width={44} height={44} alt="" className="h-11 w-11 shrink-0 object-contain" priority/>SplitKub</a><span className="rounded-full bg-[#f1ecff] px-3 py-2 text-xs font-bold text-[#6040ac]">ฟรี · ไม่ต้องสมัครสมาชิก</span></div></header>
    {migrationWarning && <div className="shell pt-4"><div role="status" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"><p>{migrationWarning}</p>{pendingLegacyPromptPay && <div className="mt-3 flex flex-wrap items-end gap-2"><div className="min-w-52 flex-1"><label htmlFor="migration-promptpay-person" className="mb-1 block font-bold">กำหนดเลขนี้ให้คนที่รับเงิน</label><select id="migration-promptpay-person" className="field" value={migrationParticipantId} onChange={(event) => setMigrationParticipantId(event.target.value)} disabled={pending}><option value="">เลือกคน</option>{session.participants.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></div><button type="button" className="btn-primary" onClick={() => void assignLegacyPromptPay()} disabled={!migrationParticipantId || pending || Boolean(owner && remoteStatus !== "live")}>กำหนดเลขให้คนนี้</button><button type="button" className="btn-secondary" onClick={discardLegacyPromptPay} disabled={pending}>ทิ้งเลขเดิมนี้</button></div>}</div></div>}
    {!started ? <section id="top" className="shell flex min-h-[75vh] flex-col items-center justify-center py-12 text-center"><div className="mb-5 flex h-64 w-64 items-center justify-center rounded-[2rem] bg-white shadow-sm sm:h-72 sm:w-72"><Image src="/brand/splitkub-mascot.png" width={288} height={288} alt="มาสคอตพนักงาน SplitKub ยิ้มต้อนรับ" className="h-full w-full object-contain" priority/></div><p className="eyebrow">Split smarter, smile more</p><h1 className="mt-4 max-w-2xl text-4xl leading-tight font-black tracking-tight sm:text-6xl">หารหลายบิล<br/><span className="text-[#7350d1]">จบในที่เดียว</span></h1><p className="muted mt-6 max-w-lg text-lg leading-8">เพิ่มหลายใบเสร็จ ระบุคนออกเงิน ให้เพื่อนเลือกของที่ร่วมจ่าย แล้วดูยอดสุทธิได้ทันที</p><button className="btn-primary mt-9 px-8 text-lg" onClick={() => setStarted(true)}>เริ่มหารบิล →</button><p className="muted mt-5 text-sm">ไม่ต้องล็อกอิน · บันทึกฉบับร่างใน browser ของคุณ</p></section> : <div id="top" className="shell space-y-6 pb-20">
      <div className="flex flex-wrap items-center justify-between gap-4 py-8"><div><p className="eyebrow">Your split session</p><h1 className="mt-1 break-words text-3xl font-black tracking-tight">{session.title} ✨</h1><p className="muted mt-1 text-sm">เพิ่มคน ใบเสร็จ และรายการ แล้วดูว่าใครจ่ายไปเท่าไร</p></div><button className="btn-danger" onClick={newBill}>เริ่มบิลใหม่</button></div>
      <nav aria-label="ขั้นตอนการหารบิล" className="flex gap-2 overflow-x-auto pb-2 text-sm"><a className="chip whitespace-nowrap" href="#setup">1 ตั้งค่าบิล</a><a className="chip whitespace-nowrap" href="#people">2 คนร่วมบิล</a><a className="chip whitespace-nowrap" href="#receipts">3 ใบเสร็จ</a><a className="chip whitespace-nowrap" href="#summary">4 สรุปและแชร์</a></nav>
      <section id="setup" className="card scroll-mt-5 p-5 sm:p-7"><h2 className="section-title">ตั้งค่าบิล</h2><form onSubmit={(event) => { event.preventDefault(); if (titleDraft.trim()) void commit({ type: "set-title", title: titleDraft.trim() }); else setFormError("กรุณาใส่ชื่อบิล"); }} className="mt-4 flex flex-wrap items-end gap-2"><div className="min-w-48 flex-1"><label htmlFor="session-title" className="mb-1 block text-sm font-bold">ชื่อบิล</label><input id="session-title" className="field" value={titleDraft} onChange={(event) => { setTitleDraft(event.target.value); setFormError(""); }} disabled={!canEdit}/></div><button type="submit" className="btn-secondary" disabled={!canEdit || titleDraft.trim() === session.title}>บันทึกชื่อ</button></form><div className="mt-4"><label htmlFor="currency" className="mb-1 block text-sm font-bold">สกุลเงิน</label><select id="currency" className="field max-w-48" value={session.currency} disabled={!canEdit || itemCount > 0} onChange={(event) => void commit({ type: "currency", currency: event.target.value as Currency })}><option value="THB">THB · บาท</option><option value="USD">USD · ดอลลาร์</option></select>{itemCount > 0 && <p className="muted mt-1 text-xs">ลบรายการทั้งหมดก่อนเปลี่ยนสกุลเงิน</p>}</div></section>
      <SettlementSettings session={session} disabled={!canEdit} onChange={(action) => { void commit(action); }}/>
      <section id="people" className="card scroll-mt-5 p-5 sm:p-7"><h2 className="section-title">คนร่วมบิล</h2><p className="muted mt-1 text-sm">ระบุทุกคนที่จ่ายหรือร่วมรายการ เลข PromptPay จะใช้กับผู้รับเงินจริงตามเส้นทางโอน</p><form onSubmit={(event) => { event.preventDefault(); if (!personName.trim()) { setFormError("กรุณาใส่ชื่อคน"); return; } void commit({ type: "add-person", id: createClientId(), name: personName.trim() }).then((ok) => { if (ok) setPersonName(""); }); }} className="mt-4 flex flex-wrap items-end gap-2"><div className="min-w-48 flex-1"><label htmlFor="new-person" className="mb-1 block text-sm font-bold">เพิ่มคน</label><input id="new-person" className="field" value={personName} onChange={(event) => { setPersonName(event.target.value); setFormError(""); }} placeholder="เช่น Boss" disabled={!canEdit}/></div><button className="btn-primary" disabled={!canEdit}>+ เพิ่มคน</button></form>{formError && <p role="alert" className="error mt-2">{formError}</p>}{session.participants.length === 0 ? <p className="muted mt-5 rounded-xl bg-[#f8f6fd] p-4 text-sm">ยังไม่มีคนร่วมบิล</p> : <ul className="mt-5 grid gap-3 md:grid-cols-2">{session.participants.map((person) => <PersonRow key={`${person.id}:${person.name}:${person.promptPay}`} person={person} currency={session.currency} disabled={!canEdit} onRename={(name) => commit({ type: "edit-person", id: person.id, name })} onPromptPay={(value) => commit({ type: "set-person-promptpay", id: person.id, value })} onRemove={() => void commit({ type: "remove-person", id: person.id })}/>)}</ul>}</section>
      <section id="receipts" className="scroll-mt-5 space-y-5">
        <div className="card p-5 sm:p-7"><h2 className="section-title">ใบเสร็จ</h2><p className="muted mt-1 text-sm">แต่ละใบเลือกคนจ่ายก่อน แล้วเพิ่มรายการและผู้ร่วมจ่าย</p><form onSubmit={(event) => { event.preventDefault(); if (!receiptTitle.trim()) { setFormError("กรุณาใส่ชื่อใบเสร็จ"); return; } void commit({ type: "add-receipt", id: createClientId(), title: receiptTitle.trim() }).then((ok) => { if (ok) setReceiptTitle(""); }); }} className="mt-4 flex flex-wrap items-end gap-2"><div className="min-w-48 flex-1"><label htmlFor="new-receipt" className="mb-1 block text-sm font-bold">ชื่อใบเสร็จใหม่</label><input id="new-receipt" className="field" value={receiptTitle} onChange={(event) => { setReceiptTitle(event.target.value); setFormError(""); }} placeholder="เช่น ร้านอาหาร" disabled={!canEdit}/></div><button className="btn-primary" disabled={!canEdit}>+ เพิ่มใบเสร็จ</button></form>{session.receipts.length === 0 && <p className="muted mt-5 rounded-xl bg-[#f8f6fd] p-4 text-sm">ยังไม่มีใบเสร็จ</p>}</div>
        {session.receipts.map((receipt) => <ReceiptEditor
          key={`${receipt.id}:${receipt.title}`} receipt={receipt} participants={session.participants} currency={session.currency} disabled={!canEdit}
          onRename={(title) => commit({ type: "edit-receipt", id: receipt.id, title })}
          onRemove={() => void commit({ type: "remove-receipt", id: receipt.id })}
          onSetPayer={(paidByParticipantId) => void commit({ type: "set-receipt-payer", receiptId: receipt.id, paidByParticipantId })}
          onAddItem={(name, price) => commit({ type: "add-item", receiptId: receipt.id, id: createClientId(), name, price })}
          onEditItem={(id, name, price) => commit({ type: "edit-item", receiptId: receipt.id, id, name, price })}
          onRemoveItem={(id) => void commit({ type: "remove-item", receiptId: receipt.id, id })}
          onToggle={(itemId, participantId) => void commit({ type: "toggle", receiptId: receipt.id, itemId, participantId })}
          onSelectAll={(itemId, selected) => void commit({ type: "select-item", receiptId: receipt.id, itemId, selected })}
        />)}
      </section>
      <section id="summary" className="scroll-mt-5 space-y-5"><div><p className="eyebrow">Summary</p><h2 className="section-title mt-1">สรุปยอดและแชร์</h2></div>{result ? <SessionSummary result={result} session={session}/> : <div className="card p-5 sm:p-7"><p className="muted">{calculationError}</p></div>}
        <div className="card p-5 sm:p-7"><h3 className="section-title">แชร์ให้เพื่อนเลือกของที่ร่วมจ่าย</h3><p className="muted mt-2 text-sm">เพื่อนเปิดลิงก์แล้วเลือกชื่อของตัวเอง การเปลี่ยนแปลงจะปรากฏกับทุกคน</p><p role="status" aria-live="polite" className="mt-3 text-sm">{remoteStatus === "live" ? "เชื่อมต่อบิลออนไลน์แล้ว" : remoteStatus === "connecting" ? "กำลังเชื่อมต่อ…" : remoteStatus === "offline" ? "ออฟไลน์อยู่ แก้ไขได้เมื่อเชื่อมต่ออีกครั้ง" : remoteStatus === "stale" ? "ข้อมูลออนไลน์ไม่พร้อม กดโหลดใหม่" : "บิลฉบับร่างอยู่บนอุปกรณ์นี้"}</p>{owner?.billId && <button className="btn-secondary mt-2" onClick={() => reloadRemoteAndReconnect(owner.billId)} disabled={pending || remoteStatus === "offline"}>โหลดข้อมูลล่าสุดและเชื่อมต่อใหม่</button>}
          {!owner ? <><button className="btn-primary mt-4 w-full sm:w-auto" onClick={() => void createLink()} disabled={!shareAvailable || pending || !canCreateLink}>สร้างลิงก์ให้เพื่อน</button><p className="muted mt-2 text-xs">{pendingLegacyPromptPay ? "จัดการ PromptPay เดิมด้วยการกำหนดผู้รับหรือทิ้งเลขก่อนสร้างลิงก์" : shareAvailable ? "เพิ่มคน รายการ และเลือกคนจ่ายทุกใบเสร็จก่อนสร้างลิงก์" : "การแชร์ออนไลน์ยังไม่พร้อมใช้งาน สามารถทำบิลบนเครื่องนี้ต่อได้"}</p></> : <div className="mt-4 space-y-3">{friendUrl ? <div><label htmlFor="friend-link" className="mb-1 block text-sm font-bold">ลิงก์สำหรับเพื่อน</label><input id="friend-link" className="field text-sm" readOnly value={friendUrl} onFocus={(event) => event.currentTarget.select()}/><button className="btn-primary mt-2" onClick={() => void copyText(friendUrl, "คัดลอกลิงก์สำหรับเพื่อนแล้ว")}>คัดลอกลิงก์เพื่อน</button></div> : <p className="muted text-sm">ลิงก์เพื่อนถูกสร้างบนอุปกรณ์เดิม กรุณาใช้ลิงก์ที่บันทึกไว้</p>}{ownerUrl && <div><label htmlFor="owner-link" className="mb-1 block text-sm font-bold">ลิงก์สำรองสำหรับเจ้าของ</label><input id="owner-link" className="field text-sm" readOnly value={ownerUrl} onFocus={(event) => event.currentTarget.select()}/><button className="btn-secondary mt-2" onClick={() => void copyText(ownerUrl, "คัดลอกลิงก์เจ้าของแล้ว")}>คัดลอกลิงก์เจ้าของ</button></div>}{session.expiresAt && <p className="muted text-xs">ลิงก์หมดอายุ: {new Date(session.expiresAt).toLocaleString("th-TH")}</p>}</div>}
        </div>
        <div className="card p-5 sm:p-7"><h3 className="section-title">ช่องทางรับเงินและส่งสรุป</h3><p className="muted mt-2 text-sm">เลข PromptPay ระบุที่ชื่อคนด้านบน รูป QR ที่อัปโหลดจะอยู่บนอุปกรณ์นี้เท่านั้น เพื่อนที่เปิดลิงก์จะไม่เห็น QR จนกว่าคุณจะส่งรูปสรุป</p><div className="mt-5"><label htmlFor="qr-file" className="mb-1 block text-sm font-bold">อัปโหลดรูป QR รับเงิน</label><input id="qr-file" ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="field !h-auto text-sm" onChange={onQrChange}/><p className="muted mt-2 text-xs">PNG, JPEG หรือ WebP · สูงสุด 5 MB · รูปหายเมื่อรีเฟรช</p>{qrError && <p role="alert" className="error mt-2">{qrError}</p>}{qrUrl && qrReceivers.length > 1 && <div className="mt-4"><label htmlFor="qr-receiver" className="mb-1 block text-sm font-bold">QR นี้เป็นของใคร</label><select id="qr-receiver" className="field" value={effectiveQrReceiverId} onChange={(event) => setQrReceiverSelection(event.target.value ? { destinationKey, participantId: event.target.value } : null)}><option value="">เลือกคนที่รับเงินจาก QR นี้</option>{qrReceivers.map((person) => <option key={person.participantId} value={person.participantId}>{personLabels.get(person.participantId)}</option>)}</select><p className="muted mt-1 text-xs">เลือกผู้รับเงินจริงที่เป็นเจ้าของ QR ก่อนแชร์รูป เพื่อไม่ให้เพื่อนเข้าใจว่า QR ใช้แทน PromptPay ของทุกคน</p></div>}{qrUrl && qrReceivers.length === 1 && <p className="muted mt-3 text-sm">QR นี้จะระบุว่าเป็นของ {personLabels.get(qrReceivers[0].participantId)}</p>}{qrUrl && qrReceivers.length === 0 && <p className="muted mt-3 text-sm">ยังไม่มีเส้นทางโอนที่มีผู้รับเงิน จึงแชร์รูป QR ไม่ได้</p>}{qrUrl && <div className="mt-4 rounded-xl border border-[#e8e3f2] p-3"><Image unoptimized src={qrUrl} width={288} height={288} alt={`QR รับเงิน${qrReceiver ? `ของ ${personLabels.get(qrReceiver.participantId)}` : "ที่ยังไม่ได้ระบุผู้รับ"}`} className="mx-auto max-h-72 max-w-full object-contain"/><button className="btn-danger mt-3 w-full" onClick={clearQr}>ลบรูป QR</button></div>}</div><div className="mt-6 grid gap-3"><button className="btn-primary" onClick={() => void copyText(shareText, copySuccessMessage)} disabled={!shareReadiness.canCopy}>คัดลอกข้อความสรุป</button><p className="muted text-xs">{copyHelperText}</p><button className="btn-secondary" onClick={() => void shareImage()} disabled={!shareReadiness.canShareImage || imageStatus === "preparing" || sharingImage}>{sharingImage ? "กำลังแชร์รูป…" : imageStatus === "preparing" ? "กำลังเตรียมรูป…" : imageStatus === "error" ? "ลองเตรียมรูปอีกครั้ง" : imageIsCurrent && preparedImage.file ? "แชร์รูปสรุป" : "ดาวน์โหลดรูปสรุป"}</button><p className="muted text-xs">{qrUrl && qrReceivers.length > 1 && !qrReceiver ? "เลือกผู้รับ QR ก่อนแชร์รูป" : shareReadiness.canShareImage ? "รูป PNG มี QR ยอดรวม เส้นทางโอน ผู้จ่ายแต่ละใบ และระบุผู้รับ QR" : "อัปโหลด QR และกรอกบิลให้ครบก่อนแชร์รูป"}</p><p role="status" aria-live="polite" className={imageStatus === "error" ? "error text-xs" : "muted text-xs"}>{imageStatus === "preparing" ? "กำลังเตรียมรูปสรุป" : imageStatus === "ready" ? "รูปสรุปพร้อมแล้ว" : imageStatus === "error" ? preparedImage.error : ""}</p></div>{actionMessage && <p role="alert" className="error mt-3">{actionMessage}</p>}{manualCopyText && <div className="mt-3"><label htmlFor="manual-copy" className="mb-1 block text-sm font-bold">ข้อความสำหรับคัดลอกเอง</label><textarea id="manual-copy" ref={manualCopyRef} readOnly value={manualCopyText} rows={8} onFocus={(event) => event.currentTarget.select()} className="field !h-auto resize-y text-sm"/><button className="btn-secondary mt-2" onClick={() => manualCopyRef.current?.select()}>เลือกข้อความทั้งหมด</button></div>}</div>
        {session.currency === "THB" && missingDestinationLabels.length > 0 && <p role="status" className="error text-sm">ต้องเพิ่ม PromptPay ให้ผู้รับเงิน: {missingDestinationLabels.join(", ")}</p>}
      </section>
    </div>}
    <footer className="border-t border-[#e9e4f7] py-8 text-center text-sm text-[#817b8e]">SplitKub · หารบิลแล้วไปสนุกต่อ ✦</footer>
    <SuccessToast toast={toast} onDismiss={dismissToast}/>
  </main>;
}
