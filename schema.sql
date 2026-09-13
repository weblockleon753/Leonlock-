-- ===================================================================
-- Lua Locker & Obfuscator - Supabase Schema
-- Chạy toàn bộ file này trong Supabase SQL Editor
-- ===================================================================

create extension if not exists "pgcrypto";

-- Bảng người dùng
create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  username text unique not null,
  password_hash text not null,
  created_at timestamptz not null default now()
);

-- Bảng lưu script đã khóa (obfuscated)
create table if not exists scripts (
  id text primary key,                       -- ID ngẫu nhiên dùng cho /raw/:id
  user_id uuid references users(id) on delete cascade,
  title text default 'Untitled Script',
  original_code text not null,               -- code gốc (để user xem lại/sửa)
  locked_code text not null,                 -- code đã obfuscate, trả ra ở /raw/:id
  key_used int not null,                     -- khóa XOR dùng để obfuscate (lưu tham khảo)
  views int not null default 0,              -- đếm số lần được gọi qua /raw/:id
  created_at timestamptz not null default now()
);

create index if not exists idx_scripts_user_id on scripts(user_id);

-- Lưu ý bảo mật:
-- Vì backend Node.js dùng SERVICE_ROLE_KEY để thao tác trực tiếp,
-- có thể bật Row Level Security (RLS) và chặn truy cập trực tiếp từ client (anon key):
alter table users enable row level security;
alter table scripts enable row level security;
-- Không tạo policy nào cho anon => chỉ service_role (backend) mới truy cập được.
