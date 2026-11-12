/**
 * @file src/services/portfolio/published.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Username to published welcome page: the owner's identities, the page's config and its
 *   HTML. Moved from routes/portfolio.ts, which re-exports it, so a service (the access request's
 *   target, services/organism-join-requests/access-targets.ts) reads it without importing a route
 *   file. One change in the move: the owner's agents are read with loadOwnerAgents
 *   (services/db/owner-identity.ts), the read every service uses, which answers the same list.
 * @structure PortfolioResolution · resolvePublishedPortfolio()
 * @usage const resolved = await resolvePublishedPortfolio(storage, username); if (resolved.ok && resolved.html) …
 * @version-history
 *   v1.0.0 — 2026-11-12 — Extracted from routes/portfolio.ts; agents through loadOwnerAgents.
 */
import type { Storage, GHIIRecord, AgentRecord } from '../../storage/interface.js';
import { PORTFOLIO_HTML_KEY, PORTFOLIO_CONFIG_KEY } from '../portfolio-config.js';
import { loadOwnerAgents } from '../db/owner-identity.js';

/** Result of resolving a username to their published portfolio. */
export type PortfolioResolution =
  | { ok: true; html: string | null; ghii: GHIIRecord; agents: AgentRecord[]; portfolioConfig: Record<string, unknown>;
      /** The page's AI-provenance record, when it has one: the serve path sends its marks. */
      aiProvenanceId?: string }
  | { ok: false; reason: 'user_not_found' | 'not_enabled' };

/**
 * Shared resolver: username → published portfolio HTML + owner identities.
 * Used by both the apex JSON route (GET /v1/portfolio/data/:username, which maps
 * reasons to granular 404 messages and tolerates html:null) and the
 * portfolio-origin serve route (<username>.portfolio.<apex>, which returns a
 * uniform 404 for every failure INCLUDING html:null).
 *
 * `no_agent` is gone as a reason: a welcome mat exists before its owner has an agent, and
 * refusing to serve it would make the first thing anyone builds here invisible.
 */
export async function resolvePublishedPortfolio(
  storage: Storage, username: string,
): Promise<PortfolioResolution> {
  const ghii = await storage.getGHIIByOwner(username);
  if (!ghii) return { ok: false, reason: 'user_not_found' };

  const agents = await loadOwnerAgents(storage, username);
  const candidates = [...agents.map(a => a.gaii), ghii.ghii];

  let portfolioConfig: Record<string, unknown> | null = null;
  for (const gaii of candidates) {
    const mem = await storage.getMemory(gaii, PORTFOLIO_CONFIG_KEY);
    const val = (mem?.value ?? null) as Record<string, unknown> | null;
    if (val?.enabled) { portfolioConfig = val; break; }
  }
  if (!portfolioConfig) return { ok: false, reason: 'not_enabled' };

  let html: string | null = null;
  let aiProvenanceId: string | undefined;
  for (const gaii of candidates) {
    const file = await storage.getStorageFile(gaii, PORTFOLIO_HTML_KEY);
    if (file) { html = file.data.toString('utf-8'); aiProvenanceId = file.aiProvenanceId; break; }
  }
  return { ok: true, html, ghii, agents, portfolioConfig, ...(aiProvenanceId ? { aiProvenanceId } : {}) };
}
