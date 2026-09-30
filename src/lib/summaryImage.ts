import type { BillResult } from "./calculateBill";
import { formatMoney } from "./money";
import { participantLabels } from "./participantLabels";
import { isValidPromptPay } from "./promptpay";
import { normalizedPromptPay, SHARE_TITLE } from "./share";
import type { Currency } from "../types/bill";

const WIDTH = 1080;
const ROW_HEIGHT = 106;
const ROW_START = 520;
const MAX_HEIGHT = 16384;
const MASCOT_URL = "/brand/splitkub-mascot.png";

export function summaryImageHeight(participantCount: number): number {
  const height = ROW_START + participantCount * ROW_HEIGHT + 590;
  if (height > MAX_HEIGHT) throw new Error("มีผู้ร่วมบิลมากเกินไปสำหรับรูปเดียว");
  return height;
}

/** Stable identity for every value rendered into the summary image. */
export function summaryImageCacheKey(result: BillResult, currency: Currency, promptPay: string, qrUrl: string): string {
  return JSON.stringify([
    currency,
    promptPay,
    qrUrl,
    result.total,
    result.people.map(({ participantId, name, total }) => [participantId, name, total]),
  ]);
}

export function preparedImageMatchesKey(preparedKey: string | null, currentKey: string | null): boolean {
  return currentKey !== null && preparedKey === currentKey;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function wrappedLines(ctx: CanvasRenderingContext2D, value: string, maxWidth: number): string[] {
  const characters = Array.from(value);
  const lines: string[] = [];
  let line = "";
  for (const character of characters) {
    if (ctx.measureText(line + character).width > maxWidth && line) {
      lines.push(line);
      line = character;
      if (lines.length === 2) break;
    } else {
      line += character;
    }
  }
  if (lines.length < 2 && line) lines.push(line);
  if (lines.length === 0) lines.push("—");
  if (lines.length === 2 && lines.join("").length < characters.length) {
    while (ctx.measureText(lines[1] + "…").width > maxWidth && lines[1]) lines[1] = lines[1].slice(0, -1);
    lines[1] += "…";
  }
  return lines;
}

function loadQr(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("อ่านรูป QR ไม่สำเร็จ กรุณาอัปโหลดใหม่"));
    image.src = url;
  });
}

function loadMascot(): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image.naturalWidth && image.naturalHeight ? image : null);
    image.onerror = () => resolve(null);
    image.src = MASCOT_URL;
  });
}

