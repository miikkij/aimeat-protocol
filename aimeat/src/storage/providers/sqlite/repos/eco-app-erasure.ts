/**
 * @file src/storage/providers/sqlite/repos/eco-app-erasure.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description SQLite SQL for the ecosystem apps an account connected: they go as its agents go. The
 *   account deletion (deleteOwner in methods/identity.ts), the start step and the operator's decision on
 *   a held name (repos/held-names.ts) call this one function. A free function over the connection,
 *   like the other erasure repos, so there is no import cycle through the provider class; the
 *   per-identity cascade is handed in by the caller, which owns it. The Postgres twin is
 *   deleteEcosystemAppsDb in its methods/identity-erasure.ts.
 * @structure deleteEcosystemApps(db, owner, geais, cascade, opts)
 * @usage deleteEcosystemApps(this.db, name, geais, g => this.cascadeDeleteAgentData(g), { everyRecipe: true });
 * @version-history
 *   v1.0.0 — 2026-09-26 — What deleteOwner did for the ecosystem apps inline.
 *   v1.0.1 — 2026-10-05 — deleteOwner is in methods/identity.ts now (secaudit 2026-10, M8).
 */
import type Database from 'better-sqlite3';

/**
 * What each app holds under its own identity (`eco:<app>#<owner>@<node>`) goes through `cascade`, then
 * its record with the key pinned at its first connection, then the automation recipes set for it.
 * Every credential of an app stops with its record (auth/middleware.ts ecosystemAppGone). The work and
 * the ledger lines that name an app are settled by the caller, beside the account's.
 *
 * `everyRecipe` deletes every recipe of the owner, apps never connected included, as the account
 * deletion does; without it only the recipes of these apps go. Returns the number of records deleted.
 */
export function deleteEcosystemApps(
  db: Database.Database, owner: string, geais: string[], cascade: (geai: string) => void,
  opts: { everyRecipe?: boolean } = {},
): number {
  const marks = geais.map(() => '?').join(', ');
  const apps = geais.length
    ? db.prepare(`SELECT geai, app FROM ecosystem_apps WHERE owner = ? AND geai IN (${marks})`).all(owner, ...geais) as { geai: string; app: string }[]
    : [];
  for (const a of apps) cascade(a.geai);
  const del = db.prepare('DELETE FROM ecosystem_apps WHERE owner = ? AND geai = ?');
  for (const a of apps) del.run(owner, a.geai);
  if (opts.everyRecipe) {
    db.prepare('DELETE FROM eco_automation_recipes WHERE owner = ?').run(owner);
  } else {
    const recipe = db.prepare('DELETE FROM eco_automation_recipes WHERE owner = ? AND app = ?');
    for (const a of apps) recipe.run(owner, a.app);
  }
  return apps.length;
}
