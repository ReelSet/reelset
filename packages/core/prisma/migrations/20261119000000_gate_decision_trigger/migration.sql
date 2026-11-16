-- Manual judgements: an admin can ask the gate to judge one item on demand, purely for analysis.
-- 'auto' rows come from the pipeline (and admin overrides); 'manual' rows never act on an item and are
-- ignored by the pipeline, admission and the automatic stats. Additive: existing rows become 'auto'.
ALTER TABLE "gate_decision" ADD COLUMN "trigger" TEXT NOT NULL DEFAULT 'auto';
ALTER TABLE "gate_decision" ADD CONSTRAINT "gate_decision_trigger_check" CHECK ("trigger" IN ('auto', 'manual'));
