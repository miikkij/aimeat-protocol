/**
 * @file src/services/data-map/data-map-derive.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Build the first draft of a data map out of what the node already knows about a
 *   program: the scope words it declares, the workspaces it writes into, the extensions it installs,
 *   and the key families it has actually been seen writing.
 *
 *   PURE. No storage, no clock — the caller passes `at` — so the same input always yields the same
 *   map and a unit test can assert it. Two thin async adapters fetch the input elsewhere; they are
 *   the only I/O, which is also what lets the one-off backfill over 169 apps call exactly the same
 *   function the publish path calls.
 *
 *   WHAT IT REFUSES TO INVENT. Every `why` is left empty. A machine does not know why data is where
 *   it is, and that sentence is the entire reason this feature exists — a fabricated one would be
 *   worse than a blank, because a blank is visibly missing and a plausible sentence is not.
 *   `personalData` stays 'unstated' unless something decides it. Retention is only claimed where a
 *   mechanism enforces it. The "elsewhere" table stays empty except for the two entries the node can
 *   genuinely see: a foreign extension's namespace, and a connected ecosystem app's own account.
 *
 *   Measured input, 2026-08-24: 84 of 168 production apps already declare `aimeat-scopes`
 *   (memory:read 79, memory:write 73, storage:read 21, storage:write 20, memory:delete 18,
 *   organism:read 7, organism:write 5), so half the base has something to derive from on day one.
 * @structure DataMapDerivationInput · ObservedFamily · deriveDataMap(input)
 * @usage import { deriveDataMap } from './data-map-derive.js';
 * @version-history
 *   v1.0.0 — 2026-08-24 — Initial creation for TARGET-073 step 4.
 */
import type { EcoDataAreaGrant } from '../../storage/types/identity.js';
import type { IdentificationTier } from '../../utils/key-family.js';
import type { DeclaredDataMapMeta } from './data-map-meta.js';
import {
  DATA_MAP_SPEC,
  type DataMap,
  type DataMapForm,
  type DataMapRow,
  type DeletionAnswer,
  type ElsewhereRow,
  type ObservedTrace,
  type RetentionAnswer,
} from './data-map-types.js';

/** A family the write tally has actually seen, folded by the classifier. */
export interface ObservedFamily {
  family: string;
  tier: IdentificationTier;
  by: string;
  area: string;
  trace: ObservedTrace;
}

export interface DataMapDerivationInput {
  programKind: 'app' | 'extension' | 'ecosystem' | 'package';
  /** The app filename without `.html`, the extension name, the ecosystem app's short name. */
  programId: string;
  ownerName: string;
  /** ISO timestamp. Passed in rather than read, so this function stays pure. */
  at: string;
  /** From `parseAppScopes(html)`, or the GEAI's approved scopes. */
  scopes?: string[];
  declaredMeta?: DeclaredDataMapMeta | null;
  /** The full document the program published, when it has one. Its rows win over everything. */
  declaredDoc?: DataMap | null;
  /** The map of the version being replaced, or of the app this one was forked from. */
  previous?: DataMap | null;
  manifest?: { usesCortex?: string[] };
  installedExtensions?: { name: string; ownerName: string }[];
  workspaceSpaces?: { organismId: string; workspaceId: string; space: string; schemaKey?: string }[];
  observedFamilies?: ObservedFamily[];
}

const UNKNOWN_DELETION: DeletionAnswer = {
  effect: 'unknown',
  says: '',
};

const UNTIL_DELETED: RetentionAnswer = { kind: 'until-deleted' };

/**
 * What deleting a memory family does, when the node is the only thing holding it.
 *
 * The tally is named in `survives` on purpose and on every such row. A permanent count of who has
 * touched a key is the point of that ledger, and a map that quietly left it out would be describing
 * a deletion that does not happen.
 */
function memoryDeletion(canDelete: boolean): DeletionAnswer {
  return canDelete
    ? {
      effect: 'gone',
      says: 'Deleting removes the record. Nothing else here holds a copy of it.',
      alsoRemoves: ['versions', 'history'],
      survives: ['the count of who wrote to this key, and when'],
    }
    : {
      effect: 'unknown',
      says: '',
      survives: ['the count of who wrote to this key, and when'],
    };
}

function grant(area: string, pattern: string, rights: ('read' | 'write')[]): EcoDataAreaGrant {
  return { area, pattern, rights };
}

