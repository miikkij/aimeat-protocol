/**
 * @file src/services/content/shared-profile-settings.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Whether a workspace document gets its shared fingerprint when it is published, set
 *   for one workspace or for a whole organism, off unless someone turns it on (decision
 *   decision-sormenj-lki-yksi-yhteinen-per-ty-tilan-asiakirja-sama-lukulu, Jouni 2026-11-03). The
 *   workspace's own setting wins over the organism's.
 *
 *   WHO PAYS. The setting spends nobody's key by itself. A document published in a workspace where
 *   it is on gets its fingerprint on the publisher's own AI key, and only when the publisher's own
 *   content settings say so too (the profile step on, reading workspace documents on arrival):
 *   intake.ts asks both. So a workspace admin cannot spend a member's allowance.
 *
 *   WHO CHANGES IT. For a workspace, its creator or an organism creator or admin; for the organism,
 *   an organism creator or admin. Both need memory:write-reserved, the word for what decides
 *   spending (service.ts). Any member who may read the workspace reads it. The record is
 *   `organism.<org>.w.<ws>.meta.contentclass` or `organism.<org>.meta.contentclass`, held private by
 *   the node's identity, so it is changed only here.
 * @structure SharedProfileSettings · autoProfileOn · sharedSettingsFor · updateSharedSettingsFor
 * @usage if (await autoProfileOn(storage, nodeId, org, ws)) { ... }
 * @version-history
 *   v1.0.0 — 2026-11-03 — Initial (wish-sormenj-lki-jaetuksi-yksi-per-ty-tilan-asiakirja-ja-ty-tilan).
 */
import type { Storage } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import type { CallerContext } from '../caller-context.js';
import { updateRecord } from '../record-cas.js';
import { decideWorkspaceRead, isOrgManager } from '../workspace-access.js';
import { findWorkspaceRegistration } from '../workspace-meta-read.js';
import { ContentError } from './pipeline.js';
import { systemOwnerOf } from './shared-profile-key.js';

type Deps = { storage: Storage; config: AimeatConfig };

interface Stored { v: 1; autoProfile: boolean; by: string; at: string }

/** What a reader is told: this level's own choice, and what is in force and where it comes from. */
export interface SharedProfileSettings {
  organism_id: string;
  ws: string | null;
  /** This level's own choice; null when it has none and follows the level above. */
  auto_profile: boolean | null;
  /** What is in force for a document published here. */
  effective: boolean;
  from: 'workspace' | 'organism' | 'default';
  changed_by?: string;
  changed_at?: string;
}

const keyOf = (org: string, ws: string | null): string => (ws ? `organism.${org}.w.${ws}.meta.contentclass` : `organism.${org}.meta.contentclass`);
const parse = (v: unknown): Stored | null => {
  const s = v as Stored | null;
  return s && typeof s === 'object' && s.v === 1 && typeof s.autoProfile === 'boolean' ? s : null;
};

async function read(storage: Storage, nodeId: string, org: string, ws: string | null): Promise<Stored | null> {
  return parse((await storage.getMemory(systemOwnerOf(nodeId), keyOf(org, ws)))?.value);
}

/** Is the shared fingerprint made on publication in this workspace? */
export async function autoProfileOn(storage: Storage, nodeId: string, org: string, ws: string): Promise<boolean> {
  const own = await read(storage, nodeId, org, ws);
  if (own) return own.autoProfile;
  return (await read(storage, nodeId, org, null))?.autoProfile ?? false;
}

function checkTarget(t: { organismId?: unknown; ws?: unknown }): { org: string; ws: string | null } {
  const org = typeof t.organismId === 'string' ? t.organismId.trim() : '';
  const ws = typeof t.ws === 'string' && t.ws.trim() ? t.ws.trim() : null;
  if (!org || !/^[^.\s]+$/.test(org) || (ws !== null && !/^[^.\s]+$/.test(ws))) {
    throw new ContentError('INVALID_INPUT', 400, 'organism_id names the organism, and ws one of its workspaces (omit ws for the whole organism).');
  }
  return { org, ws };
}

