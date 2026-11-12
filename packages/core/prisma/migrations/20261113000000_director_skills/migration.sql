-- Admin-editable skills and example scripts the render director sends to the model, and what each render's director run reported.
CREATE TABLE "director_skill" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(80) NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'skill',
    "content" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "director_skill_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "director_skill_name_check" CHECK (char_length("name") >= 1),
    CONSTRAINT "director_skill_kind_check" CHECK ("kind" IN ('skill', 'example'))
);

CREATE UNIQUE INDEX "director_skill_name_key" ON "director_skill"("name");
CREATE INDEX "director_skill_enabled_sort_idx" ON "director_skill"("enabled", "sort", "name");

ALTER TABLE "director_skill" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "render" ADD COLUMN "director" JSONB;
