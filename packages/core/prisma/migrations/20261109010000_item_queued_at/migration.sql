-- queued_at IS NULL means "needs to be enqueued". Only the ingest worker enqueues (ingest-items
-- for found/summarized, render-jobs for embedded). Admin Retry and the render reconciler just set
-- it to NULL.
ALTER TABLE "item" ADD COLUMN "queued_at" TIMESTAMPTZ(6);

CREATE INDEX "item_requeue_idx" ON "item"("status", "queued_at");
