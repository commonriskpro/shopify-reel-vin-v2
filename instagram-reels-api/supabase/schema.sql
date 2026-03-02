-- Run this in Supabase SQL Editor (Dashboard → SQL Editor) to create tables.

-- Reels synced from Instagram
create table if not exists public.reels (
  id uuid primary key default gen_random_uuid(),
  ig_id text not null unique,
  media_url text,
  thumbnail_url text,
  shopify_video_file_id text,
  shopify_video_url text,
  shopify_video_status text,
  shopify_poster_file_id text,
  shopify_poster_url text,
  shopify_poster_status text,
  media_sync_status text not null default 'pending',
  media_sync_error text,
  media_synced_at timestamptz,
  caption text,
  permalink text,
  show_on_homepage boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Product handles per reel (Shopify product handle)
create table if not exists public.reel_products (
  id uuid primary key default gen_random_uuid(),
  reel_id uuid not null references public.reels(id) on delete cascade,
  product_handle text not null,
  sort_order int not null default 0,
  unique(reel_id, product_handle)
);

create index if not exists idx_reels_created_at on public.reels(created_at desc);
create index if not exists idx_reel_products_reel_id on public.reel_products(reel_id);

-- Allow anonymous read for reels (used by storefront)
alter table public.reels enable row level security;
alter table public.reel_products enable row level security;

create policy "Allow public read reels"
  on public.reels for select
  using (true);

create policy "Allow public read reel_products"
  on public.reel_products for select
  using (true);

-- Service role can do everything; anon can only read (above). Sync uses service key.

-- App config (e.g. Instagram token) - backend only, no anon access
create table if not exists public.app_config (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
alter table public.app_config enable row level security;
-- No policies: anon cannot read/write. Service role (sync/refresh) bypasses RLS.
