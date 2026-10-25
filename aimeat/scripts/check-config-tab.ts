/**
 * @file scripts/check-config-tab.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The admin Config tab against the config schema, the English locale and the code that
 *   reads the settings. Read-only. It exists because an audit on 2026-10-11 found all of the
 *   following at once, each of them invisible to every other gate:
 *     - twenty sections of settings under "Other" in the page's index, and ten names in the index
 *       list that matched no section (`quotas` for `quota`);
 *     - seventy settings with no name, so the page printed the raw key twice;
 *     - four sections with no name, two fixed values shown as the raw value;
 *     - forty-eight locale keys of the page naming no setting;
 *     - seven settings no code read;
 *     - six settings the node holds as a list while the schema typed them as text, so a save wrote
 *       the text into a field the code reads as an array;
 *     - thirteen whole-number settings that accepted a fraction, and one number with no range.
 *   check:config-coverage asks the opposite question (is every variable the node reads on the page).
 * @structure main() · groups vs DOMAINS · names · dead locale keys · unread settings · list and number rows
 * @usage pnpm check:config-tab
 * @version-history
 *   v1.0.2 — 2026-10-25 — security.allow_private_egress is read from the environment the loader normalises.
 *   v1.0.1 — 2026-10-12 — security.owner_key_login and ai.legacy_settings_routes are read through the
 *     version gate beside their config key (ownerKeyLoginAllowed, aiLegacySettingsRoutesAllowed).
 *   v1.0.0 — 2026-10-11 — Initial.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { CONFIG_FIELDS } from '../src/services/config-schema.js';
import { numericRangeOf } from '../src/services/config-schema-validators.js';
import { RATE_LIMIT_KEYS } from '../src/services/config-rate-limit-sync.js';

const ROOT = process.cwd();
const fields = CONFIG_FIELDS;
const visible = fields.filter(f => f.adminDisplay !== 'hidden');
/** The path the page shows: a secret is `<path>_configured`. */
const shownPath = (f: (typeof fields)[number]): string => f.adminDisplay === 'configured' ? `${f.dotPath}_configured` : f.dotPath;
/** Rows the route adds itself (routes/admin-config.ts). */
const VIRTUAL_PATHS = ['push.vapid_configured'];
const paths = [...visible.map(shownPath), ...VIRTUAL_PATHS];
const under = (p: string): string => p.replace(/\./g, '_');

const problems: string[] = [];
const fail = (title: string, items: string[], fix: string): void => {
  if (items.length === 0) return;
  problems.push(`\n  ✖ ${title} (${items.length})\n${items.map(i => `      ${i}`).join('\n')}\n    → ${fix}`);
};

// ── 1. Sections and the page's DOMAINS list ──
const tab = readFileSync(join(ROOT, 'public', 'views', 'admin', 'config-tab.js'), 'utf8');
const listed = new Set<string>();
for (const m of tab.matchAll(/\{ id: '\w+', groups: \[([^\]]+)\] \}/g)) for (const g of m[1].split(',')) listed.add(g.trim().replace(/'/g, ''));
const groups = new Set(paths.map(p => p.split('.')[0]));
if (listed.size === 0) fail('DOMAINS not found in public/views/admin/config-tab.js', ['the list changed shape, so this gate is checking nothing'], 'fix the pattern in scripts/check-config-tab.ts');
fail('Sections of the schema the index puts under "Other"', [...groups].filter(g => !listed.has(g)), 'name the section in DOMAINS (public/views/admin/config-tab.js)');
fail('Names in DOMAINS that are no section of the schema', [...listed].filter(g => !groups.has(g)), 'delete the name from DOMAINS, or correct it to the first segment of the settings\' dot-path');

// ── 2. Names a person reads (English is the source of truth for which keys exist) ──
const flat = (o: unknown, pre = '', out: Record<string, string> = {}): Record<string, string> => {
  for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) flat(v, `${pre}${k}.`, out); else out[pre + k] = String(v);
  }
  return out;
};
const locale = (tag: string): Record<string, string> => flat(JSON.parse(readFileSync(join(ROOT, 'locales', `${tag}.json`), 'utf8')));
const en = locale('en');
fail('Settings with no name: the page prints the raw key twice', paths.filter(p => !(`dashboard.cfg_${under(p)}` in en)),
  'add dashboard.cfg_<path with dots as underscores> to locales/en.json, then fi and es');
