-- What code backs an agent, as its runtime reports it.
--
-- A JSON crew is auditable already: its definition is a versioned record on this node. A
-- code-backed crew has no definition here, so nothing could answer "what was running when this
-- ran" — and a run nobody can audit is the same as a run that did not happen, once something goes
-- wrong. crewaimeat proposed the shape: file, hash, commit, runtime version.
--
-- JSONB and nullable: it is a report about a disk this node does not own, read whole and never
-- queried into, and absent means nobody has said.
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "runtimeSource" JSONB;
