-- Admin-hidden items: visibility gains 'hidden' (never public, never owner-visible), with a reason and time.
ALTER TABLE "item" ADD COLUMN "hidden_reason" TEXT;
ALTER TABLE "item" ADD COLUMN "hidden_at" TIMESTAMPTZ(6);
ALTER TABLE "item" ADD CONSTRAINT "item_visibility_check" CHECK ("visibility" IN ('public', 'private', 'hidden'));

-- Stopgap spam rows: public items with no owner that were set private by hand.
UPDATE "item"
SET "visibility" = 'hidden', "hidden_reason" = 'spam', "hidden_at" = now()
WHERE "owner_id" IS NULL AND "visibility" = 'private';

CREATE INDEX "item_hidden_idx" ON "item"("hidden_at") WHERE "visibility" = 'hidden';
