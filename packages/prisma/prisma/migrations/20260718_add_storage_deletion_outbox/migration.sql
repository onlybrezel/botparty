CREATE TABLE "storage_deletion_tasks" (
    "id" UUID NOT NULL,
    "bucket" VARCHAR(255) NOT NULL,
    "objectKey" VARCHAR(1024) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" VARCHAR(1000),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "storage_deletion_tasks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "storage_deletion_tasks_bucket_objectKey_key"
    ON "storage_deletion_tasks"("bucket", "objectKey");
CREATE INDEX "storage_deletion_tasks_nextAttemptAt_idx"
    ON "storage_deletion_tasks"("nextAttemptAt");
