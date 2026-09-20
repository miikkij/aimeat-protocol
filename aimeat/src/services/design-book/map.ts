/**
 * @file src/services/design-book/map.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Design Book as ONE page a builder can take in before it writes a line.
 *
 *   Measured 2026-09-19 on three builds of one app: the Book was searched in none of them. Size
 *   was not what stopped it. The search takes a word or a kind, so it serves a builder that
 *   already knows what the Book holds; with no word it returned the first 50 of 90 rows, each a
 *   JSON object of ten fields, and nothing in a build made the call necessary. The map is the
 *   answer to "what is in there": every part on one line, grouped by kind, each kind with one
 *   sentence on what it is for, and on a genre whether it keeps its own colours. It is built from
 *   the Book's own rows on every read, so it cannot drift from the shelf.
 *
 *   It rides inside part `libraries` of the Atelier specification, so it has to stay inside that
 *   part's share of one tool result: past MAP_BUDGET the summaries are cut shorter, never the rows.
 * @structure MAP_BUDGET · MapRow · buildDesignBookMap(rows, opts)
 * @usage const text = buildDesignBookMap(rows, { baseUrl, light, unlisted });
 * @version-history
 *   v1.0.0 — 2026-09-19 — Initial.
 */

/** The map's share of one tool result. Part `libraries` is 9 kB without it, and a result holds 24 kB. */
export const MAP_BUDGET = 13_000;

/** What a search with no word says beside the map, on every door. */
export const MAP_NOTE = 'This is the whole published Book on one page. Give a word (q) or a kind to get rows with their tags, versions and usage instead.';

/** How the reasons queue is to be read, on every door: what it is, and what it is not. */
export const REASONS_NOTE = 'These are the builders\' OWN ACCOUNTS of why they took a part, passed one over, or made something by hand. They are leads for a person to read, not measurements. '
  + '`times` counts builders; `kept` counts the apps among them whose owner said the app turned out well, and only that number says anybody was satisfied.';

export interface MapRow { id: string; kind: string; summary: string }

export interface MapOptions {
  baseUrl: string;
  /** Genre id (as in the Book, `genre-<name>`) to whether the page keeps its own colours. */
  light?: Map<string, 'fixed' | 'follows'>;
}

const KINDS: Array<[string, string]> = [
  ['genre', 'GENRES: a whole page in a committed look. A build STARTS by forking one (`aimeat_app_template_get`), never by adopting it.'],
  ['layout', 'LAYOUTS: a complete arrangement of a screen, with its blocks placed. Adopt one instead of arranging blocks yourself.'],
  ['fill', 'FILLS: a starting shape for ONE screen or dialog, with the words and the states already thought through.'],
  ['look', 'LOOKS: a proven token sheet (colour pair, type, corners) for a screen that has no genre of its own.'],
  ['motion', 'MOTION: how things arrive and change. A sheet of motion tokens, adopted whole.'],
  ['ambient', 'AMBIENTS: the one layer allowed to move at idle, behind the words.'],
  ['effect', 'EFFECTS: a treatment on a picture or a block: still on the words, a moment on a cue.'],
  ['illustration', 'ILLUSTRATIONS: art direction as words, for the imagery pipeline.'],
];

/** The first sentence of a summary, or its first `max` characters. */
function lead(summary: string, max: number): string {
  const text = String(summary ?? '').replace(/\s+/g, ' ').trim();
  // A full stop only: "A Swiss data poster: strict rules, one red." cut at its colon says nothing.
  const sentence = new RegExp(`^(.{20,${max}}?[.!?])(?:\\s|$)`).exec(text);
  return sentence ? sentence[1] : text.slice(0, max);
}

function render(rows: MapRow[], opts: MapOptions, max: number): string {
  const base = opts.baseUrl.replace(/\/+$/, '');
  let out = '## What the Design Book holds\n\n'
    + 'Every part here passed its own bench before it was published. Read this list before you compose anything: '
    + 'open ONE part with `aimeat_designbook_get { id }`, take it into your app with `aimeat_designbook_adopt { id, filename }`, '
    + 'see any part as a real page at ' + base + '/v1/designbook/<id>/preview, and search by word with '
    + '`aimeat_designbook_search { q }`. What you make that is not here, propose back with `aimeat_designbook_propose`.\n\n';
  const known = new Set(KINDS.map(([kind]) => kind));
  const groups: Array<[string, string]> = [...KINDS];
  for (const kind of new Set(rows.map(r => r.kind))) if (!known.has(kind)) groups.push([kind, kind.toUpperCase()]);
  for (const [kind, head] of groups) {
    const mine = rows.filter(r => r.kind === kind).sort((a, b) => a.id.localeCompare(b.id));
    if (!mine.length) continue;
    out += `### ${head} (${mine.length})\n`;
    for (const row of mine) {
      const light = kind === 'genre' ? ` [${opts.light?.get(row.id) === 'follows' ? 'follows the theme' : 'fixed colours'}]` : '';
      out += `- \`${row.id}\`${light}: ${lead(row.summary, max)}\n`;
    }
    out += '\n';
  }
  return out;
}

export function buildDesignBookMap(rows: MapRow[], opts: MapOptions): string {
  for (const max of [150, 90, 50]) {
    const text = render(rows, opts, max);
    if (text.length <= MAP_BUDGET) return text;
  }
  return render(rows, opts, 24);
}
