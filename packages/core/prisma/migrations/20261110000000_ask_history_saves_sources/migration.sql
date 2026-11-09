-- Ask history: conversation grouping, cache-hit marker (cache hits keep their answer for history
-- but must not refresh the one-hour cache window) and soft delete (rows still count toward the
-- hourly rate limit, so deleting history cannot be used to dodge it).
ALTER TABLE "ask_query" ADD COLUMN "conversation_id" UUID;
ALTER TABLE "ask_query" ADD COLUMN "cached" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ask_query" ADD COLUMN "deleted_at" TIMESTAMPTZ(6);
CREATE INDEX "ask_query_profile_idx" ON "ask_query"("profile_id", "created_at" DESC);
CREATE INDEX "ask_query_conversation_idx" ON "ask_query"("conversation_id");

-- Feed source preference. Empty array means every source.
ALTER TABLE "profile" ADD COLUMN "sources" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Saved reels.
CREATE TABLE "save" (
    "profile_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "save_pkey" PRIMARY KEY ("profile_id","item_id")
);
CREATE INDEX "save_item_idx" ON "save"("item_id");
ALTER TABLE "save" ADD CONSTRAINT "save_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "save" ADD CONSTRAINT "save_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hand-written: RLS. Server code connects as postgres (bypasses RLS); these policies only let a
-- signed-in browser client read its own rows through the Supabase API.
ALTER TABLE "save" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "save_owner_select" ON "save" FOR SELECT TO authenticated USING (profile_id = auth.uid());
CREATE POLICY "save_owner_insert" ON "save" FOR INSERT TO authenticated WITH CHECK (profile_id = auth.uid());
CREATE POLICY "save_owner_delete" ON "save" FOR DELETE TO authenticated USING (profile_id = auth.uid());
CREATE POLICY "ask_query_owner_select" ON "ask_query" FOR SELECT TO authenticated USING (profile_id = auth.uid() AND deleted_at IS NULL);
CREATE POLICY "profile_owner_select" ON "profile" FOR SELECT TO authenticated USING (id = auth.uid());
