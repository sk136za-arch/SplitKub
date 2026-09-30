"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { SuccessToast, type ToastMessage } from "@/components/SuccessToast";
import { billReducer, emptyBill, type BillAction } from "@/lib/billState";
import { calculateBill } from "@/lib/calculateBill";
import { formatMoney, moneyInput, parseMoney, sumMoneyChecked } from "@/lib/money";
import { createClientId } from "@/lib/id";
import { isValidPromptPay } from "@/lib/promptpay";
import { clearBillStorage, loadBillSafely, saveBill, shouldPersistBill } from "@/lib/storage";
import { participantLabels } from "@/lib/participantLabels";
import { buildShareText, copyTextWithFallback, isShareCancelled, prepareNativeShareFile, sharingAvailability } from "@/lib/share";
import { createSummaryImage, preparedImageMatchesKey, summaryImageCacheKey } from "@/lib/summaryImage";
import type { Currency } from "@/types/bill";

const MAX_QR_BYTES = 5 * 1024 * 1024;
const QR_TYPES = ["image/png", "image/jpeg", "image/webp"];

function SectionHeading({ number, title, hint }: { number: string; title: string; hint: string }) {
  return <div className="mb-5 flex items-start gap-4"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#eee8ff] font-bold text-[#5c39b4]">{number}</span><div><h2 className="section-title">{title}</h2><p className="muted mt-1 text-sm">{hint}</p></div></div>;
}

