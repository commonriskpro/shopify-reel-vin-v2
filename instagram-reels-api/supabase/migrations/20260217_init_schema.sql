-- Initial schema for shoppable reels backend.
-- Safe for re-runs because objects use IF NOT EXISTS where possible.

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

create table if not exists public.reel_products (
  id uuid primary key default gen_random_uuid(),
  reel_id uuid not null references public.reels(id) on delete cascade,
  product_handle text not null,
  sort_order int not null default 0,
  unique(reel_id, product_handle)
);

create index if not exists idx_reels_created_at on public.reels(created_at desc);
create index if not exists idx_reels_media_sync_status on public.reels(media_sync_status);
create index if not exists idx_reel_products_reel_id on public.reel_products(reel_id);

create table if not exists public.app_config (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

alter table public.reels enable row level security;
alter table public.reel_products enable row level security;
alter table public.app_config enable row level security;

drop policy if exists "Allow public read reels" on public.reels;
create policy "Allow public read reels"
  on public.reels for select
  using (true);

drop policy if exists "Allow public read reel_products" on public.reel_products;
create policy "Allow public read reel_products"
  on public.reel_products for select
  using (true);
