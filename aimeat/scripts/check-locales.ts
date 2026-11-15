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
 *   v1.6.0 — 2026-11-15 — PICTURE_WORDS: the door ratchet's model for the other words used as a
 *     picture of something else (road and way in, hand, room, wall, and single images such as a
 *     shelf or a shop window), one baseline file per word.
 *   v1.5.0 — 2026-11-15 — The same ratchet for "door" (fi "ovi", es "puerta"), with its own
 *     baseline security/locale-door-baseline.json, a map from id to the reason a real door or an
 *     idiom is allowed. The word had reached 64 English, 47 Finnish and 58 Spanish strings as a name
 *     for buttons, sign-in methods and endpoints; they were rewritten in the same change.
 *   v1.4.1 — 2026-11-04 — Reads APP_GRANTABLE_SCOPES from src/services/app-grant-vocabulary.ts, where
 *     the file moved (codebase analysis 2026-11-03, item D-d).
 *   v1.4.0 — 2026-09-12 — missingBlockWords(): the Portal page prints a name and a sentence for
 *     every part a page can be built from, so each block id in the surface-layout registry needs
 *     surface.blocks.<id>.label and .summary in en.json. Before this, the summary had no locale key
 *     at all: a Finnish operator read a fully Finnish page with twenty English sentences in it.
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
 * The Portal page prints one sentence under every part it offers, and an operator reads it in their
 * own language. The registry's English `summary` is the fallback and the AI prompt's source; the
 * page prefers surface.blocks.<id>.summary, beside the label it already reads. A block added
 * without those two words shows a Finnish operator an English sentence, or a raw id.
 *
 * The source of truth is the three registry files, read the way the other two checks read theirs.
 */
function missingBlockWords(en: Record<string, unknown>): string[] {
  const base = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'services', 'surface-layout');
  const out: string[] = [];
  for (const file of ['blocks-portal.ts', 'blocks-home.ts', 'registry.ts']) {
    let src: string;
    try { src = readFileSync(join(base, file), 'utf-8'); } catch { continue; }
    for (const m of src.matchAll(/^\s{8}id: '([a-z-]+\.[a-z-]+)',$/gm)) {
      const id = m[1];
      for (const word of ['label', 'summary']) {
        const key = `surface.blocks.${id}.${word}`;
        if (!(key in en)) out.push(`${key} — the ${word === 'label' ? 'name' : 'sentence'} an operator reads for the "${id}" part`);
      }
    }
  }
  return [...new Set(out)];
}

/**
 * Same shape of guarantee for the app-grant consent screen. Its source of truth is
 * APP_GRANTABLE_SCOPES in src/services/app/grant-vocabulary.ts: every scope an app may request must
 * have a
 * plain-language sentence in en.json (the app-context override tree first, the shared agent tree
 * as fallback — the exact chain consent-vocab.js resolves) and every scope FAMILY must have an
 * appGrant.area name for the "Works with:" line. Without the sentence the row falls back to the
 * server's English-only description; without the family name the raw word ("storage") prints.
 */
