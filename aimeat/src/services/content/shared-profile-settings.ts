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
 *
 *   CONTENT RISK. The same record carries the level's layer of the content risk settings (`risk`,
 *   risk-settings.ts), changed by the same people with the same word; `locked` makes its values a floor
 *   for the layers under it.
 * @version-history
 *   v1.1.0 — 2026-11-21 — The record carries `risk`; a patch may set autoProfile, risk or both, and the
 *     answer carries risk and risk_in_force (wish-sis-ll-n-riskimerkinn-t-merkit-n-metadatalla-alkuper-ist-ei-).
 *   v1.0.0 — 2026-11-03 — Initial (wish-sormenj-lki-jaetuksi-yksi-per-ty-tilan-asiakirja-ja-ty-tilan).
 */
import type { Storage } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import type { CallerContext } from '../caller-context.js';
import { updateRecord, UNCHANGED } from '../record-cas.js';
import { checkRiskLayer, lenientRiskLayer, resolveRisk, RiskSettingsError } from './risk-settings.js';
import type { RiskLayer, ResolvedRisk } from './risk-types.js';
import { decideWorkspaceRead, isOrgManager } from '../workspace/access.js';
import { findWorkspaceRegistration } from '../workspace/meta-read.js';
import { ContentError } from './pipeline.js';
import { systemOwnerOf } from './shared-profile-key.js';

type Deps = { storage: Storage; config: AimeatConfig };

/**
 * One level's record. `autoProfile` absent: this level has no fingerprint choice of its own. `risk`:
 * this level's layer of the content risk settings (risk-settings.ts).
 */
interface Stored { v: 1; autoProfile?: boolean; risk?: RiskLayer; by: string; at: string }

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
  /** This level's own content risk choice; null when it has none. */
  risk: RiskLayer | null;
  /** The content risk rules in force for an item of this workspace (or of a workspace of this organism with no choice of its own). */
  risk_in_force: ResolvedRisk;
}

const keyOf = (org: string, ws: string | null): string => (ws ? `organism.${org}.w.${ws}.meta.contentclass` : `organism.${org}.meta.contentclass`);
const parse = (v: unknown): Stored | null => {
  const s = v as Stored | null;
  if (!s || typeof s !== 'object' || s.v !== 1) return null;
  const risk = lenientRiskLayer(s.risk);
  return {
    v: 1, by: typeof s.by === 'string' ? s.by : '', at: typeof s.at === 'string' ? s.at : '',
    ...(typeof s.autoProfile === 'boolean' ? { autoProfile: s.autoProfile } : {}), ...(risk ? { risk } : {}),
  };
};

async function read(storage: Storage, nodeId: string, org: string, ws: string | null): Promise<Stored | null> {
  return parse((await storage.getMemory(systemOwnerOf(nodeId), keyOf(org, ws)))?.value);
}

/** Is the shared fingerprint made on publication in this workspace? */
export async function autoProfileOn(storage: Storage, nodeId: string, org: string, ws: string): Promise<boolean> {
  const own = await read(storage, nodeId, org, ws);
  if (typeof own?.autoProfile === 'boolean') return own.autoProfile;
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
  const ownProfile = typeof own?.autoProfile === 'boolean' ? own.autoProfile : null;
  const aboveProfile = typeof above?.autoProfile === 'boolean' ? above.autoProfile : null;
  const layers = ws
    ? [{ level: 'organism' as const, layer: above?.risk ?? null }, { level: 'workspace' as const, layer: own?.risk ?? null }]
    : [{ level: 'organism' as const, layer: own?.risk ?? null }];
  return {
    organism_id: org, ws, auto_profile: ownProfile, effective: ownProfile ?? aboveProfile ?? false,
    from: ownProfile !== null ? (ws ? 'workspace' : 'organism') : aboveProfile !== null ? 'organism' : 'default',
    ...(own ? { changed_by: own.by, changed_at: own.at } : {}),
    risk: own?.risk ?? null,
    risk_in_force: resolveRisk(deps.config, layers, { homeOwner: null }),
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
  const extra = Object.keys(p).filter((k) => k !== 'autoProfile' && k !== 'risk');
  const profileOk = !('autoProfile' in p) || typeof p.autoProfile === 'boolean' || p.autoProfile === null;
  if (extra.length || !profileOk || !('autoProfile' in p || 'risk' in p)) {
    throw new ContentError('INVALID_INPUT', 400, 'A workspace or organism takes two settings: { autoProfile: true | false | null } (null follows the organism, or the default off) and { risk: { ... } }, its layer of the content risk settings (null removes it).');
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
  const now = new Date().toISOString();
  // Checked before anything is written: a bad risk patch refuses the whole change.
  let riskError: RiskSettingsError | null = null;
  await updateRecord(deps.storage, owner, key, parse, (cur) => {
    const next: Stored = { ...(cur ?? { v: 1 as const, by: caller.principal, at: now }), by: caller.principal, at: now };
    if ('autoProfile' in p) {
      if (p.autoProfile === null) delete next.autoProfile;
      else next.autoProfile = p.autoProfile as boolean;
    }
    if ('risk' in p) {
      if (p.risk === null) delete next.risk;
      else {
        try {
          const layer = checkRiskLayer(cur?.risk, p.risk, { allowLock: true });
          if (p.risk && typeof p.risk === 'object' && 'detect' in p.risk) layer.detectBy = caller.principal;
          next.risk = { ...layer, by: caller.principal, at: now };
        } catch (err) {
          if (!(err instanceof RiskSettingsError)) throw err;
          riskError = err;
          return UNCHANGED;
        }
      }
    }
    return next;
  }, { tag: 'contentclass', visibility: 'private' });
  if (riskError) throw new ContentError((riskError as RiskSettingsError).code, (riskError as RiskSettingsError).status, (riskError as RiskSettingsError).message);
  // A record with no choice left follows the level above in everything.
  const left = await read(deps.storage, deps.config.nodeId, org, ws);
  if (left && left.autoProfile === undefined && !left.risk) await deps.storage.deleteMemory(owner, key);
  return sharedSettingsFor(deps, caller, { organismId: org, ws });
}
