/**
 * @file src/services/classification/audience-settle.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description When a label rises, content already shown wider than the new label's audience cap is
 *   lowered to the cap at once, and its owner is told (plan doc-mvdipuyqraas, L3.4; decision 10.2).
 *
 *   WHEN. setLabel (labels.ts) tells the label-raise listener (label-core.ts onLabelRaised) of every
 *   applied raise: a person's, a rule's or the node's classifier's. registerAudienceSettle() is that
 *   listener, registered once at boot. A raise on content settles that content; a raise on a container
 *   settles the container's own level and the content inside it, each held to its own EFFECTIVE label
 *   (effective.ts), so content with a cap of its own stricter than its container's is held to that.
 *   Nothing here runs for a policy change: content over a cap when a cap is first set is reported, not
 *   changed (decision 10.3; plan step L4).
 *
 *   WHAT IS LOWERED, and to what (the widest level the kind has within the cap):
 *     a memory record, a stored file   members for link or signed-in; organism:<id> for organism in an
 *                                      organism's content; private otherwise
 *     a board                          private
 *     an organism                      private, and its member list to signed-in accounts
 *     an app                           unlisted (link), open to signed-in accounts (signed-in), or an
 *                                      access code (organism, private), as its settings would
 *     a workspace share                access account (link, signed-in) or organism; no share (private)
 *   Inside a container: an organism's and a workspace's memory records (their key prefix, every holder)
 *   and the shares of its workspaces; an app's records and stored files in its own namespace
 *   (containers.ts, AN APP'S DATA). A board's posts have no level of their own. A row has no level of
 *   its own.
 *
 *   THE OWNER'S EXCEPTION. An item with an 'audience' exception in force that still covers its label
 *   (audience-cap.ts) keeps its level.
 *
 *   WHAT IS IN THE BIN IS NOT SETTLED, AND IS CAPPED ON THE WAY OUT. Everything read here
 *   (getMemory, listAllMemoryMeta, listApps, the share and organism reads) skips a deleted row by
 *   design, so a record binned at the moment of a raise keeps the level it went in with. Nothing
 *   reads it there, so its level shows nobody anything; what matters is the level it comes back at,
 *   and services/memory-bin.ts restoreMemoryRecord asks the cap before it clears the tombstone
 *   (secaudit 2026-10). Lowering binned rows here as well would write the level of content no reader
 *   can reach and would have to be undone by the same check anyway.
 *
 *   WHAT IS TOLD. Each lowering writes an audit row (action changed, purpose `audience <from> → <to>`),
 *   and each owner gets one notification per raise naming what was lowered (notify.ts, the bell and
 *   the push). Every step is best effort past the raise itself: a failure is logged and the next item
 *   is tried, because the label is already stored.
 * @structure LoweredItem · settleAudienceAfterRise() · registerAudienceSettle()
 * @usage registerAudienceSettle(storage, config);   // once, at boot (server-bootstrap/routes-loader.ts)
 * @version-history
 *   v1.2.1 — 2026-10-20 — Says where a binned record is held to the cap: on the restore, not here
 *     (services/memory-bin.ts restoreLevel; secaudit 2026-10). No behaviour change.
 *   v1.2.0 — 2026-10-18 — A memory record is lowered on the version that was read (setMemoryIfVersion,
 *     re-read on a conflict), so an owner's write at the same moment is kept; the lowering now bumps
 *     the record's version like any other write (atomic-write round).
 *   v1.1.0 — 2026-10-18 — A rise on an app lowers the stored files in the app's own namespace too, with
 *     the same audit row and the same one notification (plan doc-mvdipuyqraas, L3 gap closed in L5).
 *   v1.0.0 — 2026-10-18 — Initial (plan doc-mvdipuyqraas, L3.4).
 */
