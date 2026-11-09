-- ============================================================================
-- MemeChat v2 — ONLY ADDITIVE. هیچ DROP / DELETE / TRUNCATE / ALTER COLUMN وجود ندارد.
-- هیچ دادهٔ فعلی خوانده، جابهجا، بازنویسی یا پاک نمیشود.
-- جدولها فقط در صورتی ساخته میشوند که نباشند (قابل اجرای دوباره، idempotent).
-- ============================================================================

-- ۱) فهرست بستههای تاریخچه (فقط نشانی و هش؛ متن پیام هرگز اینجا نیست)
create table if not exists public.mimchat_v2_archives (
  history_key text primary key,
  topic text not null,
  version integer not null default 1,
  path text not null,
  sha256 text not null,
  commit_sha text,
  source text not null default 'supabase',
  message_count integer not null default 0,
  created_at timestamptz not null default now(),
  unique (history_key, version, path)
);
create index if not exists mimchat_v2_archives_topic_idx on public.mimchat_v2_archives (topic, version desc);

-- ۲) صف پیامهای آفلاین: فقط شناسه و وضعیت؛ محتوا تو دستگاه رمزشده میماند
create table if not exists public.mimchat_v2_outbox (
  client_id text primary key,
  user_id text not null,
  topic text not null,
  status text not null default 'pending' check (status in ('pending','in_flight','confirmed','failed')),
  attempts integer not null default 0,
  archive_path text,
  commit_sha text,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz
);
create index if not exists mimchat_v2_outbox_status_idx on public.mimchat_v2_outbox (status, created_at asc);

-- ۳) سیگنالینگ WebRTC: اطلاعات موقت اتصال، پاکشدنی بعد از استفاده
--    (مسیر فعلی rt-post/rt-get/rt-clear همچنان سر جاشه و دستنخورده میماند)
create table if not exists public.mimchat_v2_signals (
  id bigserial primary key,
  room text not null,
  from_id text not null,
  kind text not null,
  nonce text not null unique,
  payload jsonb not null default '{}'::jsonb,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists mimchat_v2_signals_room_idx on public.mimchat_v2_signals (room, created_at asc);

-- ۴) امنیت: همان الگوی فعلی — RLS روشن، دسترسی فقط با کلید سرویس
alter table public.mimchat_v2_archives enable row level security;
alter table public.mimchat_v2_outbox   enable row level security;
alter table public.mimchat_v2_signals  enable row level security;
revoke all on public.mimchat_v2_archives from anon, authenticated;
revoke all on public.mimchat_v2_outbox   from anon, authenticated;
revoke all on public.mimchat_v2_signals  from anon, authenticated;

-- ۵) پاکسازی فقط ردیفهای موقت «منقضیشده» — هیچ پیام / حساب / تنظیمی پاک نمیشود.
--    این تابع بهصورت اختیاری و فقط برای جدول سیگنالینگ قابل صداست.
create or replace function public.mimchat_v2_cleanup_expired_signals() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  delete from public.mimchat_v2_signals where expires_at < now();
  get diagnostics n = row_count;
  return n;
end $$;

select 'memechat v2 additive schema ready; no existing data touched' as status;
