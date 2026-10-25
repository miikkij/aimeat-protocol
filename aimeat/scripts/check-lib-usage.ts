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
 *
 *   DIRECT, THROUGH A LIBRARY, AND THE PORTAL. An app rarely names /lib/mermaid/ itself: it loads
 *   /v1/libs/aimeat-markdown.js, and that bundle loads Mermaid when a diagram appears. Counting only
 *   the paths written in an app's HTML printed Mermaid, KaTeX and Preact with zero or near-zero
 *   users while the markdown renderer, the living document and the whole portal load them. So the
 *   scan also reads this checkout's served SDK bundles (src/static/sdk-libs/dist/) and bundled
 *   cortex packs (public/cortex-bundled/) for the /lib/ paths each one loads, following one SDK lib
 *   loading another, and counts an app that names such a library under "via lib". Most of those
 *   loads are lazy (the Atelier kit fetches three.js only for a 3D scene), so "via lib" means the
 *   app can reach the file, which is the question retiring a file asks. It reads the
 *   portal's own files (public/ and src/static/) for the same paths. The carrier map comes from
 *   this checkout, so against a node on older code it can differ by what changed since.
 * @structure listApps() → every published app; carriers() → which SDK lib or cortex URL loads which
 *   /lib/ paths; portalRefs() → the /lib/ paths the portal itself loads; main() → one GET per app,
 *   the table, and the line that says which files nobody loads any more
 * @usage
 *   pnpm libs:usage                              # against the local dev node
 *   pnpm libs:usage -- --node https://aimeat.io  # against production
 *   pnpm libs:usage -- --json
 * @version-history
 *   v1.1.0 — 2026-10-25 — Counts the apps that load a library through a served SDK lib or cortex pack, and marks the libraries the portal loads.
 *   v1.0.0 — 2026-08-31 — Initial, so that "can this old file be retired" stops being a guess.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { vendoredComponents, type Component } from './lib/license-inventory.js';

const AIMEAT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SDK_DIST = join(AIMEAT, 'src/static/sdk-libs/dist');
const CORTEX_BUNDLED = join(AIMEAT, 'public/cortex-bundled');
/** The portal's own files. lib/ is what is counted, cortex-bundled/ is a carrier, data/ is generated documentation that names every path. */
const PORTAL_ROOTS = [
  { dir: join(AIMEAT, 'public'), skip: new Set(['lib', 'cortex-bundled', 'data']) },
  { dir: join(AIMEAT, 'src/static'), skip: new Set(['sdk-libs']) },
];
const LIB_REF = /\/lib\/[A-Za-z0-9@._/-]+/g;
const SDK_REF = /\/v1\/libs\/aimeat-[a-z0-9-]+\.js/g;

/** A URL an app's HTML can name that loads served /lib/ files on the app's behalf. */
interface Carrier { url: string; name: string; libRefs: Set<string>; sdkRefs: Set<string> }

function refsIn(text: string): { libRefs: Set<string>; sdkRefs: Set<string> } {
  return { libRefs: new Set(text.match(LIB_REF) ?? []), sdkRefs: new Set(text.match(SDK_REF) ?? []) };
}

/** Every served SDK bundle and bundled cortex pack that loads a /lib/ path, directly or through another SDK lib. */
function carriers(): Carrier[] {
  const out: Carrier[] = [];
  if (existsSync(SDK_DIST)) {
    for (const f of readdirSync(SDK_DIST).filter(n => n.endsWith('.js'))) {
      out.push({ url: `/v1/libs/${f}`, name: f.slice(0, -3), ...refsIn(readFileSync(join(SDK_DIST, f), 'utf8')) });
    }
  }
  if (existsSync(CORTEX_BUNDLED)) {
    for (const f of readdirSync(CORTEX_BUNDLED).filter(n => n.endsWith('.js'))) {
      const name = f.slice(0, -3);
      out.push({ url: `/v1/cortex/${name}/`, name: `cortex ${name}`, ...refsIn(readFileSync(join(CORTEX_BUNDLED, f), 'utf8')) });
    }
  }
  const byUrl = new Map(out.map(c => [c.url, c]));
  for (const c of out) {
    const seen = new Set([c.url]);
    const queue = [...c.sdkRefs];
    while (queue.length > 0) {
      const url = queue.pop()!;
      if (seen.has(url)) continue;
      seen.add(url);
      const next = byUrl.get(url);
      if (next === undefined) continue;
      for (const r of next.libRefs) c.libRefs.add(r);
      queue.push(...next.sdkRefs);
    }
  }
  return out.filter(c => c.libRefs.size > 0);
}

