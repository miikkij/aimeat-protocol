/**
 * @file extensions-tab.datamap.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One adapter: a cortex extension's schema components in the shape the shared data map
 *   renders. Its own file because extensions-tab.js sits at the 800-line ceiling, and a pure
 *   extraction is what that ceiling asks for - the function is unchanged from where it was written.
 *   It replaces a bespoke "Schemas" list in extensions-tab.js that showed key_pattern (apply_to):
 *   the same row as a data map, in a vocabulary nobody outside this repo reads.
 * @structure extDataMap(ext, comps)
 * @usage import { extDataMap } from './extensions-tab.datamap.js';
 * @version-history
 *   v1.0.0 - 2026-08-25 - Extracted on arrival, for TARGET-073.
 */
/**
 * A cortex extension's schema components, in the shape the shared map renders.
 *
 * key_pattern + apply_to is the same triple the map's row is built around, so this is a wrapper
 * rather than a translation. A locked schema is the strongest basis there is - the store refuses a
 * value that does not fit - so these rows say so. What it does NOT invent is the sentence: nobody
 * wrote why the extension keeps its data there, and a plausible one would be worse than the blank
 * the surface reports.
 */
export function extDataMap(ext, comps) {
  const schemas = (comps || []).filter(c => c.type === 'schema');
  return {
    spec: 'aimeat.datamap/1',
    form: 'single-person',
    source: 'declared',
    at: ext.activated_at || ext.installed_at || null,
    elsewhere: [],
    held: schemas.map(s => ({
      grant: { area: 'memory', pattern: s.key_pattern, rights: ['read', 'write'] },
      basis: { tier: 'schema-locked', by: 'schema:' + s.key_pattern },
      why: '',
      ownership: 'extension',
      readers: { visibility: 'public' },
      deletion: {
        effect: 'gone-here-copy-remains',
        says: 'Removing the extension does not remove what it wrote. Its records stay until they are deleted.',
      },
      retention: { kind: 'until-deleted' },
      personalData: 'unstated',
      source: 'declared',
    })),
  };
}
