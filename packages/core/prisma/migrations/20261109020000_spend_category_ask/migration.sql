-- Ask (user questions) gets its own spend category so its daily cap and the pipeline's cap
-- (llm, embedding, tts, render) never count each other's spend.
ALTER TYPE "spend_category" ADD VALUE IF NOT EXISTS 'ask';
