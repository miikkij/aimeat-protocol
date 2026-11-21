/**
 * @file src/services/content/risk-core.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The `risk` stage on one text: the rules in force for the item's home, the marks (rules,
 *   and a model when detect is rules+ai), what the point's behaviour then does, and the notice to the
 *   owner. Every point calls this: the intake and shared-write hooks (risk-intake.ts), the pipeline's
 *   `risk` stage on request (pipeline.ts), and the read helper for the rules on a read (risk-read.ts).
 *
 *   NOTHING IS CHANGED. The text is read and the marks are written beside it (risk-store.ts). A hold
 *   is a flag on the marks that the read helper obeys; the content stays where it is, as it is.
 *
 *   BEHAVIOUR. mark keeps the marks; mark+warn also tells the owner (the person, or the workspace's
 *   creator and the organism's admins); hold also flags outside content that is marked as held and tells
 *   the approvers. A hold on a write whose writer is an approver acts as mark+warn: an approver does not
 *   wait for themselves. A hold that was released for the same hash stays released.
 *
 *   NOTICES. Once per item and hash, and at most NOTICE_LIMIT per recipient per hour in this process;
 *   past that the recipient gets one notice saying more were marked, so a flood of marked writes cannot
 *   flood a person's notices.
 * @structure hashText · layersFor · resolveForHome · approversOf · isApprover · behaviourAt · markText
 * @usage const marks = await markText(deps, { subject, text, point: 'intake', writer });
 * @version-history
 *   v1.0.0 — 2026-11-21 — Initial (wish-sis-ll-n-riskimerkinn-t-merkit-n-metadatalla-alkuper-ist-ei-).
 */
import { createHash } from 'node:crypto';
import type { Storage } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import { ownerGhiiOf, localAccountName } from '../../utils/gaii.js';
import { logger } from '../../utils/logger.js';
import { notify } from '../notify.js';
import { systemReader } from '../classification/reader.js';
import { fileTarget, memoryTarget, ClassificationError } from '../classification/labels.js';
import { findWorkspaceRegistration } from '../workspace/meta-read.js';
import { readSettings } from './settings.js';
import { systemOwnerOf } from './shared-profile-key.js';
import { resolveRisk, lenientRiskLayer, type LayerIn } from './risk-settings.js';
import { detectRiskRules } from './risk-rules.js';
import { detectRiskModel } from './risk-model.js';
import { homeOf, getRiskMarks, putRiskMarks, subjectIdOf, type RiskHome, type RiskSubject } from './risk-store.js';
import type { ResolvedRisk, RiskBehaviour, RiskMarks, RiskPoint } from './risk-types.js';

type Deps = { storage: Storage; config: AimeatConfig };

