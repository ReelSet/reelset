-- Real source imagery for reels: [{ url, kind, width?, height?, alt? }], at most 6. NULL = not captured yet.
ALTER TABLE "item" ADD COLUMN "images" JSONB;
