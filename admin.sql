-- =====================================================================
-- PartNo-Compare : ระบบจัดการผู้ใช้ (Admin)
-- รันไฟล์นี้ใน Supabase Dashboard > SQL Editor หลังจากรัน schema.sql แล้ว
-- รันซ้ำได้ ไม่ทำให้ข้อมูลเดิมเสีย
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- รายชื่อผู้ดูแลระบบ
create table if not exists public.app_admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.app_admins enable row level security;
-- ไม่มี policy => อ่าน/แก้ตรงๆ จากหน้าเว็บไม่ได้ ต้องผ่านฟังก์ชันด้านล่างเท่านั้น

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.app_admins where user_id = auth.uid());
$$;

create or replace function public._require_admin()
returns void
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'ต้องเป็น Admin เท่านั้น' using errcode = '42501';
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- รายชื่อผู้ใช้
-- ---------------------------------------------------------------------
create or replace function public.admin_list_users()
returns table (
  id uuid, email text, created_at timestamptz, last_sign_in_at timestamptz,
  is_admin boolean, is_active boolean
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public._require_admin();
  return query
    select u.id, u.email::text, u.created_at, u.last_sign_in_at,
           exists (select 1 from public.app_admins a where a.user_id = u.id),
           (u.banned_until is null or u.banned_until < now())
    from auth.users u
    order by u.email;
end;
$$;

-- ---------------------------------------------------------------------
-- สร้างผู้ใช้ใหม่ (p_email = "<userid>@<USER_DOMAIN>" ส่งมาจากหน้าเว็บ)
-- ---------------------------------------------------------------------
-- ฟังก์ชันภายใน (ไม่ตรวจสิทธิ์) ใช้โดย admin_create_user และตอนสร้าง Admin คนแรก
create or replace function public._create_user(p_email text, p_password text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_id    uuid := gen_random_uuid();
  v_email text := lower(trim(p_email));
begin
  if v_email !~ '^[a-z0-9._-]{2,40}@[a-z0-9.-]+$' then
    raise exception 'User ID ใช้ได้เฉพาะ a-z, 0-9, จุด, ขีด (2-40 ตัวอักษร)';
  end if;
  if length(coalesce(p_password, '')) < 6 then
    raise exception 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร';
  end if;
  if exists (select 1 from auth.users where email = v_email) then
    raise exception 'มี User ID นี้อยู่แล้ว';
  end if;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change, email_change_token_new
  ) values (
    '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated',
    v_email, extensions.crypt(p_password, extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', '{}', now(), now(),
    '', '', '', ''
  );

  insert into auth.identities (
    id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
  ) values (
    gen_random_uuid(), v_id, v_id::text,
    jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true),
    'email', now(), now(), now()
  );

  return v_id;
end;
$$;

create or replace function public.admin_create_user(p_email text, p_password text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
begin
  perform public._require_admin();
  return public._create_user(p_email, p_password);
end;
$$;

-- ---------------------------------------------------------------------
-- รีเซ็ตรหัสผ่าน
-- ---------------------------------------------------------------------
create or replace function public.admin_reset_password(p_user uuid, p_password text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform public._require_admin();
  if length(coalesce(p_password, '')) < 6 then
    raise exception 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร';
  end if;
  update auth.users
     set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')),
         updated_at = now()
   where id = p_user;
end;
$$;

-- ---------------------------------------------------------------------
-- ระงับ / เปิดใช้งาน (ไม่ลบ เพื่อให้ประวัติการสแกนยังอ้างอิงได้)
-- ---------------------------------------------------------------------
create or replace function public.admin_set_active(p_user uuid, p_active boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform public._require_admin();
  if p_user = auth.uid() and not p_active then
    raise exception 'ระงับบัญชีตัวเองไม่ได้';
  end if;
  update auth.users
     set banned_until = case when p_active then null else 'infinity'::timestamptz end,
         updated_at = now()
   where id = p_user;
  if not p_active then
    delete from auth.sessions where user_id = p_user; -- บังคับ log out
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- ตั้ง / ยกเลิกสิทธิ์ Admin
-- ---------------------------------------------------------------------
create or replace function public.admin_set_admin(p_user uuid, p_admin boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform public._require_admin();
  if p_user = auth.uid() and not p_admin then
    raise exception 'ยกเลิกสิทธิ์ Admin ของตัวเองไม่ได้';
  end if;
  if p_admin then
    insert into public.app_admins (user_id) values (p_user) on conflict do nothing;
  else
    delete from public.app_admins where user_id = p_user;
  end if;
end;
$$;

-- เปิดให้เรียกได้เฉพาะผู้ที่ log in แล้ว (ในฟังก์ชันตรวจสิทธิ์ Admin อีกชั้น)
revoke all on function public._require_admin()                       from public, anon, authenticated;
revoke all on function public._create_user(text, text)                from public, anon, authenticated;
revoke all on function public.admin_list_users()                      from public, anon;
revoke all on function public.admin_create_user(text, text)           from public, anon;
revoke all on function public.admin_reset_password(uuid, text)        from public, anon;
revoke all on function public.admin_set_active(uuid, boolean)         from public, anon;
revoke all on function public.admin_set_admin(uuid, boolean)          from public, anon;
grant execute on function public.is_admin()                           to authenticated;
grant execute on function public.admin_list_users()                   to authenticated;
grant execute on function public.admin_create_user(text, text)        to authenticated;
grant execute on function public.admin_reset_password(uuid, text)     to authenticated;
grant execute on function public.admin_set_active(uuid, boolean)      to authenticated;
grant execute on function public.admin_set_admin(uuid, boolean)       to authenticated;

-- ---------------------------------------------------------------------
-- Admin คนแรก: สร้าง User ID "nikhom" ถ้ายังไม่มี
-- >>> เปลี่ยนรหัสผ่าน 'ChangeMe123' ด้านล่างก่อนกด Run <<<
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from auth.users where email = 'nikhom@partno.local') then
    perform public._create_user('nikhom@partno.local', 'ChangeMe123');
  end if;
end;
$$;

insert into public.app_admins (user_id)
select id from auth.users
where email in ('nikhom@partno.local', 'pnikhom2520@gmail.com')
on conflict do nothing;

select u.email as admin from public.app_admins a join auth.users u on u.id = a.user_id;
