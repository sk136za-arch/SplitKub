"use client";

import { useEffect } from "react";

export type ToastMessage = { id: number; text: string };

export function scheduleToastDismiss(onDismiss: () => void, delay = 3000): () => void {
  const timer = window.setTimeout(onDismiss, delay);
  return () => window.clearTimeout(timer);
}

export function SuccessToast({ toast, onDismiss }: { toast: ToastMessage | null; onDismiss: () => void }) {
  useEffect(() => {
    if (!toast) return;
    return scheduleToastDismiss(onDismiss);
  }, [toast, onDismiss]);

  if (!toast) return null;

  return <div className="toast-position pointer-events-none fixed z-50" role="status" aria-live="polite" aria-atomic="true">
    <div className="pointer-events-auto flex items-center gap-3 rounded-2xl border border-[#bce4cd] bg-white px-4 py-3 text-[#24583b] shadow-[0_12px_35px_rgba(32,64,52,.18)]">
      <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#e0f6e8] text-lg font-bold">✓</span>
      <span className="min-w-0 flex-1 text-sm font-bold">{toast.text}</span>
      <button type="button" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-xl hover:bg-[#e8f6ed]" aria-label="ปิดข้อความแจ้งเตือน" onClick={onDismiss}>×</button>
    </div>
  </div>;
}
