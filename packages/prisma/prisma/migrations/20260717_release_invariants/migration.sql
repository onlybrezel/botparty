-- Release invariants and upgrade path from databases created before the
-- immutable baseline was introduced. All operations are forward-only.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Remove the fresh-install compatibility shim after the historical migration.
DROP TABLE IF EXISTS "Robot";

-- Device credentials are one-way hashes. Existing plaintext values are
-- converted in-place during upgrade; fresh baselines already use these names.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'robots' AND column_name = 'streamKey'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'robots' AND column_name = 'streamKeyHash'
  ) THEN
    ALTER TABLE "robots" RENAME COLUMN "streamKey" TO "streamKeyHash";
    UPDATE "robots" SET "streamKeyHash" = encode(digest("streamKeyHash", 'sha256'), 'hex');
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'robots' AND column_name = 'claimToken'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'robots' AND column_name = 'claimTokenHash'
  ) THEN
    ALTER TABLE "robots" RENAME COLUMN "claimToken" TO "claimTokenHash";
    UPDATE "robots" SET "claimTokenHash" = encode(digest("claimTokenHash", 'sha256'), 'hex');
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public."robots_streamKey_key"') IS NOT NULL
     AND to_regclass('public."robots_streamKeyHash_key"') IS NULL THEN
    ALTER INDEX "robots_streamKey_key" RENAME TO "robots_streamKeyHash_key";
  END IF;
  IF to_regclass('public."robots_claimToken_key"') IS NOT NULL
     AND to_regclass('public."robots_claimTokenHash_key"') IS NULL THEN
    ALTER INDEX "robots_claimToken_key" RENAME TO "robots_claimTokenHash_key";
  END IF;
END $$;

ALTER TABLE "robots"
  ADD COLUMN IF NOT EXISTS "deviceTokenVersion" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "creditDebt" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "financialHold" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "legalAcceptedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "acceptedTermsVersion" VARCHAR(32),
  ADD COLUMN IF NOT EXISTS "acceptedPrivacyVersion" VARCHAR(32);

ALTER TABLE "admin_audit_logs"
  ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMP(3);
UPDATE "admin_audit_logs"
SET "expiresAt" = "createdAt" + interval '90 days'
WHERE "expiresAt" IS NULL;
ALTER TABLE "admin_audit_logs"
  ALTER COLUMN "expiresAt" SET DEFAULT (now() + interval '90 days'),
  ALTER COLUMN "expiresAt" SET NOT NULL;
CREATE INDEX IF NOT EXISTS "admin_audit_logs_expiresAt_idx"
  ON "admin_audit_logs"("expiresAt");

ALTER TYPE "BillingIntentStatus" ADD VALUE IF NOT EXISTS 'CREATING' BEFORE 'PENDING';
ALTER TYPE "BillingIntentStatus" ADD VALUE IF NOT EXISTS 'NEEDS_REVIEW' AFTER 'FAILED';

