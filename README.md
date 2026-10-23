# PartNo-Compare

เว็บแอปสแกนเปรียบเทียบ Part No. จากเอกสาร 2 ชุด เก็บผลทุกครั้งใน Supabase
ถ้าไม่ตรงกัน (NG) ต้องกรอกสาเหตุก่อนจึงจะสแกนต่อได้ และต้อง log in ก่อนใช้งาน

## ไฟล์

| ไฟล์ | หน้าที่ |
|---|---|
| `schema.sql` | สร้างตาราง `scan_logs` และ Row Level Security |
| `config.js` | ใส่ Supabase URL / anon key |
| `index.html`, `app.js`, `styles.css` | ตัวแอป |

## ตั้งค่า Supabase (โปรเจกต์ PartNo-Compare)

1. ไปที่ https://supabase.com/dashboard แล้วสร้าง (หรือเปิด) โปรเจกต์ชื่อ **PartNo-Compare**
2. **SQL Editor** → New query → วางเนื้อหาจาก `schema.sql` → Run
3. **Authentication → Users → Add user → Create new user** สร้างบัญชีผู้ใช้งาน (ติ๊ก Auto Confirm)
   - Log in ด้วย **User ID**: ใส่ Email เป็น `<userid>@partno.local` เช่น User ID `somchai` → Email `somchai@partno.local`
   - ยังใช้อีเมลจริง log in ได้ด้วย (พิมพ์อีเมลเต็มในช่อง User ID)
   - เปลี่ยนโดเมนได้ที่ `USER_DOMAIN` ใน `config.js`
4. แนะนำ: **Authentication → Sign In / Providers** ปิด "Allow new users to sign up" เพื่อให้เฉพาะผู้ที่ admin สร้างให้เท่านั้นที่ใช้งานได้
5. **Project Settings → API** คัดลอก Project URL และ `anon` `public` key ไปใส่ใน `config.js`

## เปิดใช้งาน

ออนไลน์ (GitHub Pages): https://pnikhom2520-sketch.github.io/PartNo-Compare/
— หลังแก้ `config.js` แล้ว `git push` หน้าเว็บจะอัปเดตเองภายใน 1–2 นาที

ในเครื่อง: ดับเบิลคลิก `index.html` เพื่อเปิดใน Chrome/Edge ได้ทันที หรือเปิดผ่าน web server:

```
cd C:\Users\Nikhom\PartNo-Compare
python -m http.server 8080
```
แล้วเปิด http://localhost:8080

จะ deploy ขึ้น Netlify / Vercel / GitHub Pages ก็ได้ (เป็น static files ทั้งหมด)

## วิธีใช้

1. Log in
2. สแกน Part No. เอกสารชุดที่ 1 (เครื่องสแกนส่ง Enter ให้อัตโนมัติ) → เคอร์เซอร์ย้ายไปช่องที่ 2
3. สแกน Part No. เอกสารชุดที่ 2
   - **ตรงกัน** → เสียงบี๊บสั้น, บันทึก OK, พร้อมสแกนชุดถัดไป
   - **ไม่ตรงกัน** → เสียงเตือน, หน้าต่างให้เลือกสาเหตุ (ถ้าเลือก "อื่นๆ" ต้องกรอกรายละเอียด) → บันทึก NG
4. แท็บ **ประวัติ / Log** กรองตามวันที่ / OK-NG / Part No. และ Export CSV (เปิดใน Excel ภาษาไทยได้)

## หมายเหตุ

- ก่อนเทียบจะตัดช่องว่างหัวท้ายและแปลงเป็นตัวพิมพ์ใหญ่ (`abc-01 ` = `ABC-01`)
- ฐานข้อมูลตรวจซ้ำว่า OK/NG สอดคล้องกับข้อมูลจริง และ NG ต้องมีสาเหตุเสมอ
- ผู้ใช้แก้ไข/ลบ log จากหน้าเว็บไม่ได้ (ไม่มี policy update/delete) — แก้ได้เฉพาะ admin ใน Dashboard
- แก้รายการสาเหตุได้ที่ `<select id="ng-category">` ใน `index.html`
