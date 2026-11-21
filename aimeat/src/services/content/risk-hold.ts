/**
 * @file src/services/content/risk-hold.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The hold of the content risk marks, for the people who decide it: what waits for the
 *   caller, and the release (docs/internal/content-risk-plan.md, "Hold flow").
 *
 *   WHAT WAITS FOR WHOM. A person's own held items wait for that person; a workspace's held items wait
 *   for the workspace's creator and the organism's creators and admins (risk-core.ts approversOf). The
 *   list reads the caller's own facts and risk record, and the risk record of every workspace they
 *   approve for, one read each.
 *
 *   RELEASE. The hold's flag turns to `released`, with who and when; the marks stay, and the content was
 *   never touched. Releasing needs memory:write-reserved, or the account holder in person: an AI that has
 *   read the held text must not release it on that text's say, so the word is one a person grants on
 *   purpose. A released hold stays released for the same hash (risk-core.ts).
 *
 *   A REF names a held item for the release: `p:<subject id>` for a person's item, `w:<org>:<ws>:<subject
 *   id>` for a workspace's. The list gives it.
 * @structure HeldItem · listHeldFor · releaseHeldFor · RELEASE_WORD
 * @usage const items = await listHeldFor(deps, caller); await releaseHeldFor(deps, caller, items[0].ref);
 * @version-history
 *   v1.0.0 — 2026-11-21 — Initial (wish-sis-ll-n-riskimerkinn-t-merkit-n-metadatalla-alkuper-ist-ei-).
 */
import type { Storage } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import type { CallerContext } from '../caller-context.js';
import { localAccountName } from '../../utils/gaii.js';
import { updateRecord, UNCHANGED } from '../record-cas.js';
import { workspaceRegistrations } from '../workspace/meta-read.js';
import { updateOwnRecord } from './classes.js';
import { allFacts, shardKeyOf } from './facts-store.js';
import { systemOwnerOf } from './shared-profile-key.js';
import { isApprover } from './risk-core.js';
import { listHeld, personRiskKey, workspaceRiskKey, type RiskHome } from './risk-store.js';
import type { RiskMarks, RiskKind } from './risk-types.js';
import { ContentError } from './pipeline.js';

type Deps = { storage: Storage; config: AimeatConfig };

/** The word that releases a held item. */
export const RELEASE_WORD = 'memory:write-reserved';

export interface HeldItem {
  ref: string;
  /** Where the item lives, in the words a person reads. */
  where: { kind: 'person' } | { kind: 'workspace'; organism_id: string; ws: string };
  /** The id the marks are kept under: `memory:<owner>:<key>`, `comment:<key>`, `dm:<id>` ... */
  subject_id: string;
  since: string;
  kinds: RiskKind[];
  marks: number;
  written_by?: string;
  point: RiskMarks['point'];
}

const isHeld = (m: RiskMarks | undefined): m is RiskMarks => !!m && m.hold?.status === 'held';
const toItem = (ref: string, where: HeldItem['where'], subjectId: string, m: RiskMarks): HeldItem => ({
  ref, where, subject_id: subjectId, since: m.hold!.since, kinds: [...new Set(m.marks.map((x) => x.kind))], marks: m.marks.length,
  ...(m.writtenBy ? { written_by: m.writtenBy } : {}), point: m.point,
});

/** Every held item the caller decides: their own, and every workspace's they are an approver for. */
export async function listHeldFor(deps: Deps, caller: CallerContext): Promise<HeldItem[]> {
  const out: HeldItem[] = [];
  const me = caller.ownerGhii;
  for (const f of await allFacts(deps.storage, me)) {
    if (isHeld(f.risk)) out.push(toItem(`p:${f.sourceId}`, { kind: 'person' }, f.sourceId, f.risk));
  }
  for (const h of await listHeld(deps.storage, me, personRiskKey)) out.push(toItem(`p:${h.id}`, { kind: 'person' }, h.id, h.marks));
  const name = localAccountName(me);
  const system = systemOwnerOf(deps.config.nodeId);
  for (const m of await deps.storage.listMembershipsByGhii(name)) {
    if (m.status !== 'active') continue;
    const manager = m.role === 'creator' || m.role === 'admin';
    for (const [ws, reg] of await workspaceRegistrations(deps.storage, m.organismId, { nodeId: deps.config.nodeId })) {
      if (!manager && reg.creator !== name) continue;
      for (const h of await listHeld(deps.storage, system, workspaceRiskKey(m.organismId, ws))) {
        out.push(toItem(`w:${m.organismId}:${ws}:${h.id}`, { kind: 'workspace', organism_id: m.organismId, ws }, h.id, h.marks));
      }
    }
  }
  return out.sort((a, b) => (a.since < b.since ? 1 : -1));
}

