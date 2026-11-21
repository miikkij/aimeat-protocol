/**
 * @file src/services/content/risk-hold.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The decisions on content risk marks, for the people who make them: what is marked in
 *   what they decide, the acceptance of a marked item, its withdrawal, and the release of a hold
 *   (docs/internal/content-risk-plan.md, "Hold flow"; docs/internal/content-risk-accept-plan.md).
 *
 *   WHO DECIDES. A person's own items: that person. A workspace's items: the workspace's creator and the
 *   organism's creators and admins (risk-core.ts approversOf). The list reads the caller's own facts and
 *   risk record, and the risk record of every workspace they decide for, one read each.
 *
 *   ACCEPT. A person says a marked item is meant to be so (training or exercise material that instructs
 *   an AI, a runbook they wrote). The item's acceptance takes the fingerprints of its current marks, who
 *   and when; a hold on it is released. Its accepted marks are then listed as accepted, do not warn and do
 *   not make it prepare-only (risk-read.ts). The acceptance names phrases, so it outlives an edit and a
 *   new phrase is marked again. UNACCEPT takes it back. When an agent accepts, the people who decide are
 *   told, so every exception is visible. The operator can forbid acceptance (content_risk.accept deny).
 *
 *   RELEASE. The hold's flag turns to `released`, with who and when; the marks stay, and the content was
 *   never touched. A released hold stays released for the same hash (risk-core.ts).
 *
 *   THE WORD. Accept, unaccept and release need memory:write-reserved, or the account holder in person
 *   (service.ts checks it): an AI that read the marked text must not decide on that text's say, so the
 *   word is one a person grants on purpose, and an agent's refusal carries the address where they do.
 *
 *   A REF names an item: `p:<subject id>` for a person's item, `w:<org>:<ws>:<subject id>` for a
 *   workspace's. The list and the read answer (ContentRisk.ref) give it.
 * @structure RiskItem · listRiskItemsFor · acceptRiskFor · unacceptRiskFor · releaseHeldFor · DECIDE_WORD
 * @usage const items = await listRiskItemsFor(deps, caller, 'open'); await acceptRiskFor(deps, caller, items[0].ref);
 * @version-history
 *   v1.1.0 — 2026-11-21 — Every kept item, not only held ones (listRiskItemsFor with a status); accept and
 *     unaccept; an agent's acceptance tells the deciders; RELEASE_WORD became DECIDE_WORD
 *     (wish-riskimerkinn-t-oma-sis-lt-ei-merkitse-ja-ihminen-voi-hyv-ksy).
 *   v1.0.0 — 2026-11-21 — Initial (wish-sis-ll-n-riskimerkinn-t-merkit-n-metadatalla-alkuper-ist-ei-).
 */
import type { Storage } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import type { CallerContext } from '../caller-context.js';
import { localAccountName } from '../../utils/gaii.js';
import { logger } from '../../utils/logger.js';
import { notify } from '../notify.js';
import { updateRecord, UNCHANGED } from '../record-cas.js';
import { workspaceRegistrations } from '../workspace/meta-read.js';
import { updateOwnRecord } from './classes.js';
import { allFacts, shardKeyOf } from './facts-store.js';
import { systemOwnerOf } from './shared-profile-key.js';
import { isApprover, approversOf, openMarks } from './risk-core.js';
import { flushContentRisk } from './risk-intake.js';
import { listKept, personRiskKey, workspaceRiskKey, type RiskHome } from './risk-store.js';
import type { RiskMarks, RiskKind } from './risk-types.js';
import { ContentError } from './pipeline.js';

type Deps = { storage: Storage; config: AimeatConfig };

/** The word that accepts, unaccepts and releases. */
export const DECIDE_WORD = 'memory:write-reserved';

/** held: waits before other people's AIs get it. open: marks nobody accepted. accepted: every mark accepted. */
export type RiskItemStatus = 'held' | 'open' | 'accepted';

export interface RiskItem {
  ref: string;
  /** Where the item lives, in the words a person reads. */
  where: { kind: 'person' } | { kind: 'workspace'; organism_id: string; ws: string };
  /** The id the marks are kept under: `memory:<owner>:<key>`, `comment:<key>`, `dm:<id>` ... */
  subject_id: string;
  status: RiskItemStatus;
  /** The kinds of the marks nobody accepted. */
  kinds: RiskKind[];
  marks: number;
  accepted_marks: number;
  /** When it was marked; for a held item, when the hold began. */
  since: string;
  written_by?: string;
  point: RiskMarks['point'];
  accepted?: { by: string; at: string };
}

function statusOf(m: RiskMarks): RiskItemStatus {
  if (m.hold?.status === 'held') return 'held';
  return openMarks(m.marks, m.accepted).length ? 'open' : 'accepted';
}

