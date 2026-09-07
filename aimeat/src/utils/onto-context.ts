/**
 * @file src/utils/onto-context.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The ONE place this node decides what a semantic annotation may say. Three things
 *   live here and nowhere else: the default JSON-LD context (which prefixes resolve without being
 *   declared), the AIMEAT core ontology (the classes and relations `https://aimeat.io/ns/` names),
 *   and the check that refuses an annotation naming a prefix nobody defined.
 *
 *   WHY A CORE AND NOT ONE BIG VOCABULARY. The shape is the SWARMs ontology's (Li et al., Sensors
 *   2017, 17(3):569): a small core as the hub, domain modules around it, and the modules linked to
 *   the core through NAMED relations with inverses rather than through free-text fields. What that
 *   paper left open is what this file closes — it reused no standard vocabulary at all, so nothing
 *   outside the project could read it. Here everything that already has a standard name KEEPS that
 *   name (skos:broader, prov:wasDerivedFrom, schema:Person), and `aimeat:` carries only what no
 *   standard vocabulary says.
 *
 *   WHY THE CHECK EXISTS. `SemanticAnnotationSchema` was `.passthrough()` with no constraint on
 *   `@type`, so `{"@type": "foo:Bar"}` was stored and served as if it meant something. A prefix
 *   nobody declared expands to nothing in any JSON-LD processor, which makes the annotation
 *   decorative — and decorative metadata is worse than none, because a consumer trusts it.
 *
 *   A BARE TYPE IS FINE. `{"@type": "LocalBusiness"}` is how schema.org is written every day, and
 *   the CSM spec and the existing records use it. Only a PREFIXED name is checked, and only for
 *   whether its prefix was defined — never for whether the term exists in that vocabulary, which
 *   this node cannot know and should not pretend to.
 * @structure
 *   - DEFAULT_CONTEXT        — prefixes that resolve without being declared
 *   - AIMEAT_NS              — the namespace `aimeat:` expands to
 *   - CORE_CLASSES           — the classes aimeat: names, each tied to its glossary term
 *   - CORE_RELATIONS         — the named relations, with inverses, that link the modules
 *   - annotationErrors(v)    — every undeclared prefix in one annotation, as messages
 *   - contextOf(v)           — the annotation's own @context merged over the default
 *   - expandTerm(term, ctx)  — 'schema:Person' → 'https://schema.org/Person'
 * @usage
 *   import { annotationErrors, DEFAULT_CONTEXT } from '../utils/onto-context.js';
 * @version-history
 *   v1.0.0 — 2026-09-08 — Initial. One context, one check, one core.
 */

/** The namespace this node's own terms live in. Served as JSON-LD by GET /v1/ns. */
export const AIMEAT_NS = 'https://aimeat.io/ns/';

/**
 * Prefixes an annotation may use WITHOUT declaring them. Everything here is a vocabulary this node
 * already speaks somewhere: schema.org in every page head, SKOS for concept schemes, Dublin Core
 * and PROV for provenance, QUDT and SAREF for the measurement and device cases the ontology spec
 * has documented since Phase 0.7.
 *
 * An annotation that declares its own `@context` still wins for the prefixes it names — a document
 * saying `schema: 'http://schema.org/'` gets the http form it asked for, not this one.
 */
export const DEFAULT_CONTEXT: Readonly<Record<string, string>> = Object.freeze({
  aimeat: AIMEAT_NS,
  schema: 'https://schema.org/',
  skos: 'http://www.w3.org/2004/02/skos/core#',
  dcterms: 'http://purl.org/dc/terms/',
  prov: 'http://www.w3.org/ns/prov#',
  rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
  qudt: 'http://qudt.org/schema/qudt/',
  saref: 'https://saref.etsi.org/core/',
});

/** One class in the AIMEAT core. `term` is the glossary entry that DEFINES it; see glossary.ts. */
export interface CoreClass {
  /** Local name inside `aimeat:`. */
  name: string;
  /** The glossary term this class is the machine-readable side of. Checked by a unit test. */
  term: string;
  /** The wider class this one is a kind of, as a prefixed name. Absent when it stands alone. */
  subClassOf?: string;
}

/**
 * The classes `aimeat:` names, and what each one is a kind of.
 *
 * WHAT IS NOT HERE MATTERS AS MUCH AS WHAT IS. This is a hub, not a catalogue of every noun in the
 * protocol: a term earns a class when something needs to say "this record IS one of those" —
 * a memory record's `@type`, a workspace objectType, an offering's category. Scope, visibility and
 * consent are rules ABOUT records rather than kinds of record, so they stay glossary terms.
 *
 * Every `term` must resolve in the glossary, so a class cannot exist without a definition a person
 * can read; test/unit/onto-core.test.ts fails when one does not.
 */
