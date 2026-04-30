-- ─── Extend TransactionType enum (idempotent) ───────────────────────────────
ALTER TYPE "TransactionType" ADD VALUE IF NOT EXISTS 'BUTTON_SPEND';
ALTER TYPE "TransactionType" ADD VALUE IF NOT EXISTS 'BUTTON_PAYOUT';
ALTER TYPE "TransactionType" ADD VALUE IF NOT EXISTS 'DONATION_SENT';
ALTER TYPE "TransactionType" ADD VALUE IF NOT EXISTS 'DONATION_RECEIVED';
ALTER TYPE "TransactionType" ADD VALUE IF NOT EXISTS 'PLATFORM_FEE';
ALTER TYPE "TransactionType" ADD VALUE IF NOT EXISTS 'ADMIN_ADJUSTMENT';
ALTER TYPE "TransactionType" ADD VALUE IF NOT EXISTS 'REFUND';
ALTER TYPE "TransactionType" ADD VALUE IF NOT EXISTS 'CHARGEBACK';

-- ─── New enums ───────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "BillingIntentStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'REFUNDED', 'CHARGEBACK');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "PayoutRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'PAID');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── transactions: ledger group + better index ──────────────────────────────
ALTER TABLE "transactions"
  ADD COLUMN IF NOT EXISTS "ledgerGroupId" UUID;

CREATE INDEX IF NOT EXISTS "transactions_ledgerGroupId_idx"
  ON "transactions"("ledgerGroupId");

DROP INDEX IF EXISTS "transactions_userId_idx";
CREATE INDEX IF NOT EXISTS "transactions_userId_createdAt_idx"
  ON "transactions"("userId", "createdAt");

-- ─── control_buttons: per-button credit cost ────────────────────────────────
ALTER TABLE "control_buttons"
  ADD COLUMN IF NOT EXISTS "costCredits" INT NOT NULL DEFAULT 0;

DO $$ BEGIN
  ALTER TABLE "control_buttons"
    ADD CONSTRAINT "control_buttons_costCredits_nonneg" CHECK ("costCredits" >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── users: nonneg constraints (best-effort; existing data assumed >= 0) ────
DO $$ BEGIN
  ALTER TABLE "users"
    ADD CONSTRAINT "users_balance_nonneg" CHECK ("balance" >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "users"
    ADD CONSTRAINT "users_credits_nonneg" CHECK ("credits" >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── billing_intents ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "billing_intents" (
  "id"            UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId"        UUID NOT NULL,
  "provider"      VARCHAR(16) NOT NULL,
  "providerRef"   VARCHAR(128),
  "packageId"     VARCHAR(64) NOT NULL,
  "amountCents"   INT NOT NULL,
  "currency"      VARCHAR(8) NOT NULL,
  "creditsAmount" INT NOT NULL,
  "status"        "BillingIntentStatus" NOT NULL DEFAULT 'PENDING',
  "metadata"      JSONB,
  "paidAt"        TIMESTAMP(3),
  "refundedAt"    TIMESTAMP(3),
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "billing_intents_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "billing_intents_amountCents_pos" CHECK ("amountCents" > 0),
  CONSTRAINT "billing_intents_creditsAmount_pos" CHECK ("creditsAmount" > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "billing_intents_provider_providerRef_key"
  ON "billing_intents"("provider", "providerRef") WHERE "providerRef" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "billing_intents_userId_status_idx"
  ON "billing_intents"("userId", "status");
CREATE INDEX IF NOT EXISTS "billing_intents_status_createdAt_idx"
  ON "billing_intents"("status", "createdAt");

DO $$ BEGIN
  ALTER TABLE "billing_intents"
    ADD CONSTRAINT "billing_intents_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── billing_webhook_events ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "billing_webhook_events" (
  "id"          UUID NOT NULL DEFAULT gen_random_uuid(),
  "provider"    VARCHAR(16) NOT NULL,
  "eventId"     VARCHAR(128) NOT NULL,
  "eventType"   VARCHAR(64) NOT NULL,
  "payload"     JSONB NOT NULL,
  "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "billing_webhook_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "billing_webhook_events_provider_eventId_key"
  ON "billing_webhook_events"("provider", "eventId");
CREATE INDEX IF NOT EXISTS "billing_webhook_events_processedAt_idx"
  ON "billing_webhook_events"("processedAt");

-- ─── wallet_idempotency_keys ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "wallet_idempotency_keys" (
  "id"            UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId"        UUID NOT NULL,
  "scope"         VARCHAR(32) NOT NULL,
  "key"           VARCHAR(128) NOT NULL,
  "transactionId" UUID,
  "result"        JSONB,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "wallet_idempotency_keys_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "wallet_idempotency_keys_userId_scope_key_key"
  ON "wallet_idempotency_keys"("userId", "scope", "key");
CREATE INDEX IF NOT EXISTS "wallet_idempotency_keys_createdAt_idx"
  ON "wallet_idempotency_keys"("createdAt");

DO $$ BEGIN
  ALTER TABLE "wallet_idempotency_keys"
    ADD CONSTRAINT "wallet_idempotency_keys_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── payout_requests ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "payout_requests" (
  "id"           UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId"       UUID NOT NULL,
  "amount"       INT NOT NULL,
  "status"       "PayoutRequestStatus" NOT NULL DEFAULT 'PENDING',
  "destination"  VARCHAR(128) NOT NULL,
  "notes"        VARCHAR(1000),
  "reviewedById" UUID,
  "reviewedAt"   TIMESTAMP(3),
  "paidAt"       TIMESTAMP(3),
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payout_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payout_requests_amount_pos" CHECK ("amount" > 0)
);

CREATE INDEX IF NOT EXISTS "payout_requests_userId_status_idx"
  ON "payout_requests"("userId", "status");
CREATE INDEX IF NOT EXISTS "payout_requests_status_createdAt_idx"
  ON "payout_requests"("status", "createdAt");

DO $$ BEGIN
  ALTER TABLE "payout_requests"
    ADD CONSTRAINT "payout_requests_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── Platform system user (idempotent) ──────────────────────────────────────
-- Created with a fixed UUID so the API can reference it via PLATFORM_USER_ID env.
-- The user is hidden from staff lists by application logic.
INSERT INTO "users" (
  "id", "username", "email", "passwordHash", "displayName",
  "role", "balance", "credits", "tokenVersion", "isActive", "emailVerified",
  "createdAt", "updatedAt"
)
VALUES (
  '00000000-0000-0000-0000-00000000fee5',
  '__platform__',
  'platform@botparty.internal',
  '$argon2id$v=19$m=65536,t=3,p=4$disabled-disabled-disabled-disabled$disabled-disabled-disabled-disabled-disabled-disabled-disabled',
  'BotParty Platform',
  'ADMIN',
  0,
  0,
  0,
  TRUE,
  TRUE,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("id") DO NOTHING;
