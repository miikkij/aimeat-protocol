/**
 * @file src/services/classification/explorer.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The classification explorer (TARGET-082 review): the classifications stored on a
 *   caller's own content, and the items where a suggestion waits for a person, a page at a time.
 *   REST (GET /v1/classification/labels), the MCP action `explorer` of aimeat_classification on all
 *   three surfaces, and AIMEAT.labels.list() call this one function, so who may list what is decided
 *   once.
 *
 *   WHAT IT LISTS. Stored label rows (storage.listContentLabels), never content: an item with no row
 *   reads as the policy's default label and is not listed. Level owner covers the owner's own scope,
 *   their agents' scopes and their ecosystem apps' scopes, because memory is keyed by the writer and
 *   the owner sees everything their own agents hold. Level organism covers `organism:<id>`.
 *
 *   WHO. Level owner: the owner or anything acting in their name (their agent, an app grant), never
 *   a detection rule. Level organism: its creator or an admin, as for the organism's audit log
 *   (policy-admin.ts readAuditLog), and an agent the organism does not admit is no one there.
 *
 *   WHAT AN AI DOES NOT SEE. Where classification is on for the item's scope, an AI caller is not
 *   told an item exists when its label hides it from AI, and no caller sees an item whose label's
 *   audience leaves them out: the same answer a memory list gives. The check is made here and not
 *   through reader.show(), because listing label metadata is not a read of content, and a refusal
 *   row per hidden item on every page would bury the owner's log.
 *
 *   PAGING. Rows are read per (scope, kind), in key order, so the cursor `after key` is exact. The
 *   label and pending filters run over what storage returns; a call reads at most SCAN_CALLS pages of
 *   SCAN_PAGE rows and answers with a cursor when the budget ends before the page is full.
 * @structure ExplorerQuery · ExplorerItem · ExplorerPage · explorerQueryOf() · listLabels()
 * @usage
 *   const q = explorerQueryOf({ level: 'owner', pending: true });
 *   const page = await listLabels({ storage, config }, actor, q);
 * @version-history
 *   v1.1.0 — 2026-09-30 — A waiting suggestion on personal content that was deleted since is left
 *     out of the list (TARGET-082 second review).
 *   v1.0.0 — 2026-09-29 — Initial (TARGET-082 review: the explorer).
 */
import type { ContentLabelKind, ContentLabelRow, ContentLabelSuggestion } from '../../storage/interface.js';
import { agentBarred } from '../organism-agent-access.js';
import { isOrgManager } from '../workspace-access.js';
import { audienceCheck } from './audience.js';
import { labelById, type ClassificationLabel, type ClassificationPolicy } from './defaults.js';
import { ClassificationError, type ClassificationDeps, type LabelActor } from './labels.js';
import { classificationActiveFor, policyFor, scopeOrganism } from './policy.js';

/** Items per page when the caller names none, and the most a caller may ask for. */
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
/** Rows per storage read, and storage reads per call. 10 × 500 rows is the most one call scans. */
const SCAN_PAGE = 500;
const SCAN_CALLS = 10;

const KINDS: readonly ContentLabelKind[] = ['memory', 'file', 'row'];

export type ExplorerLevel = 'owner' | 'organism';

export interface ExplorerQuery {
  level: ExplorerLevel;
  organismId: string | null;
  /** Only items carrying this label id. */
  label: string | null;
  /** Only items with a suggestion waiting for a person. */
  pending: boolean;
  kind: ContentLabelKind | null;
  limit: number;
  cursor: string | null;
}

/** A label as a list shows it. */
export interface LabelBrief {
  id: string;
  name: ClassificationLabel['name'];
  rank: number;
  color: string;
  aiVisibility: ClassificationLabel['aiVisibility'];
}

export interface ExplorerItem {
  kind: ContentLabelKind;
  /** A memory key, a stored file key, or `<ws>/<space>/<rowId>` for a row. */
  key: string;
  /** The owner identity, or `organism:<id>`. */
  scope: string;
  organismId: string | null;
  /** Whose personal content it is; null on organism content. */
  owner: string | null;
  label: string;
  labelDetail: LabelBrief | null;
  source: ContentLabelRow['source'];
  locked: boolean;
  suggestion: (ContentLabelSuggestion & { labelDetail: LabelBrief | null }) | null;
  justification: string | null;
  humanSaid: string | null;
  setBy: string;
  updatedAt: string;
}

