/**
 * @file scripts/check-profile-tabs.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Pre-commit gate: every profile tab registered in profile.js must also have an
 *   entry in the sidebar menu (landing-page.cards.js). A tab that is registered but not
 *   listed is reachable ONLY by typing ?tab=<id> into the address bar — it renders fine, it
 *   answers its API calls, and no test fails, so the miss is invisible until a person spends
 *   ten minutes hunting for a feature that has no door.
 *
 *   This has now happened three times (generator 2026-07-19, then pnl and companies
 *   2026-08-07), which is what turns it from a slip into a gate.
 *
 *   Deliberate exceptions live in ALLOWED_ORPHANS with the reason they are reachable some
 *   other way. Adding an id there is a decision, not a workaround — an entry without a real
 *   alternative door is the bug this file exists to catch.
 *
 * @structure ALLOWED_ORPHANS · parse both files · report · exit 1 on any unexplained orphan
 * @usage pnpm check:profile-tabs   (runs in .githooks/pre-commit and CI)
 * @version-history
 *   v1.0.0 — 2026-08-07 — Added after the Companies tab shipped with no menu entry.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const TABS_FILE = resolve(here, '../public/views/profile.js');
const MENU_FILE = resolve(here, '../public/views/profile/landing-page.cards.js');

/** Tab ids that legitimately have no sidebar entry, each with the door they DO have. */
const ALLOWED_ORPHANS: Record<string, string> = {
  messages: 'has its own top-level sidebar button above the groups, not a group item',
  nodeStats: 'lives as a tab on the Nodes page since 2026-06; the route id is kept for old links',
};

function read(path: string): string {
  try {
    return readFileSync(path, 'utf-8');
  } catch (err) {
    console.error(`[check:profile-tabs] cannot read ${path}: ${(err as Error).message}`);
    process.exit(1);
  }
}

const registered = [...read(TABS_FILE).matchAll(/\{\s*id:\s*'([A-Za-z]+)',\s*key:/g)].map((m) => m[1] as string);
const menuSource = read(MENU_FILE);
const inMenu = new Set([...menuSource.matchAll(/\{\s*id:\s*'([A-Za-z]+)',\s*labelKey:/g)].map((m) => m[1] as string));

if (registered.length === 0 || inMenu.size === 0) {
  console.error('[check:profile-tabs] parsed 0 entries — the shape of profile.js or landing-page.cards.js changed, so this gate is no longer checking anything. Fix the patterns.');
  process.exit(1);
}

const orphans = registered.filter((id) => !inMenu.has(id) && !(id in ALLOWED_ORPHANS));
// The reverse direction matters too: a menu entry pointing at a tab that no longer exists is a
// dead link, and open() refuses an unknown id silently.
const dangling = [...inMenu].filter((id) => !registered.includes(id));

if (orphans.length === 0 && dangling.length === 0) {
  const explained = Object.keys(ALLOWED_ORPHANS).length;
  console.log(`✓ profile tabs reachable — ${registered.length} registered, ${inMenu.size} in the sidebar, ${explained} documented exception(s).`);
  process.exit(0);
}

if (orphans.length > 0) {
  console.error('\n  Profile tabs with NO sidebar entry — reachable only by typing ?tab=<id>:\n');
  for (const id of orphans) console.error(`    - ${id}`);
  console.error('\n  Add each to SIDEBAR_GROUPS in public/views/profile/landing-page.cards.js,');
  console.error('  or to ALLOWED_ORPHANS in this script WITH the other door it has.\n');
}
if (dangling.length > 0) {
  console.error('\n  Sidebar entries pointing at tabs that are not registered (dead menu items):\n');
  for (const id of dangling) console.error(`    - ${id}`);
  console.error('');
}
process.exit(1);
