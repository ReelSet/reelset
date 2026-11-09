-- Research papers become a source; Firecrawl fallback scrapes get their own spend category.
ALTER TYPE "source" ADD VALUE IF NOT EXISTS 'papers';
ALTER TYPE "spend_category" ADD VALUE IF NOT EXISTS 'scrape';