export default function Home() {
  const [bill, rawDispatch] = useReducer(billReducer, undefined, emptyBill);
  const [ready, setReady] = useState(false);
  const [started, setStarted] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [itemName, setItemName] = useState("");
  const [itemPrice, setItemPrice] = useState("");
  const [editingItem, setEditingItem] = useState<string | null>(null);
  const [itemError, setItemError] = useState("");
  const [personName, setPersonName] = useState("");
  const [editingPerson, setEditingPerson] = useState<string | null>(null);
  const [personError, setPersonError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [successToast, setSuccessToast] = useState<ToastMessage | null>(null);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [qrError, setQrError] = useState("");
  const [manualCopyText, setManualCopyText] = useState("");
  const [sharingImage, setSharingImage] = useState(false);
  const [imageRetryCount, setImageRetryCount] = useState(0);
  const [preparedImage, setPreparedImage] = useState<{ key: string | null; status: "idle" | "preparing" | "ready" | "error"; blob?: Blob; file?: File; error?: string }>({ key: null, status: "idle" });
  const qrRef = useRef<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const manualCopyRef = useRef<HTMLTextAreaElement>(null);
  const toastId = useRef(0);
  const dismissToast = useCallback(() => setSuccessToast(null), []);
  function showSuccessToast(text: string) {
    toastId.current += 1;
    setSuccessToast({ id: toastId.current, text });
  }

  function dispatch(action: BillAction) { rawDispatch(action); setShowSummary(false); setActionMessage(""); setManualCopyText(""); dismissToast(); }

  /* eslint-disable react-hooks/set-state-in-effect -- Restoring browser storage requires a client-only hydration step. */
  useEffect(() => {
    try {
      const saved = loadBillSafely(() => window.localStorage);
      if (saved) { rawDispatch({ type: "restore", bill: saved }); setStarted(true); }
    } finally { setReady(true); }
  }, []);
  useEffect(() => {
    if (!ready) return;
    try {
      if (shouldPersistBill(started, bill)) saveBill(window.localStorage, bill, started);
      else clearBillStorage(window.localStorage);
    } catch { setActionMessage("ไม่สามารถบันทึกข้อมูลใน browser นี้ได้"); }
  }, [bill, ready, started]);
  /* eslint-enable react-hooks/set-state-in-effect */
  useEffect(() => () => { if (qrRef.current) URL.revokeObjectURL(qrRef.current); }, []);
  useEffect(() => { if (manualCopyText) manualCopyRef.current?.select(); }, [manualCopyText]);

  function clearQr() {
    if (qrRef.current) URL.revokeObjectURL(qrRef.current);
    qrRef.current = null; setQrUrl(null); setQrError("");
    setActionMessage("");
    if (fileRef.current) fileRef.current.value = "";
  }

  function clearBill() {
    clearQr();
    dismissToast();
    try { clearBillStorage(window.localStorage); } catch { /* private browsing may block storage */ }
    rawDispatch({ type: "clear" }); setStarted(false); setShowSummary(false);
    setItemName(""); setItemPrice(""); setPersonName("");
    setEditingItem(null); setEditingPerson(null); setItemError(""); setPersonError(""); setActionMessage("");
    setManualCopyText("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function submitItem(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = itemName.trim(); const price = parseMoney(itemPrice);
    if (!name) { setItemError("กรุณาใส่ชื่อรายการ"); return; }
    if (price === null) { setItemError("ใส่ราคามากกว่า 0 และทศนิยมไม่เกิน 2 ตำแหน่ง"); return; }
    dispatch(editingItem ? { type: "edit-item", id: editingItem, name, price } : { type: "add-item", id: createClientId(), name, price });
    setItemName(""); setItemPrice(""); setEditingItem(null); setItemError("");
  }

  function submitPerson(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); const name = personName.trim();
    if (!name) { setPersonError("กรุณาใส่ชื่อคนร่วมบิล"); return; }
    dispatch(editingPerson ? { type: "edit-person", id: editingPerson, name } : { type: "add-person", id: createClientId(), name });
    setPersonName(""); setEditingPerson(null); setPersonError("");
  }

  function calculate() {
    try {
      calculateBill(bill); setActionMessage(""); setShowSummary(true);
      window.setTimeout(() => document.getElementById("summary")?.scrollIntoView({ behavior: "smooth" }), 0);
    } catch (error) { setActionMessage(error instanceof Error ? error.message : "ไม่สามารถคำนวณบิลได้"); }
  }

  function onQrChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (qrRef.current) URL.revokeObjectURL(qrRef.current);
    qrRef.current = null;
    setQrUrl(null);
    setQrError("");
    setActionMessage("");
    if (!QR_TYPES.includes(file.type)) { setQrError("เลือกไฟล์ PNG, JPEG หรือ WebP เท่านั้น"); event.target.value = ""; return; }
    if (file.size > MAX_QR_BYTES) { setQrError("รูป QR ต้องมีขนาดไม่เกิน 5 MB"); event.target.value = ""; return; }
    const next = URL.createObjectURL(file);
    qrRef.current = next; setQrUrl(next); setQrError("");
  }

  const result = useMemo(() => {
    if (!showSummary) return null;
    try { return calculateBill(bill); } catch { return null; }
  }, [bill, showSummary]);
  const invalidItemIds = new Set(bill.items.filter((item) => item.participantIds.length === 0).map((item) => item.id));
  const labels = participantLabels(bill.participants);
  const itemTotal = sumMoneyChecked(bill.items.map((item) => item.price));
  const shareText = result ? buildShareText(result, bill.currency, bill.promptPay) : "";
  const shareReady = sharingAvailability(bill.currency, bill.promptPay, Boolean(qrUrl));
  const imageKey = result && qrUrl ? summaryImageCacheKey(result, bill.currency, bill.promptPay, qrUrl) : null;
  const imageIsCurrent = preparedImageMatchesKey(preparedImage.key, imageKey);
  const imageStatus = imageKey === null ? "idle" : imageIsCurrent ? preparedImage.status : "preparing";
  /* eslint-disable react-hooks/set-state-in-effect -- Generate the browser-only PNG when its complete input key changes. */
  useEffect(() => {
    if (!result || !qrUrl || !imageKey) {
      setPreparedImage({ key: null, status: "idle" });
      return;
    }
    let cancelled = false;
    setPreparedImage({ key: imageKey, status: "preparing" });
    const timer = window.setTimeout(() => {
      void createSummaryImage(result, bill.currency, bill.promptPay, qrUrl).then(
        (blob) => {
          if (cancelled) return;
          const nativeShareAvailable = typeof navigator.share === "function" && typeof navigator.canShare === "function" && typeof File !== "undefined";
          const file = prepareNativeShareFile(
            blob,
            nativeShareAvailable,
            (imageBlob) => new File([imageBlob], "splitkub-summary.png", { type: "image/png" }),
            (preparedFile) => navigator.canShare({ files: [preparedFile] }),
          );
          setPreparedImage({ key: imageKey, status: "ready", blob, ...(file ? { file } : {}) });
        },
        (error: unknown) => { if (!cancelled) setPreparedImage({ key: imageKey, status: "error", error: error instanceof Error ? error.message : "สร้างรูปสรุปไม่สำเร็จ" }); },
      );
    }, 200);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [imageKey, imageRetryCount, result, qrUrl, bill.currency, bill.promptPay]);
  /* eslint-enable react-hooks/set-state-in-effect */

  async function copySummary() {
    if (!result || !shareReady.canCopy) return;
    setManualCopyText("");
    setActionMessage("");
    dismissToast();
    try {
      if (await copyTextWithFallback(shareText, document, navigator.clipboard)) {
        showSuccessToast("คัดลอกสรุปบิลและเลข PromptPay แล้ว");
        return;
      }
    } catch { /* Offer visible text when both clipboard paths are blocked. */ }
    setManualCopyText(shareText);
    setActionMessage("Browser ไม่อนุญาตให้คัดลอกอัตโนมัติ เลือกข้อความด้านล่างแล้วคัดลอกได้เลย");
  }

  async function shareSummaryImage() {
    if (imageStatus === "error") { setImageRetryCount((count) => count + 1); return; }
    if (!result || !qrUrl || !imageKey || !imageIsCurrent || !preparedImage.blob || sharingImage) return;
    if (qrRef.current !== qrUrl) return;
    const blob = preparedImage.blob;
    setSharingImage(true);
    setActionMessage("");
    try {
      if (preparedImage.file && typeof navigator.share === "function") {
        try {
          await navigator.share({ title: "Dinner 🍻", files: [preparedImage.file] });
          setActionMessage("แชร์รูปสรุปบิลแล้ว");
          return;
        } catch (error) {
          if (isShareCancelled(error)) return;
        }
      }
      let downloadUrl: string | null = null;
      let link: HTMLAnchorElement | null = null;
      try {
        downloadUrl = URL.createObjectURL(blob);
        link = document.createElement("a");
        link.href = downloadUrl;
        link.download = "splitkub-summary.png";
        document.body.appendChild(link);
        link.click();
      } finally {
        try { link?.remove(); }
        finally {
          if (downloadUrl) {
            try { window.setTimeout(() => URL.revokeObjectURL(downloadUrl!), 30_000); }
            catch { URL.revokeObjectURL(downloadUrl); }
          }
        }
      }
      setActionMessage("ดาวน์โหลดรูปสรุปบิลแล้ว ส่งไฟล์นี้ให้เพื่อนได้เลย");
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : "แชร์รูปสรุปไม่สำเร็จ กรุณาลองอีกครั้ง");
    } finally {
      setSharingImage(false);
    }
  }

  if (!ready) return <main className="shell py-16"><p className="muted">กำลังเปิดบิล…</p></main>;

  return <main>
    <header className="border-b border-[#e9e4f7] bg-white/80"><div className="shell flex min-h-18 items-center justify-between py-4"><a href="#top" className="inline-flex min-h-11 items-center gap-2 text-xl font-black tracking-tight text-[#5331aa]"><Image src="/brand/splitkub-icon.png" width={44} height={44} alt="" className="h-11 w-11 shrink-0 object-contain" priority/>SplitKub</a><span className="rounded-full bg-[#f1ecff] px-3 py-2 text-xs font-bold text-[#6040ac]">ฟรี · ไม่ต้องสมัครสมาชิก</span></div></header>
    {!started ? <section id="top" className="shell flex min-h-[75vh] flex-col items-center justify-center py-12 text-center"><div className="mb-5 flex h-64 w-64 items-center justify-center rounded-[2rem] bg-white shadow-sm sm:h-72 sm:w-72"><Image src="/brand/splitkub-mascot.png" width={288} height={288} alt="มาสคอตพนักงาน SplitKub ยิ้มต้อนรับ" className="h-full w-full object-contain" priority/></div><p className="eyebrow">Split smarter, smile more</p><h1 className="mt-4 max-w-2xl text-4xl leading-tight font-black tracking-tight sm:text-6xl">หารบิลกันง่ายๆ<br/><span className="text-[#7350d1]">จบในที่เดียว</span></h1><p className="muted mt-6 max-w-lg text-lg leading-8">เพิ่มรายการ เลือกคนที่ร่วมจ่าย แล้วเราคำนวณให้เอง พร้อมแชร์ยอดให้เพื่อนในไม่กี่นาที</p><button className="btn-primary mt-9 px-8 text-lg" onClick={() => setStarted(true)}>เริ่มหารบิล →</button><p className="muted mt-5 text-sm">ไม่ต้องล็อกอิน · ข้อมูลอยู่ใน browser ของคุณ</p></section> : <div id="top" className="shell pb-20">
      <div className="flex flex-wrap items-center justify-between gap-4 py-8"><div><p className="eyebrow">Your bill</p><h1 className="mt-1 text-3xl font-black tracking-tight">บิลของเรา ✨</h1><p className="muted mt-1 text-sm">กรอกข้อมูลตามลำดับ แล้วกดคำนวณได้เลย</p></div><button className="btn-danger" onClick={clearBill}>เริ่มบิลใหม่</button></div>
      <nav aria-label="ขั้นตอนการหารบิล" className="mb-6 flex gap-2 overflow-x-auto pb-2 text-sm"><a className="chip whitespace-nowrap" href="#items">1 รายการ</a><a className="chip whitespace-nowrap" href="#people">2 คนร่วมบิล</a><a className="chip whitespace-nowrap" href="#split">3 เลือกคนหาร</a><a className="chip whitespace-nowrap" href="#summary">4 สรุป</a></nav>

      <div className="grid gap-6 lg:grid-cols-[1.1fr_.9fr]">
        <section id="items" className="card scroll-mt-5 p-5 sm:p-7"><SectionHeading number="1" title="รายการในบิล" hint="เพิ่มอาหาร เครื่องดื่ม หรือค่าใช้จ่ายอื่นๆ"/>
          <div className="mb-5 flex items-center gap-3"><label htmlFor="currency" className="text-sm font-bold">สกุลเงิน</label><select id="currency" className="field max-w-40" value={bill.currency} disabled={bill.items.length > 0} onChange={(e) => dispatch({ type: "currency", currency: e.target.value as Currency })}><option value="THB">THB · บาท</option><option value="USD">USD · ดอลลาร์</option></select></div>
          {bill.items.length > 0 && <p className="muted -mt-3 mb-5 text-xs">ลบรายการทั้งหมดก่อนเปลี่ยนสกุลเงิน</p>}
          <form onSubmit={submitItem} noValidate className="grid gap-3 sm:grid-cols-[1fr_130px_auto]"><div><label className="mb-1 block text-sm font-bold" htmlFor="item-name">ชื่อรายการ</label><input id="item-name" className="field" placeholder="เช่น หมูกระทะ" value={itemName} onChange={(e) => { setItemName(e.target.value); setItemError(""); }}/></div><div><label className="mb-1 block text-sm font-bold" htmlFor="item-price">ราคา ({bill.currency})</label><input id="item-price" className="field" type="text" inputMode="decimal" placeholder="0.00" value={itemPrice} onChange={(e) => { setItemPrice(e.target.value); setItemError(""); }}/></div><div className="flex items-end gap-2"><button className="btn-primary w-full sm:w-auto" type="submit">{editingItem ? "บันทึก" : "+ เพิ่ม"}</button>{editingItem && <button className="btn-secondary" type="button" onClick={() => { setEditingItem(null); setItemName(""); setItemPrice(""); setItemError(""); }}>ยกเลิก</button>}</div></form>
          {itemError && <p role="alert" className="error mt-2">{itemError}</p>}
          {bill.items.length === 0 ? <p className="muted mt-6 rounded-xl bg-[#f8f6fd] p-5 text-center text-sm">ยังไม่มีรายการ เริ่มจากของที่สั่งเลย 🍽️</p> : <ul className="mt-6 divide-y divide-[#eeeaf6]">{bill.items.map((item) => <li key={item.id} className="flex items-center justify-between gap-3 py-3"><div className="min-w-0"><p className="truncate font-bold">{item.name}</p><p className="text-sm text-[#7152bc]">{formatMoney(item.price, bill.currency)}</p></div><div className="flex shrink-0 gap-2"><button className="btn-secondary !px-3 text-sm" aria-label={`แก้ไข ${item.name}`} onClick={() => { setEditingItem(item.id); setItemName(item.name); setItemPrice(moneyInput(item.price)); setItemError(""); document.getElementById("item-name")?.focus(); }}>แก้ไข</button><button className="btn-danger" aria-label={`ลบ ${item.name}`} onClick={() => { dispatch({ type: "remove-item", id: item.id }); if (editingItem === item.id) { setEditingItem(null); setItemName(""); setItemPrice(""); } }}>ลบ</button></div></li>)}</ul>}
        </section>
        <section id="people" className="card scroll-mt-5 p-5 sm:p-7"><SectionHeading number="2" title="คนร่วมบิล" hint="เพิ่มชื่อทุกคนในโต๊ะ ชื่อซ้ำกันได้"/>
          <form onSubmit={submitPerson} noValidate className="flex flex-col gap-3 sm:flex-row sm:items-end"><div className="flex-1"><label className="mb-1 block text-sm font-bold" htmlFor="person-name">ชื่อคน</label><input id="person-name" className="field" placeholder="เช่น Boss" value={personName} onChange={(e) => { setPersonName(e.target.value); setPersonError(""); }}/></div><div className="flex gap-2"><button className="btn-primary flex-1" type="submit">{editingPerson ? "บันทึก" : "+ เพิ่มคน"}</button>{editingPerson && <button className="btn-secondary" type="button" onClick={() => { setEditingPerson(null); setPersonName(""); setPersonError(""); }}>ยกเลิก</button>}</div></form>
          {personError && <p role="alert" className="error mt-2">{personError}</p>}
          {bill.participants.length === 0 ? <p className="muted mt-6 rounded-xl bg-[#f8f6fd] p-5 text-center text-sm">เพิ่มเพื่อนที่ร่วมจ่ายในบิลนี้ 👋</p> : <ul className="mt-6 divide-y divide-[#eeeaf6]">{bill.participants.map((person, index) => <li key={person.id} className="flex items-center justify-between gap-3 py-3"><div className="flex min-w-0 items-center gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#eae3ff] font-bold text-[#5d3eb0]">{index + 1}</span><span className="truncate font-bold">{labels.get(person.id)}</span></div><div className="flex shrink-0 gap-2"><button className="btn-secondary !px-3 text-sm" aria-label={`แก้ไขชื่อ ${labels.get(person.id)}`} onClick={() => { setEditingPerson(person.id); setPersonName(person.name); setPersonError(""); document.getElementById("person-name")?.focus(); }}>แก้ไข</button><button className="btn-danger" aria-label={`ลบคน ${labels.get(person.id)}`} onClick={() => { dispatch({ type: "remove-person", id: person.id }); if (editingPerson === person.id) { setEditingPerson(null); setPersonName(""); } }}>ลบ</button></div></li>)}</ul>}
          <p className="muted mt-5 text-xs">คนที่เพิ่มใหม่จะยังไม่ถูกรวมในรายการเดิม เลือกเพิ่มได้ในขั้นตอนถัดไป</p>
        </section>
      </div>

      <section id="split" className="card mt-6 scroll-mt-5 p-5 sm:p-7"><SectionHeading number="3" title="ใครร่วมจ่ายรายการไหน?" hint="รายการใหม่จะเลือกทุกคนที่มีอยู่ในบิลโดยอัตโนมัติ"/>
        {bill.items.length === 0 || bill.participants.length === 0 ? <p className="muted rounded-xl bg-[#f8f6fd] p-5 text-sm">เพิ่มรายการและคนร่วมบิลก่อน แล้วเลือกคนหารแต่ละรายการที่นี่</p> : <>
          <div className="space-y-4 lg:hidden">{bill.items.map((item) => <div key={item.id} className="min-w-0 rounded-2xl border border-[#e8e3f2] p-4"><div className="flex min-w-0 justify-between gap-3"><h3 className="split-item-name font-bold">{item.name}</h3><span className="shrink-0 font-bold text-[#6040b4]">{formatMoney(item.price, bill.currency)}</span></div><p className="muted mt-3 text-sm">ใครร่วมจ่าย?</p><div className="mt-2 flex flex-wrap gap-2">{bill.participants.map((person) => <button type="button" key={person.id} className="chip split-chip" data-selected={item.participantIds.includes(person.id)} aria-pressed={item.participantIds.includes(person.id)} onClick={() => dispatch({ type: "toggle", itemId: item.id, participantId: person.id })}>{item.participantIds.includes(person.id) ? "✓ " : ""}{labels.get(person.id)}</button>)}</div><div className="mt-2 flex flex-wrap gap-1 text-sm"><button className="split-action rounded-lg text-[#6040b4]" onClick={() => dispatch({ type: "select-item", itemId: item.id, selected: true })}>เลือกทุกคน</button><button className="split-action rounded-lg text-[#817396]" onClick={() => dispatch({ type: "select-item", itemId: item.id, selected: false })}>ล้างทั้งหมด</button></div>{invalidItemIds.has(item.id) && <p role="alert" className="error mt-3">เลือกอย่างน้อย 1 คนสำหรับรายการนี้</p>}</div>)}</div>
          <div className="hidden overflow-x-auto lg:block"><table className="matrix"><thead><tr><th scope="col">รายการ</th><th scope="col">ราคา</th>{bill.participants.map((person) => <th scope="col" key={person.id}>{labels.get(person.id)}</th>)}<th scope="col">เลือก</th></tr></thead><tbody>{bill.items.map((item) => <tr key={item.id}><th scope="row"><span className="split-item-name">{item.name}</span>{invalidItemIds.has(item.id) && <span className="error block font-normal">เลือกอย่างน้อย 1 คน</span>}</th><td>{formatMoney(item.price, bill.currency)}</td>{bill.participants.map((person) => <td key={person.id}><label className="matrix-checkbox-target"><input type="checkbox" className="h-5 w-5 accent-[#6745c6]" checked={item.participantIds.includes(person.id)} aria-label={`${labels.get(person.id)} ร่วมจ่าย ${item.name}`} onChange={() => dispatch({ type: "toggle", itemId: item.id, participantId: person.id })}/></label></td>)}<td><div className="flex flex-col gap-1 text-xs"><button className="split-action rounded-lg text-[#6040b4]" onClick={() => dispatch({ type: "select-item", itemId: item.id, selected: true })}>ทุกคน</button><button className="split-action rounded-lg text-[#817396]" onClick={() => dispatch({ type: "select-item", itemId: item.id, selected: false })}>ล้าง</button></div></td></tr>)}</tbody></table></div>
        </>}
        <div className="mt-6 flex flex-wrap items-center gap-3"><button className="btn-primary" onClick={calculate}>คำนวณบิล →</button>{itemTotal === null ? <p role="alert" aria-live="polite" className="error text-sm">ยอดรวมรายการสูงเกินขอบเขตที่รองรับ กรุณาแก้ไขหรือลบบางรายการก่อนคำนวณ</p> : <p className="muted text-sm">ยอดรวมรายการ: <strong className="text-[#342750]">{formatMoney(itemTotal, bill.currency)}</strong></p>}</div>
        {actionMessage && !showSummary && <p role="status" className="error mt-3">{actionMessage}</p>}
      </section>

      <section id="summary" className="scroll-mt-5 mt-6">{result ? <div className="grid gap-6 lg:grid-cols-[1.1fr_.9fr]">
        <div className="card p-5 sm:p-7"><SectionHeading number="4" title="สรุปบิล" hint="กดชื่อเพื่อดูว่าแต่ละคนจ่ายอะไรบ้าง"/><div className="mb-5 rounded-2xl bg-[#6040b4] p-6 text-white"><p className="text-sm text-[#e6dbff]">ยอดรวมทั้งหมด</p><p className="mt-1 text-4xl font-black tracking-tight">{formatMoney(result.total, bill.currency)}</p></div><div className="divide-y divide-[#eeeaf6]">{result.people.map((person) => <details key={person.participantId} className="group py-3"><summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-lg py-2"><span className="font-bold">{labels.get(person.participantId)} <span className="muted ml-1 text-xs">⌄</span></span><strong className="text-lg text-[#5331aa]">{formatMoney(person.total, bill.currency)}</strong></summary><ul className="mt-2 space-y-2 rounded-xl bg-[#f8f6fd] p-4 text-sm">{person.breakdown.length ? person.breakdown.map((row) => <li key={row.itemId} className="flex justify-between gap-3"><span>{row.itemName}</span><span>{formatMoney(row.amount, bill.currency)}</span></li>) : <li className="muted">ไม่ได้ร่วมจ่ายรายการใด</li>}</ul></details>)}</div></div>
        <div className="card p-5 sm:p-7"><p className="eyebrow">Payment</p><h2 className="section-title mt-2">ช่องทางรับเงิน 💸</h2><p className="muted mt-2 text-sm">ใส่ช่องทางรับเงินก่อนคัดลอกหรือแชร์สรุป</p>{bill.currency === "THB" && <div className="mt-6"><label htmlFor="promptpay" className="mb-1 block text-sm font-bold">เลข PromptPay</label><input id="promptpay" className="field" inputMode="numeric" placeholder="เบอร์มือถือหรือเลขบัตรประชาชน" value={bill.promptPay} onChange={(e) => { rawDispatch({ type: "promptpay", value: e.target.value }); setActionMessage(""); setManualCopyText(""); }}/><p className="muted mt-2 text-xs">รองรับเบอร์มือถือไทย 10 หลัก หรือเลขบัตรประชาชน 13 หลัก</p>{bill.promptPay && (isValidPromptPay(bill.promptPay) ? <p className="success mt-2">พร้อมให้เพื่อนโอน: <strong>{bill.promptPay}</strong></p> : <p role="alert" className="error mt-2">เลข PromptPay ไม่ถูกต้อง</p>)}</div>}
          <div className="mt-6"><label htmlFor="qr-file" className="mb-1 block text-sm font-bold">อัปโหลดรูป QR ของคุณ</label><input ref={fileRef} id="qr-file" type="file" accept="image/png,image/jpeg,image/webp" className="field !h-auto text-sm" onChange={onQrChange}/><p className="muted mt-2 text-xs">PNG, JPEG หรือ WebP · สูงสุด 5 MB · รูปจะหายเมื่อรีเฟรช</p>{qrError && <p role="alert" className="error mt-2">{qrError}</p>}{qrUrl && <div className="mt-4 rounded-xl border border-[#e8e3f2] p-3"><Image unoptimized src={qrUrl} width={288} height={288} alt="QR สำหรับรับเงินที่อัปโหลด" className="mx-auto max-h-72 max-w-full object-contain"/><button className="btn-danger mt-3 w-full" onClick={clearQr}>ลบรูป QR</button></div>}</div>
          <div className="mt-7 border-t border-[#eeeaf6] pt-6"><h3 className="font-bold">ส่งสรุปให้เพื่อน</h3><div className="mt-3 grid gap-3"><button className="btn-primary w-full" onClick={copySummary} disabled={!shareReady.canCopy} aria-describedby="copy-hint">คัดลอกข้อความ</button><p id="copy-hint" className="muted text-xs">{bill.currency === "USD" ? "USD ใช้รูปสรุปพร้อม QR สำหรับส่งช่องทางชำระเงิน" : shareReady.canCopy ? "รวมยอดทั้งหมด ยอดรายคน และเลข PromptPay ที่คัดลอกได้" : "กรอกเลข PromptPay ที่ถูกต้องก่อนคัดลอกข้อความ"}</p><button className="btn-secondary w-full" onClick={shareSummaryImage} disabled={!shareReady.canShareImage || imageStatus === "preparing" || sharingImage} aria-describedby="image-hint image-status">{sharingImage ? "กำลังแชร์รูป…" : imageStatus === "preparing" ? "กำลังเตรียมรูป…" : imageStatus === "error" ? "ลองเตรียมรูปอีกครั้ง" : imageIsCurrent && preparedImage.file ? "แชร์รูปสรุป" : "ดาวน์โหลดรูปสรุป"}</button><p id="image-hint" className="muted text-xs">{shareReady.canShareImage ? "รูป PNG มี QR ยอดรวม และยอดรายคน" : "อัปโหลดรูป QR ก่อนแชร์หรือดาวน์โหลดรูปสรุป"}</p><p id="image-status" role="status" aria-live="polite" aria-atomic="true" className={imageStatus === "error" ? "error text-xs" : "muted text-xs"}>{imageStatus === "preparing" ? "กำลังเตรียมภาพสรุปจากข้อมูลบิลและ QR ปัจจุบัน" : imageStatus === "ready" ? (imageIsCurrent && preparedImage.file ? "PNG นี้รองรับการแชร์จาก browser นี้" : "รูปสรุปพร้อมดาวน์โหลด") : imageStatus === "error" ? preparedImage.error ?? "สร้างรูปไม่สำเร็จ กรุณาลองอีกครั้ง" : ""}</p></div>
            {actionMessage && <p role="status" className={manualCopyText || actionMessage.includes("ไม่") ? "error mt-3" : "success mt-3"}>{actionMessage}</p>}
            {manualCopyText && <div className="mt-3"><label htmlFor="manual-copy" className="mb-2 block text-sm font-bold">ข้อความสำหรับคัดลอกด้วยตนเอง</label><textarea id="manual-copy" ref={manualCopyRef} readOnly value={manualCopyText} rows={Math.min(16, result.people.length + 7)} onFocus={(event) => event.currentTarget.select()} className="field !h-auto resize-y text-sm"/><button className="btn-secondary mt-2 w-full" onClick={() => manualCopyRef.current?.select()}>เลือกข้อความทั้งหมด</button></div>}
          </div>
        </div>
      </div> : <div className="card p-6 text-center sm:p-9"><span className="text-3xl">🧾</span><h2 className="section-title mt-2">สรุปบิลจะอยู่ตรงนี้</h2><p className="muted mt-2 text-sm">เพิ่มรายการและคนร่วมบิล แล้วกดคำนวณเพื่อดูยอดแต่ละคน</p></div>}</section>
    </div>}
    <footer className="border-t border-[#e9e4f7] py-8 text-center text-sm text-[#817b8e]">SplitKub · หารบิลแล้วไปสนุกต่อ ✦</footer>
    <SuccessToast toast={successToast} onDismiss={dismissToast}/>
  </main>;
}
