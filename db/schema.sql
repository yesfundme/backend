-- FUNDme database schema (Postgres / Supabase)
-- Run this in the Supabase SQL editor.

create extension if not exists "pgcrypto";

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text unique not null,
  password_hash text not null,
  role text not null default 'owner' check (role in ('owner', 'admin')),
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now()
);

create table if not exists campaigns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  category text not null check (category in (
    'funeral', 'wedding', 'hospital', 'campaign', 'birthday', 'food'
  )),
  title text not null,
  description text,
  image_url text,
  beneficiary_name text,
  phone_number text,
  location text,
  extra_info text,
  target_amount numeric(14,2) not null default 0,
  amount_collected numeric(14,2) not null default 0,
  public_slug text unique not null,
  status text not null default 'active' check (status in ('active', 'suspended', 'completed')),
  created_at timestamptz not null default now()
);

create index if not exists idx_campaigns_slug on campaigns(public_slug);
create index if not exists idx_campaigns_user on campaigns(user_id);

create table if not exists support_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  icon text,
  price numeric(10,2) not null,
  active boolean not null default true
);

insert into support_items (name, icon, price) values
  ('Coffee', '☕', 1000),
  ('Popcorn', '🍿', 500),
  ('Chocolate', '🍫', 200),
  ('Flower', '🌸', 50),
  ('Smile', '😊', 20),
  ('Bazuu Support', '💚', 10000)
on conflict do nothing;

create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  supporter_name text,
  supporter_message text,
  show_name_publicly boolean not null default true,
  is_anonymous boolean not null default false,
  amount numeric(14,2) not null,
  platform_fee numeric(14,2) not null default 0,
  net_amount numeric(14,2) not null,
  currency text not null default 'KES',
  payment_reference text unique not null,
  payment_method text default 'mpesa',
  status text not null default 'pending' check (status in ('pending', 'successful', 'failed')),
  created_at timestamptz not null default now()
);

create index if not exists idx_payments_campaign on payments(campaign_id);
create index if not exists idx_payments_reference on payments(payment_reference);

create table if not exists payment_items (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references payments(id) on delete cascade,
  support_item_id uuid references support_items(id),
  quantity integer not null default 1,
  unit_price numeric(10,2) not null,
  subtotal numeric(12,2) not null
);

create table if not exists withdrawals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  campaign_id uuid not null references campaigns(id) on delete cascade,
  amount numeric(14,2) not null,
  method text not null check (method in ('bank', 'mpesa')),
  bank_name text,
  account_name text,
  account_number text,
  mpesa_name text,
  mpesa_phone text,
  status text not null default 'pending' check (status in ('pending', 'processing', 'paid', 'failed')),
  requested_at timestamptz not null default now(),
  processed_at timestamptz
);

create table if not exists platform_settings (
  key text primary key,
  value text not null
);

insert into platform_settings (key, value) values
  ('platform_fee_percent', '0'),
  ('platform_fee_flat', '0')
on conflict do nothing;

create table if not exists campaign_reports (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  reason text not null,
  reporter_email text,
  status text not null default 'open' check (status in ('open', 'reviewed', 'dismissed')),
  created_at timestamptz not null default now()
);
