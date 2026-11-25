-- 360 px WebP of the poster for grids (render worker writes it next to poster_key). Null for renders
-- made before this column existed or by an old box image; grids fall back to the poster.
ALTER TABLE "render" ADD COLUMN "thumb_key" TEXT;
