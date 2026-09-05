/**
 * @file living/nodes/text-node.js
 * @description THE SENTENCE THAT KNOWS WHERE THE DOCUMENT IS. A number on its own tells a reader
 *   what, never whether: 31.4 is a fact and "liian kuuma" is the point. So the prose is a node
 *   like any other — a template over the graph, recomputed with everything else, rendered into a
 *   section of the arrangement.
 *
 *   THIS IS WHERE A THRESHOLD WOULD OTHERWISE BE WRITTEN TWICE. The chart bands say 30, the
 *   machine's guard says 30, and a hand-typed caption saying "over 30 is too hot" is the copy
 *   that goes stale the first time somebody moves the threshold. Here the caption reads the same
 *   condition the machine does.
 *
 *   IT PRODUCES TEXT, NEVER MARKUP. See text.js: whoever renders it sets textContent.
 *
 *   THE TEMPLATE MAY BE ONE SENTENCE PER LANGUAGE — { fi: "…", en: "…" } — each composed as
 *   itself rather than translated, with the same {{ }} holes in both. That last part is checked:
 *   validate() refuses a template that reads a node in one language and not in the other, naming
 *   the node and the language, because a sentence that goes blank in Finnish and reads in English
 *   is exactly the kind of quietly wrong this library exists to make impossible.
 *
 * @node       text      A sentence over the graph: it changes when the numbers do.
 * @inputs     text      template (with {{ node }}, {{ node | format }} and {{ if expr }}…{{ else }}…{{ end }})
 * @outputs    text      value — the rendered sentence
 * @options    text      block (a section to render it into) · label
 * @languages  text      template · label
 * @example    text      { "type": "text", "template": { "fi": "Lämpötila on {{ t | 1 }} °C, {{ if t > 30 }}liian kuuma{{ else }}hyvä{{ end }}.", "en": "It is {{ t | 1 }} °C, {{ if t > 30 }}too hot{{ else }}fine{{ end }}." }, "block": "note" }
 * @structure textNode: the node-type module (dependsOn · prepare · evaluate · relanguage)
 * @usage  import { textNode } from './text-node.js';
 * @version-history
 *   v0.4.0 — 2026-09-06 — The template may be a language map, read through ctx.langs() and read
 *     again on relanguage().
 *   v0.1.0 — 2026-09-05 — Initial (the living document, stage 1).
 */
import { parseTemplate, renderTemplate, symbolsOfTemplate } from '../text.js';
import { isError } from '../formula-eval.js';
import { textOf } from '../i18n.js';

export const textNode = {
  id: 'text',

  dependsOn(node, ctx) {
    return symbolsOfTemplate(ctx.compiled.parts).map((s) => s.split('.')[0]);
  },

  prepare(node, ctx) {
    const langs = ctx.langs ? ctx.langs() : [];
    const parts = parseTemplate(textOf(node.template, langs));
    ctx.compiled.lang = langs[0] || '';
    if (isError(parts)) { ctx.compiled.parts = []; return [parts.error]; }
    ctx.compiled.parts = parts;
    return [];
  },

  /** The page changed language: read the sentence again, from the same record. */
  relanguage(node, ctx) { this.prepare(node, ctx); },

  evaluate(node, ctx) { return renderTemplate(ctx.compiled.parts, ctx.scope, ctx.compiled.lang); },
};