/** The /lib/ paths the portal loads itself or through an SDK lib it names. */
function portalRefs(all: Carrier[]): Set<string> {
  const refs = new Set<string>();
  const walk = (dir: string, skip: Set<string>): void => {
    for (const entry of readdirSync(dir)) {
      if (skip.has(entry)) continue;
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) { walk(path, new Set()); continue; }
      if (!['.js', '.mjs', '.html', '.css'].includes(extname(entry))) continue;
      const text = readFileSync(path, 'utf8');
      for (const r of text.match(LIB_REF) ?? []) refs.add(r);
      for (const c of all) if (text.includes(c.url)) for (const r of c.libRefs) refs.add(r);
    }
  };
  for (const root of PORTAL_ROOTS) if (existsSync(root.dir)) walk(root.dir, root.skip);
  return refs;
}

/** Does a set of referenced paths reach any of a component's served paths. */
function reaches(refs: Iterable<string>, paths: string[]): boolean {
  for (const r of refs) if (paths.some(p => r === p || (p.endsWith('/') && r.startsWith(p)))) return true;
  return false;
}

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
  /** Apps whose own HTML names one of the paths. */
  apps: string[];
  /** Apps that do not name a path but load an SDK lib or cortex pack that does. */
  viaApps: string[];
  /** The SDK libs and cortex packs that load this library. */
  carriers: string[];
  /** The portal loads it, so it stays whatever the app counts say. */
  portal: boolean;
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

  const all = carriers();
  const portal = portalRefs(all);
  const rows: Row[] = served.map(c => {
    const paths = pathsOf(c);
    return {
      id: c.id, name: c.name, version: c.version, paths, apps: [], viaApps: [],
      carriers: all.filter(k => reaches(k.libRefs, paths)).map(k => k.name),
      portal: reaches(portal, paths),
      frozen: c.supersededBy !== undefined, supersededBy: c.supersededBy,
    };
  });
  const carrierOf = new Map(all.map(k => [k.name, k]));

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
    const key = `${app.owner}/${app.filename}`;
    for (const row of rows) {
      if (row.paths.some(p => html.includes(p))) row.apps.push(key);
      else if (row.carriers.some(n => html.includes(carrierOf.get(n)!.url))) row.viaApps.push(key);
    }
  }

  if (asJson) {
    console.log(JSON.stringify({
      node: base, apps: apps.length, unreadable,
      libraries: rows.map(r => ({ ...r, count: r.apps.length, viaCount: r.viaApps.length })),
    }, null, 2));
    return;
  }

  const used = (r: Row): number => r.apps.length + r.viaApps.length;
  rows.sort((a, b) => used(b) - used(a) || Number(b.portal) - Number(a.portal) || a.name.localeCompare(b.name));
  console.log('  library                  version        direct  via lib  portal  loaded from');
  console.log('  ' + '-'.repeat(100));
  for (const r of rows) {
    const state = r.frozen ? `frozen, superseded by ${r.supersededBy}` : '';
    const via = r.carriers.length > 0 ? `  (via ${r.carriers.join(', ')})` : '';
    console.log(
      '  ' + r.name.slice(0, 24).padEnd(24) + ' '
      + r.version.slice(0, 14).padEnd(14) + ' '
      + String(r.apps.length).padStart(6) + ' '
      + String(r.viaApps.length).padStart(8) + ' '
      + (r.portal ? 'yes' : '').padStart(7) + '  '
      + r.paths.join(' ') + via + (state ? `   [${state}]` : ''),
    );
  }

  const retirable = rows.filter(r => r.frozen && used(r) === 0 && !r.portal);
  const held = rows.filter(r => r.frozen && (used(r) > 0 || r.portal));
  console.log('\n  ' + '-'.repeat(100));
  console.log('  direct = the app names the path itself · via lib = the app loads an SDK lib or cortex pack');
  console.log('  that can load it, usually lazily when the app uses that part (read from this checkout)');
  console.log('  · portal = the node\'s own screens load it.');
  if (unreadable > 0) console.log(`  ${unreadable} app(s) could not be read and are not counted.`);
  for (const r of held) {
    const users = [...r.apps, ...r.viaApps];
    console.log(`  ${r.name} ${r.version} is still loaded by ${users.length} app(s)${r.portal ? ' and the portal' : ''} — the file stays:`);
    for (const a of users.slice(0, 8)) console.log(`      ${a}`);
    if (users.length > 8) console.log(`      … and ${users.length - 8} more`);
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
