/**
 * @file src/routes/ns.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Serves the AIMEAT core ontology at the namespace its own annotations have been
 *   pointing at since Phase 0.7. `aimeat: https://aimeat.io/ns/` appears in the catalogue
 *   responses, in the directory's semantic block and in the interest-profile spec, and until now
 *   the address resolved to nothing — a prefix this node asked everyone else to trust while
 *   publishing no definition of its own.
 *
 *   THE DEFINITIONS COME FROM THE GLOSSARY, not from a second copy written for machines. A class
 *   here names the glossary term that defines it, and this route renders that definition as
 *   `rdfs:comment`; a unit test fails when a class names a term the glossary does not have. One
 *   text, two audiences.
 *
 *   PUBLIC, like the glossary and for the same reason: a peer node deciding whether it understands
 *   our records has not authenticated and never will.
 * @structure
 *   - nsRouter(config): mounts the endpoints
 *   - GET /v1/ns      — the core ontology as JSON-LD (application/ld+json)
 *   - GET /v1/ns.md   — the same for an agent reading prose
 * @usage app.use(nsRouter(config));
 * @version-history
 *   v1.0.0 — 2026-09-08 — Initial.
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import { CORE_CLASSES, CORE_RELATIONS, DEFAULT_CONTEXT, buildCoreOntology, AIMEAT_NS } from '../utils/onto-context.js';
import { findTerm } from '../data/glossary.js';
import { sendMarkdown } from '../services/markdown-negotiation.js';

/** The glossary definition for a term, or undefined when it has none. */
function definitionOf(term: string): string | undefined {
  return findTerm(term)?.definition;
}

/** The core ontology as prose: what an agent reads when it wants the shape, not the triples. */
export function buildNamespaceMarkdown(config: AimeatConfig): string {
  const b = config.baseUrl.replace(/\/$/, '');

  const prefixes = Object.entries(DEFAULT_CONTEXT)
    .map(([p, iri]) => `| \`${p}\` | ${iri} |`).join('\n');

  const classes = CORE_CLASSES.map((c) => {
    const kind = c.subClassOf ? ` — a kind of \`${c.subClassOf}\`` : '';
    return `### \`aimeat:${c.name}\`${kind}\n\n${definitionOf(c.term) ?? `See the glossary entry for ${c.term}.`}`;
  }).join('\n\n');

  const relations = CORE_RELATIONS.map((r) => {
    const inverse = r.inverseOf ? ` Read the other way: \`${r.inverseOf}\`.` : '';
    const domain = r.domain?.length ? `\n\nOn the left: ${r.domain.map((d) => `\`${d}\``).join(', ')}.` : '';
    const range = r.range?.length ? ` On the right: ${r.range.map((d) => `\`${d}\``).join(', ')}.` : '';
    return `### \`aimeat:${r.name}\`\n\n${r.comment}${inverse}${domain}${range}`;
  }).join('\n\n');

  return `---
title: The AIMEAT core ontology
description: The classes and relations this protocol names for itself, and the prefixes an annotation may use without declaring them.
url: ${b}/v1/ns
---

# The AIMEAT core ontology

> \`${AIMEAT_NS}\` — what a record means when it says it is one of ours.

This is a hub, not a catalogue. A domain vocabulary — an app's, a cortex's, an organism's shared
sanasto — links to these classes and travels along these relations, and everything that already has
a standard name keeps it: SKOS for concepts and their hierarchy, PROV for where something came from,
schema.org for people, places, offers and creative works. A term appears below only when no standard
vocabulary says it.

Every class is the machine-readable side of a term in the [glossary](${b}/v1/glossary), which is
where its definition lives. There is no second copy.

## Prefixes that resolve without being declared

An annotation may use these without a \`@context\` of its own. Declaring your own mapping for one of
them wins for that annotation.

| Prefix | Namespace |
|---|---|
${prefixes}

Any other prefix must be declared in the annotation's \`@context\`, or written as a full URL. A
prefix nobody defined expands to nothing, so this node refuses it rather than storing a claim that
means nothing to whoever reads it next.

## Classes

${classes}

## Relations

${relations}

## Reading it as data

[${b}/v1/ns](${b}/v1/ns) serves the same content as JSON-LD.
`;
}

export function nsRouter(config: AimeatConfig): Router {
  const router = Router();

  // GET /v1/ns — the ontology itself.
  router.get('/v1/ns', (_req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    // Not the node's success() envelope: this document IS a JSON-LD graph, and a consumer feeding
    // it to a JSON-LD processor cannot be asked to unwrap a node-specific wrapper first. Same
    // reasoning as /v1/glossary/jsonld.json.
    res.type('application/ld+json').send(JSON.stringify(buildCoreOntology(definitionOf), null, 2));
  });

  // GET /v1/ns.md — the same for a reader.
  router.get('/v1/ns.md', (_req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Link', `<${config.baseUrl.replace(/\/$/, '')}/v1/ns>; rel="canonical"`);
    sendMarkdown(res, buildNamespaceMarkdown(config));
  });

  return router;
}
