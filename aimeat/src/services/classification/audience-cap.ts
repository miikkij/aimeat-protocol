/**
 * @file src/services/classification/audience-cap.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The audience cap of a label, held at every place that sets who may read classifiable
 *   content or a container (plan doc-mvdipuyqraas, L3.2, L3.3 and L3.5). One function, audienceCapOf():
 *   may this content be given this level, under the label it effectively carries?
 *
 *   THE RULE. A change that RAISES the content's level (from what it has now, or from private for new
 *   content) to one wider than its effective label's `maxAudience` is refused with 409
 *   LABEL_CAPS_AUDIENCE, and the message names the label and the cap. A change that keeps or narrows
 *   the level is never refused, so content already over a cap (decision 10.3: not changed at deploy)
 *   can still be edited and narrowed. The label is the EFFECTIVE one (effective.ts): a workspace's or
 *   an organism's label caps everything in it, and a container's own label caps the container's level
 *   (a workspace share, a board, an app, an organism). Only where classification is on for the
 *   content's scope (policy.ts classificationActiveFor); off reads nothing.
 *
 *   ORDER. A door asks this BEFORE the publish gate (publish-requests/ask.ts publishAskOf) and before
 *   its first write: a refused level files no publish request and stores nothing. An approved publish
 *   request is asked again when it is applied (publish-requests/cap-recheck.ts), so a request never
 *   carries content past a cap.
 *
 *   THE OVERRIDE (L3.3). The owner, signed in themselves, makes an exception with action 'audience'
 *   and a written reason for one item (exception-admin.ts makeException). While it is in force and the
 *   item's label is no higher than the one it was made for, the cap does not refuse that item, and the
 *   use is written to the audit log. An agent, an app grant or an ecosystem app cannot make one
 *   (PERSON_REQUIRED), and nothing else passes the cap: not a publish request, not an agent holding
 *   publish:public.
 *
 *   ON A CLOSED NODE public and link compare as signed-in (audience-levels.ts storedLevel).
 * @structure CapSubject · AudienceCapAnswer · LABEL_CAPS_AUDIENCE · audienceCapOf() · capMessage() ·
 *   capByOf() · capRefusalOf() · audienceOfVisibility() · audienceOfShareAccess() · audienceOfOrganism()
 * @usage
 *   const cap = await audienceCapOf({ storage, config }, memoryTarget(owner, key), 'public', { from: 'private' });
 *   if (cap.kind === 'refused') return { ok: false, status: cap.status, code: cap.code, message: cap.message };
 * @version-history
 *   v1.0.0 — 2026-10-18 — Initial (plan doc-mvdipuyqraas, L3.2, L3.3, L3.5).
 */
import type { Storage, ContentLabelTarget } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import type { CallerContext } from '../caller-context.js';
import { levelOfVisibility } from '../exposure/exposure-types.js';
import { labelById, type ClassificationLabel } from './defaults.js';
import { effectiveLabels } from './effective.js';
import { activeExceptionsFor, recordExceptionUse, type ClassificationException } from './exceptions.js';
import { targetId } from './label-rows.js';
import { classificationActiveFor, ownerOfScope, policyFor } from './policy.js';
import { recordClassificationAudit } from './audit.js';
import {
  AUDIENCE_LEVEL_WORDS, capAllows, isWiderAudience, storedLevel, type AudienceLevel,
} from './audience-levels.js';

export const LABEL_CAPS_AUDIENCE = 'LABEL_CAPS_AUDIENCE' as const;

/**
 * What is given a level: content or a container at its label address, or content that does not exist
 * yet and has no address (a new board, a new organism), named by the scope whose default label it
 * will carry.
 */
export type CapSubject = ContentLabelTarget | { scope: string };

export type AudienceCapAnswer =
  /** `exception` is the owner's exception that let it through, when one did. */
  | { kind: 'allowed'; exception?: ClassificationException }
  | { kind: 'refused'; status: 409; code: typeof LABEL_CAPS_AUDIENCE; message: string; label: string; cap: AudienceLevel; level: AudienceLevel };

export interface CapCtx {
  storage: Storage;
  config: Pick<AimeatConfig, 'classificationMode' | 'nodeId' | 'contentAccess'>;
}

export interface CapOptions {
  /** The level the content has now; absent or null for new content, which counts as private. */
  from?: AudienceLevel | null;
  /** Who asks, for the audit row a refusal or an exception's use writes. */
  by?: { principal: string; kind: 'human' | 'ai' | 'system' };
  /** Where the change was asked, for the audit row (a route or an MCP tool name). */
  where?: string;
}

const hasAddress = (s: CapSubject): s is ContentLabelTarget => 'key' in s && 'kind' in s;

