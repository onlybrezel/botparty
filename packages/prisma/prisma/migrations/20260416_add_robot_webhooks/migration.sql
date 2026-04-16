CREATE TABLE IF NOT EXISTS "robot_webhooks" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "robotId" UUID NOT NULL,
  "url" VARCHAR(1024) NOT NULL,
  "secret" VARCHAR(64) NOT NULL,
  "events" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
  "lastTriggeredAt" TIMESTAMP(3),
  "lastStatusCode" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "robot_webhooks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "robot_webhooks_robotId_isActive_idx"
ON "robot_webhooks"("robotId", "isActive");

CREATE INDEX IF NOT EXISTS "robot_webhooks_robotId_createdAt_idx"
ON "robot_webhooks"("robotId", "createdAt");

DO $$
BEGIN
  ALTER TABLE "robot_webhooks"
  ADD CONSTRAINT "robot_webhooks_robotId_fkey"
  FOREIGN KEY ("robotId") REFERENCES "robots"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
