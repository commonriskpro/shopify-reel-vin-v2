-- Remove duplicate lowercase "session" table if it exists.
-- The app uses only Prisma model Session -> table "Session". A previous migration
-- mistakenly created both "session" and "Session"; only "Session" is needed.
DROP TABLE IF EXISTS "session";
