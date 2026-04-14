-- Add backward-compatible slug alias support for robot URL migrations
ALTER TABLE "Robot"
ADD COLUMN "slugAliases" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