DO $$ BEGIN
  CREATE TYPE "BillingWebhookProcessingStatus" AS ENUM ('PROCESSED', 'NEEDS_REVIEW', 'FAILED', 'IGNORED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "WalletIdempotencyStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "PayoutDestinationType" AS ENUM ('PAYPAL_EMAIL', 'IBAN');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "ControlCommandStatus" AS ENUM ('PENDING', 'ACKED', 'NACKED', 'TIMED_OUT', 'COMPENSATED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "transactions"
  ADD COLUMN IF NOT EXISTS "billingIntentId" UUID,
  ADD COLUMN IF NOT EXISTS "billingReversalKey" VARCHAR(192),
  ADD COLUMN IF NOT EXISTS "payoutRequestId" UUID,
  ADD COLUMN IF NOT EXISTS "controlCommandId" UUID;
CREATE UNIQUE INDEX IF NOT EXISTS "transactions_billingIntentId_key" ON "transactions"("billingIntentId");
CREATE UNIQUE INDEX IF NOT EXISTS "transactions_billingReversalKey_key" ON "transactions"("billingReversalKey");
CREATE UNIQUE INDEX IF NOT EXISTS "transactions_payoutRequestId_key" ON "transactions"("payoutRequestId");
CREATE UNIQUE INDEX IF NOT EXISTS "transactions_userId_controlCommandId_type_key"
  ON "transactions"("userId", "controlCommandId", "type");

ALTER TABLE "billing_intents"
  ADD COLUMN IF NOT EXISTS "providerPaymentRef" VARCHAR(128),
  ADD COLUMN IF NOT EXISTS "providerSubscriptionRef" VARCHAR(128),
  ADD COLUMN IF NOT EXISTS "reversedCredits" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "termsVersion" VARCHAR(32),
  ADD COLUMN IF NOT EXISTS "immediateDeliveryConsentAt" TIMESTAMP(3);
CREATE UNIQUE INDEX IF NOT EXISTS "billing_intents_provider_providerPaymentRef_key"
  ON "billing_intents"("provider", "providerPaymentRef");
CREATE UNIQUE INDEX IF NOT EXISTS "billing_intents_provider_providerSubscriptionRef_key"
  ON "billing_intents"("provider", "providerSubscriptionRef");

ALTER TABLE "billing_webhook_events"
  ADD COLUMN IF NOT EXISTS "intentId" UUID,
  ADD COLUMN IF NOT EXISTS "status" "BillingWebhookProcessingStatus" NOT NULL DEFAULT 'PROCESSED',
  ADD COLUMN IF NOT EXISTS "errorCode" VARCHAR(64);

ALTER TABLE "wallet_idempotency_keys"
  ADD COLUMN IF NOT EXISTS "requestHash" VARCHAR(64),
  ADD COLUMN IF NOT EXISTS "status" "WalletIdempotencyStatus" NOT NULL DEFAULT 'IN_PROGRESS',
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE "wallet_idempotency_keys"
SET "requestHash" = encode(digest("userId"::text || ':' || "scope" || ':' || "key", 'sha256'), 'hex'),
    "status" = CASE WHEN "result" IS NULL THEN 'FAILED'::"WalletIdempotencyStatus" ELSE 'COMPLETED'::"WalletIdempotencyStatus" END
WHERE "requestHash" IS NULL;
ALTER TABLE "wallet_idempotency_keys" ALTER COLUMN "requestHash" SET NOT NULL;
ALTER TABLE "wallet_idempotency_keys" ALTER COLUMN "updatedAt" DROP DEFAULT;

ALTER TABLE "payout_requests"
  ADD COLUMN IF NOT EXISTS "destinationType" "PayoutDestinationType",
  ADD COLUMN IF NOT EXISTS "destinationLast4" VARCHAR(16),
  ADD COLUMN IF NOT EXISTS "paidById" UUID,
  ADD COLUMN IF NOT EXISTS "providerRef" VARCHAR(192);
UPDATE "payout_requests"
SET "destinationType" = CASE WHEN "destination" LIKE '%@%' THEN 'PAYPAL_EMAIL'::"PayoutDestinationType" ELSE 'IBAN'::"PayoutDestinationType" END,
    "destinationLast4" = RIGHT("destination", 4)
WHERE "destinationType" IS NULL OR "destinationLast4" IS NULL;
ALTER TABLE "payout_requests"
  ALTER COLUMN "destination" TYPE VARCHAR(1024),
  ALTER COLUMN "destinationType" SET NOT NULL,
  ALTER COLUMN "destinationLast4" SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "payout_requests_providerRef_key" ON "payout_requests"("providerRef");
CREATE INDEX IF NOT EXISTS "payout_requests_reviewedById_reviewedAt_idx" ON "payout_requests"("reviewedById", "reviewedAt");
CREATE INDEX IF NOT EXISTS "payout_requests_paidById_paidAt_idx" ON "payout_requests"("paidById", "paidAt");
DO $$ BEGIN
  ALTER TABLE "payout_requests" ADD CONSTRAINT "payout_requests_reviewedById_fkey"
    FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "payout_requests" ADD CONSTRAINT "payout_requests_paidById_fkey"
    FOREIGN KEY ("paidById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "clientMessageId" UUID;
CREATE UNIQUE INDEX IF NOT EXISTS "chat_messages_userId_clientMessageId_key"
  ON "chat_messages"("userId", "clientMessageId");

ALTER TABLE "robot_webhooks" ALTER COLUMN "secret" TYPE VARCHAR(512);

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "productAnalyticsEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "productAnalyticsConsentAt" TIMESTAMP(3);

ALTER TABLE "analytics_events"
  ADD COLUMN IF NOT EXISTS "schemaVersion" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "admin_audit_logs"
  ALTER COLUMN "expiresAt" SET DEFAULT (now() + interval '180 days');

CREATE TABLE IF NOT EXISTS "notification_preferences" (
  "userId" UUID NOT NULL,
  "inAppEnabled" BOOLEAN NOT NULL DEFAULT true,
  "browserEnabled" BOOLEAN NOT NULL DEFAULT false,
  "emailTurn" BOOLEAN NOT NULL DEFAULT true,
  "emailRobot" BOOLEAN NOT NULL DEFAULT true,
  "emailFinance" BOOLEAN NOT NULL DEFAULT true,
  "quietStartMin" INTEGER,
  "quietEndMin" INTEGER,
  "timezone" VARCHAR(64) NOT NULL DEFAULT 'UTC',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("userId")
);
CREATE TABLE IF NOT EXISTS "notifications" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "kind" VARCHAR(32) NOT NULL,
  "category" VARCHAR(16) NOT NULL,
  "title" VARCHAR(120) NOT NULL,
  "body" VARCHAR(500) NOT NULL,
  "actionUrl" VARCHAR(512),
  "dedupeKey" VARCHAR(192) NOT NULL,
  "browserRequested" BOOLEAN NOT NULL DEFAULT false,
  "emailRequested" BOOLEAN NOT NULL DEFAULT false,
  "emailStatus" VARCHAR(16) NOT NULL DEFAULT 'SKIPPED',
  "emailAttempts" INTEGER NOT NULL DEFAULT 0,
  "nextEmailAttemptAt" TIMESTAMP(3),
  "emailDeliveredAt" TIMESTAMP(3),
  "readAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3) NOT NULL DEFAULT (now() + interval '180 days'),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "notifications_dedupeKey_key" ON "notifications"("dedupeKey");
CREATE INDEX IF NOT EXISTS "notifications_userId_createdAt_idx" ON "notifications"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "notifications_emailStatus_nextEmailAttemptAt_idx" ON "notifications"("emailStatus", "nextEmailAttemptAt");
CREATE INDEX IF NOT EXISTS "notifications_expiresAt_idx" ON "notifications"("expiresAt");
DO $$ BEGIN
  ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Resolve any historical duplicate queue positions deterministically before
-- adding the database invariant.
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY "robotId" ORDER BY "isPriority" DESC, "position", "joinedAt", id
  ) AS next_position
  FROM "queue_entries"
)
UPDATE "queue_entries" q
SET "position" = ranked.next_position
FROM ranked
WHERE q.id = ranked.id;
CREATE UNIQUE INDEX IF NOT EXISTS "queue_entries_robotId_position_key"
  ON "queue_entries"("robotId", "position");

