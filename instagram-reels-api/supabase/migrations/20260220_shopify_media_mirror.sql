alter table public.reels
  add column if not exists shopify_video_file_id text,
  add column if not exists shopify_video_url text,
  add column if not exists shopify_video_status text,
  add column if not exists shopify_poster_file_id text,
  add column if not exists shopify_poster_url text,
  add column if not exists shopify_poster_status text,
  add column if not exists media_sync_status text not null default 'pending',
  add column if not exists media_sync_error text,
  add column if not exists media_synced_at timestamptz;

create index if not exists idx_reels_media_sync_status on public.reels(media_sync_status);