import type { Storage, ContentLabelTarget, MemoryRecord, StorageFileRecord, BoardRecord } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import { appSlug, ownerGhiiOf } from '../../utils/gaii.js';
import { logger } from '../../utils/logger.js';
import { emitChange } from '../event-bus.js';
import { notify } from '../notify.js';
import { CAS_ATTEMPTS } from '../record-cas.js';
import { updateOrganismRecord } from '../organism-lifecycle.js';
import { applyOwnerSettingsUpdate, type AppSettingsInput } from '../app-settings.js';
import { generateAccessCode } from '../app-publish-exposure.js';
import { appAudienceOf } from '../app-publish-gate.js';
import { readShareMetaOf, setWorkspaceShareOp, type SetShareBody } from '../workspace-share.js';
import { findWorkspaceRegistration, workspaceRegistrations } from '../workspace-meta-read.js';
import { labelById, type ClassificationLabel } from './defaults.js';
import { effectiveLabels } from './effective.js';
import { activeExceptionsFor } from './exceptions.js';
import { onLabelRaised, type LabelRaise } from './label-core.js';
import { documentContentKeys, memoryTarget, targetId } from './label-rows.js';
import { fileTarget } from './labels.js';
import { appTarget, boardTarget, organismTarget, workspaceTarget } from './containers.js';
import { classificationActiveFor, policyFor, scopeOrganism } from './policy.js';
import { recordClassificationAudit } from './audit.js';
import { audienceOfOrganism, audienceOfShareAccess, audienceOfVisibility } from './audience-cap.js';
import { AUDIENCE_LEVEL_WORDS, capAllows, storedLevel, type AudienceLevel } from './audience-levels.js';

type Ctx = { storage: Storage; config: AimeatConfig };

/** One thing whose level may be over its cap: its label address, its level, and how to lower it. */
interface Candidate {
  target: ContentLabelTarget;
  level: AudienceLevel;
  /** What a person recognises it by: a key, a filename, a name. */
  name: string;
  /** The person told: a GHII. */
  owner: string;
  /** Lower it to within `cap`; the level it has after, or null when it could not be lowered. */
  lower(cap: AudienceLevel): Promise<AudienceLevel | null>;
}

/** What was lowered, for the audit, the notification and a test. */
export interface LoweredItem {
  target: ContentLabelTarget;
  name: string;
  owner: string;
  label: string;
  from: AudienceLevel;
  to: AudienceLevel;
}

/** The widest memory or file visibility within a cap: members, the organism, or private. */
function visibilityWithin(cap: AudienceLevel, orgId: string | null): MemoryRecord['visibility'] {
  if (cap === 'link' || cap === 'signed-in') return 'members';
  if (cap === 'organism' && orgId) return `organism:${orgId}` as MemoryRecord['visibility'];
  return 'private';
}

function memoryCandidate(ctx: Ctx, rec: Pick<MemoryRecord, 'ownerGaii' | 'key' | 'visibility'>): Candidate | null {
  const level = audienceOfVisibility(rec.visibility);
  if (level === 'private') return null;
  const target = memoryTarget(rec.ownerGaii, rec.key);
  return {
    target, level, name: rec.key, owner: ownerGhiiOf(rec.ownerGaii),
    async lower(cap) {
      const visibility = visibilityWithin(cap, scopeOrganism(target.scope));
      // Only the level changes: the bytes and their provenance stay as they are. Written on the
      // version that was read, so an owner's write between the read and the write is lowered on a
      // fresh read rather than written over.
      for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
        const full = await ctx.storage.getMemory(rec.ownerGaii, rec.key);
        if (!full) return null;
        const next = { ...full, key: rec.key, visibility, groupId: undefined, workspaceRef: undefined, version: full.version + 1, updatedAt: new Date().toISOString() };
        if (ctx.storage.setMemoryIfVersion ? !(await ctx.storage.setMemoryIfVersion(next, full.version)) : !(await ctx.storage.setMemory(next))) continue;
        emitChange('memory', ownerGhiiOf(rec.ownerGaii));
        return audienceOfVisibility(visibility);
      }
      throw new Error(`${rec.ownerGaii} ${rec.key} changed under every one of ${CAS_ATTEMPTS} attempts; try again`);
    },
  };
}