function derivedRow(
  g: EcoDataAreaGrant,
  tier: IdentificationTier,
  by: string,
  extra: Partial<DataMapRow> = {},
): DataMapRow {
  return {
    grant: g,
    basis: { tier, by },
    why: '',                     // never invented — see the file header
    ownership: 'owner',
    readers: { visibility: 'owner' },
    deletion: UNKNOWN_DELETION,
    retention: UNTIL_DELETED,
    personalData: 'unstated',
    source: 'derived',
    ...extra,
  };
}

/** Which of read/write a pair of scope words grants for one area. */
function rightsFromScopes(scopes: string[], area: string): ('read' | 'write')[] {
  const out: ('read' | 'write')[] = [];
  if (scopes.includes(`${area}:read`)) out.push('read');
  if (scopes.includes(`${area}:write`)) out.push('write');
  return out;
}

/** Two patterns address the same thing when they are the same string. Deliberately exact. */
function samePattern(a: EcoDataAreaGrant, b: EcoDataAreaGrant): boolean {
  return a.area === b.area && a.pattern === b.pattern;
}

/**
 * Draft a map.
 *
 * Precedence, strongest first: the published document, then the head declaration, then what the node
 * can work out, then what it has observed. A declared row is never overwritten by a derived one —
 * the whole point of declaring is that the person's answer stands.
 */
export function deriveDataMap(input: DataMapDerivationInput): DataMap {
  const scopes = input.scopes ?? [];
  const declared = input.declaredDoc ?? null;
  const meta = input.declaredMeta ?? null;

  // A version that declares nothing inherits what the last one said. Without this, a fork or a
  // republish silently resets a program's statement to "says nothing" — which is exactly when the
  // statement is worth most. Same rule, same reason, as lintAppAiDisclosure's posture inheritance.
  const inherited = !declared && !meta && input.previous ? input.previous : null;

  const held: DataMapRow[] = [];
  const elsewhere: ElsewhereRow[] = [];

  if (declared) held.push(...declared.held.map(r => ({ ...r, source: 'declared' as const })));
  if (declared) elsewhere.push(...declared.elsewhere.map(r => ({ ...r, source: 'declared' as const })));
  if (inherited) held.push(...inherited.held);
  if (inherited) elsewhere.push(...inherited.elsewhere);

  const add = (row: DataMapRow): void => {
    if (held.some(r => samePattern(r.grant, row.grant))) return;
    held.push(row);
  };
  const addElsewhere = (row: ElsewhereRow): void => {
    if (elsewhere.some(r => samePattern(r.grant, row.grant))) return;
    elsewhere.push(row);
  };

  // 1. What the head declaration named. Stronger than a guess from scope words: the builder wrote it.
  for (const area of meta?.areas ?? []) {
    add(derivedRow(grant(area.area, area.pattern, area.rights), 'declared-space', `app:${input.programId}`, {
      source: 'declared',
      personalData: area.personalData,
    }));
  }

  // 2. Scope words. The app asked for these, so it can reach them; the pattern is its own name,
  //    which is a convention rather than a fence — hence the weaker tier.
  const canDelete = scopes.includes('memory:delete');
  const memoryRights = rightsFromScopes(scopes, 'memory');
  if (memoryRights.length > 0) {
    add(derivedRow(grant('memory', `${input.programId}.*`, memoryRights), 'owner-named', `app:${input.programId}`, {
      deletion: memoryDeletion(canDelete),
    }));
  }
  const storageRights = rightsFromScopes(scopes, 'storage');
  if (storageRights.length > 0) {
    add(derivedRow(grant('storage', `${input.programId}/*`, storageRights), 'owner-named', `app:${input.programId}`, {
      deletion: canDelete
        ? { effect: 'gone', says: 'Deleting removes the file.' }
        : UNKNOWN_DELETION,
    }));
  }
  const knowledgeRights = rightsFromScopes(scopes, 'knowledge');
  if (knowledgeRights.length > 0) {
    add(derivedRow(grant('knowledge', `${input.programId}.*`, knowledgeRights), 'owner-named', `app:${input.programId}`));
  }

  // 3. Organism workspaces. The strongest tier the node has: a space's schema fixes the shape at
  //    write time, so this is a promise the store keeps rather than a claim the program makes.
  const organismRights = rightsFromScopes(scopes, 'organism');
  for (const space of input.workspaceSpaces ?? []) {
    add(derivedRow(
      grant('organisms', `organism.${space.organismId}.w.${space.workspaceId}.${space.space}.*`,
        organismRights.length > 0 ? organismRights : ['read']),
      space.schemaKey ? 'schema-locked' : 'declared-space',
      space.schemaKey ? `schema:${space.schemaKey}` : `space:${space.organismId}/${space.workspaceId}/${space.space}`,
      {
        ownership: 'organism',
        readers: { visibility: 'workspace' },
        deletion: {
          effect: 'tombstoned',
          says: 'Removing the record leaves its earlier versions in the workspace history, which is how a workspace keeps a record of what it held.',
          survives: ['every earlier version of the record'],
        },
        retention: { kind: 'version-capped', note: 'the workspace keeps earlier versions' },
      },
    ));
  }

  // 4. Extensions. One this owner installed is theirs to describe; anyone else's is a copy of
  //    somebody else's record, which is the second table and not the first.
  for (const ext of input.installedExtensions ?? []) {
    const g = grant('memory', `ext:${ext.name}.*`, ['read']);
    if (ext.ownerName === input.ownerName) {
      add(derivedRow(g, 'owner-named', `extension:${ext.name}`, { ownership: 'extension' }));
    } else {
      addElsewhere({
        grant: g,
        basis: { tier: 'owner-named', by: `extension:${ext.name}` },
        why: '',
        status: 'copy-of-anothers-record',
        where: `the ${ext.name} extension, which ${ext.ownerName} maintains`,
        controller: ext.ownerName,
        deletion: {
          effect: 'not-ours-to-delete',
          says: `Removing this program does not remove what ${ext.name} holds. Ask whoever runs it.`,
        },
        retention: { kind: 'unknown' },
        personalData: 'unstated',
        source: 'derived',
      });
    }
  }

  // 5. What it has actually been seen writing. A family no row covers is the interesting case — it
  //    is either an undeclared area or a pattern that is wrong, and both are findings.
  for (const fam of input.observedFamilies ?? []) {
    const g = grant(fam.area || 'memory', fam.family, ['write']);
    const existing = held.find(r => samePattern(r.grant, g) || covers(r.grant.pattern, fam.family));
    if (existing) {
      existing.observed = fam.trace;
      continue;
    }
    held.push(derivedRow(g, fam.tier, fam.by, { source: 'observed', observed: fam.trace }));
  }

  const form = pickForm(declared, meta, inherited, held);
  const source = declared || meta ? (held.some(r => r.source !== 'declared') ? 'mixed' : 'declared') : 'derived';

  return { spec: DATA_MAP_SPEC, form, held, elsewhere, source, at: input.at };
}