fail('Sections with no name', [...groups].filter(g => !(`dashboard.cfgGroup_${g}` in en)), 'add dashboard.cfgGroup_<section> to locales/en.json, then fi and es');
const rawChoices: string[] = [];
for (const f of fields) if (f.choices && !f.immutable && f.adminDisplay !== 'hidden') for (const c of f.choices) if (!(`dashboard.cfgOpt_${under(f.dotPath)}_${c}` in en)) rawChoices.push(`${f.dotPath} = ${c}`);
fail('Fixed values the page shows as the raw value', rawChoices, 'add dashboard.cfgOpt_<path>_<value> to locales/en.json, then fi and es');

// ── 3. Locale keys of the page that name nothing ──
const validNames = new Set(paths.map(under));
const choicePrefixes = fields.filter(f => f.choices).map(f => `dashboard.cfgOpt_${under(f.dotPath)}_`);
for (const tag of ['en', 'fi', 'es']) {
  const keys = Object.keys(tag === 'en' ? en : locale(tag));
  const dead = keys.filter(k =>
    (/^dashboard\.cfg_/.test(k) && !validNames.has(k.slice('dashboard.cfg_'.length)))
    || (/^dashboard\.cfgDesc_/.test(k) && !validNames.has(k.slice('dashboard.cfgDesc_'.length)))
    || (/^dashboard\.cfgGroup_/.test(k) && !groups.has(k.slice('dashboard.cfgGroup_'.length)))
    || (/^dashboard\.cfgHelp_/.test(k) && !groups.has(k.slice('dashboard.cfgHelp_'.length)))
    || (/^dashboard\.cfgOpt_/.test(k) && !choicePrefixes.some(p => k.startsWith(p))));
  fail(`Config-tab keys in locales/${tag}.json that name no setting or section`, dead, 'delete the key: the setting it named is gone or was renamed');
}

// ── 4. Settings no code reads ──
/** Config plumbing: reading a key here is not using the setting. */
const PLUMBING = /^src[\\/](config[^\\/]*\.ts|services[\\/]config-[^\\/]*\.ts|utils[\\/]env-config[\\/]|cli[\\/]init-wizard[\\/]|generated[\\/])|[\\/]__tests__[\\/]/;
/**
 * Rows whose config key is not read by name, with the reason each is still a live setting.
 * An entry here is an answer, not a backlog: delete it when the code starts reading the key.
 */
