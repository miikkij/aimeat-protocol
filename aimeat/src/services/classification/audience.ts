/**
 * @file src/services/classification/audience.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Whether a reader is inside a label's reader audience (TARGET-082 V4, spec §4.1,
 *   decided 2026-09-29: the audience narrows access for people and AI alike, and only narrows).
 *
 *   An audience lists organism roles, sharing groups and named people; a reader in any one of them
 *   is inside. An AI reads for its owner, so an agent, an app or an ecosystem app is inside when its
 *   owner is. Roles are the owner's role in the organism the content belongs to (creator, admin,
 *   member), so they mean nothing for personal content. A group is named by its id or its name and
 *   is a sharing group the owner is a member of. People are named by identity (alice@node) or
 *   account name (alice).
 *
 *   One AudienceCheck is made per reader and remembers what it looked up, so a list of a thousand
 *   items with the same audience costs one membership read and one group read.
 * @structure AudienceWho · audienceCheck(storage, who) → (audience, scope) => Promise<boolean>
 * @usage
 *   const inside = audienceCheck(storage, { owner: 'alice@n', ownerName: 'alice' });
 *   if (!(await inside(label.audience, target.scope))) hide();
 * @version-history
 *   v1.0.0 — 2026-09-29 — TARGET-082 V4. Initial.
 */
import type { Storage } from '../../storage/interface.js';
import type { LabelAudience } from './defaults.js';
import { scopeOrganism } from './policy.js';

/** Whose reading this is: the owner the reader acts for. Null for anonymous. */
export interface AudienceWho {
  owner: string | null;
  ownerName: string | null;
}

export type AudienceCheck = (audience: LabelAudience | null | undefined, scope: string) => Promise<boolean>;

export function audienceCheck(storage: Storage, who: AudienceWho): AudienceCheck {
  const roles = new Map<string, Promise<string | null>>();
  let groups: Promise<Set<string>> | null = null;

  const roleIn = (orgId: string) => {
    if (!roles.has(orgId)) {
      roles.set(orgId, (async () => {
        if (!who.ownerName) return null;
        const m = await storage.getMembership(orgId, who.ownerName);
        return m && m.status === 'active' ? m.role : null;
      })());
    }
    return roles.get(orgId)!;
  };
  const myGroups = () => {
    groups ??= (async () => {
      if (!who.owner) return new Set<string>();
      const list = await storage.listSharingGroupsByMember(who.owner);
      return new Set(list.flatMap(g => [g.id, g.name].filter((x): x is string => typeof x === 'string')));
    })();
    return groups;
  };

  return async (audience, scope) => {
    if (!audience || (!audience.roles?.length && !audience.groups?.length && !audience.people?.length)) return true;
    if (!who.owner) return false;
    if (audience.people?.some(p => p === who.owner || p === who.ownerName)) return true;
    const orgId = scopeOrganism(scope);
    if (orgId && audience.roles?.length) {
      const role = await roleIn(orgId);
      if (role && audience.roles.includes(role)) return true;
    }
    if (audience.groups?.length) {
      const mine = await myGroups();
      if (audience.groups.some(g => mine.has(g))) return true;
    }
    return false;
  };
}
