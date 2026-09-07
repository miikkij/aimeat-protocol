/**
 * A cortex ontology rendered as SKOS. The mapping is one to one, so what these assert is that no
 * field is dropped on the way and that `values` — the one part of the old shape that is not a
 * straight rename — become real concepts rather than a list nothing can filter on.
 */
import { describe, it, expect } from 'vitest';
import { cortexOntologyToSkos } from '../../src/services/cortex-ontology-skos.js';
import { annotationErrors } from '../../src/utils/onto-context.js';
import type { CortexOntologyComponent } from '../../src/storage/types/organisms-federation.js';

const FIXTURE: CortexOntologyComponent = {
  type: 'ontology',
  name: 'recipes',
  description: 'Cooking terms',
  concepts: {
    dish: { label: { en: 'Dish', fi: 'Ruokalaji' }, properties: ['servings', 'minutes'] },
    dessert: { label: { en: 'Dessert', fi: 'Jälkiruoka' }, broader: 'dish' },
    course: { label: { en: 'Course' }, values: ['starter', 'main', 'dessert'] },
    cuisine: { label: { en: 'Cuisine' }, related_to: 'dish' },
    unlabelled: { label: {} },
  },
};

describe('cortexOntologyToSkos', () => {
  const doc = cortexOntologyToSkos(FIXTURE, 'recipes') as {
    '@type': string; '@id': string; concepts: Array<Record<string, unknown>>;
  };
  const byId = new Map(doc.concepts.map((c) => [c['@id'] as string, c]));

  it('is a concept scheme addressed under vocab:', () => {
    expect(doc['@type']).toBe('skos:ConceptScheme');
    expect(doc['@id']).toBe('vocab:recipes');
  });

  it('is an annotation this node would accept', () => {
    // Whatever we render has to pass the check we impose on everyone else's annotations.
    expect(annotationErrors(doc)).toEqual([]);
  });

  it('carries the multilingual label as skos:prefLabel', () => {
    expect(byId.get('vocab:recipes/dish')!['skos:prefLabel']).toEqual({ en: 'Dish', fi: 'Ruokalaji' });
  });

  it('maps broader and related into the same id space', () => {
    expect(byId.get('vocab:recipes/dessert')!['skos:broader']).toBe('vocab:recipes/dish');
    expect(byId.get('vocab:recipes/cuisine')!['skos:related']).toEqual(['vocab:recipes/dish']);
  });

  it('turns values into narrower concepts that point back', () => {
    const course = byId.get('vocab:recipes/course')!;
    expect(course['skos:narrower']).toEqual([
      'vocab:recipes/course/starter', 'vocab:recipes/course/main', 'vocab:recipes/course/dessert',
    ]);
    const main = byId.get('vocab:recipes/course/main')!;
    expect(main['skos:prefLabel']).toEqual({ en: 'main' });
    expect(main['skos:broader']).toBe('vocab:recipes/course');
  });

  it('gives a concept with no label its key rather than rendering as a bare id', () => {
    expect(byId.get('vocab:recipes/unlabelled')!['skos:prefLabel']).toEqual({ en: 'unlabelled' });
  });

  it('keeps the declared properties, which are not concepts', () => {
    expect(byId.get('vocab:recipes/dish')!['aimeat:properties']).toEqual(['servings', 'minutes']);
    expect(byId.has('vocab:recipes/servings')).toBe(false);
  });

  it('says which cortex it came from', () => {
    expect((doc as Record<string, unknown>)['dcterms:source']).toBe('cortex:recipes');
  });

  it('namespaces by the ontology it was given, so two cortexes can both declare "status"', () => {
    const a = cortexOntologyToSkos({ ...FIXTURE, concepts: { status: { label: { en: 'S' } } } }, 'shop/flow');
    const b = cortexOntologyToSkos({ ...FIXTURE, concepts: { status: { label: { en: 'S' } } } }, 'crm/flow');
    const idOf = (d: unknown) => ((d as { concepts: Array<{ '@id': string }> }).concepts[0]['@id']);
    expect(idOf(a)).toBe('vocab:shop/flow/status');
    expect(idOf(b)).toBe('vocab:crm/flow/status');
    expect(idOf(a)).not.toBe(idOf(b));
  });

  it('survives an empty ontology without inventing anything', () => {
    const empty = cortexOntologyToSkos({ type: 'ontology', name: 'x', description: '', concepts: {} }, 'x');
    expect((empty as { concepts: unknown[] }).concepts).toEqual([]);
  });
});