const READ_ANOTHER_WAY: Record<string, string> = {
  'decide.jeff_key': 'the provider reads AIMEAT_DECIDE_JEFF_KEY from the environment by name (services/decide/providers.ts); the row shows whether it is set',
  'decide.laya_key': 'the provider reads AIMEAT_DECIDE_LAYA_KEY from the environment by name; the row shows whether it is set',
  'decide.von_key': 'the provider reads AIMEAT_DECIDE_VON_KEY from the environment by name; the row shows whether it is set',
  'security.owner_key_login': 'routes/auth.ts reads it through ownerKeyLoginAllowed (config-security.ts), which also asks whether the running version removed the sign-in',
  'ai.legacy_settings_routes': 'routes/openrouter.ts reads it through aiLegacySettingsRoutesAllowed (config-ai-models.ts), which also asks whether the running version removed the routes',
  'security.allow_private_egress': 'utils/blocked-ip.ts and services/decide/providers.ts read AIMEAT_ALLOW_PRIVATE_EGRESS at call time from the environment, which config.ts sets from the security profile at start; the row is immutable, so the two hold the same value',
};
const sources: string[] = [];
const walk = (dir: string, skip: (rel: string) => boolean): void => {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const rel = relative(ROOT, full);
    if (statSync(full).isDirectory()) { if (!skip(rel)) walk(full, skip); continue; }
    if (/\.(ts|js|mjs)$/.test(name) && !skip(rel)) sources.push(readFileSync(full, 'utf8'));
  }
};
walk(join(ROOT, 'src'), rel => PLUMBING.test(rel));
// A site link is served whole to the pages, which read it by name (public/js/site.js).
walk(join(ROOT, 'public'), rel => /^public[\\/](lib|cortex-bundled)$/.test(rel));
const code = sources.join('\n');
// A rate-limit setting is read through its limiter tier: config-rate-limit-sync.ts copies each of
// these keys into config.rateLimits, which the request limiters read.
const tierKeys = new Set(RATE_LIMIT_KEYS.map(k => String(k.key)));
const unread = fields.filter(f => {
  if (f.dotPath in READ_ANOTHER_WAY || tierKeys.has(String(f.key))) return false;
  const leaf = String(f.key).split('.').pop() as string;
  return !new RegExp(`\\b${leaf}\\b`).test(code);
}).map(f => `${f.dotPath} (${String(f.key)}, ${f.envVar})`);
fail('Settings no code reads', unread, 'remove the row with its config key, variable and locale keys, or make the code read it; a setting read some other way gets an entry in READ_ANOTHER_WAY with the reason');
fail('READ_ANOTHER_WAY entries for a row that is gone', Object.keys(READ_ANOTHER_WAY).filter(p => !fields.some(f => f.dotPath === p)), 'delete the entry');

// ── 5. Lists and numbers ──
fail('`list` rows that are not type object', fields.filter(f => f.list && f.type !== 'object').map(f => f.dotPath), 'a list row is type \'object\' with validate: isStringList');
// The config loader builds a list with .split(','); a row for such a key must be a list row, or a
// save writes text into a field the code reads as an array.
const loader = readdirSync(join(ROOT, 'src')).filter(n => /^config.*\.ts$/.test(n)).map(n => readFileSync(join(ROOT, 'src', n), 'utf8')).join('\n');
const listKeys = new Set([...loader.matchAll(/^\s*(\w+):\s*\(?[^\n]*\)\s*\.split\(','\)/gm)].map(m => m[1]));
fail('Mutable rows typed as text whose config key the loader builds as a list', fields.filter(f => !f.immutable && !f.list && f.type === 'string' && listKeys.has(String(f.key))).map(f => f.dotPath),
  'mark the row `list: true`, type \'object\', validate: isStringList');
const fractions: string[] = [];
const noRange: string[] = [];
for (const f of fields) {
  if (f.adminDisplay === 'hidden' || (f.type !== 'number' && f.type !== 'float')) continue;
  const r = numericRangeOf(f);
  if (!r) { noRange.push(`${f.dotPath}${f.range ? ` "${f.range}"` : ''}`); continue; }
  // A whole-number setting whose range is in whole numbers takes no fraction.
  if (f.type === 'number' && Number.isInteger(r.min) && Number.isInteger(r.max) && f.validate(r.min + 0.5)) fractions.push(`${f.dotPath} accepts ${r.min + 0.5}`);
  if (!f.validate(r.min)) fractions.push(`${f.dotPath} refuses its own minimum ${r.min}`);
}
fail('Number settings with no "min-max" range', noRange, 'give the row a range: the page shows it and the schema says whether it is a limit');
fail('Whole-number settings whose check accepts a fraction, or refuses the range\'s own minimum', fractions, 'add Number.isInteger(v) to the row\'s validate, or correct the range');

if (problems.length > 0) {
  console.error(`[check:config-tab] ${problems.length} kind(s) of problem on the admin Config tab:${problems.join('\n')}\n`);
  process.exit(1);
}
console.log(`[check:config-tab] ✓ ${paths.length} settings in ${groups.size} sections: every section is in the index, every setting and section has a name, no dead locale key, no unread setting, lists and numbers consistent`);
