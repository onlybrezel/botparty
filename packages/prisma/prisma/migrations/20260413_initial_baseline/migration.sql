-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'MOD', 'USER');

-- CreateEnum
CREATE TYPE "RobotVisibility" AS ENUM ('PUBLIC', 'UNLISTED', 'PRIVATE');

-- CreateEnum
CREATE TYPE "RobotAccessMode" AS ENUM ('OPEN', 'PASSWORD', 'LINK_ONLY', 'ALLOWED_USERS');

-- CreateEnum
CREATE TYPE "QueueMode" AS ENUM ('FIRST_COME', 'VOTING', 'DISABLED');

-- CreateEnum
CREATE TYPE "RobotStatus" AS ENUM ('ONLINE', 'OFFLINE', 'BUSY', 'MAINTENANCE');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('DEPOSIT', 'WITHDRAWAL', 'PRIORITY_QUEUE', 'FEATURED_ROBOT', 'BATTLE_ENTRY', 'REWARD', 'BUTTON_SPEND', 'BUTTON_PAYOUT', 'DONATION_SENT', 'DONATION_RECEIVED', 'PLATFORM_FEE', 'ADMIN_ADJUSTMENT', 'REFUND', 'CHARGEBACK');

-- CreateEnum
CREATE TYPE "BillingIntentStatus" AS ENUM ('CREATING', 'PENDING', 'PAID', 'FAILED', 'NEEDS_REVIEW', 'REFUNDED', 'CHARGEBACK', 'CANCELED');

-- CreateEnum
CREATE TYPE "BillingPurchaseType" AS ENUM ('ONE_TIME', 'SUBSCRIPTION');

-- CreateEnum
CREATE TYPE "PayoutRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'PAID');

-- CreateEnum
CREATE TYPE "BillingWebhookProcessingStatus" AS ENUM ('PROCESSED', 'NEEDS_REVIEW', 'FAILED', 'IGNORED');

-- CreateEnum
CREATE TYPE "WalletIdempotencyStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "PayoutDestinationType" AS ENUM ('PAYPAL_EMAIL', 'IBAN');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('ACTIVE', 'ENDED', 'RECORDING');

-- CreateEnum
CREATE TYPE "ControlButtonAccess" AS ENUM ('EVERYONE', 'QUEUE_TURN', 'MODERATOR', 'OWNER');

