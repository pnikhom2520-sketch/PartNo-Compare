-- =====================================================================
-- PartNo-Compare : Supabase schema
-- รันไฟล์นี้ใน Supabase Dashboard > SQL Editor (โปรเจกต์ PartNo-Compare)
-- =====================================================================

create table if not exists public.scan_logs (
  id               bigint generated always as identity primary key,
  created_at       timestamptz not null default now(),
  user_id          uuid not null default auth.uid() references auth.users(id),
  user_email       text default (auth.jwt() ->> 'email'),
  part_no_a        text not null,             -- Part No. จากเอกสารชุดที่ 1
  part_no_b        text not null,             -- Part No. จากเอกสารชุดที่ 2
  result           text not null check (result in ('OK', 'NG')),
  reason_category  text,                      -- สาเหตุ (กรณี NG)
  reason_detail    text,                      -- รายละเอียดเพิ่มเติม

  -- ผลต้องสอดคล้องกับข้อมูลจริง: ตรงกัน = OK, ไม่ตรง = NG
  constraint result_matches_data
    check ((part_no_a = part_no_b) = (result = 'OK')),
  -- กรณี NG ต้องมีสาเหตุเสมอ
  constraint ng_requires_reason
    check (result = 'OK' or coalesce(trim(reason_category), '') <> '')
);

create index if not exists scan_logs_created_at_idx on public.scan_logs (created_at desc);
create index if not exists scan_logs_result_idx     on public.scan_logs (result);

-- ---------------------------------------------------------------------
-- Row Level Security: ต้อง log in ก่อนจึงจะบันทึก/ดูข้อมูลได้
-- ไม่มี policy สำหรับ update/delete => แก้ไขหรือลบ log จากหน้าเว็บไม่ได้
-- ---------------------------------------------------------------------
alter table public.scan_logs enable row level security;

drop policy if exists "authenticated can insert own logs" on public.scan_logs;
create policy "authenticated can insert own logs"
  on public.scan_logs for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "authenticated can read logs" on public.scan_logs;
create policy "authenticated can read logs"
  on public.scan_logs for select
  to authenticated
  using (true);
