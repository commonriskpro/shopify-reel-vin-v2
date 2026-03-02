/**
 * One-off: drop the duplicate lowercase "session" table if it exists.
 * The app uses only the Prisma table "Session". Run with: npm run db:fix-session
 * Requires DIRECT_URL or DATABASE_URL in env (use DIRECT_URL for Supabase so DDL runs on direct connection).
 */
import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";

config(); // load .env from project root if present

const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!url) {
  console.error("Set DIRECT_URL or DATABASE_URL in the environment.");
  process.exit(1);
}

// Use direct connection for DDL (pooler often disallows it)
process.env.DATABASE_URL = url;

const prisma = new PrismaClient();

try {
  await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS "session";');
  console.log('Dropped duplicate table "session" if it existed. Only "Session" is used.');
} catch (err) {
  console.error("Error dropping table:", err.message);
  process.exit(1);
} finally {
  await prisma.$disconnect();
}