function fileCandidate(ctx: Ctx, holder: string, file: Pick<StorageFileRecord, 'key' | 'visibility' | 'workspaceRef'>): Candidate | null {
  const level = audienceOfVisibility(file.visibility);
  if (level === 'private') return null;
  const target = fileTarget(holder, file.key, file.workspaceRef);
  return {
    target, level, name: file.key, owner: ownerGhiiOf(holder),
    async lower(cap) {
      const visibility = visibilityWithin(cap, scopeOrganism(target.scope)) as StorageFileRecord['visibility'];
      if (!(await ctx.storage.updateFileVisibility(holder, file.key, visibility))) return null;
      emitChange('memory', ownerGhiiOf(holder));
      return audienceOfVisibility(visibility);
    },
  };
}

function boardCandidate(ctx: Ctx, board: BoardRecord): Candidate | null {
  const level = audienceOfVisibility(board.visibility);
  if (level === 'private') return null;
  return {
    target: boardTarget(board), level, name: board.name, owner: ownerGhiiOf(board.ownerGaii),
    async lower() {
      if (!(await ctx.storage.updateBoardVisibility(board.id, 'private'))) return null;
      emitChange('boards');
      return 'private';
    },
  };
}

/** The app settings body that brings an app within a cap. */
function appBodyWithin(cap: AudienceLevel): AppSettingsInput {
  if (cap === 'link') return { listing: 'unlisted' };
  if (cap === 'signed-in') return { open_to: 'signed-in' };
  return { access_code: generateAccessCode() };
}

/** The share body that brings a share within a cap. */
function shareBodyWithin(cap: AudienceLevel, share: { spaces: Record<string, boolean>; docs: Record<string, boolean> }): SetShareBody {
  if (cap === 'link' || cap === 'signed-in') return { access: 'account' };
  if (cap === 'organism') return { access: 'organism' };
  const off = (m: Record<string, boolean>) => Object.fromEntries(Object.keys(m).map(k => [k, false]));
  return { public: false, spaces: off(share.spaces), docs: off(share.docs) };
}

async function shareCandidate(ctx: Ctx, orgId: string, ws: string): Promise<Candidate | null> {
  const share = await readShareMetaOf(ctx.storage, ctx.config, orgId, ws);
  const shared = share.public || Object.values(share.spaces).some(Boolean) || Object.values(share.docs).some(Boolean);
  const level = shared ? audienceOfShareAccess(share.access) : 'private';
  if (level === 'private') return null;
  const reg = await findWorkspaceRegistration(ctx.storage, orgId, ws);
  const organism = await ctx.storage.getOrganism(orgId);
  const manager = reg?.creator ?? organism?.createdBy ?? organism?.creatorGhii;
  if (!manager) return null;
  return {
    target: workspaceTarget(orgId, ws), level, name: reg?.entry.name ?? ws,
    owner: `${manager}@${ctx.config.nodeId}`,
    async lower(cap) {
      const out = await setWorkspaceShareOp(ctx, { sub: `${manager}@${ctx.config.nodeId}`, owner: manager }, { orgId, ws, body: shareBodyWithin(cap, share) });
      if (!out.ok) { logger.warn('audience cap: a share could not be lowered', { orgId, ws, code: out.code }); return null; }
      return audienceOfShareAccess((await readShareMetaOf(ctx.storage, ctx.config, orgId, ws)).access);
    },
  };
}

/** Every memory record under a key prefix, any holder, at a level wider than private. */
async function memoryUnder(ctx: Ctx, prefix: string): Promise<Candidate[]> {
  const out: Candidate[] = [];
  for (let offset = 0; offset < 20_000; offset += 1000) {
    const { items } = await ctx.storage.listAllMemoryMeta({ prefix, limit: 1000, offset, excludeVersionRows: true });
    for (const row of items) {
      const c = memoryCandidate(ctx, row);
      if (c) out.push(c);
    }
    if (items.length < 1000) break;
  }
  return out;
}

