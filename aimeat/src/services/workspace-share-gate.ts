/**
 * @file src/services/workspace-share-gate.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The publish gate in front of a workspace share (plan doc-mvcn6c7e4e5q, V4). A share
 *   with access `open` serves what it shares to anyone who has the link, signed in or not; a password,
 *   an account or the organism narrow it. So a change is a move to public when, after it, someone with
 *   only the link reads a target (the workspace, a space or a page) they could not read before: the
 *   access set to `open` over what is shared, or a target shared while the access is `open`, which is
 *   the default of a workspace that has never been shared.
 *
 *   On an ask the rest of the change applies and the opening part is held back: the access keeps the
 *   level it had, or the newly opened targets stay as they were. The request carries the held-back
 *   part as `change.to`, and the applier (apply-workspace-share.ts) hands exactly that body to
 *   setWorkspaceShareOp as the owner.
 * @structure ShareTarget · openTargets · newlyOpened · withholdOpening · fileShareAsk · shareCapRefusal
 * @usage
 *   const opened = newlyOpened(prev, next);
 *   if (opened.length && ask) { const held = withholdOpening(prev, next, opened, untilIn); ... }
 * @version-history
 *   v1.1.0 — 2026-10-18 — shareCapRefusal(): the workspace's label and each newly shared page's label
 *     cap the share's level (plan doc-mvdipuyqraas, L3.5).
 *   v1.0.0 — 2026-10-18 — Initial (plan doc-mvcn6c7e4e5q, V4).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { ResolvedShare } from '../routes/organisms/share-types.js';
import type { PublishAsk } from './publish-requests/ask.js';
import { fileAskForDoor, type DoorAsk, type PublishGateInput } from './publish-requests/door.js';
import { readWorkspaceMetaRecord } from './workspace-meta-read.js';
import { audienceCapOf, audienceOfShareAccess, capRefusalOf, type CapOptions } from './classification/audience-cap.js';
import { workspaceTarget } from './classification/containers.js';
import { memoryTarget } from './classification/label-rows.js';

/** A target as `until` names it: `*` (the workspace), `space:<name>`, or `<space>/<id>` (a page). */
type ShareTarget = string;

/** The targets anyone with the link reads under this share: none unless its access is `open`. */
export function openTargets(share: Pick<ResolvedShare, 'access' | 'public' | 'spaces' | 'docs'>): Set<ShareTarget> {
  const out = new Set<ShareTarget>();
  if (share.access !== 'open') return out;
  if (share.public) out.add('*');
  for (const [k, v] of Object.entries(share.spaces)) if (v) out.add(`space:${k}`);
  for (const [k, v] of Object.entries(share.docs)) if (v) out.add(k);
  return out;
}

/** The targets this change opens to anyone with the link that were not open to them before. */
export function newlyOpened(prev: ResolvedShare, next: ResolvedShare): ShareTarget[] {
  const before = openTargets(prev);
  return [...openTargets(next)].filter(t => !before.has(t));
}

/**
 * Hold the opening part of a change back, in place on `next`, and answer the body that applies it
 * later. Access raised to `open`: the access keeps its level, and every target the call shared stays
 * shared under it. Access already `open`: each newly opened target keeps the value it had, and its end
 * date goes unless the share had one before. `untilIn` is what the call named for an end date; the
 * body carries those, and the HTML page default is decided again when it is applied.
 */
export function withholdOpening(
  prev: ResolvedShare, next: ResolvedShare, opened: ShareTarget[], untilIn: Record<string, string | null>,
): Record<string, unknown> {
  if (prev.access !== 'open' && next.access === 'open') {
    next.access = prev.access;
    return { access: 'open' };
  }
  const body: { public?: boolean; spaces?: Record<string, boolean>; docs?: Record<string, boolean>; until?: Record<string, string> } = {};
  for (const t of opened) {
    if (t === '*') { next.public = prev.public; body.public = true; }
    else if (t.startsWith('space:')) {
      const k = t.slice('space:'.length);
      if (k in prev.spaces) next.spaces[k] = prev.spaces[k]; else delete next.spaces[k];
      (body.spaces ??= {})[k] = true;
    } else {
      if (t in prev.docs) next.docs[t] = prev.docs[t]; else delete next.docs[t];
      (body.docs ??= {})[t] = true;
    }
    if (prev.until[t]) next.until[t] = prev.until[t]; else delete next.until[t];
    if (typeof untilIn[t] === 'string') (body.until ??= {})[t] = untilIn[t] as string;
  }
  return body;
}

