/**
 * @file src/services/cortex-ontology-skos.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Renders a cortex `ontology` component as a SKOS concept scheme, so what a cortex
 *   declares can be read by the same code that reads any other vocabulary on this node.
 *
 *   THE OLD SHAPE IS SKOS WITH DIFFERENT WORDS. A cortex ontology has been storing
 *   `concepts{ label{lang}, broader, related_to, values }` since Phase 0.7 — a concept scheme with
 *   multilingual labels and a hierarchy, under names no SKOS tool recognises. Nothing about it was
 *   wrong; it just could not be read by anything outside this repo, and it could not be pointed at
 *   an outside vocabulary. Every field maps one to one: `label` is `skos:prefLabel`, `broader` is
 *   `skos:broader`, `related_to` is `skos:related`, and `values` become narrower concepts, which is
 *   what they always were.
 *
 *   THE OLD SHAPE STAYS. Activation writes both: `concepts` exactly as before, and `skos` beside
 *   it. Anything reading the old field is untouched, which is the whole point — a cortex published
 *   months ago keeps working and gains a second reading of itself for free.
 * @structure cortexOntologyToSkos(component, ontologyName) → a skos:ConceptScheme document
 * @usage
 *   import { cortexOntologyToSkos } from '../services/cortex-ontology-skos.js';
 * @version-history
 *   v1.0.0 — 2026-09-08 — Initial.
 */
import type { CortexOntologyComponent } from '../storage/types/organisms-federation.js';
import { DEFAULT_CONTEXT } from '../utils/onto-context.js';

/** One concept in the rendered scheme. Loose on purpose: this is a JSON-LD node, not a table row. */
type SkosConcept = Record<string, unknown>;

/**
 * The id space a cortex ontology's concepts live in.
 *
 * `vocab:<ontology>/<key>` rather than a bare key, because two cortexes may both declare `status`
 * and a reader holding both needs to tell them apart. It is a compact IRI under the `vocab:` prefix
 * an app's own schemes already use, so a concept from a cortex and one an app wrote sit in the same
 * namespace and can point at each other.
 */
function conceptId(ontologyName: string, key: string): string {
  return `vocab:${ontologyName}/${key}`;
}

/**
 * A cortex ontology component as a SKOS concept scheme.
 *
 * `values` deserve the note. The old shape let a concept carry a list of permitted values — a
 * `status` concept with `['open', 'closed']`. Those are narrower concepts and always were: each one
 * gets its own id, its label is the value string, and it points back at its parent with
 * `skos:broader`. That turns a list a human read into something a filter, a search and a translation
 * can each use.
 */
export function cortexOntologyToSkos(comp: CortexOntologyComponent, ontologyName?: string): Record<string, unknown> {
  const name = ontologyName ?? comp.name;
  const concepts: SkosConcept[] = [];

  for (const [key, raw] of Object.entries(comp.concepts ?? {})) {
    if (!raw || typeof raw !== 'object') continue;
    const node: SkosConcept = {
      '@id': conceptId(name, key),
      '@type': 'skos:Concept',
      // The label map is already lang → string, which is what SKOS wants. An entry with no label at
      // all keeps the key as its English label rather than rendering as an id with no words.
      'skos:prefLabel': raw.label && Object.keys(raw.label).length ? raw.label : { en: key },
    };
    if (raw.broader) node['skos:broader'] = conceptId(name, raw.broader);
    if (raw.related_to) node['skos:related'] = [conceptId(name, raw.related_to)];
    // The properties a concept declares are what it is described BY, not concepts of their own.
    if (raw.properties?.length) node['aimeat:properties'] = raw.properties;

    if (raw.values?.length) {
      node['skos:narrower'] = raw.values.map((v) => conceptId(name, `${key}/${v}`));
      for (const v of raw.values) {
        concepts.push({
          '@id': conceptId(name, `${key}/${v}`),
          '@type': 'skos:Concept',
          'skos:prefLabel': { en: v },
          'skos:broader': conceptId(name, key),
        });
      }
    }
    concepts.push(node);
  }

  return {
    '@context': { ...DEFAULT_CONTEXT },
    '@type': 'skos:ConceptScheme',
    '@id': `vocab:${name}`,
    'skos:prefLabel': { en: name },
    'dcterms:description': comp.description || undefined,
    // Says where this came from, so a reader who finds the scheme can find the cortex that declared
    // it. A vocabulary with no stated origin is one nobody dares change.
    'dcterms:source': `cortex:${name}`,
    concepts,
  };
}