export interface ExplorerPage {
  level: ExplorerLevel;
  /** The owner identity, or the organism id. */
  subject: string;
  items: ExplorerItem[];
  /** Pass as `cursor` for the next page; null when there is nothing after this page. */
  next: string | null;
  /** How many stored rows this call read to fill the page. */
  scanned: number;
}

const bad = (message: string): never => { throw new ClassificationError('INVALID_INPUT', 400, message); };

function text(v: unknown, field: string, max: number): string | null {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string' || v.length > max) return bad(`${field} is text of at most ${max} characters.`);
  return v.trim() || null;
}

/**
 * The explorer's query from a REST query string or tool arguments: the one validation both use.
 * @param {Record<string, unknown>} input level, organism_id, label, pending, kind, limit, cursor
 * @returns {ExplorerQuery}
 */
export function explorerQueryOf(input: Record<string, unknown>): ExplorerQuery {
  const level = input.level === undefined || input.level === null || input.level === '' ? 'owner' : input.level;
  if (level !== 'owner' && level !== 'organism') bad('level is owner or organism.');
  const organismId = text(input.organism_id, 'organism_id', 200);
  if (level === 'organism' && !organismId) bad('organism_id names the organism whose classified content this lists.');
  const pending = input.pending === true || input.pending === 'true' ? true
    : input.pending === undefined || input.pending === null || input.pending === false || input.pending === 'false' || input.pending === '' ? false
      : bad('pending is true or false.');
  const kind = input.kind === undefined || input.kind === null || input.kind === '' ? null : input.kind;
  if (kind !== null && !KINDS.includes(kind as ContentLabelKind)) bad('kind is memory, file or row.');
  const rawLimit = input.limit === undefined || input.limit === null || input.limit === '' ? DEFAULT_LIMIT : Number(input.limit);
  if (!Number.isInteger(rawLimit) || rawLimit < 1) bad(`limit is a whole number from 1 to ${MAX_LIMIT}.`);
  return {
    level: level as ExplorerLevel,
    organismId: level === 'organism' ? organismId : null,
    label: text(input.label, 'label', 200),
    pending: pending as boolean,
    kind: kind as ContentLabelKind | null,
    limit: Math.min(rawLimit, MAX_LIMIT),
    cursor: text(input.cursor, 'cursor', 2000),
  };
}

interface Cursor { s: string; k: ContentLabelKind; a: string }

function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c), 'utf8').toString('base64url');
}

const BAD_CURSOR = 'cursor is not one this list gave out. Start again without it.';

function decodeCursor(raw: string): Cursor {
  let c: Cursor;
  try {
    c = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Cursor;
  } catch (err) {
    throw new ClassificationError('INVALID_INPUT', 400, `${BAD_CURSOR} (${(err as Error).message})`);
  }
  if (c && typeof c.s === 'string' && typeof c.a === 'string' && KINDS.includes(c.k)) return c;
  return bad(BAD_CURSOR);
}

/** The scopes a level covers, and whom the caller is listed as. Refuses before anything is read. */
async function scopesFor(deps: ClassificationDeps, actor: LabelActor, q: ExplorerQuery): Promise<{ subject: string; scopes: string[] }> {
  if (actor.kind === 'rule') throw new ClassificationError('PERSON_REQUIRED', 403, 'A detection rule lists no content.');
  if (q.level === 'organism') {
    const id = q.organismId as string;
    const organism = await deps.storage.getOrganism(id);
    if (organism && !agentBarred(organism, actor.principal) && await isOrgManager(deps.storage, id, actor.ownerName ?? undefined)) {
      return { subject: id, scopes: [`organism:${id}`] };
    }
    throw new ClassificationError('NOT_FOUND', 404, "No such organism, or you are not its creator or an admin, who list the organism's classified content.");
  }
  const scopes = [actor.ownerGhii];
  if (actor.ownerName) {
    const [agents, eco] = await Promise.all([
      deps.storage.getAgentsByOwner(actor.ownerName),
      deps.storage.getEcosystemAppsByOwner(actor.ownerName),
    ]);
    scopes.push(...agents.map(a => a.gaii).sort(), ...eco.map(e => e.geai).sort());
  }
  return { subject: actor.ownerGhii, scopes: [...new Set(scopes)] };
}

