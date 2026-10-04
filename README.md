# SplitKub

เว็บหารค่าใช้จ่ายระหว่างเพื่อน เพิ่มรายการ เลือกคนร่วมจ่าย แล้วแชร์ยอดได้โดยไม่ต้องสมัครสมาชิก

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
- เจ้าของเลือกวิธีชำระเงินได้: โอนตรงตามยอดสุทธิ หรือเลือกคนรวบรวมเงินแบบยอดเต็ม (ทุกคนส่งส่วนที่หารให้คนรวบรวม และคนรวบรวมคืนยอดที่คนอื่นออกให้ตามใบเสร็จโดยไม่หักกลบกัน)
- เส้นทางโอนคำนวณจากข้อมูลบิล ไม่เก็บซ้ำในฐานข้อมูล; ลบคนรวบรวมแล้วกลับเป็นโอนตรง เพื่อนเห็นเส้นทางที่เกี่ยวกับชื่อตนเอง
- ยอดชำระที่แสดงใน Summary, เส้นทางโอน, ข้อความคัดลอก และรูป PNG ใช้การปัดขึ้นถึง satang/cent ชุดเดียวกัน (เช่น ฿2,000 ÷ 3 แสดง ฿666.67) โดยคงจำนวนแถว ผู้จ่าย และผู้รับจาก ledger เดิม; รายละเอียดยอดจ่าย/หาร/สุทธิในบัญชีและข้อมูลที่เก็บไม่เปลี่ยน
- การคัดลอกสรุป THB ต้องมี PromptPay ที่ถูกต้องของผู้รับเงินจริงทุกคน; QR ที่อัปโหลดต้องระบุผู้รับจากเส้นทางโอนจริง
- ข้อมูลบิลและ PromptPay เก็บใน `localStorage` ของ browser; รูป QR อยู่เฉพาะใน memory ของหน้าและหายเมื่อ refresh
- PromptPay ใช้ได้กับบิล THB เท่านั้น; การแชร์ใช้ Web Share API หรือคัดลอกข้อความเมื่อไม่รองรับ
- การแชร์ออนไลน์เป็น optional; ถ้ายังไม่ตั้งค่า Supabase จะซ่อนการแชร์และยังใช้บิล local ได้

## Optional shared bills (Supabase)

Shared bills use Supabase anonymous auth (no email or password), Postgres RPCs and private Realtime broadcasts. Each shared session is retained for a fixed 90 days. Owner/friend capabilities are random 256-bit tokens; only SHA-256 hashes are stored in Postgres. Receipt contents and participant links are normalized in private tables. The frontend only receives a publishable key; never expose a secret/service-role key.

1. Create a Supabase project and apply migrations in order: `202610030001_shared_bills.sql`, `202610030002_settlement_routing.sql`, `202610030003_shared_bill_capabilities.sql`, `202610030004_unlocked_participant_selection.sql`, and `202610040001_selection_bound_friend_participation.sql` from `supabase/migrations/` (or link the Supabase CLI project and run `supabase db push`). The first migration requires `pgcrypto` and `pg_cron`. Existing shared bills default to direct routing. Deploy the capability migration before enabling collector clients; otherwise collector creation/update fails with an explicit migration-required message instead of silently downgrading. Migration 004 allows multiple friends to select the same participant and preserves memberships when an owner removes that participant. Migration 005 binds each participation toggle to its tab's explicit participant choice, preventing two tabs with the same anonymous session from editing the wrong person.
2. In Supabase Auth, enable anonymous sign-ins. In API settings, expose the `api` schema to PostgREST (the local CLI configuration already does this).
3. Configure Realtime to reject public channels. This integration subscribes only to private `shared-bill:<internal-id>` channels and the migration permits SELECT/receive only for joined bill members.
4. Copy `.env.example` to `.env.local` and set `NEXT_PUBLIC_SHARED_BILLS_ENABLED=true`, `NEXT_PUBLIC_SUPABASE_URL`, and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. The key may be the modern publishable key or the legacy `anon` JWT, never `service_role`/secret. Restart Next.js after changing environment variables.
5. Keep the SQL migration and security test in source control. Check scheduled cleanup under Supabase Cron after deployment.

For local database work, install Docker and the Supabase CLI, then run:

```bash
supabase start
supabase test db
```

The database tests assert private-table RLS, no direct authenticated/anon table grants, RPC execution grants, fixed `search_path` on exposed SECURITY DEFINER functions, receipt-scoped participation identifiers, collector validation/same-bill FK, capability negotiation, private Realtime receive policy and scheduled expiry purge. Browser sessions are anonymous Supabase identities; clearing browser storage can lose recovery unless the owner capability was saved separately. Friend links can rejoin with their URL fragment token. Local drafts migrate copy-on-write to V3; V1/V2 keys remain recoverable until a server-confirmed V3 snapshot is saved (or the user explicitly clears the bill). Remote snapshots from older backends default to direct only when both routing fields are absent; partial routing snapshots are rejected.
