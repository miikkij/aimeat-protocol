/**
 * @file src/services/builder/lib-reference.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The reference of the libraries an app calls beside the Atelier kit, as text: the
 *   sign-in library (`AIMEAT.auth`), the data library (`AIMEAT.data`), the words (`AIMEAT.i18n`) and
 *   the formats (`AIMEAT.fmt`). Served as the build specification's sections `lib` (which libraries,
 *   and every function of each in one line) and `lib-<name>` (one library whole: each function's
 *   call and what its source says about it, and the types those name), so
 *   `aimeat_handbook_get { tier: "build-app-atelier/lib-auth" }` answers what a builder otherwise
 *   downloads the library and searches it for.
 *
 *   WHY. In measured builds on 2026-11-27 and 28 every builder downloaded aimeat-auth.js and
 *   searched it for the login button's options and the session's shape, and most did the same with
 *   the data and the language library. The kit's own reference (atelier-kit.ts) covers
 *   `AIMEAT.atelier` only.
 *
 *   ONE SOURCE. The text is the libraries' own comments, read into lib-reference.generated.ts by
 *   tools/build-lib-reference.ts; `pnpm check:lib-reference` refuses a commit where it has drifted.
 * @structure libIndex() · libPage(name) · libNames()
 * @usage
 *   libIndex()       // "## The libraries beside the kit…"
 *   libPage('auth')  // "## AIMEAT.auth…", or null for a name with no reference
 * @version-history
 *   v1.0.0 — 2026-11-28 — Initial (wish-kirjautumis-data-ja-kielikirjaston-funktioiden-ohje-yhdell-k).
 */
import { LIB_REFERENCE } from './lib-reference.generated.js';

/** The libraries that have a reference, in the order the index lists them. */
export function libNames(): string[] {
  return Object.keys(LIB_REFERENCE);
}

/** The section `lib`: each library, how it is loaded, and its functions by name. */
export function libIndex(): string {
  let out = '## The libraries beside the kit: sign-in, data, words and formats\n';
  out += 'Read a library here BEFORE you call it, in place of downloading it and searching its source: '
    + '`aimeat_handbook_get { tier: "build-app-atelier/lib-<name>" }` (over HTTP `/v1/prompts/build-app-atelier/sections/lib-<name>?format=txt`) '
    + 'answers every public function of it with its call and what it does, taken from the library\'s own source. '
    + 'The Atelier kit itself (`AIMEAT.atelier`) is the sections `kit` and `kit-<name>`.\n\n';
  for (const name of libNames()) {
    const lib = LIB_REFERENCE[name];
    out += `- \`lib-${name}\`: \`${lib.global}\` (\`${lib.script}\`). ${lib.what} Functions: ${lib.members.map(m => `\`${m.name}\``).join(', ')}.\n`;
  }
  return out;
}

/** One library whole, or null for a name that has no reference. */
export function libPage(name: string): string | null {
  const lib = Object.hasOwn(LIB_REFERENCE, name) ? LIB_REFERENCE[name] : undefined;
  if (!lib) return null;
  let out = `## ${lib.global}\n${lib.what} Loaded with \`<script src="${lib.script}"></script>\`. `
    + 'Each function below is written as its source documents it.\n';
  for (const m of lib.members) {
    out += `\n### ${lib.global}.${m.call}\n`;
    out += m.doc ? m.doc + '\n' : 'Its source carries no description: the call above is what it takes.\n';
  }
  if (lib.types.length) out += '\n### The types named above\n\n```\n' + lib.types.join('\n\n') + '\n```\n';
  return out;
}
