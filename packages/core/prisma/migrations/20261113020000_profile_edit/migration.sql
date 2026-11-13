-- Editable profile: display name, bio, avatar (bytes in profile_avatar), and an edit rate-limit window.
ALTER TABLE "profile" ADD COLUMN "display_name" VARCHAR(40);
ALTER TABLE "profile" ADD COLUMN "bio" VARCHAR(160);
ALTER TABLE "profile" ADD COLUMN "avatar_hidden" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "profile" ADD COLUMN "edit_window_at" TIMESTAMPTZ(6);
ALTER TABLE "profile" ADD COLUMN "edit_count" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "profile_avatar" (
    "profile_id" UUID NOT NULL,
    "content_type" VARCHAR(32) NOT NULL,
    "bytes" BYTEA NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "profile_avatar_pkey" PRIMARY KEY ("profile_id")
);

ALTER TABLE "profile_avatar" ADD CONSTRAINT "profile_avatar_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "profile_avatar" ENABLE ROW LEVEL SECURITY;
