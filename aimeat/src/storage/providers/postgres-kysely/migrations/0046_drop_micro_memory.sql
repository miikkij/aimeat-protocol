-- 0046_drop_micro_memory.sql
--
-- The micro-memory / Tier 0.5 subsystem was removed in full on 2026-08-23 (see the RFC v4.0 Core,
-- §13 "Removed: Micro-Memory"): the routes, the storage layer, the config knobs and the usage-summary
-- field are all gone. The physical table was created by the base migration 0001, which is immutable
-- once applied, so it is dropped here. Idempotent — a fresh database that never ran 0001's create
-- (there is none, but be safe) still applies cleanly.

DROP INDEX IF EXISTS "MicroMemory_gaii_setName_key";
DROP TABLE IF EXISTS "MicroMemory";
