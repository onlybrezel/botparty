-- The unread counter is evaluated for every authenticated request. Restricting the
-- index to unread rows keeps it small while covering user and expiry filtering.
CREATE INDEX "notifications_unread_user_expires_idx"
ON "notifications"("userId", "expiresAt")
WHERE "readAt" IS NULL;
