-- Uploaded thumbnails used to contain their direct object-storage URL. Route
-- those objects through the API so private robots receive the same ownership
-- checks as every other file access path.
UPDATE "robots"
SET "thumbnailUrl" = '/api/v1/robots/' || "id" || '/thumbnail-image'
WHERE "thumbnailUrl" LIKE '%/robot-thumbnails/%';
