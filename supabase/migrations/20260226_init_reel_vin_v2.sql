-- Bootstrap new Supabase project for reel-vin-v2.
-- Includes:
-- 1) Shopify app session storage (single table "Session" used by Prisma).
-- 2) Reels API schema, indexes, and RLS policies.

CREATE TABLE IF NOT EXISTS "Session" (
  "id" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "isOnline" BOOLEAN NOT NULL DEFAULT false,
  "scope" TEXT,
  "expires" TIMESTAMP(3),
  "accessToken" TEXT NOT NULL,
  "userId" BIGINT,
  "firstName" TEXT,
  "lastName" TEXT,
  "email" TEXT,
  "accountOwner" BOOLEAN NOT NULL DEFAULT false,
  "locale" TEXT,
  "collaborator" BOOLEAN DEFAULT false,
  "emailVerified" BOOLEAN DEFAULT false,
  "refreshToken" TEXT,
  "refreshTokenExpires" TIMESTAMP(3),
  CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.reels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ig_id text NOT NULL UNIQUE,
  media_url text,
  thumbnail_url text,
  shopify_video_file_id text,
  shopify_video_url text,
  shopify_video_status text,
  shopify_poster_file_id text,
  shopify_poster_url text,
  shopify_poster_status text,
  media_sync_status text NOT NULL DEFAULT 'pending',
  media_sync_error text,
  media_synced_at timestamptz,
  caption text,
  permalink text,
  show_on_homepage boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.reel_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reel_id uuid NOT NULL REFERENCES public.reels(id) ON DELETE CASCADE,
  product_handle text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  UNIQUE(reel_id, product_handle)
);

CREATE INDEX IF NOT EXISTS idx_reels_created_at ON public.reels(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reels_media_sync_status ON public.reels(media_sync_status);
CREATE INDEX IF NOT EXISTS idx_reel_products_reel_id ON public.reel_products(reel_id);

CREATE TABLE IF NOT EXISTS public.app_config (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.reels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reel_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read reels" ON public.reels;
CREATE POLICY "Allow public read reels"
  ON public.reels FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Allow public read reel_products" ON public.reel_products;
CREATE POLICY "Allow public read reel_products"
  ON public.reel_products FOR SELECT
  USING (true);
