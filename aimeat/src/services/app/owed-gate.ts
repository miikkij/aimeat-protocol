/**
 * @file src/services/app/owed-gate.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What an app owes before a publish of a later version goes through: its design spec
 *   (always), its data map (when the app keeps data), its bound skill and agent face (not on a quick
 *   prototype or a declared presentation), and the update's roadmap line. With the node setting
 *   apps.owed_on_publish = refuse (the default) a missing item refuses the publish; with warn the
 *   publish goes through and the answer lists them.
 *
 *   WHY. The publish answer had listed these items since 2026-10-10, and builds still shipped
 *   without them: on aimeat.io on 2026-11-24, nine apps of one package had no data map, no design
 *   spec and no bound skill after 5 to 28 versions each, published by a session that followed its
 *   own repository's instructions instead of the answer. A reminder is read or it is not; a refusal
 *   is the one thing every publish route, script and model meets. Ruled: the design spec always, the
 *   data map when the app keeps data (Jouni, 2026-11-24).
 *
 *   THE FIRST PUBLISH ALWAYS GOES THROUGH: a data map, a design spec and a bound skill can only be
 *   written once the app exists, so the gate starts at the second version.
 * @structure OwedFacts · owedMissing(storage, config, facts) · owedRefusal(missing)
 * @usage const missing = await owedMissing(storage, config, facts); if (missing.length && config.appOwedOnPublish === 'refuse') return { refusal: owedRefusal(missing, ...) };
 * @version-history
 *   v1.0.1 — 2026-11-25 — The agent face's `how` names aimeat_app_manage face_set, the MCP call for it.
 *   v1.0.0 — 2026-11-24 — Initial (wish-corp-paketin-apit-saavat-datakartan-design-specin-ja-skillin).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { readAppDataMap } from '../data-map/data-map-store.js';
import { parseAppScopes } from '../protected-resource.js';
import { listSkillsByBinding } from '../skills.js';
import { getOwnerScopePublicMemory } from '../owner/memory.js';
import { agentFaceKey } from '../agent/face.js';
import { appDataMapId } from './app-ref.js';
import { declaredLevel } from './build-level.js';
import { declaresNoAiPath } from './ai-path-step.js';

/** The permission words that mean the app writes data somewhere. */
const DATA_WRITE_WORDS = ['memory:write', 'organism:write', 'organism:rows', 'storage:write', 'files:write'];

export interface OwedFacts {
  ownerName: string;
  ownerGhii: string;
  filename: string;
  html: string;
  /** The design spec as it stands before this version, or null. */
  hasDesignSpec: boolean;
  /** The roadmap line this publish carries (the draft's notice counts), or null. */
  roadmapLine: string | null;
}

export interface OwedItem { item: 'design_spec' | 'data_map' | 'bound_skill' | 'agent_face' | 'roadmap'; how: string }

/** What the app still owes. Empty when nothing is missing. */
export async function owedMissing(storage: Storage, config: AimeatConfig, f: OwedFacts): Promise<OwedItem[]> {
  const app = `${f.ownerName}/${f.filename}`;
  const out: OwedItem[] = [];
  if (!f.hasDesignSpec) {
    out.push({ item: 'design_spec', how: `aimeat_app_manage { action: "spec_set", owner: "${f.ownerName}", filename: "${f.filename}", markdown } (PUT /v1/apps/${app}/design-spec): what the app is for, its screens, where its data lives, what was decided and what is open; { action: "spec" } answers an outline` });
  }
  const scopes = parseAppScopes(f.html);
  const keepsData = scopes.length === 0 || scopes.some(s => DATA_WRITE_WORDS.includes(s));
  if (keepsData && !(await readAppDataMap(storage, f.ownerGhii, appDataMapId(f.filename)))) {
    out.push({ item: 'data_map', how: `aimeat_datamap_set { app: "${app}", data_map } (PUT /v1/datamap/apps/${app}): for each family of keys or files, where it lives, who owns and reads it, and why there` });
  }
  const aiPart = declaredLevel(f.html) !== 'proto' && !declaresNoAiPath(f.html);
  if (aiPart) {
    const skills = await listSkillsByBinding(storage, config, `app:${app}`, { ownerName: f.ownerName });
    if (skills.length === 0) {
      out.push({ item: 'bound_skill', how: `aimeat_skill_publish with metadata.binding "app:${app}": how the person's own AI reads and writes the app's data, the rules, and what the person confirms` });
    }
    const face = await getOwnerScopePublicMemory(storage, config.nodeId, f.ownerName, agentFaceKey(f.filename));
    if (!face) {
      out.push({ item: 'agent_face', how: `one public memory record ${agentFaceKey(f.filename)} (aimeat_app_manage { action: "face_set", filename: "${f.filename}", markdown }, or AIMEATAgentFace.publish from /v1/libs/aimeat-agentface.js): what the app does, for an AI that opens its address` });
    }
  }
  if (!f.roadmapLine) {
    out.push({ item: 'roadmap', how: 'send `roadmap` on this publish: one sentence on what this version changes (a draft\'s notice counts)' });
  }
  return out;
}

/** The refusal of a publish that owes items, naming each and how to write it. */
export function owedRefusal(missing: OwedItem[], app: string): { status: number; code: string; message: string; details: Record<string, unknown> } {
  return {
    status: 422,
    code: 'APP_OWES_ITEMS',
    message: `This update of ${app} is refused until the app has what every app on this node owes: `
      + missing.map(m => `${m.item.replace('_', ' ')}: ${m.how}`).join('; ')
      + '. Write them and publish again; nothing was stored.',
    details: { missing: missing.map(m => m.item), how: Object.fromEntries(missing.map(m => [m.item, m.how])) },
  };
}
