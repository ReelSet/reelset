-- Owners ask for a private reel to go public: the review lives on the item (publishing is per item).
ALTER TABLE "item" ADD COLUMN "publish_review" TEXT;
ALTER TABLE "item" ADD COLUMN "publish_requested_at" TIMESTAMPTZ(6);
ALTER TABLE "item" ADD COLUMN "publish_reviewed_at" TIMESTAMPTZ(6);
ALTER TABLE "item" ADD COLUMN "publish_note" TEXT;
ALTER TABLE "item" ADD CONSTRAINT "item_publish_review_check" CHECK ("publish_review" IS NULL OR "publish_review" IN ('pending', 'approved', 'rejected'));
CREATE INDEX "item_publish_pending_idx" ON "item"("publish_requested_at") WHERE "publish_review" = 'pending';

-- One admin email per new signup: claimed atomically; existing profiles count as already notified.
ALTER TABLE "profile" ADD COLUMN "signup_notified_at" TIMESTAMPTZ(6);
UPDATE "profile" SET "signup_notified_at" = "created_at";
