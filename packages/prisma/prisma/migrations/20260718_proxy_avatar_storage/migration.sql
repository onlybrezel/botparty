-- Platform-hosted avatars share the private object-storage bucket with robot
-- thumbnails. Keep the object key internal and route browser reads through the
-- API so the bucket itself can remain anonymous-access-free.
UPDATE "users"
SET "avatarUrl" = '/api/v1/users/' || "id" || '/avatar-image'
WHERE "avatarUrl" LIKE '%/avatars/%';
