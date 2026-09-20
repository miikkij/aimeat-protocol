/**
 * @file src/services/app-ui/catalogue-index.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The UI catalogue in the size a reader can take: an index by default, and any part
 *   of it in full when asked by name.
 *
 *   The whole catalogue is 89 kB, and it rode along on every read of a stored arrangement. Two
 *   readers paid for that. An AI asking for one app's layout was answered 94 000 characters, which
 *   is more than one tool result carries, so the client wrote it to a file a chat cannot open and
 *   the builder got nothing (measured 2026-09-20). And every open of every mosaic app downloaded
 *   the 89 kB to read the few hundred bytes of layout beside it.
 *
 *   The index names every component with its one line and its prop NAMES, and every other section
 *   by the ids it holds. `detail` takes names from it (`table`, `effects`, `layouts`) and answers
 *   those in full, so the second call is exact instead of a guess.
 * @structure CatalogueMode · catalogueMode(value) · buildUiCatalogueView(mode, detail)
 * @usage const catalogue = buildUiCatalogueView('index', ['table', 'effects']);
 * @version-history
 *   v1.0.0 — 2026-09-20 — Initial.
 */
import { buildUiCatalogue } from './catalogue.js';

export type CatalogueMode = 'full' | 'index' | 'none';

/** What a query string or a tool argument asked for; anything else is the door's own default. */
export function catalogueMode(value: unknown): CatalogueMode | undefined {
  return value === 'full' || value === 'index' || value === 'none' ? value : undefined;
}

/** The index carries what a component IS; the rest of its summary comes with `detail`. */
const firstSentence = (text: string): string => /^.*?[.!?](?=\s|$)/.exec(text)?.[0] ?? text;

const idsOf =(rows: ReadonlyArray<{ id: string }>): string[] => rows.map(r => r.id);

export function buildUiCatalogueView(mode: CatalogueMode, detail: readonly string[] = []): Record<string, unknown> | undefined {
  if (mode === 'none') return undefined;
  const full = buildUiCatalogue();
  if (mode === 'full') return full;

  const asked = new Set(detail.map(d => d.trim()).filter(Boolean));
  const sections = full as unknown as Record<string, unknown>;
  const index: Record<string, unknown> = {
    how_to_read: 'This is the INDEX. Ask again with `detail` naming component ids or section names from it '
      + '(for example ["table", "statRow", "effects"]) and those come back in full, props and bounds included.',
    // ONE LINE PER COMPONENT, and every list on one line: this answer is printed as indented
    // JSON, where an array of forty names costs forty lines, and the first shape of this index
    // weighed 23 kB of the 24 a result carries.
    components: Object.fromEntries(full.components.map(c => [c.id,
      `${firstSentence(c.summary)} Settings: ${Object.keys(c.props).join(', ')}.${c.max_per_layout !== undefined ? ` At most ${c.max_per_layout} per layout.` : ''}`])),
    nav_modes: full.nav_modes.join(', '),
    looks: full.looks.join(', '),
    spans: full.spans.values.join(', '),
    choreographies: full.choreographies.values.join(', '),
    structures: idsOf(full.structures).join(', '),
    layouts: full.layouts.map(l => (l as { id: string }).id).join(', '),
    signature_tokens: Object.keys(full.signature_tokens.values).join(', '),
    patterns: idsOf(full.patterns.recipes).join(', '),
    ambients: idsOf(full.ambients.presets).join(', '),
    effects: idsOf(full.effects.entries).join(', '),
    sections_in_full: Object.keys(sections).join(', '),
  };
  if (!asked.size) return index;

  const inFull: Record<string, unknown> = {};
  const unknown: string[] = [];
  for (const name of asked) {
    const component = full.components.find(c => c.id === name);
    if (component) inFull[name] = component;
    else if (name in sections) inFull[name] = sections[name];
    else unknown.push(name);
  }
  return { ...index, detail: inFull, ...(unknown.length ? { detail_unknown: unknown } : {}) };
}