/** What a raise on `t` may have put over a cap: the item itself, and for a container what it holds. */
async function candidatesOf(ctx: Ctx, t: ContentLabelTarget): Promise<Candidate[]> {
  const { storage, config } = ctx;
  const one = (c: Candidate | null) => (c ? [c] : []);
  switch (t.kind) {
    case 'memory': {
      const org = scopeOrganism(t.scope);
      if (!org) { const rec = await storage.getMemory(t.scope, t.key); return rec ? one(memoryCandidate(ctx, rec)) : []; }
      // An organism's document: every copy of it, whoever holds it.
      const keys = [...new Set([t.key, ...documentContentKeys(t.key)])];
      const recs = storage.getMemoryByKeysAnyOwner ? await storage.getMemoryByKeysAnyOwner(keys) : [];
      return recs.flatMap(r => one(memoryCandidate(ctx, r)));
    }
    case 'file': {
      const m = /^organism\.[^.]+\.w\.[^.]+\.files\.(.+?)\/(.+)$/.exec(t.key);
      const holder = m ? m[1]! : t.scope;
      const key = m ? m[2]! : t.key;
      const file = await storage.getStorageFileMeta(holder, key);
      return file ? one(fileCandidate(ctx, holder, file)) : [];
    }
    case 'board': {
      if (t.key.includes('/')) return [];
      const board = await storage.getBoard(t.key);
      return board ? one(boardCandidate(ctx, board)) : [];
    }
    case 'app': {
      const { apps } = await storage.listApps({ ownerGaii: t.scope, viewerGhii: t.scope, limit: 1000 });
      const seen = new Set<string>();
      const out: Candidate[] = [];
      for (const app of apps) {
        if (appSlug(app.filename) !== t.key || seen.has(app.filename)) continue;
        seen.add(app.filename);
        const level = appAudienceOf(app);
        if (level === 'private') continue;
        out.push({
          target: appTarget(app.ownerGaii, app.filename), level, name: app.filename, owner: ownerGhiiOf(app.ownerGaii),
          async lower(cap) {
            const res = await applyOwnerSettingsUpdate(storage, config, { ownerGaii: app.ownerGaii, ownerName: app.ownerName, filename: app.filename, callerGaii: app.ownerGaii }, appBodyWithin(cap));
            if ('refusal' in res) return null;
            const after = await storage.getApp(app.ownerGaii, app.filename);
            return after ? appAudienceOf(after) : null;
          },
        });
      }
      // What the app keeps in its own namespace (containers.ts, AN APP'S DATA): its memory records and
      // its stored files, each lowered as content of its own is.
      const ns = `eco:${t.key}#${t.scope}`;
      const meta = await storage.listMemoryMeta(ns);
      const files = await storage.listStorageFiles(ns);
      return [...out, ...meta.flatMap(r => one(memoryCandidate(ctx, r))), ...files.flatMap(f => one(fileCandidate(ctx, ns, f)))];
    }
    case 'workspace': {
      const org = scopeOrganism(t.scope)!;
      return [...one(await shareCandidate(ctx, org, t.key)), ...await memoryUnder(ctx, `organism.${org}.w.${t.key}.`)];
    }
    case 'organism': {
      const organism = await storage.getOrganism(t.key);
      if (!organism) return [];
      const out: Candidate[] = [];
      const level = organism.memberVisibility === 'public' ? 'public' : audienceOfOrganism(organism.visibility);
      if (level !== 'private') {
        out.push({
          target: organismTarget(organism.id), level, name: organism.name,
          owner: `${organism.createdBy ?? organism.creatorGhii}@${config.nodeId}`,
          async lower(cap) {
            const res = await updateOrganismRecord(ctx, organism, {
              ...(audienceOfOrganism(organism.visibility) !== 'private' ? { visibility: 'private' } : {}),
              ...(organism.memberVisibility === 'public' ? { memberVisibility: cap === 'private' ? 'members' : 'authenticated' } : {}),
              callerIsPerson: true,
            });
            return res.ok ? (cap === 'private' ? 'private' : 'signed-in') : null;
          },
        });
      }
      for (const ws of (await workspaceRegistrations(storage, organism.id)).keys()) out.push(...one(await shareCandidate(ctx, organism.id, ws)));
      return [...out, ...await memoryUnder(ctx, `organism.${organism.id}.`)];
    }
    default:
      return [];
  }
}

