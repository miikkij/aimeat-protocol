/**
 * @file check-prompt-groups.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Every prompt group the seeds declare has a heading on the admin Prompts page, and
 *   that heading has a translation. The page names a group through a hand-kept map
 *   (GROUP_NAMES in public/views/admin/prompts-tab.list.js) and t('dashboard.<key>'); a group missing
 *   from the map renders its raw key as the heading, and nothing errors. Measured 2026-09-09:
 *   five groups added since July (playbooks, workflows, proactive, contacts, email) read
 *   "dashboard.workflows (3)" on the page for weeks before a person noticed.
 * @structure
 *   - seededGroups(): every `group: '<name>'` in src/services/prompt-defaults.ts and its folder
 *   - mappedGroups(): the GROUP_NAMES literal, parsed as text
 *   - the dashboard object of locales/en.json (fi and es follow en through check:locales)
 * @usage  pnpm check:prompt-groups   (exits non-zero when a group has no heading or no translation)
 * @version-history
 *   v1.1.0 — 2026-09-12 — GROUP_NAMES moved with the page's list pane to prompts-tab.list.js; the
 *     gate reads it there. The map and the rule are unchanged.
 *   v1.0.0 — 2026-09-09 — Initial.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

function seededGroups(): Set<string> {
  const files = [join(root, 'src/services/prompt-defaults.ts')];
  const dir = join(root, 'src/services/prompt-defaults');
  for (const f of readdirSync(dir)) if (f.endsWith('.ts')) files.push(join(dir, f));
  const groups = new Set<string>();
  for (const f of files) {
    for (const m of readFileSync(f, 'utf8').matchAll(/\bgroup:\s*'([^']+)'/g)) groups.add(m[1]);
  }
  return groups;
}

const GROUP_NAMES_FILE = 'public/views/admin/prompts-tab.list.js';

function mappedGroups(): Map<string, string> {
  const src = readFileSync(join(root, GROUP_NAMES_FILE), 'utf8');
  const block = /const GROUP_NAMES = \{([\s\S]*?)\};/.exec(src);
  if (!block) throw new Error(`GROUP_NAMES not found in ${GROUP_NAMES_FILE}`);
  const map = new Map<string, string>();
  for (const m of block[1].matchAll(/(\w+):\s*'([^']+)'/g)) map.set(m[1], m[2]);
  return map;
}

const en = JSON.parse(readFileSync(join(root, 'locales/en.json'), 'utf8')) as { dashboard?: Record<string, unknown> };
const dashboard = en.dashboard ?? {};
const seeded = seededGroups();
const mapped = mappedGroups();

const problems: string[] = [];
for (const g of [...seeded].sort()) {
  const key = mapped.get(g);
  if (!key) { problems.push(`group "${g}" has no GROUP_NAMES entry; the admin page shows "dashboard.${g}" as its heading`); continue; }
  if (typeof dashboard[key] !== 'string') problems.push(`group "${g}" maps to dashboard.${key}, which locales/en.json does not have`);
}

console.log(`\n  Prompt groups — every seeded group has a translated heading on the admin page`);
console.log(`  ${'─'.repeat(62)}`);
console.log(`  seeded groups   ${seeded.size}`);
console.log(`  mapped          ${[...seeded].filter(g => mapped.has(g)).length}`);
if (problems.length) {
  console.log('');
  for (const p of problems) console.log(`    ✖ ${p}`);
  console.log(`\n  ✖ ${problems.length} group(s) would render as a raw key.\n`);
  process.exit(1);
}
console.log(`\n  ✓ every prompt group has a heading and a translation\n`);
