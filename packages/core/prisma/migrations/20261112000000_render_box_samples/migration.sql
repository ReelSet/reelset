-- Which render box produced each render, and periodic box health samples for the admin capacity page.
ALTER TABLE "render" ADD COLUMN "box" VARCHAR(64);

CREATE TABLE "box_sample" (
    "id" BIGSERIAL NOT NULL,
    "box" VARCHAR(64) NOT NULL,
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ok" BOOLEAN NOT NULL,
    "running" INTEGER NOT NULL DEFAULT 0,
    "inflight" INTEGER NOT NULL DEFAULT 0,
    "idle_seconds" INTEGER,
    "cpu_pct" DOUBLE PRECISION,
    "load1" DOUBLE PRECISION,
    "mem_used_mb" INTEGER,
    "swap_used_mb" INTEGER,
    CONSTRAINT "box_sample_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "box_sample_box_at_idx" ON "box_sample"("box", "at" DESC);
CREATE INDEX "box_sample_at_idx" ON "box_sample"("at");

ALTER TABLE "box_sample" ENABLE ROW LEVEL SECURITY;
