# คู่มือติดตั้ง Supabase สำหรับ SplitKub

คู่มือนี้ครอบคลุมสองวิธี:

1. รัน Supabase ในเครื่องบน Windows ด้วย Docker Desktop
2. ใช้ Supabase Cloud โดยไม่ต้องติดตั้ง Docker

สำหรับ Windows การรัน Supabase stack ในเครื่องต้องใช้ Docker Desktop หรือ container runtime ที่รองรับ Docker API เพราะ Supabase native runtime ยังไม่รองรับ Windows

เอกสารอ้างอิง:

- [Supabase Local Development](https://supabase.com/docs/guides/local-development)
- [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started)
- [Docker and native runtimes](https://supabase.com/docs/guides/local-development/docker-and-native-runtimes)

## วิธีที่ 1: Local Supabase ด้วย Docker

### 1. ติดตั้งและเปิด Docker Desktop

ดาวน์โหลดจาก [Docker Desktop for Windows](https://docs.docker.com/desktop/setup/install/windows-install/)

เปิด Docker Desktop แล้วตรวจสอบใน PowerShell:

```powershell
docker version
```

ต้องเห็นข้อมูลทั้ง `Client` และ `Server` ถ้าเห็นเฉพาะ Client แปลว่า Docker Engine ยังไม่ทำงาน

### 2. ติดตั้ง Supabase CLI ในโปรเจกต์

เปิด PowerShell ที่โฟลเดอร์โปรเจกต์:

```powershell
cd C:\Users\sk136\Desktop\Work\SplitKub
npm install --save-dev supabase
```

ตรวจสอบเวอร์ชัน:

```powershell
node --version
npx supabase --version
```

Supabase CLI ที่ติดตั้งผ่าน npm ต้องใช้ Node.js 20 ขึ้นไปและเรียกผ่าน `npx supabase`

โปรเจกต์นี้มี `supabase/config.toml` อยู่แล้ว จึงไม่ต้องรัน `supabase init`

### 3. เปิด Supabase local stack

```powershell
npx supabase start
```

ครั้งแรกอาจใช้เวลาหลายนาทีเพื่อดาวน์โหลด Docker images คำสั่งนี้จะสร้าง local Postgres, Auth, Realtime และนำ migration ใน `supabase/migrations/` ไปใช้

เมื่อเปิดสำเร็จ ตรวจสอบสถานะด้วย:

```powershell
npx supabase status
```

ค่าปกติ:

- API URL: `http://127.0.0.1:54321`
- Studio: `http://localhost:54323`
- Database: port `54322`

ให้ใช้ Publishable key หรือ legacy anon key ที่แสดงจาก `npx supabase status` ห้ามใช้ secret/service-role key ใน frontend

### 4. สร้าง `.env.local`

สร้างไฟล์ `.env.local` ที่ root ของโปรเจกต์:

```env
NEXT_PUBLIC_SHARED_BILLS_ENABLED=true
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<ใส่ Publishable key หรือ anon key จาก supabase status>
```

ข้อควรระวัง:

- อย่า commit `.env.local`
- อย่าใส่ secret key หรือ service-role key ในตัวแปรที่ขึ้นต้นด้วย `NEXT_PUBLIC_`
- หลังเปลี่ยน environment variables ต้อง restart Next.js dev server

### 5. รันการตรวจฐานข้อมูล

```powershell
npx supabase test db
```

คำสั่งนี้จะรัน pgTAP ทุกไฟล์ใน `supabase/tests/` เพื่อตรวจ RLS, grants, RPC security, collector validation, capability negotiation, การเลือกชื่อซ้ำ, Realtime policy และ scheduled expiry cleanup

### 6. เปิด SplitKub

```powershell
npm run dev
```

เปิด:

- SplitKub: `http://localhost:3000`
- Supabase Studio: `http://localhost:54323`

### 7. ทดสอบ Shared Bill

1. เปิด SplitKub และสร้างวงหาร
2. เพิ่มคน ใบเสร็จ รายการ และเลือกคนออกเงินให้ครบ
3. กดสร้างลิงก์ให้เพื่อน
4. เปิด Friend link ใน Incognito หรือ browser อีก profile
5. เลือกชื่อตัวเองและติ๊กรายการ ลองเปิดลิงก์บนอีกอุปกรณ์เพื่อเลือกชื่อเดียวกันได้ (แต่ละอุปกรณ์จำชื่อที่เลือกแยกกันใน sessionStorage)
6. ตรวจว่าหน้าเจ้าของอัปเดตผ่าน Realtime
7. ลองเปิดลิงก์ผิดหรือเอา fragment token ออกและตรวจว่าระบบปฏิเสธ

## คำสั่ง Local ที่ใช้บ่อย

ดูสถานะ:

```powershell
npx supabase status
```

หยุดโดยเก็บข้อมูล local ไว้:

```powershell
npx supabase stop
```

เปิดใหม่:

```powershell
npx supabase start
```

ล้างฐานข้อมูล local และลง migrations ใหม่:

```powershell
npx supabase db reset
```

คำเตือน: `db reset` จะลบข้อมูลใน Supabase local ปัจจุบันทั้งหมด

## วิธีอัปเดต Database Migration

ใช้ขั้นตอนนี้เมื่อหน้าเว็บแจ้งว่าฐานข้อมูลยังไม่รองรับฟีเจอร์ล่าสุด หรือเมื่อมีไฟล์ใหม่ใน `supabase/migrations/`

Migration ของโปรเจกต์จะถูกรันตามลำดับชื่อไฟล์ ปัจจุบันต้องมีอย่างน้อย:

1. `202610030001_shared_bills.sql`
2. `202610030002_settlement_routing.sql`
3. `202610030003_shared_bill_capabilities.sql`
4. `202610030004_unlocked_participant_selection.sql`
5. `202610040001_selection_bound_friend_participation.sql`

### อัปเดต Supabase local โดยไม่ลบข้อมูล

เปิด Docker Desktop และรันจาก root ของโปรเจกต์:

```powershell
cd C:\Users\sk136\Desktop\Work\SplitKub
npx supabase status
npx supabase migration up
```

`migration up` จะนำเฉพาะ migration ที่ยังไม่เคยรันไปใช้กับฐานข้อมูล local โดยไม่ตั้งใจล้างข้อมูลเดิม เมื่อสำเร็จให้ restart เว็บ:

```powershell
npm run dev
```

จากนั้น refresh หน้าและลองเลือกคนรวบรวมเงินอีกครั้ง

### สร้างฐานข้อมูล local ใหม่

ใช้เมื่อเป็นข้อมูลทดสอบที่ลบได้ หรือ migration history ของ local เสียจน `migration up` ทำงานไม่ได้:

```powershell
npx supabase db reset
```

คำเตือน: คำสั่งนี้ลบข้อมูลทั้งหมดใน Supabase local แล้วสร้าง schema ใหม่จาก migration ทุกไฟล์ ห้ามใช้กับฐานข้อมูล production

### อัปเดต Supabase Cloud

เชื่อม project ก่อน แล้วตรวจรายการ migration โดยยังไม่เขียนฐานข้อมูล:

```powershell
npx supabase login
npx supabase link --project-ref <PROJECT_REF>
npx supabase db push --dry-run
```

ตรวจว่า dry run แสดงเฉพาะ migration ที่คาดไว้ แล้วจึงรัน:

```powershell
npx supabase db push
```

อย่ารัน migration ซ้ำด้วยการคัดลอก SQL ไปวางใน Dashboard หาก project ใช้ CLI migration history อยู่ เพราะอาจทำให้ schema กับ `supabase_migrations.schema_migrations` ไม่ตรงกัน

### ตรวจหลังอัปเดต

รัน database tests และเปิดเว็บใหม่:

```powershell
npx supabase test db
npm run dev
```

ถ้า Collector mode ยังแจ้งให้ทำ migration ให้ตรวจว่าหน้าเว็บชี้ไปยัง Supabase instance เดียวกับที่เพิ่งอัปเดต โดยดู `NEXT_PUBLIC_SUPABASE_URL` ใน `.env.local` แล้ว restart dev server ทุกครั้งหลังแก้ environment variables

## ปัญหาที่พบบ่อย

### `Cannot connect to the Docker daemon`

- เปิด Docker Desktop
- รอจน Docker Engine แสดงว่า Running
- รัน `docker version` และตรวจว่ามี Server

### Port ถูกใช้งานอยู่

ตรวจว่ามี Supabase project อื่นทำงานอยู่หรือไม่:

```powershell
npx supabase status
npx supabase stop
```

จากนั้นลอง `npx supabase start` ใหม่

### Migration ล้มเหลว

ดูข้อความ SQL error แล้วลองสร้างฐานข้อมูลใหม่:

```powershell
npx supabase db reset
```

ใช้คำสั่งนี้เฉพาะ local development เพราะข้อมูล local จะถูกลบ

### ปุ่มแชร์ออนไลน์ยังปิดอยู่

ตรวจสอบว่า:

- Docker และ Supabase local ทำงานอยู่
- `.env.local` มี `NEXT_PUBLIC_SHARED_BILLS_ENABLED=true`
- URL และ Publishable key ถูกต้อง
- Restart `npm run dev` หลังแก้ `.env.local`

## วิธีที่ 2: Supabase Cloud โดยไม่ใช้ Docker

ถ้าไม่ต้องการติดตั้ง Docker สามารถใช้ Supabase Cloud ได้โดยตรง:

1. สร้าง project ที่ [Supabase Dashboard](https://supabase.com/dashboard)
2. เปิด Anonymous Sign-ins
3. เพิ่ม `api` ใน Exposed schemas
4. ตั้ง Realtime ให้ไม่อนุญาต public channels
5. เชื่อม CLI และส่ง migration ทั้ง 5 ไฟล์ตามลำดับ (001 shared bills → 002 settlement routing → 003 capabilities → 004 unlocked participant selection → 005 tab-bound participation) ก่อนเปิดใช้ client รุ่นล่าสุด

```powershell
npx supabase login
npx supabase link --project-ref <PROJECT_REF>
npx supabase db push
```

ถ้าหน้าเว็บแจ้งว่าต้องอัปเดต migration สำหรับคนรวบรวมเงิน ให้ตรวจว่าฐานข้อมูลปลายทางลงไฟล์ `202610030002_settlement_routing.sql` และ `202610030003_shared_bill_capabilities.sql` แล้ว จากนั้นลองใหม่ ข้อมูลบิลในเครื่องยังไม่ถูกแปลงเป็น direct อัตโนมัติ

จากนั้นสร้าง `.env.local`:

```env
NEXT_PUBLIC_SHARED_BILLS_ENABLED=true
NEXT_PUBLIC_SUPABASE_URL=<Project URL จาก Supabase>
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<Publishable key จาก Supabase>
```

แล้ว restart:

```powershell
npm run dev
```

การใช้ Supabase Cloud ไม่ต้องเปิด Docker แต่ต้องมีอินเทอร์เน็ตและข้อมูลทดสอบจะอยู่บน project ที่เชื่อมไว้
