-- 0042_account_events.sql
--
-- What has happened on one person's account, as its own system.
--
-- WHY A TABLE AND NOT A MEMORY RECORD. Memory is the person's own refined knowledge, which they
-- brought and which they own; these are events the NODE generated about them. Putting the second
-- inside the first spends their key budget on rows they never wrote, puts machine chatter into the
-- namespace their librarian searches, and makes "delete my memory" and "delete my history" the same
-- act when they are not. The repo's default is to prefer a memory record over a new table, and this
-- is a case where that default is wrong.
--
-- TWO TABLES, ONE WINDOW. The hot table holds the last 100 events per owner: the answer to "what has
-- happened lately" must be one indexed read, always, whatever the account has been through.
-- Everything past 100 moves to the archive, which is browsable and slower by design. Nothing is
-- deleted by this mechanism — an event that scrolled out of the window is still a fact.
--
-- WHY 100 PER OWNER RATHER THAN A TIME WINDOW. A quiet account keeps a year of history and a busy
-- one keeps a week, which is the behaviour a person actually wants: the feed answers "what happened
-- recently to ME", and recency is relative to how much happens to them.

CREATE TABLE IF NOT EXISTS "AccountEvent" (
  "id"          TEXT NOT NULL,
  -- Whose account this happened on. Always a GHII: the feed is per person, and an agent's events
  -- are its owner's events.
  "ownerGhii"   TEXT NOT NULL,
  "at"          TEXT NOT NULL,
  -- A stable key the UI translates. NEVER a sentence: the node has no business deciding which
  -- language the person reads, and this is the contract home-feed.ts already keeps for its
  -- derived rows.
  "kind"        TEXT NOT NULL,
  -- Who caused it, as an exact principal (GHII / GAII / GEAI). Empty when the node itself did.
  "actorGaii"   TEXT NOT NULL DEFAULT '',
  -- Values the translated line interpolates: an agent's name, an app's title, an amount.
  "data"        JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Where the row goes when clicked. Empty when it points at nothing.
  "link"        TEXT NOT NULL DEFAULT '',
  -- The thing this is about, so a later feature can group or de-duplicate by subject without
  -- parsing `data`.
  "subject"     TEXT NOT NULL DEFAULT '',
  CONSTRAINT "AccountEvent_pkey" PRIMARY KEY ("id")
);

-- THE read: one owner's newest N. Also the sweep's cursor when it decides what falls out of the
-- window, so it is the only index this table needs.
CREATE INDEX IF NOT EXISTS "AccountEvent_owner_at_idx" ON "AccountEvent"("ownerGhii", "at" DESC);

-- Column-identical plus when it left the window. Browsable, not served on the hot path.
CREATE TABLE IF NOT EXISTS "AccountEventArchive" (
  "id"          TEXT NOT NULL,
  "ownerGhii"   TEXT NOT NULL,
  "at"          TEXT NOT NULL,
  "kind"        TEXT NOT NULL,
  "actorGaii"   TEXT NOT NULL DEFAULT '',
  "data"        JSONB NOT NULL DEFAULT '{}'::jsonb,
  "link"        TEXT NOT NULL DEFAULT '',
  "subject"     TEXT NOT NULL DEFAULT '',
  "archivedAt"  TEXT NOT NULL,
  CONSTRAINT "AccountEventArchive_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "AccountEventArchive_owner_at_idx" ON "AccountEventArchive"("ownerGhii", "at" DESC);
