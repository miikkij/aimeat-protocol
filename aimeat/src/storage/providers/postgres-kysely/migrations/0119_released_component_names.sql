-- 0119_released_component_names.sql
--
-- Extension and cortex names live in the owner's namespace (wish
-- wish-cortex-and-extension-names-live-in-the-owner-s-namespace, secaudit2026oct22 leads 589 and
-- 2827). A new install is stored as `<owner>/<name>`; a name stored bare before that stays the
-- record's key and is reached through its holder's namespace as an alias.
--
-- When a bare-named extension or cortex is uninstalled, its name is written here with the account
-- that held it. Only that account may install under the bare name again (a DELETE followed by a
-- POST by the same holder keeps every published address working), and a `/v1/ext/<name>/...`
-- address keeps reading as that extension's address rather than as an owner's namespace. Nobody
-- else can take the name: new installs are namespaced.
--
-- This migration creates the table only. It changes no existing row.

CREATE TABLE IF NOT EXISTS "ReleasedComponentName" (
  "kind"       text NOT NULL,
  "name"       text NOT NULL,
  "holder"     text NOT NULL,
  "releasedAt" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("kind", "name")
);