function brief(policy: ClassificationPolicy, id: string): LabelBrief | null {
  const l = labelById(policy, id);
  return l ? { id: l.id, name: l.name, rank: l.rank, color: l.color, aiVisibility: l.aiVisibility } : null;
}

/**
 * A page of the classifications stored on the caller's content, filtered by label or by a waiting
 * suggestion. See the file header for what it lists, to whom, and how it pages.
 */
export async function listLabels(deps: ClassificationDeps, actor: LabelActor, q: ExplorerQuery): Promise<ExplorerPage> {
  const { subject, scopes } = await scopesFor(deps, actor, q);
  const kindsOf = (scope: string): ContentLabelKind[] =>
    (scopeOrganism(scope) ? ['memory', 'row'] as ContentLabelKind[] : ['memory', 'file'] as ContentLabelKind[])
      .filter(k => !q.kind || k === q.kind);
  const pairs = scopes.flatMap(scope => kindsOf(scope).map(kind => ({ scope, kind })));

  let start = 0;
  let after: string | undefined;
  if (q.cursor) {
    const c = decodeCursor(q.cursor);
    start = pairs.findIndex(p => p.scope === c.s && p.kind === c.k);
    if (start < 0) bad('cursor names content this list no longer covers. Start again without it.');
    after = c.a;
  }

  // The policy and whether classification is on, once per scope.
  const perScope = new Map<string, { policy: ClassificationPolicy; active: boolean }>();
  const policyOf = async (scope: string) => {
    let p = perScope.get(scope);
    if (!p) {
      const [policy, active] = await Promise.all([
        policyFor(deps.storage, deps.config, scope), classificationActiveFor(deps.storage, deps.config, scope),
      ]);
      p = { policy, active };
      perScope.set(scope, p);
    }
    return p;
  };
  const inside = audienceCheck(deps.storage, { owner: actor.ownerGhii, ownerName: actor.ownerName });
  const visible = async (row: ContentLabelRow, policy: ClassificationPolicy, active: boolean): Promise<boolean> => {
    if (!active) return true;
    const label = labelById(policy, row.label) ?? labelById(policy, policy.defaultLabel);
    if (!label) return true;
    if (actor.kind === 'ai' && label.aiVisibility === 'hidden') return false;
    return inside(label.audience, row.scope);
  };

  const items: ExplorerItem[] = [];
  let scanned = 0;
  let calls = 0;
  for (let i = start; i < pairs.length; i++) {
    const { scope, kind } = pairs[i]!;
    let cursorKey = i === start ? after : undefined;
    const { policy, active } = await policyOf(scope);
    for (;;) {
      if (calls >= SCAN_CALLS) {
        return { level: q.level, subject, items, next: encodeCursor({ s: scope, k: kind, a: cursorKey ?? '' }), scanned };
      }
      const rows = await deps.storage.listContentLabels({ scope, kind, ...(cursorKey !== undefined ? { after: cursorKey } : {}), limit: SCAN_PAGE });
      calls++;
      scanned += rows.length;
      for (const row of rows) {
        cursorKey = row.key;
        if (q.label && row.label !== q.label) continue;
        if (q.pending && !row.suggestion) continue;
        if (!(await visible(row, policy, active))) continue;
        // A suggestion on personal content that was deleted since waits for nobody: leave it out.
        // An organism document is stored under its copies' keys by any member, so it is not looked up.
        if (row.suggestion && row.kind === 'memory' && !scopeOrganism(row.scope)
          && !(await deps.storage.getMemory(row.scope, row.key))) continue;
        items.push({
          kind: row.kind, key: row.key, scope: row.scope, organismId: scopeOrganism(row.scope), owner: row.ownerGaii,
          label: row.label, labelDetail: brief(policy, row.label), source: row.source, locked: row.locked,
          suggestion: row.suggestion ? { ...row.suggestion, labelDetail: brief(policy, row.suggestion.label) } : null,
          justification: row.justification, humanSaid: row.humanSaid, setBy: row.setBy, updatedAt: row.updatedAt,
        });
        if (items.length >= q.limit) {
          return { level: q.level, subject, items, next: encodeCursor({ s: scope, k: kind, a: row.key }), scanned };
        }
      }
      if (rows.length < SCAN_PAGE) break;
    }
  }
  return { level: q.level, subject, items, next: null, scanned };
}
