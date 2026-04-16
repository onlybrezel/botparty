ALTER TABLE "chat_messages"
ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "deletedById" UUID;

CREATE INDEX IF NOT EXISTS "chat_messages_deletedAt_idx"
ON "chat_messages"("deletedAt");

DO $$
BEGIN
  ALTER TABLE "chat_messages"
  ADD CONSTRAINT "chat_messages_deletedById_fkey"
  FOREIGN KEY ("deletedById") REFERENCES "users"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "admin_audit_logs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "actorId" UUID,
  "action" VARCHAR(64) NOT NULL,
  "targetType" VARCHAR(32),
  "targetId" UUID,
  "payload" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "admin_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "admin_audit_logs_actorId_createdAt_idx"
ON "admin_audit_logs"("actorId", "createdAt");

CREATE INDEX IF NOT EXISTS "admin_audit_logs_action_createdAt_idx"
ON "admin_audit_logs"("action", "createdAt");

CREATE INDEX IF NOT EXISTS "admin_audit_logs_targetType_targetId_createdAt_idx"
ON "admin_audit_logs"("targetType", "targetId", "createdAt");

DO $$
BEGIN
  ALTER TABLE "admin_audit_logs"
  ADD CONSTRAINT "admin_audit_logs_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "users"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;