/** The refusal's words: the label, where it came from, its cap, and the level asked for. */
export function capMessage(label: ClassificationLabel, from: string, cap: AudienceLevel, level: AudienceLevel): string {
  const via = from === 'own' ? '' : ` (it is in a ${from} classified so)`;
  return `This is classified "${label.name.en}"${via}, which may be shown to at most ${AUDIENCE_LEVEL_WORDS[cap]} ("${cap}"). `
    + `This change would show it to ${AUDIENCE_LEVEL_WORDS[level]} ("${level}"), so nothing was changed. `
    + `Choose "${cap}" or a narrower level. The owner may allow a wider level for this one item, signed in themselves, `
    + 'with a written reason: an exception with action "audience" (POST /v1/classification/exceptions, or Make an exception in the Data Wallet).';
}

/** Does this exception still cover the item: made for a label no lower than the one it carries now? */
function stillCovers(e: ClassificationException, label: ClassificationLabel, rankOf: (id: string) => number): boolean {
  return e.action === 'audience' && (!e.label || e.label === label.id || rankOf(e.label) >= label.rank);
}

/**
 * May `subject` be given level `to`? Allowed when classification is off for its scope, when the change
 * does not raise its level, when its effective label has no cap or the cap admits the level, or when
 * the owner's 'audience' exception for it is in force. Otherwise refused, and the refusal is audited.
 */
export async function audienceCapOf(ctx: CapCtx, subject: CapSubject, to: AudienceLevel, opts: CapOptions = {}): Promise<AudienceCapAnswer> {
  const { storage, config } = ctx;
  if (config.classificationMode === 'off') return { kind: 'allowed' };
  const level = storedLevel(config, to);
  const from = storedLevel(config, opts.from ?? 'private');
  if (!isWiderAudience(level, from)) return { kind: 'allowed' };
  if (!(await classificationActiveFor(storage, config, subject.scope))) return { kind: 'allowed' };
  const policy = await policyFor(storage, config, subject.scope);
  const eff = hasAddress(subject) ? (await effectiveLabels(storage, policy, [subject])).get(targetId(subject)) : undefined;
  const label = labelById(policy, eff?.label ?? policy.defaultLabel);
  const cap = label?.maxAudience ?? null;
  if (!label || capAllows(cap, level)) return { kind: 'allowed' };
  const by = opts.by ?? { principal: `system@${config.nodeId}`, kind: 'system' as const };
  if (hasAddress(subject)) {
    const rankOf = (id: string) => labelById(policy, id)?.rank ?? -1;
    const found = (await activeExceptionsFor({ storage, config }, subject.scope, [subject])).get(`${subject.kind}\u0000${subject.key}`) ?? [];
    const exception = found.find(e => stillCovers(e, label, rankOf));
    if (exception) {
      recordExceptionUse(exception, by.principal, by.kind, `audience ${level}${opts.where ? ` at ${opts.where}` : ''}`);
      return { kind: 'allowed', exception };
    }
    recordClassificationAudit({
      scope: subject.scope, ownerGaii: ownerOfScope(subject.scope), kind: subject.kind, key: subject.key, label: label.id,
      reader: by.principal, readerKind: by.kind, action: 'refused',
      purpose: `audience ${from} → ${level} over the cap ${cap}${opts.where ? ` at ${opts.where}` : ''}`,
    });
  }
  return {
    kind: 'refused', status: 409, code: LABEL_CAPS_AUDIENCE,
    message: capMessage(label, eff?.from ?? 'own', cap!, level), label: label.id, cap: cap!, level,
  };
}

/** Who asks, as the audit row names them: an agent or an ecosystem app is an AI, anyone else a person. */
export function capByOf(caller: Pick<CallerContext, 'principal' | 'kind'>): NonNullable<CapOptions['by']> {
  return { principal: caller.principal, kind: caller.kind === 'agent' || caller.kind === 'ecosystem' ? 'ai' : 'human' };
}

/** A refused answer as the `{ ok: false, status, code, message }` a service returns; null when allowed. */
export function capRefusalOf(answer: AudienceCapAnswer): { ok: false; status: 409; code: typeof LABEL_CAPS_AUDIENCE; message: string } | null {
  return answer.kind === 'refused' ? { ok: false, status: answer.status, code: answer.code, message: answer.message } : null;
}

/**
 * The level a stored visibility word gives: 'public', 'members' (signed-in) and 'organism:<id>' as
 * the exposure report reads them (exposure-types.ts levelOfVisibility), and private for everything
 * else (private, group, workspace, owner, shared, system, nothing).
 */
export function audienceOfVisibility(visibility: unknown): AudienceLevel {
  return levelOfVisibility(visibility)?.level ?? 'private';
}

/** A workspace share's access as a level: open is link, account signed-in, organism its members; password and nothing are private. */
export function audienceOfShareAccess(access: unknown): AudienceLevel {
  if (access === 'open') return 'link';
  if (access === 'account') return 'signed-in';
  if (access === 'organism') return 'organism';
  return 'private';
}

/** An organism's own visibility as a level: public and listed are public, anything else private. */
export function audienceOfOrganism(visibility: unknown): AudienceLevel {
  return visibility === 'public' || visibility === 'listed' ? 'public' : 'private';
}
