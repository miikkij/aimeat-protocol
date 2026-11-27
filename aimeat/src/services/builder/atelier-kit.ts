/**
 * @file src/services/builder/atelier-kit.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Atelier kit's reference as text: one line per public function of
 *   `AIMEAT.atelier` (the components, and app(), mosaic(), toast() and the helpers beside them),
 *   and one of them whole (its call, the options it takes, and for a component its parts, slots,
 *   variants, tokens and what forking it costs). Served as the build specification's sections `kit` and `kit-<name>`
 *   (atelier-platform.ts), so `aimeat_handbook_get { tier: "build-app-atelier/kit-form" }` and
 *   `GET /v1/prompts/build-app-atelier/sections/kit-form` answer what
 *   `AIMEAT.atelier.describe("form")` answers in a browser, and the options beside it.
 *
 *   WHY. describe() needs a browser. A builder that works over MCP from a terminal has none: five
 *   measured builds on 2026-11-27 each downloaded the kit's bundle, about 15,000 lines, and
 *   searched it for `function form(spec)`, `function list(spec)` and the like, 110 file reads and
 *   searches in one round, and one build started a browser only to ask the library its options.
 *
 *   ONE SOURCE. The text is the component modules' own JSDoc, read into
 *   atelier-kit-reference.generated.ts by tools/build-atelier-parts.ts, the tool that writes what
 *   describe() answers; `pnpm check:atelier-parts` refuses a commit where either has drifted.
 * @structure kitIndex() · kitComponent(name) · kitComponentNames()
 * @usage
 *   kitIndex()            // "## The kit: every component…"
 *   kitComponent('form')  // "## AIMEAT.atelier.form(spec)…", or null for a name the kit lacks
 * @version-history
 *   v1.0.0 — 2026-11-28 — Initial (wish-atelier-kirjaston-osan-asetukset-saa-yhdell-kutsulla-ilman-s).
 */
import { KIT_REFERENCE, type KitReference } from './atelier-kit-reference.generated.js';

/** Every component the kit describes, in the order the index lists them. */
export function kitComponentNames(): string[] {
  return Object.keys(KIT_REFERENCE).sort((a, b) => a.localeCompare(b));
}

/** The reference's own first sentence of a component, for the index line. */
function firstSentence(ref: KitReference): string {
  const lead = ref.doc.split(/\n\s*@/)[0].replace(/\s+/g, ' ').trim();
  const end = lead.search(/[.:](\s|$)/);
  return (end > 0 ? lead.slice(0, end) : lead).slice(0, 140);
}

/** The section `kit`: one line per component, and how one is read whole. */
export function kitIndex(): string {
  let out = '## The kit: every component, and how to read one whole\n';
  out += 'Read a component here BEFORE you call it, in place of searching the library\'s source: '
    + '`aimeat_handbook_get { tier: "build-app-atelier/kit-<name>" }` (over HTTP `/v1/prompts/build-app-atelier/sections/kit-<name>?format=txt`) '
    + 'answers its call, every option it takes with its type, what it returns, and the parts, slots, variants and tokens you may change without forking it. '
    + 'It is the text `AIMEAT.atelier.describe("<name>")` reads in a browser, taken from the component\'s own source, so it holds for the kit this node serves.\n\n';
  for (const name of kitComponentNames()) {
    const ref = KIT_REFERENCE[name];
    const what = firstSentence(ref);
    out += `- \`${name}\`${ref.use.length ? ` (${ref.use.join(', ')})` : ''}${what ? `: ${what}` : ''}\n`;
  }
  return out;
}

/** One component whole, or null for a name the kit does not have. */
export function kitComponent(name: string): string | null {
  const ref = Object.hasOwn(KIT_REFERENCE, name) ? KIT_REFERENCE[name] : undefined;
  if (!ref) return null;
  const list = (label: string, items: string[]): string => (items.length ? `- ${label}: ${items.map(i => `\`${i}\``).join(' · ')}\n` : '');
  let out = `## AIMEAT.atelier.${ref.call || name}\n`;
  out += ref.doc
    ? 'Its options and what it returns, as its source documents them:\n\n```\n' + ref.doc + '\n```\n\n'
    : `\`${name}\` is not called on its own: it is a part or a frame another component builds (source: \`${ref.file}\`). Read \`kit\` for the component that takes it.\n\n`;
  const changeable = list('parts (each element the kit builds carries `data-ak-part="<name>"`)', ref.parts)
    + list('slots (`parts: { <name>: … }` in the spec)', ref.slots)
    + list('variants (`variant:` in the spec)', ref.variants)
    + list('tokens (set on the component\'s own box)', ref.tokens);
  if (changeable) out += 'What you may change without forking it:\n' + changeable;
  if (ref.use.length) out += `- what it is for: ${ref.use.join(', ')}\n`;
  if (ref.fork) out += `\nForking it: ${ref.fork}\n`;
  return out;
}