/** The shared fingerprint settings of a workspace or an organism. Any member who may read it. */
export async function sharedSettingsFor(deps: Deps, caller: CallerContext, target: { organismId?: unknown; ws?: unknown }): Promise<SharedProfileSettings> {
  const { org, ws } = checkTarget(target);
  const organism = await deps.storage.getOrganism(org);
  if (!organism) throw new ContentError('NOT_FOUND', 404, `Organism not found: ${org}`);
  if (ws) {
    const d = await decideWorkspaceRead(deps.storage, deps.config, organism, caller.auth.sub, caller.owner, caller.principal, ws);
    if (!d.canRead) throw new ContentError('NOT_FOUND', 404, `No workspace ${ws} you may read in this organism.`);
  } else {
    const m = await deps.storage.getMembership(org, caller.owner);
    if (!m || m.status !== 'active') throw new ContentError('NOT_FOUND', 404, `Organism not found: ${org}`);
  }
  const own = await read(deps.storage, deps.config.nodeId, org, ws);
  const above = ws ? await read(deps.storage, deps.config.nodeId, org, null) : null;
  const inForce = own ?? above;
  return {
    organism_id: org, ws, auto_profile: own?.autoProfile ?? null, effective: inForce?.autoProfile ?? false,
    from: own ? (ws ? 'workspace' : 'organism') : above ? 'organism' : 'default',
    ...(own ? { changed_by: own.by, changed_at: own.at } : {}),
  };
}

/**
 * Change it: `patch.autoProfile` true, false, or null (follow the level above). The workspace's
 * creator or an organism manager for a workspace, an organism manager for the organism.
 */
export async function updateSharedSettingsFor(
  deps: Deps, caller: CallerContext, target: { organismId?: unknown; ws?: unknown }, patch: unknown,
): Promise<SharedProfileSettings> {
  const { org, ws } = checkTarget(target);
  const p = (patch && typeof patch === 'object' ? patch : {}) as Record<string, unknown>;
  const extra = Object.keys(p).filter((k) => k !== 'autoProfile');
  if (extra.length || !('autoProfile' in p) || !(typeof p.autoProfile === 'boolean' || p.autoProfile === null)) {
    throw new ContentError('INVALID_INPUT', 400, 'A workspace or organism takes one setting: { autoProfile: true | false | null } (null follows the organism, or the default off).');
  }
  const organism = await deps.storage.getOrganism(org);
  if (!organism) throw new ContentError('NOT_FOUND', 404, `Organism not found: ${org}`);
  const manager = await isOrgManager(deps.storage, org, caller.owner);
  const creator = ws ? (await findWorkspaceRegistration(deps.storage, org, ws, { nodeId: deps.config.nodeId }))?.creator : undefined;
  if (!manager && !(ws && creator === caller.owner)) {
    await sharedSettingsFor(deps, caller, { organismId: org, ws });
    throw new ContentError('ACCESS_DENIED', 403, ws
      ? 'Only the workspace\'s creator or an organism creator or admin changes whether its documents get a fingerprint when they are published.'
      : 'Only an organism creator or admin changes whether the organism\'s documents get a fingerprint when they are published.');
  }
  const key = keyOf(org, ws);
  const owner = systemOwnerOf(deps.config.nodeId);
  if (p.autoProfile === null) await deps.storage.deleteMemory(owner, key);
  else {
    const next: Stored = { v: 1, autoProfile: p.autoProfile as boolean, by: caller.principal, at: new Date().toISOString() };
    await updateRecord(deps.storage, owner, key, parse, () => next, { tag: 'contentclass', visibility: 'private' });
  }
  return sharedSettingsFor(deps, caller, { organismId: org, ws });
}