CREATE UNIQUE INDEX IF NOT EXISTS "sessions_one_active_per_robot_key"
  ON "sessions"("robotId") WHERE "status" = 'ACTIVE';

CREATE TABLE IF NOT EXISTS "recordings" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "sessionId" UUID NOT NULL,
  "robotId" UUID NOT NULL,
  "cameraId" VARCHAR(128),
  "egressId" VARCHAR(128) NOT NULL,
  "objectKey" VARCHAR(1024) NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "recordings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "recordings_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "recordings_robotId_fkey" FOREIGN KEY ("robotId") REFERENCES "robots"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "recordings_egressId_key" ON "recordings"("egressId");
CREATE UNIQUE INDEX IF NOT EXISTS "recordings_objectKey_key" ON "recordings"("objectKey");
DROP INDEX IF EXISTS "recordings_sessionId_cameraId_key";
CREATE INDEX IF NOT EXISTS "recordings_sessionId_cameraId_idx" ON "recordings"("sessionId", "cameraId");
CREATE INDEX IF NOT EXISTS "recordings_robotId_startedAt_idx" ON "recordings"("robotId", "startedAt");
CREATE INDEX IF NOT EXISTS "recordings_sessionId_startedAt_idx" ON "recordings"("sessionId", "startedAt");
ALTER TABLE "recordings" ALTER COLUMN "id" DROP DEFAULT;

CREATE TABLE IF NOT EXISTS "control_commands" (
  "id" UUID NOT NULL,
  "robotId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "buttonId" UUID,
  "command" VARCHAR(64) NOT NULL,
  "costCredits" INTEGER NOT NULL DEFAULT 0,
  "ledgerGroupId" UUID,
  "status" "ControlCommandStatus" NOT NULL DEFAULT 'PENDING',
  "errorCode" VARCHAR(64),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "acknowledgedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "control_commands_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "control_commands_robotId_fkey" FOREIGN KEY ("robotId") REFERENCES "robots"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "control_commands_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "control_commands_robotId_createdAt_idx" ON "control_commands"("robotId", "createdAt");
CREATE INDEX IF NOT EXISTS "control_commands_userId_createdAt_idx" ON "control_commands"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "control_commands_status_createdAt_idx" ON "control_commands"("status", "createdAt");

-- Financial rows survive account anonymization and cannot be cascaded away.
ALTER TABLE "transactions" DROP CONSTRAINT IF EXISTS "transactions_userId_fkey";
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "billing_intents" DROP CONSTRAINT IF EXISTS "billing_intents_userId_fkey";
ALTER TABLE "billing_intents" ADD CONSTRAINT "billing_intents_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wallet_idempotency_keys" DROP CONSTRAINT IF EXISTS "wallet_idempotency_keys_userId_fkey";
ALTER TABLE "wallet_idempotency_keys" ADD CONSTRAINT "wallet_idempotency_keys_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payout_requests" DROP CONSTRAINT IF EXISTS "payout_requests_userId_fkey";
ALTER TABLE "payout_requests" ADD CONSTRAINT "payout_requests_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
