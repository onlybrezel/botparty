-- ─── Billing subscriptions ──────────────────────────────────────────────────
ALTER TYPE "BillingIntentStatus" ADD VALUE IF NOT EXISTS 'CANCELED';

DO $$ BEGIN
  CREATE TYPE "BillingPurchaseType" AS ENUM ('ONE_TIME', 'SUBSCRIPTION');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "billing_intents"
  ADD COLUMN IF NOT EXISTS "providerCustomerRef" VARCHAR(128),
  ADD COLUMN IF NOT EXISTS "purchaseType" "BillingPurchaseType" NOT NULL DEFAULT 'ONE_TIME';

DROP INDEX IF EXISTS "billing_intents_userId_status_idx";
CREATE INDEX IF NOT EXISTS "billing_intents_userId_purchaseType_status_idx"
  ON "billing_intents"("userId", "purchaseType", "status");