const toItem = (ref: string, where: RiskItem['where'], subjectId: string, m: RiskMarks): RiskItem => {
  const open = openMarks(m.marks, m.accepted);
  return {
    ref, where, subject_id: subjectId, status: statusOf(m), kinds: [...new Set(open.map((x) => x.kind))],
    marks: m.marks.length, accepted_marks: m.marks.length - open.length,
    since: m.hold?.status === 'held' ? m.hold.since : m.at, point: m.point,
    ...(m.writtenBy ? { written_by: m.writtenBy } : {}),
    ...(m.accepted ? { accepted: { by: m.accepted.by, at: m.accepted.at } } : {}),
  };
};

const isKept = (m: RiskMarks | undefined): m is RiskMarks => !!m && Array.isArray(m.marks) && (m.marks.length > 0 || !!m.accepted);

/** Every kept item the caller decides, newest first; with `status`, only those. */
export async function listRiskItemsFor(deps: Deps, caller: CallerContext, status?: RiskItemStatus): Promise<RiskItem[]> {
  const out: RiskItem[] = [];
  const me = caller.ownerGhii;
  for (const f of await allFacts(deps.storage, me)) {
    if (isKept(f.risk)) out.push(toItem(`p:${f.sourceId}`, { kind: 'person' }, f.sourceId, f.risk));
  }
  for (const h of await listKept(deps.storage, me, personRiskKey)) out.push(toItem(`p:${h.id}`, { kind: 'person' }, h.id, h.marks));
  const name = localAccountName(me);
  const system = systemOwnerOf(deps.config.nodeId);
  for (const m of await deps.storage.listMembershipsByGhii(name)) {
    if (m.status !== 'active') continue;
    const manager = m.role === 'creator' || m.role === 'admin';
    for (const [ws, reg] of await workspaceRegistrations(deps.storage, m.organismId, { nodeId: deps.config.nodeId })) {
      if (!manager && reg.creator !== name) continue;
      for (const h of await listKept(deps.storage, system, workspaceRiskKey(m.organismId, ws))) {
        out.push(toItem(`w:${m.organismId}:${ws}:${h.id}`, { kind: 'workspace', organism_id: m.organismId, ws }, h.id, h.marks));
      }
    }
  }
  return out.filter((it) => !status || it.status === status).sort((a, b) => (a.since < b.since ? 1 : -1));
}

const REF_HINT = 'ref names a marked item, as aimeat_content_risk { action: "list" } or a read\'s content_risk.ref gives it: p:<id> or w:<organism>:<workspace>:<id>.';

function parseRef(ref: unknown): { home: RiskHome | 'self'; id: string; org?: string; ws?: string } {
  if (typeof ref !== 'string' || ref.length > 2048) throw new ContentError('INVALID_INPUT', 400, REF_HINT);
  if (ref.startsWith('p:') && ref.length > 2) return { home: 'self', id: ref.slice(2) };
  const m = /^w:([^:.\s]+):([^:.\s]+):(.+)$/u.exec(ref);
  if (m) return { home: { kind: 'workspace', org: m[1], ws: m[2] }, id: m[3], org: m[1], ws: m[2] };
  throw new ContentError('INVALID_INPUT', 400, REF_HINT);
}

/** What a decision does to an entry: the entry as it then stands, null to remove it, or UNCHANGED. */
type Change = (m: RiskMarks) => RiskMarks | null | typeof UNCHANGED;

/**
 * Apply one decision to the entry a ref names, on the version that was read. Answers the entry before
 * the change, or null when the caller decides no such entry.
 */
async function changeEntry(deps: Deps, caller: CallerContext, ref: unknown, change: Change): Promise<{ before: RiskMarks; home: RiskHome } | null> {
  const r = parseRef(ref);
  const home: RiskHome = r.home === 'self' ? { kind: 'person', owner: caller.ownerGhii } : r.home;
  if (r.home !== 'self' && !(await isApprover(deps, r.home, caller.principal))) return null;
  let before: RiskMarks | null = null;
  const onItems = (items: Record<string, RiskMarks>): typeof UNCHANGED | void => {
    const cur = items[r.id];
    if (!isKept(cur)) return UNCHANGED;
    const next = change(cur);
    if (next === UNCHANGED) { before = cur; return UNCHANGED; }
    before = cur;
    if (next) items[r.id] = next; else delete items[r.id];
  };
  const listRecord = (v: unknown) => ({ v: 1 as const, items: { ...((v as { items?: Record<string, RiskMarks> } | undefined)?.items ?? {}) } });
  if (r.home === 'self' && /^(?:file|memory):/u.test(r.id)) {
    const me = caller.ownerGhii;
    const writer = { principal: me, ownerGhii: me, scopes: [] as string[], roles: ['owner'] };
    await updateOwnRecord(deps, writer, shardKeyOf(r.id), (cur) => {
      const shard = { v: 1, items: { ...((cur as { items?: Record<string, { risk?: RiskMarks }> } | undefined)?.items ?? {}) } };
      const f = shard.items[r.id];
      const risk = f?.risk;
      if (!f || !isKept(risk)) return UNCHANGED;
      const next = change(risk);
      before = risk;
      if (next === UNCHANGED) return UNCHANGED;
      if (next) shard.items[r.id] = { ...f, risk: next };
      else { const rest = { ...f }; delete rest.risk; shard.items[r.id] = rest; }
      return shard;
    });
  } else {
    const owner = r.home === 'self' ? caller.ownerGhii : systemOwnerOf(deps.config.nodeId);
    const key = r.home === 'self' ? personRiskKey : workspaceRiskKey(r.org!, r.ws!);
    await updateRecord(deps.storage, owner, key, listRecord, (cur) => (onItems(cur.items) === UNCHANGED ? UNCHANGED : cur), { tag: 'contentrisk', visibility: 'private' });
  }
  return before ? { before, home } : null;
}