export const CORE_CLASSES: readonly CoreClass[] = Object.freeze([
  // Identity — three principals that differ by one letter, which is the whole reason to type them.
  { name: 'GHII', term: 'GHII', subClassOf: 'schema:Person' },
  { name: 'GAII', term: 'GAII', subClassOf: 'schema:SoftwareApplication' },
  { name: 'GEAI', term: 'GEAI', subClassOf: 'schema:SoftwareApplication' },
  { name: 'Node', term: 'Node', subClassOf: 'schema:WebSite' },

  // Data
  { name: 'MemoryRecord', term: 'Record', subClassOf: 'schema:CreativeWork' },
  { name: 'Organism', term: 'Organism', subClassOf: 'schema:Organization' },
  { name: 'Workspace', term: 'Workspace', subClassOf: 'schema:Collection' },
  { name: 'Document', term: 'Document', subClassOf: 'schema:CreativeWork' },
  { name: 'KnowledgePackage', term: 'Knowledge package', subClassOf: 'schema:Dataset' },

  // Extensibility
  { name: 'App', term: 'App', subClassOf: 'schema:SoftwareApplication' },
  { name: 'Extension', term: 'Extension', subClassOf: 'schema:SoftwareApplication' },
  { name: 'Cortex', term: 'Cortex', subClassOf: 'schema:SoftwareApplication' },
  { name: 'Skill', term: 'Skill', subClassOf: 'schema:CreativeWork' },
  { name: 'Capability', term: 'Capability' },

  // Action — the mission hierarchy, which is where the SWARMs shape shows most plainly.
  { name: 'Task', term: 'Task', subClassOf: 'schema:Action' },
  { name: 'Workflow', term: 'Workflow', subClassOf: 'schema:HowTo' },
  { name: 'Schedule', term: 'Schedule', subClassOf: 'schema:Schedule' },

  // Economy
  { name: 'Offering', term: 'Offering', subClassOf: 'schema:Offer' },
  { name: 'Need', term: 'Need', subClassOf: 'schema:Demand' },
  { name: 'Morsel', term: 'Morsel' },

  // Federation
  { name: 'Peer', term: 'Peer', subClassOf: 'schema:Organization' },
]);

/** One named relation in the core, with the inverse that reads it from the other end. */
export interface CoreRelation {
  /** Local name inside `aimeat:`. */
  name: string;
  /** The other direction, when the relation has one. */
  inverseOf?: string;
  /** What may sit on the left, as prefixed names. Documentation, not a constraint this node runs. */
  domain?: string[];
  /** What may sit on the right. */
  range?: string[];
  /** One sentence a person reads. */
  comment: string;
}

/**
 * The relations that link one module to another.
 *
 * Kept SMALL on purpose, and only where no standard vocabulary already says it. Anything about
 * concepts is SKOS (`skos:broader`, `skos:narrower`, `skos:related`, `skos:exactMatch`); anything
 * about where a thing came from is PROV (`prov:wasDerivedFrom`, `prov:wasGeneratedBy`,
 * `prov:wasAttributedTo`); subject matter is `schema:about`. Re-minting those under `aimeat:` would
 * be the mistake the SWARMs paper made and named as future work.
 */
export const CORE_RELATIONS: readonly CoreRelation[] = Object.freeze([
  {
    name: 'canPerform', inverseOf: 'aimeat:performedBy',
    domain: ['aimeat:GAII', 'aimeat:GEAI', 'aimeat:App'], range: ['aimeat:Capability'],
    comment: 'This principal can carry out this capability. Read the other way with performedBy.',
  },
  {
    name: 'performedBy', inverseOf: 'aimeat:canPerform',
    domain: ['aimeat:Task', 'schema:Action'], range: ['aimeat:GAII', 'aimeat:GHII', 'aimeat:App'],
    comment: 'Who carried this out. The pair with canPerform is what makes "is this plan runnable" a check rather than a guess.',
  },
  {
    name: 'provides', inverseOf: 'aimeat:providedBy',
    domain: ['aimeat:Offering', 'aimeat:Capability'], range: ['aimeat:Need', 'aimeat:Task'],
    comment: 'This offering or capability answers that need.',
  },
  {
    name: 'providedBy', inverseOf: 'aimeat:provides',
    domain: ['aimeat:Need', 'aimeat:Task'], range: ['aimeat:Offering', 'aimeat:Capability'],
    comment: 'What answers this need. Matching a need to an offering is a walk over this relation.',
  },
  {
    name: 'assignedTo', inverseOf: 'aimeat:handles',
    domain: ['aimeat:Task'], range: ['aimeat:GAII', 'aimeat:GHII'],
    comment: 'Whose queue this task is in right now, which is not the same as who performed it.',
  },
  {
    name: 'handles', inverseOf: 'aimeat:assignedTo',
    domain: ['aimeat:GAII', 'aimeat:GHII'], range: ['aimeat:Task'],
    comment: 'The tasks in this principal\'s queue.',
  },
  {
    name: 'confidence',
    domain: ['schema:CreativeWork', 'aimeat:MemoryRecord'],
    comment: 'How sure the producer is of this, 0 to 1. Says nothing on its own: it is read next to prov:wasDerivedFrom, which names what it was concluded from.',
  },
  {
    name: 'availability',
    domain: ['aimeat:GHII'],
    comment: 'How reachable this person is for contact. No schema.org property means this.',
  },
  {
    name: 'seeking',
    domain: ['aimeat:GHII'],
    comment: 'What this person is looking for, in their own words. schema:seeks wants a Demand object; this is the free-text form the interest profile already uses.',
  },
]);