/** "sha256:<hex>" of a text, the way the pipeline hashes a memory record's words. */
export function hashText(text: string): string {
  return `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;
}

/**
 * The organism's and the workspace's layers: the `risk` field of the records shared-profile-settings.ts
 * writes (read here directly, because that file imports pipeline.ts, which imports this one).
 */
async function sharedRiskLayers(deps: Deps, org: string, ws: string): Promise<{ organism: LayerIn['layer']; workspace: LayerIn['layer'] }> {
  const owner = systemOwnerOf(deps.config.nodeId);
  const [o, w] = await Promise.all([
    deps.storage.getMemory(owner, `organism.${org}.meta.contentclass`),
    deps.storage.getMemory(owner, `organism.${org}.w.${ws}.meta.contentclass`),
  ]);
  const layerOf = (v: unknown) => (v && typeof v === 'object' && (v as { v?: unknown }).v === 1 ? lenientRiskLayer((v as { risk?: unknown }).risk) : null);
  return { organism: layerOf(o?.value), workspace: layerOf(w?.value) };
}

/**
 * The layers for an item's home, in order; with `readerOwner` (a person other than the home's owner
 * whose AI reads), that person's layer last, for on_read alone.
 */
export async function layersFor(deps: Deps, home: RiskHome, readerOwner?: string): Promise<LayerIn[]> {
  const layers: LayerIn[] = [];
  if (home.kind === 'person') {
    layers.push({ level: 'person', layer: (await readSettings(deps.storage, home.owner)).risk ?? null });
  } else {
    const { organism, workspace } = await sharedRiskLayers(deps, home.org, home.ws);
    layers.push({ level: 'organism', layer: organism }, { level: 'workspace', layer: workspace });
  }
  if (readerOwner && !(home.kind === 'person' && home.owner === readerOwner)) {
    layers.push({ level: 'person', layer: (await readSettings(deps.storage, readerOwner)).risk ?? null, readOnly: true });
  }
  return layers;
}

/** What is in force for an item of this home (and, on a read, for this reader's AIs). */
export async function resolveForHome(deps: Deps, home: RiskHome, readerOwner?: string): Promise<ResolvedRisk> {
  if (deps.config.contentRiskMode === 'off') return resolveRisk(deps.config, [], { homeOwner: null });
  return resolveRisk(deps.config, await layersFor(deps, home, readerOwner), { homeOwner: home.kind === 'person' ? home.owner : null });
}

/** Who releases a held item: the person, or the workspace's creator and the organism's creators and admins. */
export async function approversOf(deps: Deps, home: RiskHome): Promise<string[]> {
  if (home.kind === 'person') return [home.owner];
  const out = new Set<string>();
  const reg = await findWorkspaceRegistration(deps.storage, home.org, home.ws, { nodeId: deps.config.nodeId });
  if (reg?.creator) out.add(`${reg.creator}@${deps.config.nodeId}`);
  for (const m of await deps.storage.listMembers(home.org, { status: 'active' })) {
    if (m.role === 'creator' || m.role === 'admin') out.add(m.ghii.includes('@') ? ownerGhiiOf(m.ghii) : `${m.ghii}@${deps.config.nodeId}`);
  }
  return [...out];
}

/** Whether this principal (or the person behind it) releases items of this home. */
export async function isApprover(deps: Deps, home: RiskHome, principal: string): Promise<boolean> {
  const owner = ownerGhiiOf(principal);
  if (home.kind === 'person') return owner === home.owner;
  const reg = await findWorkspaceRegistration(deps.storage, home.org, home.ws, { nodeId: deps.config.nodeId });
  if (reg?.creator && `${reg.creator}@${deps.config.nodeId}` === owner) return true;
  const m = await deps.storage.getMembership(home.org, localAccountName(owner));
  return !!m && m.status === 'active' && (m.role === 'creator' || m.role === 'admin');
}

/** The behaviour of a point. A request marks; a read is decided by the read helper. */
export function behaviourAt(r: ResolvedRisk, point: RiskPoint): RiskBehaviour {
  return point === 'intake' ? r.on_intake : point === 'shared-write' ? r.on_shared_write : point === 'read' ? r.on_read : 'mark';
}

const NOTICE_LIMIT = 20;
const HOUR = 3_600_000;
const noticeWindow = new Map<string, { since: number; sent: number; over: boolean }>();

/** Whether one more notice may go to this recipient now; the first one past the limit says so. */
function mayNotify(recipient: string): 'yes' | 'over' | 'no' {
  const now = Date.now();
  if (noticeWindow.size > 10_000) noticeWindow.clear();
  const w = noticeWindow.get(recipient);
  if (!w || now - w.since > HOUR) { noticeWindow.set(recipient, { since: now, sent: 1, over: false }); return 'yes'; }
  if (w.sent < NOTICE_LIMIT) { w.sent += 1; return 'yes'; }
  if (!w.over) { w.over = true; return 'over'; }
  return 'no';
}

/** Where a person finds the item, in words, for the notice. */
function placeOf(subject: RiskSubject): string {
  switch (subject.kind) {
    case 'memory': return subject.key;
    case 'file': return subject.key;
    case 'comment': return `a comment in workspace ${subject.ws}`;
    case 'row': return `a row of ${subject.space} in workspace ${subject.ws}`;
    case 'dm': return 'a message to you';
    case 'board': return `a post on board ${subject.boardId}`;
    case 'agent-message': return `a message to your agent ${subject.agent}`;
  }
}

async function tell(deps: Deps, recipients: string[], subject: RiskSubject, marks: RiskMarks, held: boolean): Promise<void> {
  const place = placeOf(subject);
  const kinds = [...new Set(marks.marks.map((m) => m.kind))].join(', ');
  for (const r of recipients) {
    const may = mayNotify(r);
    if (may === 'no') continue;
    const over = may === 'over';
    const key = over ? 'content_risk_many' : held ? 'content_risk_held' : 'content_risk_marked';
    const vars = { place, kinds, count: String(marks.marks.length), subject: subjectIdOf(subject) };
    const title = over ? 'More content was marked for possible risks'
      : held ? `Marked content waits for you: ${place}` : `Content marked for possible risks: ${place}`;
    const body = over ? 'More items were marked in the last hour than this notice list shows. Ask your AI for the held items with aimeat_content_hold.'
      : held ? `It has ${marks.marks.length} mark(s): ${kinds}. Other people's AIs get the marks but not the content until you release it. Nothing was changed. Your AI releases it with aimeat_content_hold, action release, when you say so.`
        : `It has ${marks.marks.length} mark(s): ${kinds}. Nothing was changed. An AI that reads it gets the marks and a warning.`;
    await notify(deps.storage, r, { type: key, title, body, link: '/v1/profile?tab=dataWallet', i18n: { key, vars } })
      .catch((err: unknown) => logger.warn('contentrisk: a notice was not sent', { recipient: r, error: String(err) }));
  }
}