/** File the request once the share is stored with the opening held back. */
export function fileShareAsk(
  ctx: { storage: Storage; config: AimeatConfig }, gate: PublishGateInput, ask: Extract<PublishAsk, { kind: 'ask' }>,
  where: { orgId: string; ws: string; wsName: string; version: number; from: string; opened: ShareTarget[] },
  body: Record<string, unknown>,
): Promise<DoorAsk> {
  // One page: "the page notes/intro in the workspace Handbook"; otherwise the workspace.
  const page = where.opened.length === 1 && !where.opened[0].startsWith('space:') && where.opened[0] !== '*' ? where.opened[0] : null;
  const title = page ? `the page ${page} in the workspace ${where.wsName}` : `the workspace ${where.wsName}`;
  return fileAskForDoor(ctx, gate, ask.requester, {
    kind: 'workspace-share',
    // The share record's version: a share changed since makes the approval outdated.
    target: { organism_id: where.orgId, ws: where.ws, version: where.version },
    title, name: page ?? where.wsName,
    change: { field: 'share', from: where.from, to: body },
  }, 'it was');
}

/** Does this share hand anything out: the workspace, a space or a page? */
function sharesAny(share: Pick<ResolvedShare, 'public' | 'spaces' | 'docs'>): boolean {
  return share.public || Object.values(share.spaces).some(Boolean) || Object.values(share.docs).some(Boolean);
}

/**
 * The labels' audience cap on a share (plan doc-mvdipuyqraas, L3.5): null when `next` may be stored,
 * or the 409 to answer. Two things are held to it: the workspace itself, whose effective label (its
 * own, raised to its organism's) caps the level the share opens it at; and each page this call shares
 * that was not handed out before, held to its own effective label. Asked before the publish gate and
 * before the share is stored. `wasStored` is false for a workspace never shared, which counts as
 * private before. A whole space shared at once is held to the workspace's label only: its pages are
 * not read one by one.
 */
export async function shareCapRefusal(
  ctx: { storage: Storage; config: AimeatConfig }, orgId: string, ws: string,
  prev: ResolvedShare, next: ResolvedShare, wasStored: boolean, by: CapOptions['by'],
): Promise<{ ok: false; status: 409; code: string; message: string } | null> {
  const to = audienceOfShareAccess(next.access);
  if (!sharesAny(next) || to === 'private') return null;
  const before = wasStored && sharesAny(prev) ? audienceOfShareAccess(prev.access) : null;
  const whole = capRefusalOf(await audienceCapOf(ctx, workspaceTarget(orgId, ws), to, { from: before, by, where: 'workspace share' }));
  if (whole) return whole;
  const pages = Object.entries(next.docs).filter(([k, v]) => v && prev.docs[k] !== true).map(([k]) => k);
  if (!pages.length) return null;
  const manifest = (await readWorkspaceMetaRecord(ctx.storage, orgId, ws, 'meta.manifest', ctx.config.nodeId))?.value as
    { objectTypes?: Array<{ name?: unknown; namespace?: unknown }> } | undefined;
  for (const page of pages) {
    const [space, id] = page.split('/');
    const ns = (manifest?.objectTypes ?? []).find(o => o && o.name === space)?.namespace;
    if (typeof ns !== 'string' || !space || !id) continue;
    // A page already handed out with its whole space or the workspace was at the old level.
    const from = wasStored && (prev.public || prev.spaces[space] === true) ? audienceOfShareAccess(prev.access) : null;
    const target = memoryTarget(`organism:${orgId}`, `organism.${orgId}.w.${ws}.${ns}.${id}`);
    const refused = capRefusalOf(await audienceCapOf(ctx, target, to, { from, by, where: 'workspace share' }));
    if (refused) return refused;
  }
  return null;
}
