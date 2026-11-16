-- Official Instagram API publishing: the media container a post is published from, kept on the row
-- so a run that dies between creating the container and publishing it resumes instead of re-posting.
ALTER TABLE "instagram_post" ADD COLUMN "container_id" TEXT;
