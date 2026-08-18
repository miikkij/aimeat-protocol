/**
 * @file check-locales.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Keeps the language files honest against locales/en.json, which is the source of
 *   truth for what keys exist and what shape each value has.
 *
 *   WHY IT EXISTS. Until 2026-08-12 there were exactly two language files, and "en.json and fi.json
 *   change together" held because a person editing one could see the other. Spanish made it three,
 *   and a rule that depends on remembering does not survive a third file. This check does not
 *   demand a complete translation — a missing key falls back to English per key, by design, and
 *   that is how a language gets filled in over several passes. It demands that what IS there is
 *   usable, and the four ways it can fail live in lib/locale-files.ts next to the tools that write
 *   these files.
 * @structure
 *   - coverage line per locale, then findDefects() from the shared library
 * @usage  pnpm check:locales           (exit 1 on any violation)
 *         pnpm check:locales --list    (coverage only, always exit 0)
 * @version-history
 *   v1.0.0 — 2026-08-12 — Initial, with the arrival of Spanish as the third language.
 *   v1.1.0 — 2026-08-13 — Rules moved into lib/locale-files.ts, shared with locale:extract and
 *     locale:merge so the three tools cannot disagree about what a valid translation is.
 *   v1.2.0 — 2026-08-17 — missingAppGrantSentences(): the app-grant consent screen localizes every
 *     scope row from the sentence tree (consent-vocab.js), so each APP_GRANTABLE_SCOPES key must
 *     have a sentence (appGrant.scopeText or scopeUi.scopeText) and each family an appGrant.area
 *     name. A scope with neither used to render the server's English-only description and the raw
 *     family word, which is the screen that made a real user read "storage" as their hard drive.
 *   v1.3.0 — 2026-08-18 — jargonOffenders(): "node" (fi also "solmu", es "nodo") is a word only we
 *     understand, and the registration modal was saying "Tästä tulee pysyvä tunnuksesi tällä
 *     nodella" to people on their first day. A ratchet, same model as plain-language-baseline:
 *     security/locale-jargon-baseline.json records the existing offenders (operator and developer
 *     surfaces mostly, where the word is legitimate vocabulary), the gate fails on any NEW string
 *     carrying the word, and the file may only shrink. Node.js (the runtime) and {placeholders}
 *     are not offenses.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { shippedLocales, loadLocale, flatten, findDefects } from './lib/locale-files.js';

/**
 * The agent permission editor builds its labels from key NAMES: a domain `share` is rendered with
 * `profile.agents.scopeUi.domainShare`, and each permission with `scopeUi.scopeText.<domain>.<perm>`.
 * A missing key therefore does not fall back to English — t() returns the key itself, and the owner
 * reads `profile.agents.scopeUi.domainShare` as a section heading over their permissions.
 *
 * This is a different failure from the one the rest of this file guards. en.json is the source of
 * truth for what keys EXIST, so nothing can notice a key that was never written in any language.
 * Here the source of truth is the code: SCOPE_DOMAINS says which labels the editor is going to ask
 * for, and this checks that en.json has them. Found on 2026-08-14 in production UI, where the
 * `share` domain — added with the audit's out-of-wildcard words — had never had a heading.
 */
function missingScopeLabels(en: Record<string, unknown>): string[] {
  const modelPath = join(dirname(fileURLToPath(import.meta.url)), '..',
    'public', 'views', 'profile', 'agents', 'scope-model.js');
  const src = readFileSync(modelPath, 'utf-8');
  const out: string[] = [];
  for (const m of src.matchAll(/\{\s*key:\s*'([a-z-]+)',\s*permissions:\s*\[([^\]]*)\]/g)) {
    const [, domain, permsRaw] = m;
    const cap = domain[0].toUpperCase() + domain.slice(1);
    if (!(`profile.agents.scopeUi.domain${cap}` in en)) {
      out.push(`profile.agents.scopeUi.domain${cap} — the heading for the "${domain}" permission group`);
    }
    for (const p of permsRaw.matchAll(/'([a-z:-]+)'/g)) {
      const key = `profile.agents.scopeUi.scopeText.${domain}.${p[1]}`;
      if (!(key in en)) out.push(`${key} — what "${domain}:${p[1]}" lets an agent do`);
    }
  }
  return out;
}

/**
 * Same shape of guarantee for the app-grant consent screen. Its source of truth is
 * APP_GRANTABLE_SCOPES in src/routes/app-grant-vocabulary.ts: every scope an app may request must
 * have a
 * plain-language sentence in en.json (the app-context override tree first, the shared agent tree
 * as fallback — the exact chain consent-vocab.js resolves) and every scope FAMILY must have an
 * appGrant.area name for the "Works with:" line. Without the sentence the row falls back to the
 * server's English-only description; without the family name the raw word ("storage") prints.
 */
