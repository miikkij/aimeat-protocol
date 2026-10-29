-- 0121_storage_file_blob_ref.sql
--
-- Where a stored file's bytes are when the row does not hold them (wish
-- wish-tiedostot-azure-blob-storageen-tai-aws-s3-een-noden-yhteinen). An operator can point the node
-- at an S3 or Azure Blob store, and a person can connect their own: a file written then keeps its
-- metadata here and its bytes as one object there. "blobRef" is "<storeId>|<objectKey>"
-- (storage/blob/blob-types.ts), and "data" is empty on such a row.
--
-- NULL = the bytes are in "data", as every row stored before this column existed. Nothing here
-- moves an existing file; the operator moves them with the file-store move action, one row at a time,
-- and only after the object is written.
--
-- The partial index serves the orphan sweep, which asks which of a page of listed objects a row
-- still names.
--
-- Mirrors the SQLite column added in sqlite/schema-columns-files.ts.
ALTER TABLE "StorageFile" ADD COLUMN IF NOT EXISTS "blobRef" TEXT;
CREATE INDEX IF NOT EXISTS "StorageFile_blobRef_idx"
  ON "StorageFile"("blobRef") WHERE "blobRef" IS NOT NULL;
