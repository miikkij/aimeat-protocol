-- 0031_group_shares.sql
--
-- A share becomes its own row: this owner lets this group read this key pattern.
--
-- Until now sharing was a field on the record ("visibility":'group' plus one "groupId"). That shape
-- could only ever name ONE group, it had to be repeated on every write, and it could not describe a
-- key space that does not exist yet. The last of those is what made it useless for the thing people
-- actually want: a subscription writes tomorrow's record tomorrow, and the reader must not need a
-- second act to see it. A pattern shared once covers whatever lands under it later.
--
-- The record it covers keeps its own visibility (normally 'private'). Visibility is the floor and a
-- share is a named exception on top, so sharing something never changes what it is.
--
-- Both indexes are load-bearing rather than tidy. Every cross-owner read asks "is this key covered
-- for one of the caller's groups", so the group direction is on the request path and must not
-- become a scan; the owner direction is the Access tab answering "what have I given away, and to
-- whom", which is the question ownership is judged by.

CREATE TABLE IF NOT EXISTS "GroupShare" (
  "id"         TEXT PRIMARY KEY,
  "groupId"    TEXT NOT NULL,
  "ownerGaii"  TEXT NOT NULL,
  "keyPattern" TEXT NOT NULL,
  "note"       TEXT,
  "expiresAt"  TIMESTAMP(3),
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy"  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS "GroupShare_groupId_idx" ON "GroupShare"("groupId");
CREATE INDEX IF NOT EXISTS "GroupShare_ownerGaii_groupId_idx" ON "GroupShare"("ownerGaii", "groupId");
