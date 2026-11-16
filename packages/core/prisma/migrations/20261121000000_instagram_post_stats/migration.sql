-- Real Instagram numbers per post, synced hourly from the official API: likes and comments from the
-- media list, views/reach/saves/shares from media insights (needs instagram_manage_insights).
ALTER TABLE "instagram_post" ADD COLUMN "like_count" INTEGER;
ALTER TABLE "instagram_post" ADD COLUMN "comments_count" INTEGER;
ALTER TABLE "instagram_post" ADD COLUMN "view_count" INTEGER;
ALTER TABLE "instagram_post" ADD COLUMN "reach" INTEGER;
ALTER TABLE "instagram_post" ADD COLUMN "saves" INTEGER;
ALTER TABLE "instagram_post" ADD COLUMN "shares" INTEGER;
ALTER TABLE "instagram_post" ADD COLUMN "stats_at" TIMESTAMPTZ(6);
ALTER TABLE "instagram_post" ADD COLUMN "insights_at" TIMESTAMPTZ(6);
