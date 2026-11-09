-- pgvector lives in Supabase's "extensions" schema, which is on the default search_path.
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "source" AS ENUM ('hn', 'github', 'news', 'reddit', 'youtube');

-- CreateEnum
CREATE TYPE "item_kind" AS ENUM ('repo', 'video', 'article', 'discussion');

-- CreateEnum
CREATE TYPE "item_status" AS ENUM ('found', 'summarized', 'embedded', 'voiced', 'rendered', 'insufficient_source', 'failed');

-- CreateEnum
CREATE TYPE "mention_kind" AS ENUM ('post', 'comment', 'video', 'repo', 'article');

-- CreateEnum
CREATE TYPE "stage_outcome" AS ENUM ('started', 'ok', 'failed', 'skipped');

-- CreateEnum
CREATE TYPE "render_status" AS ENUM ('queued', 'rendering', 'done', 'failed');

-- CreateEnum
CREATE TYPE "ingest_run_status" AS ENUM ('running', 'done', 'failed');

-- CreateEnum
CREATE TYPE "ingest_task_status" AS ENUM ('queued', 'running', 'ok', 'empty', 'failed', 'deferred');

-- CreateEnum
CREATE TYPE "ingest_mode" AS ENUM ('incremental', 'backfill');

-- CreateEnum
CREATE TYPE "watermark_lane" AS ENUM ('default', 'discover', 'sweep');

-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('user', 'admin');

-- CreateEnum
CREATE TYPE "event_name" AS ENUM ('feed_view', 'item_open', 'reel_start', 'reel_complete', 'like', 'unlike', 'ask_submit', 'ask_answer_view');

-- CreateEnum
CREATE TYPE "ask_outcome" AS ENUM ('answered', 'no_evidence', 'rate_limited', 'spend_capped', 'error');

-- CreateEnum
CREATE TYPE "spend_category" AS ENUM ('llm', 'embedding', 'tts', 'render', 'storage');

-- CreateTable
CREATE TABLE "item" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "canonical_key" VARCHAR(512) NOT NULL,
    "canonical_url" TEXT NOT NULL,
    "kind" "item_kind" NOT NULL,
    "title" TEXT NOT NULL,
    "topics" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "item_status" NOT NULL DEFAULT 'found',
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tldr" TEXT,
    "script" JSONB,
    "content_hash" VARCHAR(64),
    "prompt_version" VARCHAR(32),
    "embedding" vector(768),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "published_at" TIMESTAMPTZ(6) NOT NULL,
    "first_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status_changed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rendered_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mention" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "item_id" UUID NOT NULL,
    "source" "source" NOT NULL,
    "kind" "mention_kind" NOT NULL,
    "external_id" VARCHAR(128) NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT,
    "author" VARCHAR(255),
    "body" TEXT,
    "score" INTEGER,
    "num_comments" INTEGER,
    "published_at" TIMESTAMPTZ(6) NOT NULL,
    "fetched_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scored_at" TIMESTAMPTZ(6),
    "raw" JSONB,

    CONSTRAINT "mention_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence_chunk" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "item_id" UUID NOT NULL,
    "mention_id" UUID NOT NULL,
    "chunk_index" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "embedding" vector(768),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evidence_chunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_event" (
    "id" BIGSERIAL NOT NULL,
    "item_id" UUID NOT NULL,
    "stage" "item_status" NOT NULL,
    "outcome" "stage_outcome" NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "duration_ms" INTEGER,
    "error" TEXT,
    "meta" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "item_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "render" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "item_id" UUID NOT NULL,
    "render_key" VARCHAR(64) NOT NULL,
    "status" "render_status" NOT NULL DEFAULT 'queued',
    "video_key" TEXT,
    "poster_key" TEXT,
    "bytes" INTEGER,
    "video_duration_ms" INTEGER,
    "render_ms" INTEGER,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMPTZ(6),
    "finished_at" TIMESTAMPTZ(6),

    CONSTRAINT "render_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingest_run" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "mode" "ingest_mode" NOT NULL DEFAULT 'incremental',
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "heartbeat_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(6),
    "status" "ingest_run_status" NOT NULL DEFAULT 'running',
    "result" JSONB,

    CONSTRAINT "ingest_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingest_task" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "run_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "source" "source" NOT NULL,
    "scope" VARCHAR(128) NOT NULL DEFAULT 'default',
    "status" "ingest_task_status" NOT NULL DEFAULT 'queued',
    "fetched" INTEGER NOT NULL DEFAULT 0,
    "inserted" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "duration_ms" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "started_at" TIMESTAMPTZ(6),
    "finished_at" TIMESTAMPTZ(6),

    CONSTRAINT "ingest_task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_watermark" (
    "source" "source" NOT NULL,
    "scope" VARCHAR(128) NOT NULL DEFAULT 'default',
    "lane" "watermark_lane" NOT NULL DEFAULT 'default',
    "newest_at" TIMESTAMPTZ(6),
    "oldest_at" TIMESTAMPTZ(6),
    "next_token" TEXT,
    "backfill_complete" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "source_watermark_pkey" PRIMARY KEY ("source","scope","lane")
);

