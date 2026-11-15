-- Reel-worthiness gate: items judged not worth a reel settle as 'source_only' (no script, no render, still citable by Ask).
-- Postgres cannot use a new enum value in the transaction that adds it, so nothing below reads or writes 'source_only' as an item_status;
-- "verdict" is plain text. Keep it that way: any backfill or index on item.status = 'source_only' belongs in a later migration.
ALTER TYPE "item_status" ADD VALUE IF NOT EXISTS 'source_only';

-- One row per judgement; the newest row for an item is its current decision.
CREATE TABLE "gate_decision" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "item_id" UUID NOT NULL,
    "verdict" TEXT NOT NULL,
    "score" REAL,
    "threshold" REAL NOT NULL,
    "signals" JSONB NOT NULL DEFAULT '{}',
    "reasons" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "rationale" TEXT NOT NULL DEFAULT '',
    "decided_by" TEXT NOT NULL,
    "rule" TEXT,
    "mode" TEXT NOT NULL,
    "applied" BOOLEAN NOT NULL DEFAULT false,
    "model" TEXT,
    "prompt_version" TEXT NOT NULL,
    "config_hash" TEXT NOT NULL,
    "cost_usd" REAL NOT NULL DEFAULT 0,
    "label" TEXT,
    "label_reason" TEXT,
    "label_note" TEXT,
    "labeled_by" UUID,
    "labeled_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "gate_decision_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "gate_decision_verdict_check" CHECK ("verdict" IN ('reel', 'source_only')),
    CONSTRAINT "gate_decision_score_check" CHECK ("score" IS NULL OR ("score" >= 0 AND "score" <= 100)),
    CONSTRAINT "gate_decision_decided_by_check" CHECK ("decided_by" IN ('rule', 'model', 'explore', 'admin')),
    CONSTRAINT "gate_decision_rule_check" CHECK ("decided_by" <> 'rule' OR "rule" IS NOT NULL),
    CONSTRAINT "gate_decision_mode_check" CHECK ("mode" IN ('shadow', 'live')),
    CONSTRAINT "gate_decision_label_check" CHECK ("label" IS NULL OR "label" IN ('agree', 'disagree'))
);
ALTER TABLE "gate_decision" ADD CONSTRAINT "gate_decision_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "gate_decision_item_created_idx" ON "gate_decision"("item_id", "created_at" DESC);
CREATE INDEX "gate_decision_verdict_created_idx" ON "gate_decision"("verdict", "created_at" DESC);
CREATE INDEX "gate_decision_review_queue_idx" ON "gate_decision"("created_at" DESC) WHERE "label" IS NULL;
CREATE INDEX "gate_decision_labeled_idx" ON "gate_decision"("labeled_at" DESC) WHERE "label" IS NOT NULL;

ALTER TABLE "gate_decision" ENABLE ROW LEVEL SECURITY;
