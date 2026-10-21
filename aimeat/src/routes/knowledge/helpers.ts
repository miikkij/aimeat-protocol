/**
 * @file src/routes/knowledge/helpers.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Shared closures for the knowledge package routes — identity resolution and the
 *   owner-scope memory lookup (GHII + all agents). Extracted from src/routes/knowledge.ts so the
 *   split route-group modules can share them. Extracted to satisfy max-file-lines.
 * @version-history
 *   2026-10-21 — signedIn asks isAnonymousPrincipal (secaudit 2026-10, anonymous-claim-not-signed).
 *   v1.0.0 — 2026-07-13 — Extracted from src/routes/knowledge.ts (max-file-lines)
 *   v1.1.0 — 2026-07-16 — findOwnerScopeMemory batches the agent scan into one listMemoryForOwners
 *   v1.1.1 — 2026-09-29 — TARGET-082 V4: findOwnerScopeMemory is documented as the unchecked
 *     lookup for read-to-update; a route that puts its record in a response passes it through
 *     presentMemory first (packages-core.ts GET /v1/knowledge/:id does).
 *   v1.1.2 — 2026-10-05 — The account holder in person is asked with isOwnerInPerson (utils/gaii.ts;
 *     secaudit 2026-10, C4).
 *   v1.2.0 — 2026-10-15 — findReadableManifest: the manifest a caller may read, shared by the package
 *     read and the reputation read, and whether it is the caller's own (feature-list audit 207).
 *   v1.3.0 — 2026-10-17 — findReadableManifest also finds a package whose sharing.audience is members
 *     or organism:<id>, when services/audience.ts admits the caller (plan doc-mvcn6c7e4e5q, V3.6).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage, MemoryRecord } from '../../storage/interface.js';
import { resolveIdentity, isOwnerInPerson, isForeignPrincipal, isSameOwner, localAccountName } from '../../utils/gaii.js';
import { isAnonymousPrincipal } from '../../auth/anonymous-principal.js';
import { isNodeAccount } from '../../services/audience.js';
import { packageAudienceOf, knowledgeAudienceAllows } from '../../services/knowledge-audience.js';
import { readerFor } from '../../services/classification/reader.js';
import { presentMemory } from '../../services/classification/present-memory.js';

export type KnowledgeHelpers = {
  resolve: (req: Express.Request) => string;
  findOwnerScopeMemory: (
    req: Express.Request,
    key: string,
  ) => Promise<{ record: MemoryRecord; ownerGaii: string } | null>;
  findReadableManifest: (
    req: Express.Request,
    manifestKey: string,
  ) => Promise<{ record: MemoryRecord; own: boolean } | null>;
};

export function makeKnowledgeHelpers(config: AimeatConfig, storage: Storage): KnowledgeHelpers {
  const resolve = (req: Express.Request) => resolveIdentity(req.auth!, config.nodeId);

  // Find a memory record across the owner's scope (GHII + all agents).
  // Owner sessions store packages under GHII but agents store under GAII.
  // Returns the record + the actual ownerGaii it was found under.
  // Unchecked by classification: the sharing routes read it to update it. A route that returns the
  // record to the caller passes it through presentMemory (services/classification/present-memory.ts).
  async function findOwnerScopeMemory(req: Express.Request, key: string) {
    const callerGaii = resolve(req);
    const record = await storage.getMemory(callerGaii, key);
    if (record) return { record, ownerGaii: callerGaii };

    if (!isOwnerInPerson(req.auth)) return null;

    const ownerName = req.auth!.owner as string;
    const agents = await storage.getAgentsByOwner(ownerName);
    // One IN query for `key` across every owner agent (was getMemory per agent); same isLive
    // semantics as getMemory. Return the first agent (original order) that has it.
    const rows = await storage.listMemoryForOwners(agents.map(a => a.gaii), { prefix: key });
    const byGaii = new Map(rows.filter(r => r.key === key).map(r => [r.ownerGaii, r]));
    for (const agent of agents) {
      const agentRecord = byGaii.get(agent.gaii);
      if (agentRecord) return { record: agentRecord, ownerGaii: agent.gaii };
    }
    return null;
  }

  // The package manifest this caller may read, the one rule GET /v1/knowledge/:id and the reputation
  // read share: a public manifest of any account (an owner's before an agent's), else one of the
  // caller's own account in any visibility, and then what the classification reader shows. `own` says
  // whether the manifest is the caller's account's, which is who sees the moderation record. The
  // reputation read had its own lookup with no visibility filter, so an unlisted package answered to
  // anybody with its id (feature-list audit 207).
  async function findReadableManifest(req: Express.Request, manifestKey: string): Promise<{ record: MemoryRecord; own: boolean } | null> {
    let record: MemoryRecord | undefined;
    let own = false;
    const allOwners = await storage.listOwners();
    record = (await storage.listMemoryForOwners(allOwners.map(o => `${o.name}@${config.nodeId}`), { prefix: manifestKey, visibility: 'public' }))[0];
    if (!record) {
      const allAgents = await storage.listAgents();
      record = (await storage.listMemoryForOwners(allAgents.map(a => a.gaii), { prefix: manifestKey, visibility: 'public' }))[0];
    }
    const signedIn = !!req.auth && !isAnonymousPrincipal(req.auth);
    if (!record && signedIn) {
      const found = await findOwnerScopeMemory(req, manifestKey);
      if (found) { record = found.record; own = true; }
    }
    // A package shared with this node's accounts or with one organism (sharing.audience, plan
    // doc-mvcn6c7e4e5q V3.6): its record is not public, so it is found by key across every account
    // and agent and admitted only when audience.ts admits this caller. A visitor from another node and
    // the anonymous identity are never a node account, so they never reach the scan.
    if (!record && isNodeAccount(req.auth)) {
      record = await findSharedManifest(req, manifestKey);
    }
    if (record && !own && signedIn && !isForeignPrincipal(req.auth)) {
      own = isSameOwner(record.ownerGaii, `${req.auth!.owner}@${config.nodeId}`);
    }
    if (!record) return null;
    const shown = await presentMemory(readerFor({ storage, config }, req.auth), record);
    return shown ? { record: shown, own } : null;
  }

  async function findSharedManifest(req: Express.Request, manifestKey: string): Promise<MemoryRecord | undefined> {
    const owners = (await storage.listOwners()).map(o => `${o.name}@${config.nodeId}`);
    const agents = (await storage.listAgents()).map(a => a.gaii);
    const rows = (await storage.listMemoryForOwners([...owners, ...agents], { prefix: manifestKey }))
      .filter(r => r.key === manifestKey && r.visibility !== 'public');
    for (const r of rows) {
      const audience = packageAudienceOf(r.value);
      if (audience !== 'members' && !audience.startsWith('organism:')) continue;
      if (await knowledgeAudienceAllows(storage, audience, req.auth, localAccountName(r.ownerGaii))) return r;
    }
    return undefined;
  }

  return { resolve, findOwnerScopeMemory, findReadableManifest };
}
