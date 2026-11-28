/**
 * @file tools/build-lib-reference.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The reference of the libraries every app calls beside the Atelier kit (sign-in,
 *   data, language and formats), READ OUT OF THEIR SOURCE into
 *   src/services/builder/lib-reference.generated.ts, which the node serves as the build
 *   specification's sections `lib` and `lib-<name>` (services/builder/lib-reference.ts).
 *
 *   WHY. A builder that works over MCP from a terminal cannot ask a library in a browser what a
 *   function takes. In measured builds on 2026-11-27 and 28 every builder downloaded
 *   aimeat-auth.js and searched it for the login button's options and the shape of the session
 *   (`displayName`), and most did the same with the data and the language library. The kit got
 *   its reference first (tools/build-atelier-parts.ts); this is the same for the libraries around it.
 *
 *   HOW A MEMBER IS FOUND. Each library says where its public members are written, in one of the
 *   three shapes the sources use:
 *     object    a method of an object literal (`const data = { async set(key, value, opts) {`)
 *     assigned  a function assigned to that object later (`auth.getLang = function (locales) {`)
 *     map       an object that names its functions (`AIMEAT.fmt = { date: fmtDate, … }`)
 *   A member's text is the JSDoc block right above it, or the line comments right above it when
 *   it has no block. A member with neither is listed with its call alone. A name that starts with
 *   an underscore is the library's own and is left out. The `@typedef` blocks of the same file
 *   whose names the texts use follow the members.
 *
 *   `--check` fails when the generated file no longer matches the sources.
 * @structure LIBS · readLibrary() · emit() · main(): write or --check
 * @usage cd aimeat && pnpm exec tsx tools/build-lib-reference.ts [--check]
 *   (or: pnpm build:lib-reference / pnpm check:lib-reference)
 * @version-history
 *   v1.0.0 — 2026-11-28 — Initial (wish-kirjautumis-data-ja-kielikirjaston-funktioiden-ohje-yhdell-k).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const OUT = fileURLToPath(new URL('../src/services/builder/lib-reference.generated.ts', import.meta.url));

type Where =
  | { shape: 'object'; file: string; object: string }
  | { shape: 'assigned'; file: string; object: string }
  | { shape: 'map'; file: string; map: string };

interface LibSpec {
  id: string; global: string; script: string; what: string; where: Where[];
  /** More files whose `@typedef` blocks the members' texts may name. */
  types?: string[];
}

/** The libraries with a reference, in the order the index lists them. */
export const LIBS: LibSpec[] = [
  {
    id: 'auth', global: 'AIMEAT.auth', script: '/v1/libs/aimeat-auth.js',
    what: 'Sign-in and the session: the login button, the signed-in person, an authenticated fetch.',
    where: [
      { shape: 'object', file: 'src/static/sdk-libs/auth/session.js', object: 'auth' },
      { shape: 'assigned', file: 'src/static/sdk-libs/auth/index.js', object: 'auth' },
    ],
    // The session a callback receives and the login button's options are typed where the callbacks are.
    types: ['src/static/sdk-libs/auth/on-login.js'],
  },
  {
    id: 'data', global: 'AIMEAT.data', script: '/v1/libs/aimeat-data.js',
    what: 'The signed-in person\'s own records on the node: read, write with a version, list, search, and an extension\'s action.',
    where: [{ shape: 'object', file: 'src/static/sdk-libs/data/index.js', object: 'data' }],
  },
  {
    id: 'i18n', global: 'AIMEAT.i18n', script: '/v1/cortex/aimeat-i18n/libs/aimeat-i18n.js',
    what: 'The words: translations, the language in use and its switch.',
    where: [{ shape: 'map', file: 'public/cortex-bundled/aimeat-i18n.js', map: 'AIMEAT.i18n' }],
  },
  {
    id: 'fmt', global: 'AIMEAT.fmt', script: '/v1/cortex/aimeat-i18n/libs/aimeat-i18n.js',
    what: 'How things are written: dates, times, numbers, money and durations in the person\'s own format and clock.',
    where: [{ shape: 'map', file: 'public/cortex-bundled/aimeat-i18n.js', map: 'AIMEAT.fmt' }],
  },
];

