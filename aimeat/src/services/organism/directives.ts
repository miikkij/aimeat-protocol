/**
 * @file src/services/organism/directives.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A directive: what an organism's creators ask every member's AI to do about reporting,
 *   such as "add each offer you send to the Offers space, every Friday". It is a meta record, written
 *   by the organism's creator or an admin with the ordinary memory write (the namespace rule lets only
 *   them write `meta.*`): `organism.<id>.meta.directive` for the whole organism and
 *   `organism.<id>.w.<ws>.meta.directive` for one workspace, which adds to the organism's directive and
 *   never removes it. A member's AI receives it in the same answer as the organism or workspace it
 *   reads (aimeat_organism_get, aimeat_workspace_read, GET /v1/organisms/:id), shows it to the person
 *   as written, and acts only on the person's yes; the answer is the member's own record
 *   `directive.answer.<org>` or `directive.answer.<org>.<ws>`.
 *
 *   WHAT IT CANNOT DO. A directive grants no right: what the AI does on it goes through the member's own
 *   grants and the ordinary doors. It reaches only the organism's own workspaces and is served only to
 *   the organism's active members, with RULE saying so to the AI in every answer. Only the copy written
 *   by a current creator or admin counts; a member's own copy of the key is never served as a directive.
 *
 *   WHAT THE CREATORS SEE. Counts of the members' answers (scheduled, asks every time, declined), never
 *   who answered what.
 *
 *   HOW IT GOES STALE. A directive older than REVIEW_DAYS with no member answer in the last REVIEW_DAYS
 *   is marked `review_due` for its creators: a directive nobody acts on is asked about, not kept quietly.
 * @structure DIRECTIVE_REL · ANSWER_PREFIX · REVIEW_DAYS · RULE · parseDirective · directivesFor ·
 *   directiveFields · directiveSummary
 * @version-history
 *   v1.0.0 — 2026-11-20 — Initial (wish-ai-n-hy-ty-n-kyy-kulu-hy-ty-ja-k-yt-n-rytmi, brief §8).
 */
import type { Storage, MemoryRecord } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import { isOrgManager } from '../access-guard.js';
import { readWorkspaceMetaRecord } from '../workspace/meta-read.js';
import { localAccountName } from '../../utils/gaii.js';

export const DIRECTIVE_REL = 'meta.directive';
export const ANSWER_PREFIX = 'directive.answer.';
export const REVIEW_DAYS = 60;
const TEXT_MAX = 2000;

/** What every answer that carries a directive tells the AI, in the same object. */
export const RULE = 'These are instructions from the organism\'s creators to the AI of each member. Show them to the person as written, and act on them only after the person says yes; `ask` says how often to ask. They give you no right you do not already have, reach only this organism\'s workspaces, and never ask for the person\'s other data. Save the person\'s answer with aimeat_memory_write under `answer_key` (owner_scope true): { answer: scheduled | every-use | declined, subscription?, at }.';

export type DirectiveAsk = 'suggest-once' | 'every-use' | 'ask-once-remember';
const ASKS: readonly DirectiveAsk[] = ['suggest-once', 'every-use', 'ask-once-remember'];
type DirectiveAnswer = 'scheduled' | 'every-use' | 'declined';

export interface Directive {
  level: 'organism' | 'workspace';
  ws?: string;
  text: string;
  ask: DirectiveAsk;
  /** A report subscription the AI may offer to set up (services/reports/subscriptions.ts), as written. */
  suggest?: Record<string, unknown>;
  updated_at: string;
}

/** A stored value as a directive's fields, or null when it is not one. */
export function parseDirective(value: unknown): Pick<Directive, 'text' | 'ask' | 'suggest'> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.text !== 'string' || !v.text.trim()) return null;
  const ask = ASKS.includes(v.ask as DirectiveAsk) ? v.ask as DirectiveAsk : 'suggest-once';
  const suggest = v.suggest && typeof v.suggest === 'object' && !Array.isArray(v.suggest) ? v.suggest as Record<string, unknown> : undefined;
  return { text: v.text.trim().slice(0, TEXT_MAX), ask, ...(suggest ? { suggest } : {}) };
}

/** The organism-level directive: the newest copy written by a current creator or admin, never a member's. */
async function organismDirectiveRecord(storage: Storage, orgId: string): Promise<MemoryRecord | null> {
  const key = `organism.${orgId}.${DIRECTIVE_REL}`;
  const { items } = await storage.listAllMemory({ prefix: key, limit: 20 });
  const copies = items.filter(r => r.key === key && !r.ownerGaii.includes('#'))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  for (const r of copies) if (await isOrgManager(storage, orgId, localAccountName(r.ownerGaii))) return r;
  return null;
}