/** Tell each owner what was lowered, once per raise. */
async function tellOwners(storage: Storage, lowered: LoweredItem[], label: ClassificationLabel): Promise<void> {
  const byOwner = new Map<string, LoweredItem[]>();
  for (const l of lowered) byOwner.set(l.owner, [...(byOwner.get(l.owner) ?? []), l]);
  for (const [owner, items] of byOwner) {
    const one = items.length === 1;
    // The English is the fallback and what a push carries; the page says it from the i18n key.
    await notify(storage, owner, {
      type: 'classification_audience_lowered',
      title: one ? `Fewer people can see ${items[0]!.name} now` : `Fewer people can see ${items.length} of your items now`,
      body: `${one ? 'Its' : 'Their'} classification ${label.name.en} lets ${AUDIENCE_LEVEL_WORDS[label.maxAudience!]} see ${one ? 'it' : 'them'} at most, so we narrowed who sees ${one ? 'it' : 'them'}. `
        + 'To show it more widely, make an exception with a written reason in your Data Wallet, then change who sees it.',
      link: '/v1/profile?tab=exposure',
      i18n: { key: one ? 'audience_lowered' : 'audience_lowered_many', vars: { what: items[0]!.name, label: label.name.en, count: items.length } },
    });
    emitChange('notifications', owner);
  }
}

/**
 * After a raise on `raise.target`: every candidate whose effective label's cap no longer admits its
 * level, and which no 'audience' exception covers, is lowered to the cap. Answers what was lowered.
 */
export async function settleAudienceAfterRise(ctx: Ctx, raise: LabelRaise): Promise<LoweredItem[]> {
  const { storage, config } = ctx;
  if (config.classificationMode === 'off' || !(await classificationActiveFor(storage, config, raise.target.scope))) return [];
  // No label of this scope has a cap: nothing can be over one, and nothing is read.
  if (!(await policyFor(storage, config, raise.target.scope)).labels.some(l => l.maxAudience)) return [];
  const candidates = await candidatesOf(ctx, raise.target);
  const byScope = new Map<string, Candidate[]>();
  for (const c of candidates) byScope.set(c.target.scope, [...(byScope.get(c.target.scope) ?? []), c]);
  const lowered: LoweredItem[] = [];
  let told: ClassificationLabel | null = null;
  for (const [scope, list] of byScope) {
    const policy = await policyFor(storage, config, scope);
    const eff = await effectiveLabels(storage, policy, list.map(c => c.target));
    const excepted = await activeExceptionsFor({ storage, config }, scope, list.map(c => c.target));
    const rankOf = (id: string) => labelById(policy, id)?.rank ?? -1;
    for (const c of list) {
      const label = labelById(policy, eff.get(targetId(c.target))?.label ?? policy.defaultLabel);
      const cap = label?.maxAudience;
      if (!label || !cap || capAllows(cap, storedLevel(config, c.level))) continue;
      const covered = (excepted.get(`${c.target.kind}\u0000${c.target.key}`) ?? [])
        .some(e => e.action === 'audience' && (!e.label || rankOf(e.label) >= label.rank));
      if (covered) continue;
      try {
        const to = await c.lower(cap);
        if (!to) continue;
        lowered.push({ target: c.target, name: c.name, owner: c.owner, label: label.id, from: c.level, to });
        told ??= label;
        recordClassificationAudit({
          scope: c.target.scope, ownerGaii: c.owner, kind: c.target.kind, key: c.target.key, label: label.id,
          reader: raise.by, readerKind: 'system', action: 'changed', purpose: `audience ${c.level} → ${to}: the cap of ${label.id} after ${raise.from} → ${raise.to}`,
        });
      } catch (err) {
        logger.warn('audience cap: an item could not be lowered', { scope, kind: c.target.kind, key: c.target.key, error: String(err) });
      }
    }
  }
  if (lowered.length && told) await tellOwners(storage, lowered, told);
  return lowered;
}

/** Register the settle step as the label-raise listener. Called once at boot. */
export function registerAudienceSettle(storage: Storage, config: AimeatConfig): void {
  onLabelRaised(raise => settleAudienceAfterRise({ storage, config }, raise).then(() => undefined));
}
