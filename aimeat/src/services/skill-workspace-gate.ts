/**
 * @file src/services/skill-workspace-gate.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The WRITE rule for a workspace-scope skill, which is a different question from the
 *   read gate services/skills.ts asks with canReadWorkspace.
 *
 *   A workspace skill is workspace CONTENT: it is stored under `organism.{org}.w.{ws}.skills.*`,
 *   every member's agents load it as their operating instructions, and freshest-wins across owners
 *   means one member's copy can replace another's. publishSkill and deleteSkill authorized that with
 *   the READ decision until 2026-10-20, so a `viewer` grant passed both (secaudit 2026-10, defect
 *   2). They ask this module now, which asks the one organism namespace rule
 *   (services/organism-namespace-access.ts) rather than keeping a second copy of it.
 * @structure
 *   - wsWriteCaller() — the session the rule decides on, from a SkillAccessor
 *   - assertWsSkillWrite() — publish and delete: the workspace write rule on the skill's manifest key
 *   - mayActOnEveryWsSkillCopy() — whether this caller administers the workspace (creator or manager)
 * @usage
 *   await assertWsSkillWrite(storage, config, org, ws, name, accessor);   // throws SkillAccessError
 * @version-history
 *   v1.0.0 — 2026-10-20 — Initial (secaudit 2026-10, defect 2).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { checkOrganismNamespaceAccess, type OrganismAccessCaller } from './organism-namespace-access.js';
import { wsManifestKey } from './skill-refs.js';
import { SkillAccessError, type SkillAccessor } from './skill-types.js';

/**
 * The session the organism namespace rule decides on, from the accessor.
 *
 * A code path that hands over no session (the presigned ZIP upload, a package install) is read as a
 * scoped principal rather than the account holder in person. That is the stricter of the two reads
 * and asks for the same contributor role, so it refuses nothing the rule would allow a member.
 */
export function wsWriteCaller(config: AimeatConfig, accessor: SkillAccessor): OrganismAccessCaller {
  const session = accessor.caller;
  if (session) {
    return {
      principal: session.principal, owner: session.owner,
      roles: [...session.roles], scopes: [...session.scopes],
    };
  }
  const owner = accessor.ownerName ?? '';
  return { principal: accessor.gaii ?? `${owner}@${config.nodeId}`, owner, roles: [] };
}

/**
 * Workspace WRITE gate for a workspace skill, asked on the skill's own manifest key. A `viewer`
 * grant, which is the read decision, does not pass it; the workspace's registered creator, an
 * organism manager and a `workspace-contributor` grant holder do, in person or through an agent.
 */
export async function assertWsSkillWrite(
  storage: Storage, config: AimeatConfig, org: string, ws: string, name: string, accessor: SkillAccessor,
): Promise<void> {
  const refusal = await checkOrganismNamespaceAccess(
    { storage, config }, wsWriteCaller(config, accessor), wsManifestKey(org, ws, name), 'write',
  );
  if (refusal) throw new SkillAccessError('FORBIDDEN', refusal.message);
}

/**
 * May this caller act on EVERY member's copies of a workspace skill? The workspace's registered
 * creator and an organism manager may, and nobody else: that is what the workspace meta rule
 * answers, so it is asked here on a meta probe key rather than copied (the form
 * services/schema-lock-rule.ts uses). A contributor acts on their own copies only.
 */
export async function mayActOnEveryWsSkillCopy(
  storage: Storage, config: AimeatConfig, org: string, ws: string, accessor: SkillAccessor,
): Promise<boolean> {
  const refusal = await checkOrganismNamespaceAccess(
    { storage, config }, wsWriteCaller(config, accessor), `organism.${org}.w.${ws}.meta._skill_delete`, 'write',
  );
  return refusal === null;
}