/** Does a declared pattern already cover an observed family? `uutiset.*` covers `uutiset.elokuu.*`. */
function covers(pattern: string, family: string): boolean {
  const star = pattern.indexOf('*');
  if (star < 0) return pattern === family;
  return family.startsWith(pattern.slice(0, star));
}

/**
 * Which form this is.
 *
 * A declaration wins. Failing that, the rows decide: anything reaching past the owner is at least
 * shared, and an organism row makes it a workspace program. `single-person` is only claimed when
 * nothing at all reaches further, because claiming it wrongly is the one form error that makes a map
 * say something untrue rather than something incomplete.
 */
function pickForm(
  declared: DataMap | null,
  meta: DeclaredDataMapMeta | null,
  inherited: DataMap | null,
  held: DataMapRow[],
): DataMapForm {
  if (declared) return declared.form;
  if (meta) return meta.form;
  if (inherited) return inherited.form;

  const isOrganismRow = (r: DataMapRow): boolean => r.grant.area === 'organisms' || r.ownership === 'organism';
  const hasOrganism = held.some(isOrganismRow);
  // Measured over the NON-organism rows on purpose. An organism row's readers are the workspace,
  // which is what 'organism-workspace' already means — counting it as extra reach made every
  // workspace program come out 'mixed', which is a shape nobody declared and a weaker requirement set.
  const reachesFurther = held.some(r => !isOrganismRow(r) && !['private', 'owner'].includes(r.readers.visibility));
  if (hasOrganism && reachesFurther) return 'mixed';
  if (hasOrganism) return 'organism-workspace';
  if (reachesFurther) return 'shared';
  return 'single-person';
}
