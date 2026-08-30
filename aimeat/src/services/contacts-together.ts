/**
 * @file contacts-together.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the owner and a contact have in common, read from the places that already
 *   hold it: the organisms both are active members of (the memberships table), the workspaces in
 *   those organisms both may read (the workspace read gate, asked once for each of them), and the
 *   contact's agents (the agent table, by owner) with the last message each exchanged with the
 *   owner. Nothing is stored. It is a projection for the Contacts page's "Together" section, the
 *   cover's shared-organisms column, and a chat asking "which organisms do I share with Roosa".
 * @structure sharedOrganisms — for MANY contacts at once (the cover column) · contactTogether — for one person
 * @usage const t = await contactTogether(storage, config, ownerGhii, contactGhii, conversations);
 * @version-history
 *   v1.0.0 — 2026-08-30 — Initial (design canvas "AIMEAT Kontaktien sivu", direction A).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { OrganismMembershipRecord } from '../storage/interface.js';
import type { ConversationSummary } from '../storage/repositories/direct-message.repository.js';
import { canReadWorkspace } from './workspace-access.js';
import { logger } from '../utils/logger.js';

/** An organism both are active members of, with the CONTACT's role in it. */
export interface SharedOrganism { id: string; name: string; role: OrganismMembershipRecord['role']; }
/** A workspace in a shared organism that both may read. */
export interface SharedWorkspace { organism_id: string; organism_name: string; ws: string; name: string; }
/** One of the contact's agents, with the last message it exchanged with the owner. */
export interface ContactAgent { gaii: string; display_name: string | null; last_seen: string | null; last_message_at: string | null; message_count: number; }
export interface ContactTogether { organisms: SharedOrganism[]; workspaces: SharedWorkspace[]; agents: ContactAgent[]; }

/**
 * How many contacts the cover column is computed for in one listing. Each costs one membership
 * query; an address book with more people than this gets the column on the first N and the rest
 * read as "none shared", which the caller says rather than hides.
 */
export const SHARED_LOOKUP_CAP = 200;

const bare = (ghii: string): string => ghii.split('@')[0];

/** The organisms one owner is an active member of, keyed by organism id. Memberships are keyed by
 *  the BARE owner name (the same key the organism routes use), so a full GHII is reduced first. */
async function activeMemberships(storage: Storage, ghii: string): Promise<Map<string, OrganismMembershipRecord>> {
  const rows = await storage.listMembershipsByGhii(bare(ghii));
  return new Map(rows.filter(m => m.status === 'active').map(m => [m.organismId, m]));
}

/**
 * The organisms the owner shares with each of MANY contacts, for the cover column. One membership
 * query per contact, sequential, capped at SHARED_LOOKUP_CAP. Returns a map keyed by contact GHII;
 * a contact past the cap is absent from it.
 */
export async function sharedOrganisms(
  storage: Storage, ownerGhii: string, contactGhiis: string[],
): Promise<Map<string, SharedOrganism[]>> {
  const out = new Map<string, SharedOrganism[]>();
  const targets = [...new Set(contactGhiis)].slice(0, SHARED_LOOKUP_CAP);
  if (!targets.length) return out;
  const mine = await activeMemberships(storage, ownerGhii);
  if (!mine.size) { for (const g of targets) out.set(g, []); return out; }
  const names = new Map<string, string>();
  const nameOf = async (id: string): Promise<string> => {
    if (!names.has(id)) names.set(id, (await storage.getOrganism(id))?.name ?? id);
    return names.get(id)!;
  };
  for (const ghii of targets) {
    try {
      const theirs = await activeMemberships(storage, ghii);
      const shared: SharedOrganism[] = [];
      for (const [id, m] of theirs) if (mine.has(id)) shared.push({ id, name: await nameOf(id), role: m.role });
      out.set(ghii, shared);
    } catch (err) {
      logger.warn('sharedOrganisms: continuing after a suppressed failure', { ghii, error: String(err) });
      out.set(ghii, []);
    }
  }
  return out;
}

/** The workspaces in one shared organism that BOTH may read, by the same gate the workspace
 *  routes use. Read from every member's copy of the organism's workspace registry. */
async function sharedWorkspacesIn(
  storage: Storage, config: AimeatConfig, org: SharedOrganism, ownerGhii: string, contactGhii: string,
): Promise<SharedWorkspace[]> {
  const organism = await storage.getOrganism(org.id);
  if (!organism) return [];
  const regKey = `organism.${org.id}.meta.workspaces`;
  const { items } = await storage.listAllMemory({ prefix: regKey, limit: 1000 });
  const seen = new Set<string>();
  const out: SharedWorkspace[] = [];
  for (const rec of items) {
    if (rec.key !== regKey) continue;
    const list = (rec.value as { workspaces?: Array<{ id: string; name?: string }> } | null)?.workspaces ?? [];
    for (const w of list) {
      if (!w?.id || seen.has(w.id)) continue;
      seen.add(w.id);
      const [mine, theirs] = await Promise.all([
        canReadWorkspace(storage, config, organism, undefined, bare(ownerGhii), ownerGhii, w.id),
        canReadWorkspace(storage, config, organism, undefined, bare(contactGhii), contactGhii, w.id),
      ]);
      if (mine && theirs) out.push({ organism_id: org.id, organism_name: org.name, ws: w.id, name: w.name || w.id });
    }
  }
  return out;
}

/**
 * Everything the owner and ONE person have in common: shared organisms, the workspaces in them
 * both may read, and the person's agents on this node with the last message each exchanged with
 * the owner. `conversations` is the owner's conversation list, passed in so a caller that already
 * holds it does not read it twice.
 */
export async function contactTogether(
  storage: Storage, config: AimeatConfig, ownerGhii: string, contactGhii: string,
  conversations?: ConversationSummary[],
): Promise<ContactTogether> {
  const organisms = (await sharedOrganisms(storage, ownerGhii, [contactGhii])).get(contactGhii) ?? [];
  const workspaces: SharedWorkspace[] = [];
  for (const org of organisms) {
    try { workspaces.push(...await sharedWorkspacesIn(storage, config, org, ownerGhii, contactGhii)); }
    catch (err) { logger.warn('contactTogether: workspaces are best-effort', { organism: org.id, error: String(err) }); }
  }
  const convs = conversations ?? await storage.listConversations(ownerGhii);
  const byPeer = new Map(convs.map(c => [c.peerGhii, c]));
  const owner = bare(contactGhii);
  const agents: ContactAgent[] = (await storage.listAgents())
    .filter(a => a.owner === owner && a.gaii.endsWith(`@${config.nodeId}`))
    .map(a => {
      const conv = byPeer.get(a.gaii);
      return { gaii: a.gaii, display_name: a.displayName ?? null, last_seen: a.lastSeen ?? null, last_message_at: conv?.updatedAt ?? null, message_count: conv?.messageCount ?? 0 };
    })
    .sort((x, y) => (y.last_message_at ?? '').localeCompare(x.last_message_at ?? ''));
  return { organisms, workspaces, agents };
}
