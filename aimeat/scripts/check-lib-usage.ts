/**
 * @file check-lib-usage.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description How many published apps actually load each browser library, counted per FILE.
 *
 *   THE QUESTION IT ANSWERS. The major-pin policy keeps an old file forever so that apps naming it
 *   keep working — three.min.js is five years old and stays. "Forever" is the safe default, but it
 *   is only correct while somebody is still using the file, and nothing on this node could say who.
 *   Retiring an old library is not a judgement call once you can see that zero apps load it; while
 *   even one does, the file stays and there is nothing to discuss.
 *
 *   PER FILE, NOT PER LIBRARY, because that is the split that matters after a major lands: phaser@3
 *   and phaser@4 are one library and two different answers. A component's `files` list in
 *   licenses.json is what a served path is matched against.
 *
 *   It reads a node over its public API — the app listing and each app's own page, both of which
 *   are already public — so it needs no token and can be pointed at any node, including the
 *   operator's own.
 * @structure listApps() → every published app; scan() → one GET per app, counting /lib/ references;
 *   main() → the table, and the line that says which files nobody loads any more
 * @usage
 *   pnpm libs:usage                              # against the local dev node
 *   pnpm libs:usage -- --node https://aimeat.io  # against production
 *   pnpm libs:usage -- --json
 * @version-history
 *   v1.0.0 — 2026-08-31 — Initial, so that "can this old file be retired" stops being a guess.
 */
import { vendoredComponents, type Component } from './lib/license-inventory.js';

interface AppRef { owner: string; filename: string }

function nodeUrl(): string {
  const at = process.argv.indexOf('--node');
  if (at !== -1 && process.argv[at + 1]) return process.argv[at + 1].replace(/\/+$/, '');
  return (process.env.AIMEAT_NODE_URL ?? 'http://localhost:40050').replace(/\/+$/, '');
}

/** Every published app the node will list. Paginated, because a node can hold hundreds. */
async function listApps(base: string): Promise<AppRef[]> {
  const out: AppRef[] = [];
  const seen = new Set<string>();
  for (let offset = 0; offset < 5000; offset += 100) {
    const res = await fetch(`${base}/v1/apps?limit=100&offset=${offset}`);
    if (!res.ok) throw new Error(`${base}/v1/apps → HTTP ${res.status}`);
    const body = await res.json() as { data?: { apps?: AppRef[] } };
    const page = body.data?.apps ?? [];
    if (page.length === 0) break;
    let added = 0;
    for (const app of page) {
      const key = `${app.owner}/${app.filename}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ owner: app.owner, filename: app.filename });
      added++;
    }
    // A node that ignores `offset` returns the same page forever; stop rather than loop.
    if (added === 0) break;
  }
  return out;
}

/** The served paths a component owns, as the strings an app's HTML would contain. */
function pathsOf(component: Component): string[] {
  return (component.files ?? []).map(f => (f.endsWith('/**') ? `/lib/${f.slice(0, -3)}/` : `/lib/${f}`));
}

interface Row {
  id: string;
  name: string;
  version: string;
  paths: string[];
  apps: string[];
  frozen: boolean;
  supersededBy?: string;
}

async function main(): Promise<void> {
  const base = nodeUrl();
  const asJson = process.argv.includes('--json');
  const served = vendoredComponents().filter(c => c.id !== 'aimeat' && (c.files ?? []).length > 0);

  if (!asJson) console.log(`\nReading ${base} …`);
  const apps = await listApps(base);
  if (!asJson) console.log(`  ${apps.length} published app(s) to scan\n`);

  const rows: Row[] = served.map(c => ({
    id: c.id, name: c.name, version: c.version, paths: pathsOf(c), apps: [],
    frozen: c.supersededBy !== undefined, supersededBy: c.supersededBy,
  }));

  let unreadable = 0;
  for (const app of apps) {
    let html: string;
    try {
      const res = await fetch(`${base}/v1/apps/${encodeURIComponent(app.owner)}/${encodeURIComponent(app.filename)}`);
      if (!res.ok) { unreadable++; continue; }
      html = await res.text();
    } catch {
      unreadable++;
      continue;
    }
    for (const row of rows) {
      if (row.paths.some(p => html.includes(p))) row.apps.push(`${app.owner}/${app.filename}`);
    }
  }

  if (asJson) {
    console.log(JSON.stringify({
      node: base, apps: apps.length, unreadable,
      libraries: rows.map(r => ({ ...r, count: r.apps.length })),
    }, null, 2));
    return;
  }

  rows.sort((a, b) => b.apps.length - a.apps.length || a.name.localeCompare(b.name));
  console.log('  library                  version        apps  loaded from');
  console.log('  ' + '-'.repeat(86));
  for (const r of rows) {
    const state = r.frozen ? `frozen, superseded by ${r.supersededBy}` : '';
    console.log(
      '  ' + r.name.slice(0, 24).padEnd(24) + ' '
      + r.version.slice(0, 14).padEnd(14) + ' '
      + String(r.apps.length).padStart(4) + '  '
      + r.paths.join(' ') + (state ? `   [${state}]` : ''),
    );
  }

  const retirable = rows.filter(r => r.frozen && r.apps.length === 0);
  const held = rows.filter(r => r.frozen && r.apps.length > 0);
  console.log('\n  ' + '-'.repeat(86));
  if (unreadable > 0) console.log(`  ${unreadable} app(s) could not be read and are not counted.`);
  for (const r of held) {
    console.log(`  ${r.name} ${r.version} is still loaded by ${r.apps.length} app(s) — the file stays:`);
    for (const a of r.apps.slice(0, 8)) console.log(`      ${a}`);
    if (r.apps.length > 8) console.log(`      … and ${r.apps.length - 8} more`);
  }
  if (retirable.length > 0) {
    console.log('\n  NO APP LOADS THESE ANY MORE, so retiring them is a decision rather than a risk:');
    for (const r of retirable) console.log(`      ${r.name} ${r.version}  (${r.paths.join(' ')})`);
    console.log('  Retiring is still the owner\'s call: an app published elsewhere, or a draft not yet');
    console.log('  published, can name the same path and this scan cannot see it.');
  } else if (held.length === 0) {
    console.log('  No frozen file is unused; nothing to consider retiring.');
  }
  console.log('');
}

main().catch(err => {
  console.error(`check-lib-usage: ${(err as Error).message}`);
  process.exit(2);
});