/** A prefixed name: one or more non-space, non-colon characters, a colon, then a local part. */
const PREFIXED = /^([A-Za-z][A-Za-z0-9_.-]*):([^\s:/][^\s]*)$/;

/** Absolute IRIs are always fine — nothing has to be resolved. */
function isAbsoluteIri(value: string): boolean {
  return /^https?:\/\//i.test(value) || value.startsWith('urn:') || value.startsWith('did:');
}

/**
 * The prefix map in force for one annotation: its own `@context` laid over whatever it inherits.
 *
 * `base` is what a nested node was handed by its parent, because a prefix declared once at the top
 * of a document is in force all the way down — that is the whole point of a context. Getting this
 * wrong makes the check refuse a document that is perfectly valid, which is worse than not checking.
 *
 * A `@context` given as a STRING (`"https://schema.org"`, the commonest JSON-LD form) declares no
 * prefixes at all — it sets the default vocabulary, under which every BARE term resolves. That is
 * why a bare `@type` is never an error.
 */
export function contextOf(
  annotation: unknown,
  base: Record<string, string> = DEFAULT_CONTEXT,
): Record<string, string> {
  const own = (annotation as { '@context'?: unknown } | null)?.['@context'];
  if (own && typeof own === 'object' && !Array.isArray(own)) {
    const declared: Record<string, string> = {};
    for (const [k, v] of Object.entries(own as Record<string, unknown>)) {
      if (typeof v === 'string') declared[k] = v;
    }
    return { ...base, ...declared };
  }
  return { ...base };
}

/** 'schema:Person' → 'https://schema.org/Person'. A bare or unresolvable term comes back unchanged. */
export function expandTerm(term: string, context: Record<string, string> = { ...DEFAULT_CONTEXT }): string {
  if (isAbsoluteIri(term)) return term;
  const m = PREFIXED.exec(term);
  if (!m) return term;
  const base = context[m[1]];
  return base ? `${base}${m[2]}` : term;
}

/**
 * Is this name usable — bare, an absolute IRI, or a prefix somebody defined?
 *
 * `_:b0` (a blank node) and anything not shaped like a prefixed name are left alone: they are not
 * claims about a vocabulary, so there is nothing to check.
 */
function undeclaredPrefix(name: string, context: Record<string, string>): string | null {
  if (isAbsoluteIri(name) || name.startsWith('_:')) return null;
  const m = PREFIXED.exec(name);
  if (!m) return null;
  return context[m[1]] ? null : m[1];
}

/** How deep into a nested annotation the check walks. Past this a value is data, not a claim. */
const MAX_DEPTH = 6;

/**
 * Every undeclared prefix in one annotation, as messages a caller can act on.
 *
 * Walks `@type` AND the property keys, because both are claims about a vocabulary and both are
 * equally silent when the prefix resolves to nothing. Nested objects are walked too: an annotation's
 * value can itself be a typed node (`schema:address` holding a `schema:PostalAddress`), and that
 * node's own type is exactly as capable of naming a prefix nobody defined.
 *
 * Returns an EMPTY array for a valid annotation, so a caller reads `errors.length` rather than a
 * boolean it then has to explain.
 */
