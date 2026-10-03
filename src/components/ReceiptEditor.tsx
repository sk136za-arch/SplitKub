"use client";

import { useState } from "react";
import { formatMoney, moneyInput, parseMoney } from "@/lib/money";
import { participantLabels } from "@/lib/participantLabels";
import type { BillItem, Currency, Participant } from "@/types/bill";

export interface ReceiptView {
  id: string;
  title: string;
  paidByParticipantId: string;
  items: BillItem[];
}

interface ReceiptEditorProps {
  receipt: ReceiptView;
  participants: Participant[];
  currency: Currency;
  disabled?: boolean;
  onRename: (title: string) => Promise<boolean>;
  onRemove: () => void;
  onSetPayer: (participantId: string) => void;
  onAddItem: (name: string, price: number) => Promise<boolean>;
  onEditItem: (id: string, name: string, price: number) => Promise<boolean>;
  onRemoveItem: (id: string) => void;
  onToggle: (itemId: string, participantId: string) => void;
  onSelectAll: (itemId: string, selected: boolean) => void;
}

export function ReceiptEditor({ receipt, participants, currency, disabled = false, onRename, onRemove, onSetPayer, onAddItem, onEditItem, onRemoveItem, onToggle, onSelectAll }: ReceiptEditorProps) {
  const [title, setTitle] = useState(receipt.title);
  const [itemName, setItemName] = useState("");
  const [itemPrice, setItemPrice] = useState("");
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const labels = participantLabels(participants);

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

  return <section className="card p-5 sm:p-7" aria-labelledby={`receipt-${receipt.id}`}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <p className="eyebrow">Receipt</p>
        <h3 id={`receipt-${receipt.id}`} className="section-title mt-1 break-words">{receipt.title}</h3>
      </div>
      <button type="button" className="btn-danger" disabled={disabled} onClick={onRemove} aria-label={`ลบใบเสร็จ ${receipt.title}`}>ลบใบเสร็จ</button>
    </div>

    <form onSubmit={(event) => void submitTitle(event)} className="mt-5 flex flex-wrap gap-2">
      <div className="min-w-48 flex-1"><label htmlFor={`receipt-title-${receipt.id}`} className="mb-1 block text-sm font-bold">ชื่อใบเสร็จ</label><input id={`receipt-title-${receipt.id}`} className="field" value={title} onChange={(event) => { setTitle(event.target.value); setError(""); }} disabled={disabled}/></div>
      <button type="submit" className="btn-secondary self-end" disabled={disabled || title.trim() === receipt.title}>บันทึกชื่อ</button>
    </form>
    <div className="mt-4"><label htmlFor={`receipt-payer-${receipt.id}`} className="mb-1 block text-sm font-bold">คนที่จ่ายใบเสร็จนี้</label><select id={`receipt-payer-${receipt.id}`} className="field" value={receipt.paidByParticipantId} onChange={(event) => onSetPayer(event.target.value)} disabled={disabled || participants.length === 0}><option value="">เลือกคนที่ออกเงิน</option>{participants.map((person) => <option key={person.id} value={person.id}>{labels.get(person.id)}</option>)}</select></div>

    <div className="mt-6 border-t border-[#eeeaf6] pt-5">
      <h4 className="font-bold">รายการในใบเสร็จ</h4>
      <form onSubmit={(event) => void submitItem(event)} noValidate className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_130px_auto]">
        <div><label htmlFor={`item-name-${receipt.id}`} className="mb-1 block text-sm font-bold">ชื่อรายการ</label><input id={`item-name-${receipt.id}`} className="field" value={itemName} onChange={(event) => { setItemName(event.target.value); setError(""); }} placeholder="เช่น ค่าอาหาร" disabled={disabled}/></div>
        <div><label htmlFor={`item-price-${receipt.id}`} className="mb-1 block text-sm font-bold">ราคา ({currency})</label><input id={`item-price-${receipt.id}`} className="field" inputMode="decimal" value={itemPrice} onChange={(event) => { setItemPrice(event.target.value); setError(""); }} placeholder="0.00" disabled={disabled}/></div>
        <div className="flex items-end gap-2"><button type="submit" className="btn-primary flex-1" disabled={disabled}>{editingItemId ? "บันทึก" : "+ เพิ่ม"}</button>{editingItemId && <button type="button" className="btn-secondary" disabled={disabled} onClick={() => { setEditingItemId(null); setItemName(""); setItemPrice(""); setError(""); }}>ยกเลิก</button>}</div>
      </form>
      {error && <p role="alert" className="error mt-2">{error}</p>}
      {receipt.items.length === 0 ? <p className="muted mt-5 rounded-xl bg-[#f8f6fd] p-4 text-sm">ยังไม่มีรายการในใบเสร็จนี้</p> : <ul className="mt-4 space-y-4">{receipt.items.map((item) => <li key={item.id} className="rounded-2xl border border-[#eeeaf6] p-4">
        <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><p className="break-words font-bold">{item.name}</p><p className="text-sm text-[#7152bc]">{formatMoney(item.price, currency)}</p></div><div className="flex gap-2"><button type="button" className="btn-secondary !px-3 text-sm" disabled={disabled} onClick={() => { setEditingItemId(item.id); setItemName(item.name); setItemPrice(moneyInput(item.price)); setError(""); document.getElementById(`item-name-${receipt.id}`)?.focus(); }} aria-label={`แก้ไข ${item.name}`}>แก้ไข</button><button type="button" className="btn-danger" disabled={disabled} onClick={() => { onRemoveItem(item.id); if (editingItemId === item.id) { setEditingItemId(null); setItemName(""); setItemPrice(""); } }} aria-label={`ลบ ${item.name}`}>ลบ</button></div></div>
        <div className="mt-4 flex items-center justify-between gap-2"><p className="text-sm font-bold">ใครร่วมรายการนี้</p><div className="flex gap-2"><button type="button" className="split-action text-xs text-[#6040ac]" disabled={disabled || participants.length === 0} onClick={() => onSelectAll(item.id, true)}>ทุกคน</button><button type="button" className="split-action text-xs text-[#6040ac]" disabled={disabled} onClick={() => onSelectAll(item.id, false)}>ล้าง</button></div></div>
        <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label={`ผู้ร่วมรายการ ${item.name}`}>{participants.map((person) => { const selected = item.participantIds.includes(person.id); return <button key={person.id} type="button" className="chip split-chip" data-selected={selected} aria-pressed={selected} disabled={disabled} onClick={() => onToggle(item.id, person.id)}>{labels.get(person.id)}</button>; })}</div>
        {item.participantIds.length === 0 && <p role="alert" className="error mt-2">เลือกรายชื่อผู้ร่วมรายการก่อนคำนวณ</p>}
      </li>)}</ul>}
    </div>
  </section>;
}
