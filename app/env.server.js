/**
 * Env validation (fail fast on import). Do not default secrets in production.
 * @see docs/DMS-STEP1-SPEC.md §9
 */
import { z } from "zod";

const envSchema = z.object({
  SHOPIFY_API_KEY: z.string().min(1, "SHOPIFY_API_KEY is required"),
  SHOPIFY_API_SECRET: z.string().min(1, "SHOPIFY_API_SECRET is required"),
  SCOPES: z.string().min(1, "SCOPES is required"),
  SHOPIFY_APP_URL: z.string().url("SHOPIFY_APP_URL must be a valid URL"),
  SHOP_CUSTOM_DOMAIN: z.string().optional(),
  REELS_API_URL: z.string().optional(),
  REELS_ADMIN_SECRET: z.string().optional(),
});

function getEnv() {
  const parsed = envSchema.safeParse({
    SHOPIFY_API_KEY: process.env.SHOPIFY_API_KEY,
    SHOPIFY_API_SECRET: process.env.SHOPIFY_API_SECRET,
    SCOPES: process.env.SCOPES,
    SHOPIFY_APP_URL: process.env.SHOPIFY_APP_URL,
    SHOP_CUSTOM_DOMAIN: process.env.SHOP_CUSTOM_DOMAIN,
    REELS_API_URL: process.env.REELS_API_URL,
    REELS_ADMIN_SECRET: process.env.REELS_ADMIN_SECRET,
  });
  if (!parsed.success) {
    const msg = parsed.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ");
    throw new Error(`Env validation failed: ${msg}`);
  }
  return parsed.data;
}

const validated = getEnv();
export function getValidatedEnv() {
  return validated;
}
