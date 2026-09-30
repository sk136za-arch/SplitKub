# SplitKub

เว็บหารค่าใช้จ่ายระหว่างเพื่อนแบบ client-side เพิ่มรายการ เลือกคนร่วมจ่าย แล้วแชร์ยอดได้โดยไม่ต้องสมัครสมาชิก

## Run locally

Requires Node.js 20.9 or newer.

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

```bash
npm run lint
npm run test
npm run build
```

## MVP behavior

- เลือก THB หรือ USD ก่อนเพิ่มรายการ; หนึ่งบิลใช้หนึ่งสกุลเงิน
- เก็บจำนวนเงินเป็น satang หรือ cent จำนวนเต็ม และแจกเศษตามลำดับคนในบิล
- ข้อมูลบิลและ PromptPay เก็บใน `localStorage` ของ browser; รูป QR อยู่เฉพาะใน memory ของหน้าและหายเมื่อ refresh
- PromptPay ใช้ได้กับบิล THB เท่านั้น; การแชร์ใช้ Web Share API หรือคัดลอกข้อความเมื่อไม่รองรับ
- ไม่มีบัญชีผู้ใช้, backend หรืออัตราแลกเปลี่ยน