export interface MarkInput {
  subject: RiskSubject;
  text: string;
  /** The hash the marks belong to; absent: the hash of the text. */
  hash?: string;
  point: RiskPoint;
  /** Who wrote the content, for a shared write. */
  writer?: string;
  /** For a facts entry written for marks alone. */
  measure?: { mimeType: string; size: number };
  /** The rules in force, when the caller already resolved them. */
  resolved?: ResolvedRisk;
  /** When the content itself expires (a board post). */
  expiresAt?: string;
}

/** Whether a model may read this item, by the sensitivity classification (memory records and files have labels). */
async function modelMayRead(deps: Deps, subject: RiskSubject, payer: string): Promise<string | null> {
  if (subject.kind !== 'memory' && subject.kind !== 'file') return null;
  const target = subject.kind === 'file' ? fileTarget(subject.owner, subject.key) : memoryTarget(subject.owner, subject.key);
  try {
    await systemReader(deps, payer).useForAi([target], { capability: 'contentrisk' });
    return null;
  } catch (err) {
    if (err instanceof ClassificationError) return `${err.code}: ${err.message}`;
    throw err;
  }
}

/**
 * Mark one text at a point: find the marks, keep them beside the item, and do what the point's
 * behaviour says. Answers the marks kept, or null when the point is off or nothing was found (and
 * removes earlier marks of the item then, since they no longer describe it).
 */
export async function markText(deps: Deps, input: MarkInput): Promise<RiskMarks | null> {
  if (deps.config.contentRiskMode === 'off') return null;
  const home = homeOf(input.subject);
  const r = input.resolved ?? await resolveForHome(deps, home);
  const behaviour = behaviourAt(r, input.point);
  if (behaviour === 'off' || !r.kinds.length) return null;
  const hash = input.hash ?? hashText(input.text);
  const found = detectRiskRules(input.text, r.kinds);
  const marks = [...found.marks];
  let model: string | undefined;
  let modelSkipped: string | undefined;
  if (r.detect === 'rules+ai') {
    if (!r.aiPayer) modelSkipped = 'Nobody chose to pay for the model at the layer rules+ai came from.';
    else {
      modelSkipped = (await modelMayRead(deps, input.subject, r.aiPayer)) ?? undefined;
      if (!modelSkipped) {
        try {
          const m = await detectRiskModel(deps, r.aiPayer, input.text, r.kinds);
          model = m.model || undefined;
          for (const mm of m.marks) if (!marks.some((x) => x.kind === mm.kind && x.start === mm.start && x.end === mm.end)) marks.push(mm);
        } catch (err) {
          const e = err as { code?: unknown; message?: unknown };
          modelSkipped = `${e.code ? `${String(e.code)}: ` : ''}${String(e.message ?? err)}`.slice(0, 300);
        }
      }
    }
  }
  marks.sort((a, b) => a.start - b.start || a.end - b.end);
  const before = await getRiskMarks(deps, input.subject);
  if (!marks.length) {
    if (before) await putRiskMarks(deps, input.subject, null);
    return null;
  }
  const now = new Date().toISOString();
  const sameContent = before?.contentHash === hash;
  // Content from outside has no writer here: it is never an approver's own write.
  const writerIsApprover = input.writer ? await isApprover(deps, home, input.writer) : false;
  const holdNow = behaviour === 'hold' && (input.point === 'intake' || input.point === 'shared-write') && !writerIsApprover;
  const hold = sameContent && before?.hold ? before.hold : holdNow ? { status: 'held' as const, since: now } : undefined;
  const kept: RiskMarks = {
    v: 1, contentHash: hash, detect: r.detect, point: input.point, at: now, marks, kinds: r.kinds,
    ...(found.truncatedAt ? { truncatedAt: found.truncatedAt } : {}),
    ...(model ? { model } : {}), ...(modelSkipped ? { modelSkipped } : {}),
    ...(hold ? { hold } : {}), ...(input.writer ? { writtenBy: input.writer } : {}),
    ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
  };
  await putRiskMarks(deps, input.subject, kept, input.measure);
  const told = sameContent && (before?.marks.length ?? 0) > 0;
  if (!told && (behaviour === 'mark+warn' || behaviour === 'hold')) {
    const held = kept.hold?.status === 'held';
    await tell(deps, held ? await approversOf(deps, home) : home.kind === 'person' ? [home.owner] : await approversOf(deps, home), input.subject, kept, held);
  }
  return kept;
}
