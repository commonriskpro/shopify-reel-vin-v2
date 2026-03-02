-- Add show_on_homepage so merchants can choose which reels appear on the storefront.
alter table public.reels
  add column if not exists show_on_homepage boolean not null default false;
