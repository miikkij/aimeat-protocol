/**
 * The core ontology's own integrity. Nothing here checks behaviour under load or a route's answer;
 * these are the four ways a hub-and-modules ontology rots from the inside, and each one is silent:
 * a class whose definition nobody wrote, an inverse pair that only points one way, a prefix used in
 * the core that the default context does not carry, and a name minted twice.
 */
import { describe, it, expect } from 'vitest';
import {
  CORE_CLASSES,
  CORE_RELATIONS,
  DEFAULT_CONTEXT,
  AIMEAT_NS,
  expandTerm,
  contextOf,
  annotationErrors,
  buildCoreOntology,
} from '../../src/utils/onto-context.js';
import { findTerm } from '../../src/data/glossary.js';

describe('the AIMEAT core ontology', () => {
  it('defines every class in the glossary, so no class exists without words a person can read', () => {
    const missing = CORE_CLASSES.filter((c) => !findTerm(c.term));
    expect(missing.map((c) => `aimeat:${c.name} -> "${c.term}"`)).toEqual([]);
  });

  it('names each class once', () => {
    const names = CORE_CLASSES.map((c) => c.name);
    expect(names.length).toBe(new Set(names).size);
  });

  it('names each relation once', () => {
    const names = CORE_RELATIONS.map((r) => r.name);
    expect(names.length).toBe(new Set(names).size);
  });

  it('pairs every inverse both ways', () => {
    // A relation saying `inverseOf: aimeat:x` while x says nothing back is a graph you can walk in
    // one direction only, which is the failure this pairing exists to prevent.
    for (const r of CORE_RELATIONS) {
      if (!r.inverseOf) continue;
      const other = CORE_RELATIONS.find((o) => `aimeat:${o.name}` === r.inverseOf);
      expect(other, `${r.name} names ${r.inverseOf}, which is not a core relation`).toBeDefined();
      expect(other!.inverseOf, `${other!.name} does not name ${r.name} back`).toBe(`aimeat:${r.name}`);
    }
  });

  it('uses only prefixes the default context carries, in its own subClassOf/domain/range', () => {
    const used = [
      ...CORE_CLASSES.map((c) => c.subClassOf),
      ...CORE_RELATIONS.flatMap((r) => [...(r.domain ?? []), ...(r.range ?? []), r.inverseOf]),
    ].filter((v): v is string => typeof v === 'string');

    for (const name of used) {
      const prefix = name.split(':')[0];
      expect(DEFAULT_CONTEXT[prefix as keyof typeof DEFAULT_CONTEXT], `${name} names prefix "${prefix}:"`).toBeDefined();
    }
  });

  it('resolves aimeat: to the namespace the catalogue responses have been citing', () => {
    expect(DEFAULT_CONTEXT.aimeat).toBe(AIMEAT_NS);
    expect(AIMEAT_NS).toBe('https://aimeat.io/ns/');
  });
});

describe('expandTerm', () => {
  it('expands a default prefix', () => {
    expect(expandTerm('schema:Person')).toBe('https://schema.org/Person');
    expect(expandTerm('aimeat:MemoryRecord')).toBe('https://aimeat.io/ns/MemoryRecord');
  });

  it('lets an annotation override a default prefix with its own mapping', () => {
    const ctx = contextOf({ '@context': { schema: 'http://schema.org/' } });
    expect(expandTerm('schema:Person', ctx)).toBe('http://schema.org/Person');
  });

  it('leaves a bare term and an absolute IRI alone', () => {
    expect(expandTerm('LocalBusiness')).toBe('LocalBusiness');
    expect(expandTerm('https://example.org/Thing')).toBe('https://example.org/Thing');
  });
});

describe('the ontology document', () => {
  it('carries a comment for every class, taken from the glossary', () => {
    const doc = buildCoreOntology((t) => findTerm(t)?.definition) as {
      classes: Array<{ '@id': string; 'rdfs:comment'?: string }>;
    };
    const silent = doc.classes.filter((c) => !c['rdfs:comment']);
    expect(silent.map((c) => c['@id'])).toEqual([]);
  });

  it('is itself an annotation this node would accept', () => {
    // The ontology we publish has to pass the check we impose on everyone else's annotations.
    // It declares rdf and owl in its own @context, which is exactly how a caller is told to do it.
    const doc = buildCoreOntology((t) => findTerm(t)?.definition);
    expect(annotationErrors(doc)).toEqual([]);
  });
});