const notFound = (): ContentError => new ContentError('NOT_FOUND', 404, 'No marked item of yours, or of a workspace you decide for, has that ref.');

/** Tell the people who decide that an agent accepted marks: every exception is visible. */
async function tellAccepted(deps: Deps, home: RiskHome, ref: string, by: string, count: number): Promise<void> {
  const recipients = home.kind === 'person' ? [home.owner] : await approversOf(deps, home);
  const vars = { ref, by, count: String(count) };
  for (const r of recipients) {
    await notify(deps.storage, r, {
      type: 'content_risk_accepted', title: 'An AI accepted marked content',
      body: `${by} accepted ${count} mark(s) on ${ref}: an AI now uses that text normally. If you did not ask for this, ask your AI to take it back (unaccept).`,
      link: '/v1/profile?tab=dataWallet', i18n: { key: 'content_risk_accepted', vars },
    }).catch((err: unknown) => logger.warn('contentrisk: an acceptance notice was not sent', { recipient: r, error: String(err) }));
  }
}

/**
 * Accept every current mark of one item. A mark found on a read is kept off the request path, so a
 * ref given by a read that is not kept yet waits for that queue once. Answers how many marks are now
 * accepted.
 */
export async function acceptRiskFor(deps: Deps, caller: CallerContext, ref: unknown): Promise<{ ref: string; accepted: true; marks: number; at: string }> {
  if (deps.config.contentRiskAccept === 'deny') {
    throw new ContentError('ACCEPT_OFF', 403, 'This node does not let anyone accept marked content: its operator decided every mark stays (content_risk.accept deny). A workspace or a person can still switch kinds off in their risk settings.');
  }
  const at = new Date().toISOString();
  let count = 0;
  const change: Change = (m) => {
    const fps = new Set(m.accepted?.fps ?? []);
    for (const x of m.marks) if (x.fp) fps.add(x.fp);
    count = m.marks.filter((x) => x.fp && fps.has(x.fp)).length;
    const hold = m.hold?.status === 'held' ? { ...m.hold, status: 'released' as const, decidedBy: caller.principal, decidedAt: at } : m.hold;
    return { ...m, accepted: { fps: [...fps], by: caller.principal, at }, ...(hold ? { hold } : {}) };
  };
  let done = await changeEntry(deps, caller, ref, change);
  if (!done) { await flushContentRisk(); done = await changeEntry(deps, caller, ref, change); }
  if (!done) throw notFound();
  if (!caller.inPerson) await tellAccepted(deps, done.home, String(ref), caller.principal, count);
  return { ref: String(ref), accepted: true, marks: count, at };
}

/** Take back an item's acceptance: its marks warn again. An entry left with no marks is removed. */
export async function unacceptRiskFor(deps: Deps, caller: CallerContext, ref: unknown): Promise<{ ref: string; accepted: false; at: string }> {
  const at = new Date().toISOString();
  const done = await changeEntry(deps, caller, ref, (m) => {
    if (!m.accepted) return UNCHANGED;
    if (!m.marks.length) return null;
    const rest = { ...m };
    delete rest.accepted;
    return rest;
  });
  if (!done) throw notFound();
  return { ref: String(ref), accepted: false, at };
}

/** Release one held item. The caller must decide it (its owner, or an approver of its workspace). */
export async function releaseHeldFor(deps: Deps, caller: CallerContext, ref: unknown): Promise<{ ref: string; released: true; at: string }> {
  const at = new Date().toISOString();
  let held = false;
  const done = await changeEntry(deps, caller, ref, (m) => {
    if (m.hold?.status !== 'held') return UNCHANGED;
    held = true;
    return { ...m, hold: { ...m.hold, status: 'released', decidedBy: caller.principal, decidedAt: at } };
  });
  if (!done || !held) throw new ContentError('NOT_FOUND', 404, 'No held item of yours, or of a workspace you decide for, has that ref.');
  return { ref: String(ref), released: true, at };
}
