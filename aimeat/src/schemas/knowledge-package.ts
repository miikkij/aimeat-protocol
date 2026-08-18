/**
 * @file src/schemas/knowledge-package.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description JSON Schema definitions for Knowledge Package content — the manifest and entry
 *   shapes used to lock schemas on `packages/{uuid}/{entry}` memory keys.
 *
 * @structure
 *   - KNOWLEDGE_CONTENT_TYPES: enum of allowed package content types (idea, research, plan, …)
 *   - ManifestSchema: JSON Schema for a package manifest (name, version, synthesis, references, entries)
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 *   v1.1.0 — 2026-08-01 — `synthesis.level` now references AI_PROVENANCE_LEVELS instead of
 *     spelling the four strings a second time. Same vocabulary, one definition (TARGET-058).
 */
import { AI_PROVENANCE_LEVELS } from '../models/ai-provenance-schemas.js';

export const KNOWLEDGE_CONTENT_TYPES = [
  'idea', 'research', 'plan', 'dataset', 'document',
  'tutorial', 'collection', 'article', 'story', 'fiction',
  'guide',
] as const;

export const ManifestSchema = {
  type: 'object',
  required: ['type', 'name', 'version', 'author', 'content_type', 'tags', 'entries', 'sharing', 'synthesis'],
  properties: {
    type: { type: 'string', const: 'knowledge-package' },
    name: { type: 'string', minLength: 1, maxLength: 200 },
    version: { type: 'string', pattern: '^\\d+\\.\\d+\\.\\d+$' },
    author: { type: 'string', minLength: 1 },
    created: { type: 'string', format: 'date-time' },
    updated: { type: 'string', format: 'date-time' },
    content_type: { type: 'string', enum: [...KNOWLEDGE_CONTENT_TYPES] },
    tags: { type: 'array', items: { type: 'string' }, maxItems: 30 },
    language: { type: 'string', minLength: 2, maxLength: 5 },
    maturity: { type: 'string', enum: ['draft', 'review', 'published'] },
    synthesis: {
      type: 'object',
      required: ['level', 'description'],
      properties: {
        level: { type: 'string', enum: [...AI_PROVENANCE_LEVELS] },
        description: { type: 'string', maxLength: 500 },
        model: { type: 'string' },
      },
    },
    references: {
      type: 'array',
      items: {
        type: 'object',
        required: ['url', 'title', 'accessed', 'verified'],
        properties: {
          url: { type: 'string' },
          title: { type: 'string' },
          accessed: { type: 'string' },
          verified: { type: 'boolean' },
          note: { type: 'string' },
        },
      },
    },
    entries: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['key', 'title', 'visibility'],
        properties: {
          key: { type: 'string' },
          title: { type: 'string' },
          visibility: { type: 'string', enum: ['private', 'owner', 'group', 'public'] },
          schema: { type: 'string' },
          references: {
            type: 'array',
            items: {
              type: 'object',
              required: ['url', 'title', 'accessed', 'verified'],
              properties: {
                url: { type: 'string' },
                title: { type: 'string' },
                accessed: { type: 'string' },
                verified: { type: 'boolean' },
                note: { type: 'string' },
              },
            },
          },
          related_entries: {
            type: 'array',
            items: {
              type: 'object',
              required: ['key', 'relation'],
              properties: {
                key: { type: 'string' },
                relation: { type: 'string', enum: ['related-to', 'extends', 'derived-from', 'contradicts', 'supersedes', 'references'] },
              },
            },
          },
        },
      },
    },
    links: {
      type: 'array',
      items: {
        type: 'object',
        required: ['target', 'relation', 'description', 'linked_at'],
        properties: {
          target: { type: 'string' },
          relation: { type: 'string', enum: ['related-to', 'extends', 'derived-from', 'contradicts', 'supersedes', 'references'] },
          description: { type: 'string' },
          linked_at: { type: 'string', format: 'date-time' },
        },
      },
    },
    sharing: {
      type: 'object',
      required: ['catalog_listed', 'allow_clone', 'morsel_price'],
      properties: {
        catalog_listed: { type: 'boolean' },
        allow_clone: { type: 'boolean' },
        license: { type: 'string' },
        morsel_price: { type: 'number', minimum: 0 },
      },
    },
  },
};

/** Content-type-specific entry schemas. Each defines the value shape for entries of that type. */
export const EntrySchemas: Record<string, object> = {
  idea: {
    type: 'object',
    required: ['title', 'description'],
    properties: {
      title: { type: 'string' },
      description: { type: 'string' },
      problem: { type: 'string' },
      proposed_solution: { type: 'string' },
      open_questions: { type: 'array', items: { type: 'string' } },
    },
  },
  research: {
    type: 'object',
    required: ['title', 'summary'],
    properties: {
      title: { type: 'string' },
      summary: { type: 'string' },
      findings: { type: 'array', items: { type: 'string' } },
      sources: { type: 'array', items: { type: 'string' } },
      methodology: { type: 'string' },
      conclusions: { type: 'string' },
    },
  },
  plan: {
    type: 'object',
    required: ['title', 'objective'],
    properties: {
      title: { type: 'string' },
      objective: { type: 'string' },
      steps: { type: 'array', items: { type: 'object' } },
      timeline: { type: 'string' },
      resources: { type: 'array', items: { type: 'string' } },
      risks: { type: 'array', items: { type: 'string' } },
    },
  },
  dataset: {
    type: 'object',
    required: ['title', 'description'],
    properties: {
      title: { type: 'string' },
      description: { type: 'string' },
      format: { type: 'string' },
      fields: { type: 'array', items: { type: 'object' } },
      records: { type: 'array', items: { type: 'object' } },
      source: { type: 'string' },
    },
  },
  document: {
    type: 'object',
    required: ['title', 'body'],
    properties: {
      title: { type: 'string' },
      body: { type: 'string' },
      sections: { type: 'array', items: { type: 'object' } },
      references: { type: 'array', items: { type: 'string' } },
    },
  },
  tutorial: {
    type: 'object',
    required: ['title', 'steps'],
    properties: {
      title: { type: 'string' },
      prerequisites: { type: 'array', items: { type: 'string' } },
      steps: { type: 'array', items: { type: 'object' } },
      expected_outcomes: { type: 'array', items: { type: 'string' } },
    },
  },
  collection: {
    type: 'object',
    required: ['title', 'items'],
    properties: {
      title: { type: 'string' },
      description: { type: 'string' },
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            url: { type: 'string' },
            title: { type: 'string' },
            notes: { type: 'string' },
            tags: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
  },
  article: {
    type: 'object',
    required: ['title', 'body'],
    properties: {
      title: { type: 'string' },
      subtitle: { type: 'string' },
      body: { type: 'string' },
      author_bio: { type: 'string' },
      sources: { type: 'array', items: { type: 'string' } },
      category: { type: 'string' },
    },
  },
  story: {
    type: 'object',
    required: ['title', 'body'],
    properties: {
      title: { type: 'string' },
      genre: { type: 'string' },
      body: { type: 'string' },
      chapters: { type: 'array', items: { type: 'object' } },
      characters: { type: 'array', items: { type: 'string' } },
      setting: { type: 'string' },
    },
  },
  fiction: {
    type: 'object',
    required: ['title', 'body'],
    properties: {
      title: { type: 'string' },
      genre: { type: 'string' },
      body: { type: 'string' },
      world_building: { type: 'string' },
      themes: { type: 'array', items: { type: 'string' } },
    },
  },
};
