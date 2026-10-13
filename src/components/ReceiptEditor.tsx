"use client";

import { useMemo, useState } from "react";
import { localize, type AppLanguage } from "../lib/language";
import { domainErrorMessage } from "../lib/domainErrorMessage";
import { formatMoney, moneyInput, parseMoney } from "../lib/money";
import { participantLabels } from "../lib/participantLabels";
import { defaultReceiptAdjustments } from "../lib/receiptAdjustments";
import { previewReceiptAdjustments } from "../lib/receiptAdjustmentValidation";
import type { Currency, Participant, Receipt, ReceiptAdjustments, SplitSession } from "../types/bill";
import { useLanguage } from "./LanguageProvider";

export type ReceiptView = Receipt;

const englishFormErrors: Record<string, string> = {
  "กรุณาตั้งชื่อใบเสร็จ": "Enter a receipt name",
  "กรุณาใส่ชื่อรายการ": "Enter an item name",
  "ใส่ราคามากกว่า 0 และทศนิยมไม่เกิน 2 ตำแหน่ง": "Enter a price above 0 with no more than 2 decimal places",
  "กรอกอัตรา 0.01–100% และส่วนลดที่เปิดใช้งานต้องมากกว่า 0": "Enter rates from 0.01–100%; enabled discounts must be above 0",
};

function localizedError(language: AppLanguage, error: string): string {
  return language === "en" ? englishFormErrors[error] ?? domainErrorMessage(error, language) : error;
}

function parseNonnegativeMoney(value: string): number | null {
  const normalized = value.trim();
  if (normalized.length > 32 || !/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const [whole, fraction = ""] = normalized.split(".");
  const result = BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, "0"));
  return result <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(result) : null;
}

function readAdjustments(form: HTMLFormElement): ReceiptAdjustments | null {
  const data = new FormData(form);
  const vatRateBps = parseMoney(String(data.get("vatRate") ?? ""));
  const serviceChargeRateBps = parseMoney(String(data.get("serviceRate") ?? ""));
  const preDiscount = parseNonnegativeMoney(String(data.get("preDiscount") ?? ""));
  const postDiscount = parseNonnegativeMoney(String(data.get("postDiscount") ?? ""));
  if (!vatRateBps || vatRateBps > 10000 || !serviceChargeRateBps || serviceChargeRateBps > 10000
    || preDiscount === null || postDiscount === null) return null;
  const adjustments = {
    vatEnabled: data.has("vatEnabled"), vatRateBps,
    serviceChargeEnabled: data.has("serviceChargeEnabled"), serviceChargeRateBps,
    preDiscountEnabled: data.has("preDiscountEnabled"), preDiscount,
    postDiscountEnabled: data.has("postDiscountEnabled"), postDiscount,
  };
  if ((adjustments.preDiscountEnabled && preDiscount === 0) || (adjustments.postDiscountEnabled && postDiscount === 0)) return null;
  return adjustments;
}

interface ReceiptEditorProps {
  receipt: ReceiptView;
  session: SplitSession;
  participants: Participant[];
  currency: Currency;
  disabled?: boolean;
  onRename: (title: string) => Promise<boolean>;
  onRemove: () => void;
  onSetPayer: (participantId: string) => void;
  onSetAdjustments: (adjustments: ReceiptAdjustments) => Promise<boolean>;
  onAddItem: (name: string, price: number) => Promise<boolean>;
  onEditItem: (id: string, name: string, price: number) => Promise<boolean>;
  onRemoveItem: (id: string) => void;
  onToggle: (itemId: string, participantId: string) => void;
  onSelectAll: (itemId: string, selected: boolean) => void;
}

