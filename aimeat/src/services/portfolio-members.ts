/**
 * @file portfolio-members.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The node's members who have published a portfolio: the list behind
 *   GET /v1/portfolio/members and the server-rendered body of /v1/members. Moved out of
 *   routes/portfolio.ts unchanged so both read one implementation, with the route's 60-second
 *   cache moving with it.
 * @structure
 *   - PublishedMember         — one member as the showcase shows them
 *   - listPublishedMembers()  — every owner whose portfolio is enabled, cached for a minute
 *   - listSearchableMembers() — the subset who also asked to be found in a search engine
 * @usage
 *   const members = await listPublishedMembers(storage);
 * @version-history
 *   v1.0.0 — 2026-09-24 — Extracted from routes/portfolio.ts (the /v1/members page body reads it too).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { portfolioSeoIndexable, type PortfolioSeoConfig } from './portfolio-seo.js';

export interface PublishedMember {
  username: string;
  ghii: string;
  display_name: string;
  avatar?: string;
  bio?: string;
}

interface MemberRow { member: PublishedMember; portfolioConfig: PortfolioSeoConfig }

let membersCache: { at: number; data: MemberRow[] } | null = null;
const MEMBERS_TTL_MS = 60_000;

/**
 * Node members (owners) who have PUBLISHED a portfolio (portfolio.config.enabled). Cached briefly,
 * because listing all owners and reading each portfolio.config is O(owners).
 */
export async function listPublishedMembers(storage: Storage): Promise<PublishedMember[]> {
  return (await memberRows(storage)).map(r => r.member);
}

/**
 * The published members who also asked a search engine to list them (the portfolio's own `seoIndex`
 * switch, under the node-wide one). A page body written for crawlers names only these: publishing a
 * portfolio on this node and being findable in Bing are two separate decisions of the person's.
 */
export async function listSearchableMembers(storage: Storage, config: AimeatConfig): Promise<PublishedMember[]> {
  return (await memberRows(storage))
    .filter(r => portfolioSeoIndexable(r.portfolioConfig, config))
    .map(r => r.member);
}

async function memberRows(storage: Storage): Promise<MemberRow[]> {
  if (membersCache && Date.now() - membersCache.at < MEMBERS_TTL_MS) return membersCache.data;
  const ghiis = await storage.listGHIIs();
  // Batch: owner→agents in one IN query, then the portfolio.config key across every identity a
  // portfolio can live under in one IN query (was getAgentsByOwner + getMemory PER owner).
  //
  // The candidates mirror resolvePublishedPortfolio exactly: every agent gaii AND the owner's own
  // GHII. Keying this listing on the first agent alone made an agentless member's portfolio
  // published, served at /v1/portfolio/:username — and absent from the one page that exists to
  // find them, because the mat is written under the GHII before any agent exists.
  const agentsByOwner = await storage.getAgentsByOwners(ghiis.map(g => g.username));
  const candidatesByOwner = new Map<string, string[]>();
  for (const g of ghiis) {
    candidatesByOwner.set(g.username, [...(agentsByOwner[g.username] ?? []).map(a => a.gaii), g.ghii]);
  }
  const cfgRows = await storage.listMemoryForOwners(
    [...new Set([...candidatesByOwner.values()].flat())],
    { prefix: 'portfolio.config' },
  );
  const enabledConfigs = new Map<string, PortfolioSeoConfig>();
  for (const m of cfgRows) {
    const value = m.value as PortfolioSeoConfig | null;
    if (m.key === 'portfolio.config' && value?.enabled) enabledConfigs.set(m.ownerGaii, value);
  }
  const rows: MemberRow[] = [];
  for (const g of ghiis) {
    const gaii = (candidatesByOwner.get(g.username) ?? []).find(c => enabledConfigs.has(c));
    if (gaii) {
      // `ghii` is the member's full identifier (owner@node). The showcase renders each member
      // as an ID card, and the identifier is the part that makes it one — a name is a label,
      // an identifier is addressable: other people and their agents reach you by it.
      rows.push({
        member: { username: g.username, ghii: g.ghii, display_name: g.displayName, avatar: g.avatar, bio: g.bio },
        portfolioConfig: enabledConfigs.get(gaii)!,
      });
    }
  }
  membersCache = { at: Date.now(), data: rows };
  return rows;
}