-- CreateEnum
CREATE TYPE "ModerationActionType" AS ENUM ('TIMEOUT', 'KICK', 'BAN', 'UNBAN', 'WARN');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "username" VARCHAR(32) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "passwordHash" VARCHAR(255) NOT NULL,
    "displayName" VARCHAR(64),
    "avatarUrl" VARCHAR(512),
    "role" "Role" NOT NULL DEFAULT 'USER',
    "balance" INTEGER NOT NULL DEFAULT 0,
    "credits" INTEGER NOT NULL DEFAULT 0,
    "tokenVersion" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "emailVerificationToken" VARCHAR(64),
    "emailVerificationExpiry" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "robots" (
    "id" UUID NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "slug" VARCHAR(80) NOT NULL,
    "slugAliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "description" VARCHAR(2000),
    "thumbnailUrl" VARCHAR(512),
    "status" "RobotStatus" NOT NULL DEFAULT 'OFFLINE',
    "visibility" "RobotVisibility" NOT NULL DEFAULT 'PUBLIC',
    "accessMode" "RobotAccessMode" NOT NULL DEFAULT 'OPEN',
    "accessPassword" VARCHAR(255),
    "inviteCode" VARCHAR(32),
    "queueMode" "QueueMode" NOT NULL DEFAULT 'FIRST_COME',
    "maxTurnTime" INTEGER NOT NULL DEFAULT 60000,
    "maxViewers" INTEGER NOT NULL DEFAULT 1000,
    "maxControllers" INTEGER NOT NULL DEFAULT 10,
    "streamKeyHash" VARCHAR(64) NOT NULL,
    "claimTokenHash" VARCHAR(64) NOT NULL,
    "deviceTokenVersion" INTEGER NOT NULL DEFAULT 0,
    "livekitRoom" VARCHAR(128),
    "scheduleStart" TIMESTAMP(3),
    "scheduleEnd" TIMESTAMP(3),
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'UTC',
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "recordSessions" BOOLEAN NOT NULL DEFAULT false,
    "aiAssistEnabled" BOOLEAN NOT NULL DEFAULT false,
    "ros2Enabled" BOOLEAN NOT NULL DEFAULT false,
    "swarmGroupId" UUID,
    "viewerCount" INTEGER NOT NULL DEFAULT 0,
    "totalSessions" INTEGER NOT NULL DEFAULT 0,
    "totalViewers" INTEGER NOT NULL DEFAULT 0,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "metadata" JSONB,
    "lastOnlineAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ownerId" UUID NOT NULL,

    CONSTRAINT "robots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "robot_allowed_users" (
    "id" UUID NOT NULL,
    "robotId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "robot_allowed_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" "TransactionType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "ledgerGroupId" UUID,
    "billingIntentId" UUID,
    "billingReversalKey" VARCHAR(192),
    "payoutRequestId" UUID,
    "controlCommandId" UUID,
    "description" VARCHAR(255),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_intents" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "provider" VARCHAR(16) NOT NULL,
    "providerRef" VARCHAR(128),
    "providerCustomerRef" VARCHAR(128),
    "providerPaymentRef" VARCHAR(128),
    "providerSubscriptionRef" VARCHAR(128),
    "purchaseType" "BillingPurchaseType" NOT NULL DEFAULT 'ONE_TIME',
    "packageId" VARCHAR(64) NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" VARCHAR(8) NOT NULL,
    "creditsAmount" INTEGER NOT NULL,
    "status" "BillingIntentStatus" NOT NULL DEFAULT 'PENDING',
    "metadata" JSONB,
    "paidAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "billing_intents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_webhook_events" (
    "id" UUID NOT NULL,
    "provider" VARCHAR(16) NOT NULL,
    "eventId" VARCHAR(128) NOT NULL,
    "eventType" VARCHAR(64) NOT NULL,
    "payload" JSONB NOT NULL,
    "intentId" UUID,
    "status" "BillingWebhookProcessingStatus" NOT NULL DEFAULT 'PROCESSED',
    "errorCode" VARCHAR(64),
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_idempotency_keys" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "scope" VARCHAR(32) NOT NULL,
    "key" VARCHAR(128) NOT NULL,
    "transactionId" UUID,
    "requestHash" VARCHAR(64) NOT NULL,
    "status" "WalletIdempotencyStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallet_idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payout_requests" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" "PayoutRequestStatus" NOT NULL DEFAULT 'PENDING',
    "destinationType" "PayoutDestinationType" NOT NULL,
    "destination" VARCHAR(1024) NOT NULL,
    "destinationLast4" VARCHAR(16) NOT NULL,
    "notes" VARCHAR(1000),
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMP(3),
    "paidById" UUID,
    "providerRef" VARCHAR(192),
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payout_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "robotId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "recordingUrl" VARCHAR(512),
    "peakViewers" INTEGER NOT NULL DEFAULT 0,
    "totalCommands" INTEGER NOT NULL DEFAULT 0,
    "avgLatencyMs" DOUBLE PRECISION,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "queue_entries" (
    "id" UUID NOT NULL,
    "robotId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "isPriority" BOOLEAN NOT NULL DEFAULT false,
    "votes" INTEGER NOT NULL DEFAULT 0,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "queue_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" UUID NOT NULL,
    "robotId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "content" VARCHAR(500) NOT NULL,
    "clientMessageId" UUID,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "deletedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_audit_logs" (
    "id" UUID NOT NULL,
    "actorId" UUID,
    "action" VARCHAR(64) NOT NULL,
    "targetType" VARCHAR(32),
    "targetId" UUID,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL DEFAULT now() + interval '90 days',

    CONSTRAINT "admin_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recordings" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "robotId" UUID NOT NULL,
    "cameraId" VARCHAR(128),
    "egressId" VARCHAR(128) NOT NULL,
    "objectKey" VARCHAR(1024) NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recordings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "swarm_groups" (
    "id" UUID NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "description" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "swarm_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_events" (
    "id" UUID NOT NULL,
    "robotId" UUID,
    "userId" UUID,
    "event" VARCHAR(64) NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analytics_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "robot_webhooks" (
    "id" UUID NOT NULL,
    "robotId" UUID NOT NULL,
    "url" VARCHAR(1024) NOT NULL,
    "secret" VARCHAR(64) NOT NULL,
    "events" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastTriggeredAt" TIMESTAMP(3),
    "lastStatusCode" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "robot_webhooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "control_buttons" (
    "id" UUID NOT NULL,
    "robotId" UUID NOT NULL,
    "label" VARCHAR(32) NOT NULL,
    "command" VARCHAR(64) NOT NULL,
    "hotKey" VARCHAR(8),
    "icon" VARCHAR(64),
    "cooldownMs" INTEGER NOT NULL DEFAULT 200,
    "costCredits" INTEGER NOT NULL DEFAULT 0,
    "access" "ControlButtonAccess" NOT NULL DEFAULT 'QUEUE_TURN',
    "position" INTEGER NOT NULL DEFAULT 0,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "color" VARCHAR(16),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "control_buttons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "robot_moderation_entries" (
    "id" UUID NOT NULL,
    "robotId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "action" "ModerationActionType" NOT NULL,
    "reason" VARCHAR(500),
    "expiresAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "moderatorId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "robot_moderation_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_emailVerificationToken_key" ON "users"("emailVerificationToken");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_username_idx" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "robots_slug_key" ON "robots"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "robots_inviteCode_key" ON "robots"("inviteCode");

-- CreateIndex
CREATE UNIQUE INDEX "robots_streamKeyHash_key" ON "robots"("streamKeyHash");

-- CreateIndex
CREATE UNIQUE INDEX "robots_claimTokenHash_key" ON "robots"("claimTokenHash");

-- CreateIndex
CREATE INDEX "robots_ownerId_idx" ON "robots"("ownerId");

-- CreateIndex
CREATE INDEX "robots_status_idx" ON "robots"("status");

-- CreateIndex
CREATE INDEX "robots_visibility_status_idx" ON "robots"("visibility", "status");

-- CreateIndex
CREATE INDEX "robots_slug_idx" ON "robots"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "robot_allowed_users_robotId_userId_key" ON "robot_allowed_users"("robotId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_billingIntentId_key" ON "transactions"("billingIntentId");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_billingReversalKey_key" ON "transactions"("billingReversalKey");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_payoutRequestId_key" ON "transactions"("payoutRequestId");

-- CreateIndex
CREATE INDEX "transactions_userId_createdAt_idx" ON "transactions"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "transactions_type_idx" ON "transactions"("type");

-- CreateIndex
CREATE INDEX "transactions_ledgerGroupId_idx" ON "transactions"("ledgerGroupId");

-- CreateIndex
CREATE INDEX "transactions_createdAt_idx" ON "transactions"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_userId_controlCommandId_type_key" ON "transactions"("userId", "controlCommandId", "type");

-- CreateIndex
CREATE INDEX "billing_intents_userId_purchaseType_status_idx" ON "billing_intents"("userId", "purchaseType", "status");

-- CreateIndex
CREATE INDEX "billing_intents_status_createdAt_idx" ON "billing_intents"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "billing_intents_provider_providerRef_key" ON "billing_intents"("provider", "providerRef");

-- CreateIndex
CREATE UNIQUE INDEX "billing_intents_provider_providerPaymentRef_key" ON "billing_intents"("provider", "providerPaymentRef");

-- CreateIndex
CREATE UNIQUE INDEX "billing_intents_provider_providerSubscriptionRef_key" ON "billing_intents"("provider", "providerSubscriptionRef");

-- CreateIndex
CREATE INDEX "billing_webhook_events_processedAt_idx" ON "billing_webhook_events"("processedAt");

-- CreateIndex
CREATE UNIQUE INDEX "billing_webhook_events_provider_eventId_key" ON "billing_webhook_events"("provider", "eventId");

-- CreateIndex
CREATE INDEX "wallet_idempotency_keys_createdAt_idx" ON "wallet_idempotency_keys"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_idempotency_keys_userId_scope_key_key" ON "wallet_idempotency_keys"("userId", "scope", "key");

-- CreateIndex
CREATE UNIQUE INDEX "payout_requests_providerRef_key" ON "payout_requests"("providerRef");

-- CreateIndex
CREATE INDEX "payout_requests_userId_status_idx" ON "payout_requests"("userId", "status");

-- CreateIndex
CREATE INDEX "payout_requests_status_createdAt_idx" ON "payout_requests"("status", "createdAt");

-- CreateIndex
CREATE INDEX "payout_requests_reviewedById_reviewedAt_idx" ON "payout_requests"("reviewedById", "reviewedAt");

-- CreateIndex
CREATE INDEX "payout_requests_paidById_paidAt_idx" ON "payout_requests"("paidById", "paidAt");

-- CreateIndex
CREATE INDEX "sessions_robotId_idx" ON "sessions"("robotId");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE INDEX "sessions_startedAt_idx" ON "sessions"("startedAt");

-- CreateIndex
CREATE INDEX "queue_entries_robotId_position_idx" ON "queue_entries"("robotId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "queue_entries_robotId_userId_key" ON "queue_entries"("robotId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "queue_entries_robotId_position_key" ON "queue_entries"("robotId", "position");

-- CreateIndex
CREATE INDEX "chat_messages_robotId_createdAt_idx" ON "chat_messages"("robotId", "createdAt");

-- CreateIndex
CREATE INDEX "chat_messages_userId_idx" ON "chat_messages"("userId");

-- CreateIndex
CREATE INDEX "chat_messages_deletedAt_idx" ON "chat_messages"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "chat_messages_userId_clientMessageId_key" ON "chat_messages"("userId", "clientMessageId");

-- CreateIndex
CREATE INDEX "admin_audit_logs_actorId_createdAt_idx" ON "admin_audit_logs"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "admin_audit_logs_action_createdAt_idx" ON "admin_audit_logs"("action", "createdAt");

-- CreateIndex
CREATE INDEX "admin_audit_logs_targetType_targetId_createdAt_idx" ON "admin_audit_logs"("targetType", "targetId", "createdAt");

-- CreateIndex
CREATE INDEX "admin_audit_logs_expiresAt_idx" ON "admin_audit_logs"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "recordings_egressId_key" ON "recordings"("egressId");

-- CreateIndex
CREATE UNIQUE INDEX "recordings_objectKey_key" ON "recordings"("objectKey");

-- CreateIndex
CREATE INDEX "recordings_robotId_startedAt_idx" ON "recordings"("robotId", "startedAt");

-- CreateIndex
CREATE INDEX "recordings_sessionId_startedAt_idx" ON "recordings"("sessionId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "recordings_sessionId_cameraId_key" ON "recordings"("sessionId", "cameraId");

-- CreateIndex
CREATE INDEX "analytics_events_robotId_event_createdAt_idx" ON "analytics_events"("robotId", "event", "createdAt");

-- CreateIndex
CREATE INDEX "analytics_events_userId_event_createdAt_idx" ON "analytics_events"("userId", "event", "createdAt");

-- CreateIndex
CREATE INDEX "analytics_events_createdAt_idx" ON "analytics_events"("createdAt");

-- CreateIndex
CREATE INDEX "robot_webhooks_robotId_isActive_idx" ON "robot_webhooks"("robotId", "isActive");

-- CreateIndex
CREATE INDEX "robot_webhooks_robotId_createdAt_idx" ON "robot_webhooks"("robotId", "createdAt");

-- CreateIndex
CREATE INDEX "control_buttons_robotId_position_idx" ON "control_buttons"("robotId", "position");

-- CreateIndex
CREATE INDEX "control_buttons_robotId_isEnabled_idx" ON "control_buttons"("robotId", "isEnabled");

-- CreateIndex
CREATE INDEX "robot_moderation_entries_robotId_userId_isActive_idx" ON "robot_moderation_entries"("robotId", "userId", "isActive");

-- CreateIndex
CREATE INDEX "robot_moderation_entries_robotId_action_isActive_idx" ON "robot_moderation_entries"("robotId", "action", "isActive");

-- CreateIndex
CREATE INDEX "robot_moderation_entries_expiresAt_idx" ON "robot_moderation_entries"("expiresAt");

-- AddForeignKey
ALTER TABLE "robots" ADD CONSTRAINT "robots_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "robots" ADD CONSTRAINT "robots_swarmGroupId_fkey" FOREIGN KEY ("swarmGroupId") REFERENCES "swarm_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "robot_allowed_users" ADD CONSTRAINT "robot_allowed_users_robotId_fkey" FOREIGN KEY ("robotId") REFERENCES "robots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "robot_allowed_users" ADD CONSTRAINT "robot_allowed_users_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_intents" ADD CONSTRAINT "billing_intents_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_idempotency_keys" ADD CONSTRAINT "wallet_idempotency_keys_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payout_requests" ADD CONSTRAINT "payout_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payout_requests" ADD CONSTRAINT "payout_requests_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payout_requests" ADD CONSTRAINT "payout_requests_paidById_fkey" FOREIGN KEY ("paidById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_robotId_fkey" FOREIGN KEY ("robotId") REFERENCES "robots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_entries" ADD CONSTRAINT "queue_entries_robotId_fkey" FOREIGN KEY ("robotId") REFERENCES "robots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_entries" ADD CONSTRAINT "queue_entries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_robotId_fkey" FOREIGN KEY ("robotId") REFERENCES "robots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_audit_logs" ADD CONSTRAINT "admin_audit_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recordings" ADD CONSTRAINT "recordings_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recordings" ADD CONSTRAINT "recordings_robotId_fkey" FOREIGN KEY ("robotId") REFERENCES "robots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_robotId_fkey" FOREIGN KEY ("robotId") REFERENCES "robots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "robot_webhooks" ADD CONSTRAINT "robot_webhooks_robotId_fkey" FOREIGN KEY ("robotId") REFERENCES "robots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "control_buttons" ADD CONSTRAINT "control_buttons_robotId_fkey" FOREIGN KEY ("robotId") REFERENCES "robots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "robot_moderation_entries" ADD CONSTRAINT "robot_moderation_entries_robotId_fkey" FOREIGN KEY ("robotId") REFERENCES "robots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "robot_moderation_entries" ADD CONSTRAINT "robot_moderation_entries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "robot_moderation_entries" ADD CONSTRAINT "robot_moderation_entries_moderatorId_fkey" FOREIGN KEY ("moderatorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Compatibility shim for the already-published 20260414 migration, which
-- targeted Prisma's former default table name. The final release migration
-- removes this empty table again. Keeping the historical migration immutable
-- lets fresh databases replay the complete published history.
CREATE TABLE "Robot" (
  "id" TEXT NOT NULL,
  CONSTRAINT "Robot_pkey" PRIMARY KEY ("id")
);
