-- Match the public discovery sorts so PostgreSQL can stop after LIMIT instead
-- of sorting every public robot under concurrent browse traffic.
CREATE INDEX "robots_visibility_createdAt_idx"
ON "robots"("visibility", "createdAt" DESC);

CREATE INDEX "robots_visibility_totalSessions_viewerCount_createdAt_idx"
ON "robots"("visibility", "totalSessions" DESC, "viewerCount" DESC, "createdAt" DESC);

CREATE INDEX "robots_visibility_isFeatured_viewerCount_createdAt_idx"
ON "robots"("visibility", "isFeatured" DESC, "viewerCount" DESC, "createdAt" DESC);

-- Cover deterministic notification pagination without a per-request sort.
DROP INDEX "notifications_userId_createdAt_idx";
CREATE INDEX "notifications_userId_createdAt_id_idx"
ON "notifications"("userId", "createdAt" DESC, "id" DESC);
