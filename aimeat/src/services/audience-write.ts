/**
 * @file src/services/audience-write.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The write side of the audience decision (services/audience.ts): a request that names
 *   an audience for a knowledge package, a package or a data package passes here BEFORE anything is
 *   written (plan doc-mvcn6c7e4e5q, V3.6 to V3.8).
 *
 *   Two refusals, both 400:
 *     INVALID_INPUT          the value is not one of the levels this kind takes.
 *     NOT_ORGANISM_MEMBER    the value names organism:<id>, and the writer is not in that organism
 *                            (isOrganismMember: the writer's owner an active member, and an agent the
 *                            organism admits). Sharing with an organisation you are not in would hand
 *                            your content to people you have no relation with.
 *
 *   Membership is asked of audience.ts and nowhere else: this file adds no second membership check.
 * @structure AudienceWriteResult · checkAudienceWrite · writerAuthOf
 * @usage
 *   const a = await checkAudienceWrite(storage, body.visibility, req.auth, ['private', 'members', 'organism', 'public']);
 *   if (!a.ok) return res.status(a.status).json(error(nodeId, a.code, a.message));
 * @version-history
 *   v1.0.0 — 2026-10-17 — Initial (plan doc-mvcn6c7e4e5q, V3.6 to V3.8).
 */
import type { Storage } from '../storage/interface.js';
import { parseAudience, isOrganismMember, type Audience, type AudienceAuth, type AudienceLevel } from './audience.js';
import { localAccountName } from '../utils/gaii.js';

export type AudienceWriteResult =
  | { ok: true; audience: Audience }
  | { ok: false; status: 400; code: 'INVALID_INPUT' | 'NOT_ORGANISM_MEMBER'; message: string };

/**
 * Check an audience a writer asks for. `levels` names what this kind takes, and `spelling` maps a
 * kind's own word for a level (a knowledge package says 'owner' for private) before the parse.
 */
export async function checkAudienceWrite(
  storage: Storage,
  value: unknown,
  writer: AudienceAuth | null | undefined,
  levels: readonly AudienceLevel[],
  spelling: Record<string, string> = {},
): Promise<AudienceWriteResult> {
  const raw = typeof value === 'string' && spelling[value] ? spelling[value] : value;
  const audience = parseAudience(raw);
  const words = levels.map(l => (l === 'organism' ? 'organism:<id>' : Object.keys(spelling).find(k => spelling[k] === l) ?? l));
  if (!audience || !levels.includes(audience.level)) {
    return { ok: false, status: 400, code: 'INVALID_INPUT', message: `The audience must be one of: ${words.join(', ')}.` };
  }
  if (audience.level === 'organism' && !(await isOrganismMember(storage, audience.organismId!, writer))) {
    return {
      ok: false, status: 400, code: 'NOT_ORGANISM_MEMBER',
      message: `You can share this with organism ${audience.organismId} only while you are an active member of it. Nothing was saved.`,
    };
  }
  return { ok: true, audience };
}

/** The writer as audience.ts reads it, for a service that holds only the identity that writes. */
export function writerAuthOf(identity: string): AudienceAuth {
  return { sub: identity, owner: localAccountName(identity) };
}