function missingAppGrantSentences(en: Record<string, unknown>): string[] {
  const routePath = join(dirname(fileURLToPath(import.meta.url)), '..',
    'src', 'services', 'app', 'grant-vocabulary.ts');
  const src = readFileSync(routePath, 'utf-8');
  const block = src.match(/APP_GRANTABLE_SCOPES: Record<string, string> = \{([\s\S]*?)\n\};/);
  if (!block) return ['(check-locales cannot find APP_GRANTABLE_SCOPES in src/services/app/grant-vocabulary.ts — the parser needs updating)'];
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

/**
 * "door" was this codebase's own word for an endpoint, a button, a sign-in method or a way in, and it
 * reached people: "What this door does", "Refused at the door", "the federation door". A reader
 * cannot tell what it names. The strings were rewritten on 2026-11-15; this keeps a new one out.
 * A real door (a door code, a door sensor) and an established idiom are allowed in the baseline,
 * each with its reason. Finnish covers the inflected forms and the compounds the sweep found.
 */
const DOOR_BY_LOCALE: Record<string, RegExp> = {
  fi: /(?<![\p{L}0-9])(?:kirjautumis|hakemisto|eväste|sopimus|etu|taka|pää|sivu|sisään)?ov(?:i|et|en|ea|elle|ella|elta|esta|essa|eksi|ia|ien|ille|illa|ilta|issa|ista|ineen)(?![\p{L}])/iu,
  en: /\bdoor(?:s|way|ways)?\b/i,
  es: /\bpuertas?\b/i,
};
const DOOR_BASELINE = new URL('../security/locale-door-baseline.json', import.meta.url);

/**
 * The same habit as "door", with other words: a picture of something else in place of the thing's
 * name. The strings were rewritten on 2026-11-15, one word family per change, and each family keeps
 * its own ratchet here with its own baseline (security/locale-<word>-baseline.json, a map from id
 * to the reason a use is allowed). Where a word has many idiomatic uses in one language (Finnish
 * "saman tien", Spanish "en camino"), that language's pattern names only the pictures the sweep
 * removed, so an idiom is never an offense.
 */
interface PictureWord { word: string; byLocale: Record<string, RegExp>; baseline: URL; fix: string }
const PICTURE_WORDS: PictureWord[] = [
  {
    word: 'road / way in',
    byLocale: {
      en: /\b(?:roads?|ways? in)\b/i,
      fi: /(?<![\p{L}])(?:(?:tie|tiet|tiesi|reitti) (?:sisään|ulos|tänne)|(?:kaksi|kolme|neljä|viisi|\d+) (?:tietä|reittiä)|tällä tiellä|(?:koko|parempi) (?:tie|reitti)(?![\p{L}]))/iu,
      es: /\b(?:vías? de entrada|(?:dos|tres|cuatro|cinco|\d+) caminos|camino corto|por este camino|camino de vuelta)\b/i,
    },
    baseline: new URL('../security/locale-road-baseline.json', import.meta.url),
    fix: 'name what the reader does: sign in, three ways, this prompt, a link, all the steps',
  },
  {
    // "by hand", "hands-on" and "into the wrong hands" are ordinary English and stay out of the pattern.
    word: 'hand',
    byLocale: {
      en: /\b(?:by (?:your|my|their|his|her) own hands?|(?:your|my|their|own) hands\b|gets hands|a hand reaches|through your hands)/i,
      fi: /(?<![\p{L}])(?:käsiisi|käsiesi|käsissään|käsissäsi|kädet|käsi ulottuu)(?![\p{L}])/iu,
      es: /\b(?:en tus (?:propias )?manos|a través de tus manos|en la mano)\b/i,
    },
    baseline: new URL('../security/locale-hand-baseline.json', import.meta.url),
    fix: 'say who does it: you revoke it yourself, your AI gets tools, it is the easiest button to find',
  },
  {
    // A realtime room is the industry's word for a live session and is not in the pattern.
    word: 'machine room / showroom',
    byLocale: {
      en: /\b(?:machine room|engine room|control room|showrooms?)\b/i,
      fi: /(?<![\p{L}])(?:konehuone\p{L}*|näyttelytila\p{L}*|näyttelykuva\p{L}*|näyttelytiski\p{L}*|näyttelysovellu\p{L}*|myyntihuone\p{L}*)|työtilat ovat (?:sen )?huoneet/iu,
      es: /\b(?:sala de (?:máquinas|exhibición|control|venta)|sala estática|son sus salas)\b/i,
    },
    baseline: new URL('../security/locale-room-baseline.json', import.meta.url),
    fix: 'name the page or the thing: the admin pages, a demo, a card, its documents and records',
  },
  {
    word: 'wall',
    byLocale: {
      en: /\bwalls?\b/i,
      fi: /(?<![\p{L}])(?:korttiseinä\p{L}*|aloitusseinä\p{L}*|seinä\p{L}*|seinil\p{L}*)/iu,
      es: /\bmuros?\b/i,
    },
    baseline: new URL('../security/locale-wall-baseline.json', import.meta.url),
    fix: 'name the list: the public app list, the front page\'s app list, a grid of cards; a blocked sign-in is "blocked"',
  },
];

function jargonOffenders(
  byLocale: Record<string, RegExp> = JARGON_BY_LOCALE,
  baselineFile: URL = JARGON_BASELINE,
): { fresh: string[]; stale: string[] } {
  let baseline: string[] = [];
  try {
    const raw: unknown = JSON.parse(readFileSync(baselineFile, 'utf-8'));
    // A list of ids, or a map of id → the reason it is allowed.
    baseline = Array.isArray(raw) ? raw as string[] : Object.keys(raw as Record<string, string>);
  } catch { baseline = []; }
  const known = new Set(baseline);
  const current = new Set<string>();
  for (const tag of ['fi', 'en', 'es']) {
    const re = byLocale[tag];
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

// The Portal page's part list is key-derived the same way: a block with no words is an id on screen.
for (const missing of missingBlockWords(en)) {
  failures.push(`✖ [en] the Portal page has no words for a part: ${missing}\n      → add it to locales/en.json (and fi/es), beside the other surface.blocks entries`);
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

// The same ratchet for "door" / "ovi" / "puerta" used as a name for something that is not a door.
const doors = jargonOffenders(DOOR_BY_LOCALE, DOOR_BASELINE);
for (const id of doors.fresh) {
  failures.push(`✖ [${id.split(':')[0]}] "door" names something a person cannot see: ${id.split(':').slice(1).join(':')}\n      → name the thing itself: the button, the link, sign-in, the call, the way an agent connects; a real door goes in security/locale-door-baseline.json with its reason`);
}
for (const id of doors.stale) {
  failures.push(`✖ baseline entry no longer offends: ${id}\n      → remove it from security/locale-door-baseline.json — the ratchet only tightens`);
}

// One ratchet per picture word, each with its own baseline of allowed uses.
for (const p of PICTURE_WORDS) {
  const file = `security/${p.baseline.pathname.split('/').pop()}`;
  const hits = jargonOffenders(p.byLocale, p.baseline);
  for (const id of hits.fresh) {
    failures.push(`✖ [${id.split(':')[0]}] "${p.word}" is a picture, not the thing's name: ${id.split(':').slice(1).join(':')}\n      → ${p.fix}; a real use goes in ${file} with its reason`);
  }
  for (const id of hits.stale) {
    failures.push(`✖ baseline entry no longer offends: ${id}\n      → remove it from ${file} — the ratchet only tightens`);
  }
}

if (failures.length) {
  console.error(`\n✖ ${failures.length} locale violation(s):\n`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
console.log('\n✓ Locale files agree with en.json. Untranslated keys fall back to English, by design.');