export async function createSummaryImage(result: BillResult, currency: Currency, promptPay: string, qrUrl: string): Promise<Blob> {
  const [qr, mascot] = await Promise.all([loadQr(qrUrl), loadMascot()]);
  if (!qr.naturalWidth || !qr.naturalHeight) throw new Error("รูป QR ไม่ถูกต้อง กรุณาอัปโหลดใหม่");

  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = summaryImageHeight(result.people.length);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Browser นี้ไม่สามารถสร้างรูปสรุปได้");
  const labels = participantLabels(result.people.map((person) => ({ id: person.participantId, name: person.name })));

  ctx.fillStyle = "#f7f5ff";
  ctx.fillRect(0, 0, WIDTH, canvas.height);
  ctx.fillStyle = "#6241b6";
  ctx.beginPath();
  ctx.arc(1000, -40, 280, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ded6fb";
  ctx.beginPath();
  ctx.arc(-70, 480, 180, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#5331aa";
  ctx.font = "bold 32px Arial, sans-serif";
  if (mascot) {
    ctx.fillStyle = "#ffffff";
    roundRect(ctx, 72, 35, 96, 96, 24);
    ctx.fill();
    ctx.drawImage(mascot, mascot.naturalWidth * .29, mascot.naturalHeight * .02, mascot.naturalWidth * .42, mascot.naturalHeight * .42, 72, 35, 96, 96);
    ctx.fillStyle = "#5331aa";
    ctx.fillText("SplitKub", 187, 105);
  } else {
    ctx.fillText("✦ SplitKub", 72, 105);
  }
  ctx.fillStyle = "#25213b";
  ctx.font = "bold 60px Arial, sans-serif";
  ctx.fillText(SHARE_TITLE, 72, 185);
  ctx.fillStyle = "#726d82";
  ctx.font = "28px Arial, sans-serif";
  ctx.fillText("สรุปบิลและช่องทางรับเงิน", 72, 230);

  ctx.fillStyle = "#6241b6";
  roundRect(ctx, 72, 270, 936, 172, 30);
  ctx.fill();
  ctx.fillStyle = "#e9ddff";
  ctx.font = "28px Arial, sans-serif";
  ctx.fillText("ยอดรวมทั้งหมด · " + currency, 112, 325);
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 66px Arial, sans-serif";
  ctx.fillText(formatMoney(result.total, currency), 112, 405);

  ctx.fillStyle = "#25213b";
  ctx.font = "bold 32px Arial, sans-serif";
  ctx.fillText("ยอดที่แต่ละคนต้องโอน", 72, 492);

  result.people.forEach((person, index) => {
    const y = ROW_START + index * ROW_HEIGHT;
    ctx.fillStyle = "#ffffff";
    roundRect(ctx, 72, y, 936, 94, 20);
    ctx.fill();
    ctx.fillStyle = "#eee8ff";
    roundRect(ctx, 92, y + 19, 58, 58, 18);
    ctx.fill();
    ctx.fillStyle = "#5331aa";
    ctx.textAlign = "center";
    ctx.font = "bold 25px Arial, sans-serif";
    ctx.fillText(String(index + 1), 121, y + 57);
    ctx.textAlign = "left";
    ctx.fillStyle = "#25213b";
    ctx.font = "bold 26px Arial, sans-serif";
    const lines = wrappedLines(ctx, labels.get(person.participantId) ?? person.name, 475);
    lines.forEach((line, lineIndex) => ctx.fillText(line, 170, y + (lines.length === 1 ? 56 : 40) + lineIndex * 32));
    ctx.fillStyle = "#5331aa";
    ctx.textAlign = "right";
    ctx.font = "bold 29px Arial, sans-serif";
    ctx.fillText(formatMoney(person.total, currency), 984, y + 58);
    ctx.textAlign = "left";
  });

  const paymentY = ROW_START + result.people.length * ROW_HEIGHT + 30;
  ctx.fillStyle = "#25213b";
  ctx.font = "bold 32px Arial, sans-serif";
  ctx.fillText("ช่องทางรับเงิน", 72, paymentY + 3);
  ctx.fillStyle = "#ffffff";
  roundRect(ctx, 72, paymentY + 30, 936, 405, 28);
  ctx.fill();
  ctx.fillStyle = "#5331aa";
  ctx.font = "bold 30px Arial, sans-serif";
  ctx.fillText(currency === "THB" ? "สแกนเพื่อโอนเงิน" : "Pay with QR", 112, paymentY + 100);
  ctx.fillStyle = "#726d82";
  ctx.font = "25px Arial, sans-serif";
  ctx.fillText("QR สำหรับชำระบิลนี้", 112, paymentY + 146);
  if (currency === "THB" && isValidPromptPay(promptPay)) {
    ctx.fillStyle = "#5331aa";
    ctx.font = "bold 23px Arial, sans-serif";
    ctx.fillText("PromptPay", 112, paymentY + 235);
    ctx.fillStyle = "#25213b";
    ctx.font = "bold 30px Arial, sans-serif";
    ctx.fillText(normalizedPromptPay(promptPay), 112, paymentY + 280);
  }

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(656, paymentY + 70, 310, 310);
  const qrScale = Math.min(286 / qr.naturalWidth, 286 / qr.naturalHeight);
  const qrWidth = qr.naturalWidth * qrScale;
  const qrHeight = qr.naturalHeight * qrScale;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(qr, 811 - qrWidth / 2, paymentY + 225 - qrHeight / 2, qrWidth, qrHeight);

  ctx.fillStyle = "#817b8e";
  ctx.font = "22px Arial, sans-serif";
  ctx.fillText("SplitKub · หารบิลแล้วไปสนุกต่อ", 72, canvas.height - 65);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("สร้างไฟล์รูปไม่สำเร็จ")), "image/png");
  });
}