-- CreateTable
CREATE TABLE "profile" (
    "id" UUID NOT NULL,
    "role" "user_role" NOT NULL DEFAULT 'user',
    "topics" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "taste_embedding" vector(768),
    "signal_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "like" (
    "profile_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "like_pkey" PRIMARY KEY ("profile_id","item_id")
);

-- CreateTable
CREATE TABLE "event" (
    "id" BIGSERIAL NOT NULL,
    "profile_id" UUID,
    "session_id" VARCHAR(64) NOT NULL,
    "name" "event_name" NOT NULL,
    "item_id" UUID,
    "meta" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ask_query" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "profile_id" UUID,
    "question" TEXT NOT NULL,
    "normalized_question" TEXT NOT NULL,
    "answer" TEXT,
    "citations" JSONB,
    "outcome" "ask_outcome" NOT NULL,
    "latency_ms" INTEGER,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ask_query_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spend_ledger" (
    "id" BIGSERIAL NOT NULL,
    "day" DATE NOT NULL,
    "category" "spend_category" NOT NULL,
    "units" DECIMAL(18,4) NOT NULL,
    "cost_usd" DECIMAL(12,6) NOT NULL,
    "meta" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "spend_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_setting" (
    "key" VARCHAR(128) NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_setting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "item_canonical_key_key" ON "item"("canonical_key");

-- CreateIndex
CREATE INDEX "item_feed_idx" ON "item"("status", "published_at" DESC);

-- CreateIndex
CREATE INDEX "item_status_changed_idx" ON "item"("status", "status_changed_at");

-- CreateIndex
CREATE INDEX "mention_item_idx" ON "mention"("item_id");

-- CreateIndex
CREATE INDEX "mention_scored_idx" ON "mention"("source", "scored_at");

-- CreateIndex
CREATE UNIQUE INDEX "mention_source_external_key" ON "mention"("source", "external_id");

-- CreateIndex
CREATE INDEX "evidence_chunk_item_idx" ON "evidence_chunk"("item_id");

-- CreateIndex
CREATE UNIQUE INDEX "evidence_chunk_mention_index_key" ON "evidence_chunk"("mention_id", "chunk_index");

-- CreateIndex
CREATE INDEX "item_event_item_created_idx" ON "item_event"("item_id", "created_at");

-- CreateIndex
CREATE INDEX "item_event_created_idx" ON "item_event"("created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "render_render_key_key" ON "render"("render_key");

-- CreateIndex
CREATE INDEX "render_item_created_idx" ON "render"("item_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "render_status_created_idx" ON "render"("status", "created_at");

-- CreateIndex
CREATE INDEX "ingest_run_started_idx" ON "ingest_run"("started_at" DESC);

-- CreateIndex
CREATE INDEX "ingest_task_source_started_idx" ON "ingest_task"("source", "started_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "ingest_task_run_position_key" ON "ingest_task"("run_id", "position");

-- CreateIndex
CREATE INDEX "like_item_idx" ON "like"("item_id");

-- CreateIndex
CREATE INDEX "event_name_created_idx" ON "event"("name", "created_at" DESC);

-- CreateIndex
CREATE INDEX "event_profile_created_idx" ON "event"("profile_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "ask_query_cache_idx" ON "ask_query"("normalized_question", "created_at" DESC);

-- CreateIndex
CREATE INDEX "ask_query_created_idx" ON "ask_query"("created_at" DESC);

-- CreateIndex
CREATE INDEX "spend_ledger_day_category_idx" ON "spend_ledger"("day", "category");

-- AddForeignKey
ALTER TABLE "mention" ADD CONSTRAINT "mention_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_chunk" ADD CONSTRAINT "evidence_chunk_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_chunk" ADD CONSTRAINT "evidence_chunk_mention_id_fkey" FOREIGN KEY ("mention_id") REFERENCES "mention"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_event" ADD CONSTRAINT "item_event_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "render" ADD CONSTRAINT "render_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingest_task" ADD CONSTRAINT "ingest_task_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "ingest_run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "like" ADD CONSTRAINT "like_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "like" ADD CONSTRAINT "like_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event" ADD CONSTRAINT "event_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event" ADD CONSTRAINT "event_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ask_query" ADD CONSTRAINT "ask_query_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Hand-written: Prisma cannot model HNSW indexes. Do not let a later `migrate diff` drop these.
CREATE INDEX "item_embedding_hnsw_idx" ON "item" USING hnsw ("embedding" vector_cosine_ops);
CREATE INDEX "evidence_chunk_embedding_hnsw_idx" ON "evidence_chunk" USING hnsw ("embedding" vector_cosine_ops);

-- Hand-written: deny all access through Supabase's auto-generated API (anon/authenticated roles).
-- Server code connects as postgres, which bypasses RLS. Add policies only when a table must be
-- reachable from the browser.
ALTER TABLE "item" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mention" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "evidence_chunk" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "item_event" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "render" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ingest_run" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ingest_task" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "source_watermark" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "profile" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "like" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "event" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ask_query" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "spend_ledger" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "app_setting" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "_prisma_migrations" ENABLE ROW LEVEL SECURITY;