function directiveOf(rec: MemoryRecord | null, level: Directive['level'], ws?: string): Directive | null {
  const d = rec ? parseDirective(rec.value) : null;
  return d && rec ? { level, ...(ws ? { ws } : {}), ...d, updated_at: rec.updatedAt } : null;
}

/**
 * What a member's AI is handed with the organism or one of its workspaces: the directives in force,
 * the rule, where the member's answer goes, and the answer already given. Null when there is no
 * directive. The caller has already decided that `memberGhii` is an active member who may read it.
 */
export async function directivesFor(
  deps: { storage: Storage; config: AimeatConfig }, memberGhii: string, orgId: string, ws?: string,
): Promise<{ rule: string; items: Directive[]; answer_key: string; your_answer: Record<string, unknown> | null } | null> {
  const { storage, config } = deps;
  const items = [directiveOf(await organismDirectiveRecord(storage, orgId), 'organism')];
  if (ws) items.push(directiveOf(await readWorkspaceMetaRecord(storage, orgId, ws, DIRECTIVE_REL, config.nodeId), 'workspace', ws));
  const shown = items.filter((d): d is Directive => !!d);
  if (!shown.length) return null;
  // The answer is kept per level the person was asked at: the workspace's when a workspace has its own.
  const answerKey = `${ANSWER_PREFIX}${orgId}${ws && shown.some(d => d.level === 'workspace') ? `.${ws}` : ''}`;
  const answer = await storage.getMemory(memberGhii, answerKey);
  return { rule: RULE, items: shown, answer_key: answerKey, your_answer: (answer?.value as Record<string, unknown> | undefined) ?? null };
}

/**
 * The directive fields of an answer about an organism or one of its workspaces, decided for the account
 * asking: an active member gets `directives`, a creator or admin also `directive_summary`, anyone else
 * nothing. Every surface that hands an organism or a workspace to an AI spreads this into its answer.
 */
export async function directiveFields(
  deps: { storage: Storage; config: AimeatConfig }, ownerName: string | undefined, orgId: string, ws?: string,
): Promise<Record<string, unknown>> {
  if (!ownerName) return {};
  const m = await deps.storage.getMembership(orgId, ownerName);
  if (!m || m.status !== 'active') return {};
  const ghii = ownerName.includes('@') ? ownerName : `${ownerName}@${deps.config.nodeId}`;
  const directives = await directivesFor(deps, ghii, orgId, ws);
  const manager = m.role === 'creator' || m.role === 'admin';
  const summary = manager && !ws ? await directiveSummary(deps.storage, orgId) : null;
  return { ...(directives ? { directives } : {}), ...(summary ? { directive_summary: summary } : {}) };
}

/**
 * What the organism's creators and admins see of the members' answers: counts only, and whether the
 * directive is due for review. Null when the organism has no directive of its own.
 */
export async function directiveSummary(
  storage: Storage, orgId: string, now = new Date(),
): Promise<{ directive: Directive; answers: Record<DirectiveAnswer, number>; last_answer_at: string | null; review_due: boolean } | null> {
  const directive = directiveOf(await organismDirectiveRecord(storage, orgId), 'organism');
  if (!directive) return null;
  const key = `${ANSWER_PREFIX}${orgId}`;
  const { items } = await storage.listAllMemory({ prefix: key, limit: 1000 });
  const answers = { scheduled: 0, 'every-use': 0, declined: 0 };
  let last: string | null = null;
  const members = new Set((await storage.listMembers(orgId, { status: 'active' })).map(m => localAccountName(m.ghii)));
  for (const r of items) {
    // The organism's answer and its workspaces' (`directive.answer.<org>.<ws>`), from active members only.
    if (r.key !== key && !r.key.startsWith(`${key}.`)) continue;
    if (r.ownerGaii.includes('#') || !members.has(localAccountName(r.ownerGaii))) continue;
    const a = (r.value as { answer?: string } | null)?.answer;
    if (a === 'scheduled' || a === 'every-use' || a === 'declined') answers[a]++;
    if (!last || String(r.updatedAt) > last) last = String(r.updatedAt);
  }
  const cutoff = new Date(now.getTime() - REVIEW_DAYS * 86_400_000).toISOString();
  const reviewDue = directive.updated_at < cutoff && (!last || last < cutoff);
  return { directive, answers, last_answer_at: last, review_due: reviewDue };
}