function missingAppGrantSentences(en: Record<string, unknown>): string[] {
  const routePath = join(dirname(fileURLToPath(import.meta.url)), '..',
    'src', 'routes', 'app-grant-vocabulary.ts');
  const src = readFileSync(routePath, 'utf-8');
  const block = src.match(/APP_GRANTABLE_SCOPES: Record<string, string> = \{([\s\S]*?)\n\};/);
  if (!block) return ['(check-locales cannot find APP_GRANTABLE_SCOPES in src/routes/app-grant-vocabulary.ts — the parser needs updating)'];
  const out: string[] = [];
  const families = new Set<string>();
  for (const m of block[1].matchAll(/'([a-z-]+):([a-z-]+)':/g)) {
    const [, family, perm] = m;
    families.add(family);
    const override = `appGrant.scopeText.${family}.${perm}`;
    const shared = `profile.agents.scopeUi.scopeText.${family}.${perm}`;
    if (!(override in en) && !(shared in en)) {
      out.push(`${override} (or ${shared}) — the consent sentence for "${family}:${perm}"`);
    }
  }
  for (const family of families) {
    if (!(`appGrant.area.${family}` in en)) {
      out.push(`appGrant.area.${family} — the "Works with:" name for the "${family}" scope family`);
    }
  }
  return out;
}

/**
 * "node" carries meaning only for people who build this; a person registering reads it cold. The
 * word is still legitimate on operator and developer surfaces (the start wizard, federation,
 * admin), so this is a RATCHET rather than a ban: everything that already says it is recorded in
 * the baseline, anything NEW fails, and the baseline may only shrink. An entry that stops
 * offending (fixed or deleted) must be removed from the baseline in the same change, so the file
 * stays an honest worklist. Node.js the runtime and {placeholder} names are never offenses.
 */
const JARGON_BY_LOCALE: Record<string, RegExp> = {
  fi: /\b(?:node(?!\.?js)\w*|solmu\w*)/iu,
  en: /\bnodes?\b(?!\.js)/i,
  es: /\bnodos?\b/i,
};
const JARGON_BASELINE = new URL('../security/locale-jargon-baseline.json', import.meta.url);

function jargonOffenders(): { fresh: string[]; stale: string[] } {
  let baseline: string[] = [];
  try { baseline = JSON.parse(readFileSync(JARGON_BASELINE, 'utf-8')); } catch { baseline = []; }
  const known = new Set(baseline);
  const current = new Set<string>();
  for (const tag of ['fi', 'en', 'es']) {
    const re = JARGON_BY_LOCALE[tag];
    const loc = flatten(loadLocale(tag));
    for (const [key, value] of Object.entries(loc)) {
      const text = String(value).replace(/\{\{?[^}]*\}?\}/g, ''); // placeholders are not prose
      if (re.test(text)) current.add(`${tag}:${key}`);
    }
  }
  const fresh = [...current].filter(id => !known.has(id)).sort();
  const stale = baseline.filter(id => !current.has(id)).sort();
  return { fresh, stale };
}

const listOnly = process.argv.includes('--list');
const [, ...others] = shippedLocales();
const en = flatten(loadLocale('en'));
const total = Object.keys(en).length;

console.log(`locales/en.json: ${total} keys (the source of truth)`);

const failures: string[] = [];
for (const tag of others) {
  const loc = flatten(loadLocale(tag));
  const translated = Object.keys(loc).length;
  const pct = ((100 * translated) / total).toFixed(1);
  console.log(`locales/${tag}.json: ${translated} translated, ${total - translated} falling back to English (${pct} %)`);
  for (const d of findDefects(tag, en, loc)) failures.push(`✖ [${tag}] ${d.what}\n      → ${d.fix}`);
}

if (listOnly) process.exit(0);

// The scope editor's labels are keyed by NAME, so a missing one renders the raw key to the owner
// rather than falling back to English. en.json cannot notice a key nobody ever wrote; the code can.
for (const missing of missingScopeLabels(en)) {
  failures.push(`✖ [en] the agent permission editor will render a raw key: ${missing}\n      → add it to locales/en.json (and fi/es), beside the other scopeUi labels`);
}

// The app-grant consent screen has the same key-derived contract against a different code source.
for (const missing of missingAppGrantSentences(en)) {
  failures.push(`✖ [en] the app-grant consent screen has no words for: ${missing}\n      → add it to locales/en.json (and fi/es); consent-vocab.js resolves override first, shared tree second`);
}

// The jargon ratchet: no NEW "node"/"solmu"/"nodo" reaches a person, and the baseline only shrinks.
const jargon = jargonOffenders();
for (const id of jargon.fresh) {
  failures.push(`✖ [${id.split(':')[0]}] new jargon a person cannot parse: ${id.split(':').slice(1).join(':')} says "node"\n      → say it in the person's words (täällä / here / talo / your account); the word is for operator and developer surfaces only`);
}
for (const id of jargon.stale) {
  failures.push(`✖ baseline entry no longer offends: ${id}\n      → remove it from security/locale-jargon-baseline.json — the ratchet only tightens`);
}

if (failures.length) {
  console.error(`\n✖ ${failures.length} locale violation(s):\n`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
console.log('\n✓ Locale files agree with en.json. Untranslated keys fall back to English, by design.');