export interface Member { name: string; call: string; doc: string }
export interface Library { id: string; global: string; script: string; what: string; members: Member[]; types: string[] }

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A comment's text without its frame; a type named through its module is left as its name. */
const unframe = (block: string): string => block.split(/\r?\n/)
  .map((l) => l.replace(/^\s*(?:\/\*\*|\*\/|\*|\/\/)\s?/, '').replace(/\s+$/, '').replace(/import\((['"])[^'"]+\1\)\./g, ''))
  .join('\n').trim();

/** The comment that ends right before `at`: a JSDoc block, or the line comments above. */
function commentBefore(text: string, at: number): string {
  const before = text.slice(0, at).replace(/[ \t]+$/, '');
  const block = /\/\*\*((?:(?!\*\/)[\s\S])*?)\*\/\s*$/.exec(before);
  if (block) return unframe(block[1]);
  const lines = before.split(/\r?\n/);
  if (lines[lines.length - 1].trim() === '') lines.pop();
  const kept: string[] = [];
  for (let i = lines.length - 1; i >= 0 && /^\s*\/\//.test(lines[i]); i--) kept.unshift(lines[i]);
  // A divider line (`// ── Section ──`) names a part of the file, not the member under it.
  return unframe(kept.filter((l) => !/^\s*\/\/\s*[─═-]{2,}/.test(l)).join('\n'));
}

/** The text of the object literal `name = {`, from its brace to the matching one, and where it starts. */
function objectBody(text: string, opener: RegExp, file: string): { body: string; from: number } {
  const m = opener.exec(text);
  if (!m) throw new Error(`${file}: ${opener} was not found; the library's public object moved`);
  const open = text.indexOf('{', m.index);
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return { body: text.slice(open, i + 1), from: open };
  }
  throw new Error(`${file}: the object opened by ${opener} is not closed`);
}

const tidy = (args: string): string => args.replace(/\s+/g, ' ').trim();

function readWhere(w: Where): { members: Member[]; text: string } {
  const text = readFileSync(ROOT + w.file, 'utf8');
  const members: Member[] = [];
  if (w.shape === 'object') {
    const { body, from } = objectBody(text, new RegExp(String.raw`(?:export\s+)?(?:const|var|let)\s+${esc(w.object)}\s*=\s*\{`), w.file);
    for (const m of body.matchAll(/^ {2}(?:async\s+)?([A-Za-z$][\w$]*)\s*\(([^)]*)\)\s*\{/gm)) {
      members.push({ name: m[1], call: `${m[1]}(${tidy(m[2])})`, doc: commentBefore(text, from + (m.index as number)) });
    }
  } else if (w.shape === 'assigned') {
    for (const m of text.matchAll(new RegExp(String.raw`^${esc(w.object)}\.([A-Za-z$][\w$]*)\s*=\s*function\s*\(([^)]*)\)`, 'gm'))) {
      members.push({ name: m[1], call: `${m[1]}(${tidy(m[2])})`, doc: commentBefore(text, m.index as number) });
    }
  } else {
    const { body } = objectBody(text, new RegExp(String.raw`^\s*${esc(w.map)}\s*=\s*\{`, 'm'), w.file);
    // `name: fn` names a function of the file; `name: function () { … }` is written in place.
    for (const m of body.matchAll(/([A-Za-z$][\w$]*)\s*:\s*(function\s*\(([^)]*)\)|[A-Za-z$][\w$]*)/g)) {
      const name = m[1];
      if (m[2].startsWith('function')) { members.push({ name, call: `${name}(${tidy(m[3] ?? '')})`, doc: '' }); continue; }
      const fn = new RegExp(String.raw`^\s*function\s+${esc(m[2])}\s*\(([^)]*)\)`, 'm').exec(text);
      if (!fn) continue;
      members.push({ name, call: `${name}(${tidy(fn[1])})`, doc: commentBefore(text, fn.index) });
    }
  }
  return { members: members.filter((m) => !m.name.startsWith('_')), text };
}

export function readLibrary(spec: LibSpec): Library {
  const members: Member[] = [];
  const texts: string[] = [];
  for (const w of spec.where) {
    const read = readWhere(w);
    for (const m of read.members) if (!members.some((x) => x.name === m.name)) members.push(m);
    texts.push(read.text);
  }
  for (const file of spec.types ?? []) texts.push(readFileSync(ROOT + file, 'utf8'));
  // The typedefs the members' texts name, in the order the files declare them.
  const used = members.map((m) => m.doc).join('\n');
  const types: string[] = [];
  for (const text of texts) {
    for (const [, block, name] of text.matchAll(/\/\*\*((?:(?!\*\/)[\s\S])*?@typedef\s+\{[^}]*\}\s+([A-Za-z][A-Za-z0-9]*)(?:(?!\*\/)[\s\S])*?)\*\//g)) {
      if (new RegExp(String.raw`\b${name}\b`).test(used) && !types.some((t) => t.includes(`} ${name}`))) types.push(unframe(block));
    }
  }
  if (members.length === 0) throw new Error(`${spec.id}: no public member was found; the library's source changed shape`);
  return { id: spec.id, global: spec.global, script: spec.script, what: spec.what, members, types };
}

function emit(libs: Library[]): string {
  const body = libs.map((l) => `  ${JSON.stringify(l.id)}: ${JSON.stringify({ global: l.global, script: l.script, what: l.what, members: l.members, types: l.types })},`).join('\n');
  return `/**
 * @file src/services/builder/lib-reference.generated.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description GENERATED — do not edit. The public functions of the sign-in, data, language and
 *   format libraries, each with its call and the comment its source carries, read out of the
 *   libraries by tools/build-lib-reference.ts. services/builder/lib-reference.ts serves it as the
 *   specification's sections \`lib\` and \`lib-<name>\`. Run \`pnpm build:lib-reference\` after
 *   changing a public function's comment; \`pnpm check:lib-reference\` refuses a commit where the
 *   two have drifted.
 * @structure LIB_REFERENCE: one entry per library
 * @version-history
 *   v1.0.0 — 2026-11-28 — Generated (wish-kirjautumis-data-ja-kielikirjaston-funktioiden-ohje-yhdell-k).
 */
export interface LibReference {
  global: string; script: string; what: string;
  members: Array<{ name: string; call: string; doc: string }>;
  types: string[];
}

export const LIB_REFERENCE: Record<string, LibReference> = {
${body}
};
`;
}

const want = emit(LIBS.map(readLibrary));
if (process.argv.includes('--check')) {
  const have = ((): string => { try { return readFileSync(OUT, 'utf8'); } catch { return ''; } })();
  if (have.replace(/\r\n/g, '\n') !== want.replace(/\r\n/g, '\n')) {
    console.error('\n✖ src/services/builder/lib-reference.generated.ts drifts from the libraries\' own comments — run `pnpm build:lib-reference` and commit the result.\n');
    process.exit(1);
  }
  console.log(`  ok   lib-reference.generated.ts matches the source (${LIBS.length} libraries)`);
} else {
  writeFileSync(OUT, want, 'utf8');
  console.log(`  wrote lib-reference.generated.ts (${LIBS.map((l) => l.id).join(', ')})`);
}
