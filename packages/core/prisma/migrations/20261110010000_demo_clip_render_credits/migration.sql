-- README demo clip captured at ingest: { url, kind: gif|mp4|webm, width?, height?, bytes? }. NULL = none.
ALTER TABLE "item" ADD COLUMN "demo" JSONB;
-- Attribution for third-party media in a render: [{ kind: 'stock'|'demo', provider?, creator?, creatorUrl?, url }].
ALTER TABLE "render" ADD COLUMN "credits" JSONB;
