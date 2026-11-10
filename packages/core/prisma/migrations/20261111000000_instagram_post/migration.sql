-- Admin-queued Instagram reel posts, executed server-side by the render worker (one at a time).
CREATE TYPE "instagram_post_status" AS ENUM ('draft', 'queued', 'posting', 'posted', 'failed', 'deleting', 'deleted');

CREATE TABLE "instagram_post" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "item_id" UUID NOT NULL,
    "video_key" TEXT NOT NULL,
    "caption" TEXT NOT NULL,
    "status" "instagram_post_status" NOT NULL DEFAULT 'queued',
    "media_pk" TEXT,
    "permalink" TEXT,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "requested_by" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMPTZ(6),
    "posted_at" TIMESTAMPTZ(6),
    "delete_requested_at" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "instagram_post_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "instagram_post_status_created_idx" ON "instagram_post"("status", "created_at");
CREATE INDEX "instagram_post_item_idx" ON "instagram_post"("item_id");
-- At most one live (queued, posting or posted) post per item.
CREATE UNIQUE INDEX "instagram_post_item_live_key" ON "instagram_post"("item_id") WHERE "status" IN ('queued', 'posting', 'posted', 'deleting');

ALTER TABLE "instagram_post" ADD CONSTRAINT "instagram_post_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hand-written: RLS on, no policies; only the server (postgres role) reads and writes it.
ALTER TABLE "instagram_post" ENABLE ROW LEVEL SECURITY;
