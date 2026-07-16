-- Operator storage-growth telemetry: one row per hourly snapshot of per-table live row counts.
CREATE TABLE IF NOT EXISTS "StorageStatsSnapshot" (
    "id" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "counts" JSONB NOT NULL,
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "StorageStatsSnapshot_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "StorageStatsSnapshot_capturedAt_idx" ON "StorageStatsSnapshot" ("capturedAt");
