ALTER TABLE "users"
ADD COLUMN IF NOT EXISTS "emailVerified" BOOLEAN NOT NULL DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS "emailVerificationToken" VARCHAR(64),
ADD COLUMN IF NOT EXISTS "emailVerificationExpiry" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "lastLoginAt" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "users_emailVerificationToken_key"
ON "users"("emailVerificationToken");
