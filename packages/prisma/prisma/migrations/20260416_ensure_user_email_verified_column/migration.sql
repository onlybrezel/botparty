-- Hotfix: ensure user email-verification columns exist on databases where
-- the previous migration was edited after being marked as already applied.
ALTER TABLE "users"
ADD COLUMN IF NOT EXISTS "emailVerified" BOOLEAN,
ADD COLUMN IF NOT EXISTS "emailVerificationToken" VARCHAR(64),
ADD COLUMN IF NOT EXISTS "emailVerificationExpiry" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "lastLoginAt" TIMESTAMP(3);

UPDATE "users"
SET "emailVerified" = TRUE
WHERE "emailVerified" IS NULL;

ALTER TABLE "users"
ALTER COLUMN "emailVerified" SET NOT NULL,
ALTER COLUMN "emailVerified" SET DEFAULT FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS "users_emailVerificationToken_key"
ON "users"("emailVerificationToken");
