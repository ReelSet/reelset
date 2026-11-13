-- Reel views: one row per (reel, viewer, UTC day) dedupes the beacon; item.view_count is the fast counter.
ALTER TABLE "item" ADD COLUMN "view_count" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "item_view" (
    "item_id" UUID NOT NULL,
    "viewer_key" VARCHAR(64) NOT NULL,
    "day" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "item_view_pkey" PRIMARY KEY ("item_id", "viewer_key", "day")
);

CREATE INDEX "item_view_viewer_created_idx" ON "item_view"("viewer_key", "created_at" DESC);

ALTER TABLE "item_view" ADD CONSTRAINT "item_view_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "item_view" ENABLE ROW LEVEL SECURITY;

-- Backfill from reel_start events so existing reels do not start at zero.
UPDATE "item" i SET "view_count" = s.n
FROM (
    SELECT "item_id", count(DISTINCT coalesce("profile_id"::text, "session_id")) AS n
    FROM "event" WHERE "name" = 'reel_start' AND "item_id" IS NOT NULL GROUP BY "item_id"
) s
WHERE i."id" = s."item_id";
