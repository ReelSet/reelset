-- Reels generated from user-supplied sources: private visibility, priority, requests, credits, API keys.
ALTER TABLE "item" ADD COLUMN "visibility" TEXT NOT NULL DEFAULT 'public';
ALTER TABLE "item" ADD COLUMN "owner_id" UUID;
ALTER TABLE "item" ADD COLUMN "priority_at" TIMESTAMPTZ(6);
CREATE INDEX "item_priority_idx" ON "item"("priority_at") WHERE "priority_at" IS NOT NULL;

CREATE TABLE "reel_request" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "urls" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'pending',
    "item_id" UUID,
    "error" TEXT,
    "credits_charged" INTEGER NOT NULL DEFAULT 0,
    "refunded" BOOLEAN NOT NULL DEFAULT false,
    "via" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "reel_request_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "reel_request_user_created_idx" ON "reel_request"("user_id", "created_at" DESC);
CREATE INDEX "reel_request_open_idx" ON "reel_request"("status") WHERE "status" IN ('pending', 'resolving', 'processing');
ALTER TABLE "reel_request" ADD CONSTRAINT "reel_request_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "item"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "reel_request" ENABLE ROW LEVEL SECURITY;

CREATE TABLE "credit_ledger" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "delta" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "request_id" UUID,
    "month" VARCHAR(7) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "credit_ledger_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "credit_ledger_user_month_idx" ON "credit_ledger"("user_id", "month");
ALTER TABLE "credit_ledger" ENABLE ROW LEVEL SECURITY;

CREATE TABLE "credit_upgrade_request" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "message" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "credits_granted" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "credit_upgrade_request_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "credit_upgrade_request" ENABLE ROW LEVEL SECURITY;

CREATE TABLE "api_key" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "last_used_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "api_key_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "api_key_hash_key" ON "api_key"("hash");
CREATE INDEX "api_key_user_idx" ON "api_key"("user_id");
ALTER TABLE "api_key" ENABLE ROW LEVEL SECURITY;