function parseRef(ref: unknown): { home: RiskHome | 'self'; id: string; org?: string; ws?: string } {
  if (typeof ref !== 'string' || ref.length > 2048) throw new ContentError('INVALID_INPUT', 400, 'ref names a held item, as aimeat_content_hold { action: "list" } gives it.');
  if (ref.startsWith('p:') && ref.length > 2) return { home: 'self', id: ref.slice(2) };
  const m = /^w:([^:.\s]+):([^:.\s]+):(.+)$/u.exec(ref);
  if (m) return { home: { kind: 'workspace', org: m[1], ws: m[2] }, id: m[3], org: m[1], ws: m[2] };
  throw new ContentError('INVALID_INPUT', 400, 'ref names a held item, as aimeat_content_hold { action: "list" } gives it: p:<id> or w:<organism>:<workspace>:<id>.');
}

/**
 * Release one held item. The caller must decide it (its owner, or an approver of its workspace) and hold
 * memory:write-reserved unless in person. Answers the item as it now stands.
 */
export async function releaseHeldFor(deps: Deps, caller: CallerContext, ref: unknown): Promise<{ ref: string; released: true; at: string }> {
  const r = parseRef(ref);
  const notFound = () => new ContentError('NOT_FOUND', 404, 'No held item of yours, or of a workspace you decide for, has that ref.');
  if (r.home !== 'self' && !(await isApprover(deps, r.home, caller.principal))) throw notFound();
  const at = new Date().toISOString();
  const release = (m: RiskMarks): RiskMarks => ({ ...m, hold: { ...m.hold!, status: 'released', decidedBy: caller.principal, decidedAt: at } });
  let found = false;
  if (r.home === 'self') {
    const me = caller.ownerGhii;
    if (/^(?:file|memory):/u.test(r.id)) {
      const writer = { principal: me, ownerGhii: me, scopes: [] as string[], roles: ['owner'] };
      await updateOwnRecord(deps, writer, shardKeyOf(r.id), (cur) => {
        const shard = { v: 1, items: { ...((cur as { items?: Record<string, { risk?: RiskMarks }> } | undefined)?.items ?? {}) } };
        const f = shard.items[r.id];
        if (!isHeld(f?.risk)) return UNCHANGED;
        found = true;
        shard.items[r.id] = { ...f, risk: release(f.risk) };
        return shard;
      });
    } else {
      await updateRecord(deps.storage, me, personRiskKey, (v) => ({ v: 1 as const, items: { ...((v as { items?: Record<string, RiskMarks> } | undefined)?.items ?? {}) } }), (cur) => {
        if (!isHeld(cur.items[r.id])) return UNCHANGED;
        found = true;
        cur.items[r.id] = release(cur.items[r.id]);
        return cur;
      }, { tag: 'contentrisk', visibility: 'private' });
    }
  } else {
    await updateRecord(deps.storage, systemOwnerOf(deps.config.nodeId), workspaceRiskKey(r.org!, r.ws!),
      (v) => ({ v: 1 as const, items: { ...((v as { items?: Record<string, RiskMarks> } | undefined)?.items ?? {}) } }), (cur) => {
        if (!isHeld(cur.items[r.id])) return UNCHANGED;
        found = true;
        cur.items[r.id] = release(cur.items[r.id]);
        return cur;
      }, { tag: 'contentrisk', visibility: 'private' });
  }
  if (!found) throw notFound();
  return { ref: String(ref), released: true, at };
}
