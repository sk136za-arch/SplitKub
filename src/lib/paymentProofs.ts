export interface LocalPaymentProof {
  name: string;
  dataUrl: string;
  savedAt: string;
}

function key(billId: string) { return `splitkub:payment-proofs:v1:${billId}`; }

export function loadPaymentProof(storage: Pick<Storage, "getItem">, billId: string, transferKey: string): LocalPaymentProof | null {
  try {
    const saved = JSON.parse(storage.getItem(key(billId)) ?? "{}") as Record<string, unknown>;
    const proof = saved[transferKey];
    if (!proof || typeof proof !== "object") return null;
    const value = proof as LocalPaymentProof;
    return typeof value.name === "string" && typeof value.dataUrl === "string" && typeof value.savedAt === "string" ? value : null;
  } catch { return null; }
}

export function savePaymentProof(storage: Pick<Storage, "getItem" | "setItem">, billId: string, transferKey: string, proof: LocalPaymentProof) {
  let saved: Record<string, LocalPaymentProof> = {};
  try { saved = JSON.parse(storage.getItem(key(billId)) ?? "{}") as Record<string, LocalPaymentProof>; } catch { /* Start with a clean local store. */ }
  storage.setItem(key(billId), JSON.stringify({ ...saved, [transferKey]: proof }));
}

export function readLocalImage(file: File): Promise<LocalPaymentProof> {
  if (!file.type.startsWith("image/")) return Promise.reject(new Error("เลือกไฟล์รูปภาพของสลิปเท่านั้น"));
  if (file.size > 1_500_000) return Promise.reject(new Error("สลิปต้องมีขนาดไม่เกิน 1.5 MB"));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("อ่านไฟล์สลิปไม่สำเร็จ"));
    reader.onload = () => typeof reader.result === "string"
      ? resolve({ name: file.name, dataUrl: reader.result, savedAt: new Date().toISOString() })
      : reject(new Error("อ่านไฟล์สลิปไม่สำเร็จ"));
    reader.readAsDataURL(file);
  });
}
