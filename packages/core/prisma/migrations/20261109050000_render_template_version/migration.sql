-- Template of the render, so the feed can hide reels older than app_setting feed_min_template.
-- NULL means unknown (legacy row, backfilled by scripts/maintenance/backfill-render-template.ts).
ALTER TABLE "render" ADD COLUMN "template_version" INTEGER;