export function ReceiptEditor({ receipt, session, participants, currency, disabled = false, onRename, onRemove, onSetPayer, onSetAdjustments, onAddItem, onEditItem, onRemoveItem, onToggle, onSelectAll }: ReceiptEditorProps) {
  const { language } = useLanguage();
  const t = (thai: string, english: string) => localize(language, thai, english);
  const [title, setTitle] = useState(receipt.title);
  const [itemName, setItemName] = useState("");
  const [itemPrice, setItemPrice] = useState("");
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [adjustmentError, setAdjustmentError] = useState("");
  const [adjustmentExpanded, setAdjustmentExpanded] = useState(false);
  const [adjustmentDraft, setAdjustmentDraft] = useState<ReceiptAdjustments>(receipt.adjustments ?? defaultReceiptAdjustments());
  const labels = participantLabels(participants);
  const adjustmentPreview = useMemo(() => previewReceiptAdjustments(session, receipt.id, adjustmentDraft), [session, receipt.id, adjustmentDraft]);

  async function submitTitle(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = title.trim();
    if (!next) { setError("กรุณาตั้งชื่อใบเสร็จ"); return; }
    if (next !== receipt.title && !(await onRename(next))) return;
    setError("");
  }

  async function submitItem(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = itemName.trim();
    const price = parseMoney(itemPrice);
    if (!name) { setError("กรุณาใส่ชื่อรายการ"); return; }
    if (price === null) { setError("ใส่ราคามากกว่า 0 และทศนิยมไม่เกิน 2 ตำแหน่ง"); return; }
    const saved = editingItemId ? await onEditItem(editingItemId, name, price) : await onAddItem(name, price);
    if (!saved) return;
    setItemName(""); setItemPrice(""); setEditingItemId(null); setError("");
  }

  async function submitAdjustments(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const adjustments = readAdjustments(event.currentTarget);
    if (!adjustments) {
      setAdjustmentError("กรอกอัตรา 0.01–100% และส่วนลดที่เปิดใช้งานต้องมากกว่า 0");
      return;
    }
    const validation = previewReceiptAdjustments(session, receipt.id, adjustments);
    if (validation.error) { setAdjustmentError(validation.error); return; }
    if (await onSetAdjustments(adjustments)) setAdjustmentError("");
  }

  function updateAdjustmentDraft(form: HTMLFormElement) {
    const next = readAdjustments(form);
    if (!next) { setAdjustmentError("กรอกอัตรา 0.01–100% และส่วนลดที่เปิดใช้งานต้องมากกว่า 0"); return; }
    setAdjustmentDraft(next);
    const validation = previewReceiptAdjustments(session, receipt.id, next);
    setAdjustmentError(validation.error ?? "");
  }

  return <section className="card p-5 sm:p-7" aria-labelledby={`receipt-${receipt.id}`}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <p className="eyebrow">{t("ใบเสร็จ", "Receipt")}</p>
        <h3 id={`receipt-${receipt.id}`} className="section-title mt-1 break-words">{receipt.title}</h3>
      </div>
      <button type="button" className="btn-danger" disabled={disabled} onClick={onRemove} aria-label={`${t("ลบใบเสร็จ", "Remove receipt")} ${receipt.title}`}>{t("ลบใบเสร็จ", "Remove receipt")}</button>
    </div>

    <form onSubmit={(event) => void submitTitle(event)} className="mt-5 flex flex-wrap gap-2">
      <div className="min-w-48 flex-1"><label htmlFor={`receipt-title-${receipt.id}`} className="mb-1 block text-sm font-bold">{t("ชื่อใบเสร็จ", "Receipt name")}</label><input id={`receipt-title-${receipt.id}`} className="field" value={title} onChange={(event) => { setTitle(event.target.value); setError(""); }} disabled={disabled}/></div>
      <button type="submit" className="btn-secondary self-end" disabled={disabled || title.trim() === receipt.title}>{t("บันทึกชื่อ", "Save name")}</button>
    </form>
    <div className="mt-4"><label htmlFor={`receipt-payer-${receipt.id}`} className="mb-1 block text-sm font-bold">{t("คนที่จ่ายใบเสร็จนี้", "Person who paid this receipt")}</label><select id={`receipt-payer-${receipt.id}`} className="field" value={receipt.paidByParticipantId} onChange={(event) => onSetPayer(event.target.value)} disabled={disabled || participants.length === 0}><option value="">{t("เลือกคนที่ออกเงิน", "Select who paid")}</option>{participants.map((person) => <option key={person.id} value={person.id}>{labels.get(person.id)}</option>)}</select></div>

    <section className="mt-6 rounded-2xl border border-[#eeeaf6] p-4">
      <button type="button" className="flex min-h-11 w-full items-center justify-between gap-3 text-left font-bold" aria-expanded={adjustmentExpanded} aria-controls={`receipt-adjustments-${receipt.id}`} onClick={() => setAdjustmentExpanded((expanded) => !expanded)}>{t("การคำนวณเพิ่มเติม", "Additional calculations")}<span aria-hidden="true">{adjustmentExpanded ? "−" : "+"}</span></button>
      {adjustmentExpanded && <form id={`receipt-adjustments-${receipt.id}`} onChange={(event) => updateAdjustmentDraft(event.currentTarget)} onSubmit={(event) => void submitAdjustments(event)} className="mt-3" noValidate>
      <p className="muted mt-1 text-sm">{t("คำนวณแยกเฉพาะใบเสร็จนี้: ยอดรายการ → ลดก่อน → ค่าบริการ → VAT → ลดหลัง → ยอดสุทธิ", "Calculated for this receipt only: subtotal → pre-service discount → service charge → VAT → post-tax discount → total")}</p>
      {adjustmentPreview.total && <ol aria-label={t("ตัวอย่างการคำนวณใบเสร็จ", "Receipt calculation preview")} className="mt-3 grid gap-2 rounded-xl bg-[#f8f6fd] p-3 text-sm sm:grid-cols-3"><li>{t("ยอดรายการ", "Subtotal")}: {formatMoney(adjustmentPreview.total.subtotal, currency)}</li><li>− {t("ลดก่อน", "Pre-service discount")}: {formatMoney(adjustmentPreview.total.preDiscount, currency)}</li><li>+ {t("ค่าบริการ", "Service charge")}: {formatMoney(adjustmentPreview.total.serviceCharge, currency)}</li><li>+ VAT: {formatMoney(adjustmentPreview.total.vat, currency)}</li><li>− {t("ลดหลัง", "Post-tax discount")}: {formatMoney(adjustmentPreview.total.postDiscount, currency)}</li><li className="font-bold">{t("ยอดสุทธิ", "Total")}: {formatMoney(adjustmentPreview.total.total, currency)}</li></ol>}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-bold"><span className="flex items-center gap-2"><input type="checkbox" name="serviceChargeEnabled" defaultChecked={receipt.adjustments.serviceChargeEnabled} disabled={disabled}/> {t("ค่าบริการ", "Service charge")} (%)</span><input className="field mt-1" name="serviceRate" inputMode="decimal" defaultValue={moneyInput(receipt.adjustments.serviceChargeRateBps)} disabled={disabled} aria-label={`${t("อัตราค่าบริการ", "Service charge rate")} ${receipt.title}`}/></label>
        <label className="text-sm font-bold"><span className="flex items-center gap-2"><input type="checkbox" name="vatEnabled" defaultChecked={receipt.adjustments.vatEnabled} disabled={disabled}/> VAT (%)</span><input className="field mt-1" name="vatRate" inputMode="decimal" defaultValue={moneyInput(receipt.adjustments.vatRateBps)} disabled={disabled} aria-label={`${t("อัตรา VAT", "VAT rate")} ${receipt.title}`}/></label>
        <label className="text-sm font-bold"><span className="flex items-center gap-2"><input type="checkbox" name="preDiscountEnabled" defaultChecked={receipt.adjustments.preDiscountEnabled} disabled={disabled}/> {t("ส่วนลดก่อนค่าบริการ", "Pre-service discount")} ({currency})</span><input className="field mt-1" name="preDiscount" inputMode="decimal" defaultValue={moneyInput(receipt.adjustments.preDiscount)} disabled={disabled} aria-label={`${t("ส่วนลดก่อนค่าบริการ", "Pre-service discount")} ${receipt.title}`}/></label>
        <label className="text-sm font-bold"><span className="flex items-center gap-2"><input type="checkbox" name="postDiscountEnabled" defaultChecked={receipt.adjustments.postDiscountEnabled} disabled={disabled}/> {t("ส่วนลดหลังภาษี", "Post-tax discount")} ({currency})</span><input className="field mt-1" name="postDiscount" inputMode="decimal" defaultValue={moneyInput(receipt.adjustments.postDiscount)} disabled={disabled} aria-label={`${t("ส่วนลดหลังภาษี", "Post-tax discount")} ${receipt.title}`}/></label>
      </div>
      {adjustmentError && <p role="alert" className="error mt-3">{localizedError(language, adjustmentError)}</p>}
      <button type="submit" className="btn-secondary mt-4" disabled={disabled}>{t("บันทึกค่าบริการและส่วนลด", "Save charges and discounts")}</button>
    </form>}
    </section>

    <div className="mt-6 border-t border-[#eeeaf6] pt-5">
      <h4 className="font-bold">{t("รายการในใบเสร็จ", "Items on this receipt")}</h4>
      <form onSubmit={(event) => void submitItem(event)} noValidate className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_130px_auto]">
        <div><label htmlFor={`item-name-${receipt.id}`} className="mb-1 block text-sm font-bold">{t("ชื่อรายการ", "Item name")}</label><input id={`item-name-${receipt.id}`} className="field" value={itemName} onChange={(event) => { setItemName(event.target.value); setError(""); }} placeholder={t("เช่น ค่าอาหาร", "e.g. Food")} disabled={disabled}/></div>
        <div><label htmlFor={`item-price-${receipt.id}`} className="mb-1 block text-sm font-bold">{t("ราคา", "Price")} ({currency})</label><input id={`item-price-${receipt.id}`} className="field" inputMode="decimal" value={itemPrice} onChange={(event) => { setItemPrice(event.target.value); setError(""); }} placeholder="0.00" disabled={disabled}/></div>
        <div className="flex items-end gap-2"><button type="submit" className="btn-primary flex-1" disabled={disabled}>{editingItemId ? t("บันทึก", "Save") : t("+ เพิ่ม", "+ Add")}</button>{editingItemId && <button type="button" className="btn-secondary" disabled={disabled} onClick={() => { setEditingItemId(null); setItemName(""); setItemPrice(""); setError(""); }}>{t("ยกเลิก", "Cancel")}</button>}</div>
      </form>
      {error && <p role="alert" className="error mt-2">{localizedError(language, error)}</p>}
      {receipt.items.length === 0 ? <p className="muted mt-5 rounded-xl bg-[#f8f6fd] p-4 text-sm">{t("ยังไม่มีรายการในใบเสร็จนี้", "No items on this receipt yet")}</p> : <ul className="mt-4 space-y-4">{receipt.items.map((item) => <li key={item.id} className="rounded-2xl border border-[#eeeaf6] p-4">
        <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><p className="break-words font-bold">{item.name}</p><p className="text-sm text-[#7152bc]">{formatMoney(item.price, currency)}</p></div><div className="flex gap-2"><button type="button" className="btn-secondary !px-3 text-sm" disabled={disabled} onClick={() => { setEditingItemId(item.id); setItemName(item.name); setItemPrice(moneyInput(item.price)); setError(""); document.getElementById(`item-name-${receipt.id}`)?.focus(); }} aria-label={`${t("แก้ไข", "Edit")} ${item.name}`}>{t("แก้ไข", "Edit")}</button><button type="button" className="btn-danger" disabled={disabled} onClick={() => { onRemoveItem(item.id); if (editingItemId === item.id) { setEditingItemId(null); setItemName(""); setItemPrice(""); } }} aria-label={`${t("ลบ", "Remove")} ${item.name}`}>{t("ลบ", "Remove")}</button></div></div>
        <div className="mt-4 flex items-center justify-between gap-2"><p className="text-sm font-bold">{t("ใครร่วมรายการนี้", "Who shares this item?")}</p><div className="flex gap-2"><button type="button" className="split-action text-xs text-[#6040ac]" disabled={disabled || participants.length === 0} onClick={() => onSelectAll(item.id, true)}>{t("ทุกคน", "Everyone")}</button><button type="button" className="split-action text-xs text-[#6040ac]" disabled={disabled} onClick={() => onSelectAll(item.id, false)}>{t("ล้าง", "Clear")}</button></div></div>
        <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label={`${t("ผู้ร่วมรายการ", "Participants for")} ${item.name}`}>{participants.map((person) => { const selected = item.participantIds.includes(person.id); return <button key={person.id} type="button" className="chip split-chip" data-selected={selected} aria-pressed={selected} disabled={disabled} onClick={() => onToggle(item.id, person.id)}>{labels.get(person.id)}</button>; })}</div>
        {item.participantIds.length === 0 && <p role="alert" className="error mt-2">{t("เลือกรายชื่อผู้ร่วมรายการก่อนคำนวณ", "Select at least one participant before calculating")}</p>}
      </li>)}</ul>}
    </div>
  </section>;
}