export function annotationErrors(
  annotation: unknown,
  path = '',
  depth = 0,
  inherited: Record<string, string> = DEFAULT_CONTEXT,
): string[] {
  if (!annotation || typeof annotation !== 'object' || Array.isArray(annotation)) return [];
  if (depth > MAX_DEPTH) return [];

  // A nested node inherits every prefix its parents declared, and may redeclare any of them. The
  // first version of this function did not thread the parent's map down, and refused a document
  // that declared `rdf:` at the top and used it three levels in — our own ontology, as it happens.
  const context = contextOf(annotation, inherited);
  const out: string[] = [];
  const at = path ? ` at ${path}` : '';

  for (const [key, value] of Object.entries(annotation as Record<string, unknown>)) {
    if (key === '@type') {
      const types = Array.isArray(value) ? value : [value];
      for (const t of types) {
        if (typeof t !== 'string') continue;
        const bad = undeclaredPrefix(t, context);
        if (bad) {
          out.push(`"@type": "${t}"${at} uses the prefix "${bad}:", which no @context defines. Declare it in "@context", use a full URL, or drop the prefix.`);
        }
      }
      continue;
    }
    // JSON-LD keywords carry no vocabulary claim of their own.
    if (key.startsWith('@')) continue;

    const badKey = undeclaredPrefix(key, context);
    if (badKey) {
      out.push(`"${key}"${at} uses the prefix "${badKey}:", which no @context defines. Declare it in "@context" or use a full URL.`);
    }

    const childPath = path ? `${path}.${key}` : key;
    if (Array.isArray(value)) {
      value.forEach((v, i) => out.push(...annotationErrors(v, `${childPath}[${i}]`, depth + 1, context)));
    } else if (value && typeof value === 'object') {
      out.push(...annotationErrors(value, childPath, depth + 1, context));
    }
  }

  return out;
}

/**
 * A schema's semantic context, checked against the schema it describes.
 *
 * Two things, and the second is the one that was missing. `semantic_context.properties` maps a
 * FIELD of the schema to what that field means — `temperature` to a `qudt:QuantityValue`. A key in
 * there that is not a field of the schema describes nothing: the annotation reads as complete, a
 * consumer walks it looking for the field, and finds nothing. A typo produced exactly that, and no
 * surface said a word.
 *
 * `schemaJson` is a JSON Schema; its `properties` are the field names. A schema with no `properties`
 * (`type: 'array'`, a `$ref`, a bare `type: 'string'`) describes no fields to map, so the per-field
 * check stands down rather than refusing everything.
 */
export function semanticContextErrors(semanticContext: unknown, schemaJson: unknown): string[] {
  const out = annotationErrors(semanticContext).map((m) => `semantic_context: ${m}`);
  if (!semanticContext || typeof semanticContext !== 'object') return out;

  const props = (semanticContext as { properties?: unknown }).properties;
  if (!props || typeof props !== 'object' || Array.isArray(props)) return out;

  const schemaProps = (schemaJson as { properties?: Record<string, unknown> } | null)?.properties;
  if (!schemaProps || typeof schemaProps !== 'object') return out;
  const fields = new Set(Object.keys(schemaProps));

  for (const [field, mapping] of Object.entries(props as Record<string, unknown>)) {
    if (!fields.has(field)) {
      const known = [...fields].slice(0, 12).join(', ');
      out.push(
        `semantic_context.properties names "${field}", which is not a field of this schema. `
        + `The schema has: ${known}${fields.size > 12 ? `, and ${fields.size - 12} more` : ''}.`,
      );
      continue;
    }
    out.push(...annotationErrors(mapping).map((m) => `semantic_context.properties.${field}: ${m}`));
  }

  return out;
}

/** The core ontology as a JSON-LD document. What GET /v1/ns serves, and what a peer node reads. */
export function buildCoreOntology(definitionOf: (term: string) => string | undefined): object {
  return {
    '@context': {
      ...DEFAULT_CONTEXT,
      rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
      owl: 'http://www.w3.org/2002/07/owl#',
    },
    '@id': AIMEAT_NS,
    '@type': 'owl:Ontology',
    'dcterms:title': 'The AIMEAT core ontology',
    'dcterms:description':
      'The classes and relations this protocol names for itself. A hub: a domain vocabulary — an app\'s, '
      + 'a cortex\'s, an organism\'s — links to it through these relations, and everything with a standard '
      + 'name (SKOS for concepts, PROV for provenance, schema.org for people, places and offers) keeps that name.',
    'rdfs:seeAlso': 'https://aimeat.io/v1/glossary',
    'owl:imports': ['http://www.w3.org/2004/02/skos/core#', 'http://www.w3.org/ns/prov#'],
    classes: CORE_CLASSES.map((c) => ({
      '@id': `aimeat:${c.name}`,
      '@type': 'rdfs:Class',
      'rdfs:label': c.name,
      'rdfs:comment': definitionOf(c.term) ?? undefined,
      'rdfs:subClassOf': c.subClassOf ?? undefined,
      'rdfs:seeAlso': `https://aimeat.io/v1/glossary?term=${encodeURIComponent(c.term)}`,
    })),
    relations: CORE_RELATIONS.map((r) => ({
      '@id': `aimeat:${r.name}`,
      '@type': 'rdf:Property',
      'rdfs:label': r.name,
      'rdfs:comment': r.comment,
      'rdfs:domain': r.domain ?? undefined,
      'rdfs:range': r.range ?? undefined,
      'owl:inverseOf': r.inverseOf ?? undefined,
    })),
  };
}
