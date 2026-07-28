/**
 * @file portfolio.ts
 * @description Portfolio routes — builder content catalog, per-user portfolio config,
 *   HTML upload (stored as a storage file), public showcase listing, and the public
 *   portfolio-data endpoint consumed by the SPA viewer.
 * @structure catalog / members / config (GET+PUT) / upload / data/:username
 * @version-history
 *   v1.3.0 — 2026-07-16 — catalog builds file lists via listStorageFilesForOwners (one IN
 *     query for all agents, was listStorageFiles per agent twice).
 *   v1.2.0 — 2026-07-03 — data/:username returns owner_gaiis (bridge allowlist for the
 *     viewer's fetch proxy); viewer_authenticated no longer counts the anonymous-mode
 *     shared identity as authenticated.
 *   v1.1.0 — 2026-07-03 — Catalog memories entries carry the owning gaii so the builder
 *     can compose anonymous public-read URLs (/v1/memory/:gaii/:key) into the prompt.
 *   v1.0.0 — 2026-03-06 — Initial portfolio API.
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage, GHIIRecord, AgentRecord } from '../storage/interface.js';
import { requireAuth, optionalAuth } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { emitChange } from '../services/event-bus.js';

/** Result of resolving a username to their published portfolio. */
export type PortfolioResolution =
  | { ok: true; html: string | null; ghii: GHIIRecord; agents: AgentRecord[]; portfolioConfig: Record<string, unknown> }
  | { ok: false; reason: 'user_not_found' | 'no_agent' | 'not_enabled' };

/**
 * Shared resolver: username → published portfolio HTML + owner identities.
 * Used by both the apex JSON route (GET /v1/portfolio/data/:username, which maps
 * reasons to granular 404 messages and tolerates html:null) and the
 * portfolio-origin serve route (<username>.portfolio.<apex>, which returns a
 * uniform 404 for every failure INCLUDING html:null).
 */
export async function resolvePublishedPortfolio(storage: Storage, username: string): Promise<PortfolioResolution> {
  const ghii = await storage.getGHIIByOwner(username);
  if (!ghii) return { ok: false, reason: 'user_not_found' };

  const agents = await storage.getAgentsByOwner(username);
  if (!agents.length) return { ok: false, reason: 'no_agent' };

  const configMem = await storage.getMemory(agents[0].gaii, 'portfolio.config');
  const portfolioConfig = (configMem?.value ?? null) as Record<string, unknown> | null;
  if (!portfolioConfig || !portfolioConfig.enabled) return { ok: false, reason: 'not_enabled' };

  const htmlFile = await storage.getStorageFile(agents[0].gaii, 'portfolio/index.html');
  return { ok: true, html: htmlFile ? htmlFile.data.toString('utf-8') : null, ghii, agents, portfolioConfig };
}

/** Valid DNS label for a portfolio subdomain (same shape as SUBDOMAIN_RE; kept local
 *  to avoid a portfolio ↔ subdomains import cycle). */
const PORTFOLIO_LABEL_RE = /^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/;

/**
 * Standalone portfolio-origin URL (`<username>.portfolio.<apex>`) for a username,
 * or null when the portfolio origin is disabled or the username is not a usable
 * DNS label (OWNER_RE allows up to 64 chars; DNS labels cap at 63 — such names
 * simply keep the apex URL only).
 */
export function portfolioStandaloneUrl(config: AimeatConfig, username: string): string | null {
  if (!config.portfolioOriginEnabled || !config.portfolioHost) return null;
  const label = username.toLowerCase();
  if (!PORTFOLIO_LABEL_RE.test(label)) return null;
  let scheme = 'https', portSuffix = '';
  try {
    const b = new URL(config.baseUrl);
    scheme = b.protocol.replace(':', '');
    portSuffix = b.port ? `:${b.port}` : '';
  // eslint-disable-next-line aimeat/no-silent-catch -- keep https, no port
  } catch { /* keep https, no port */ }
  return `${scheme}://${label}.${config.portfolioHost}${portSuffix}/`;
}

export function portfolioRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  /**
   * GET /v1/portfolio/catalog
   * Returns all publishable content for the authenticated user.
   * Used by the portfolio builder wizard to populate checkboxes.
   */
  router.get('/v1/portfolio/catalog', requireAuth(), async (req, res) => {
    const ownerName = req.auth!.owner;
    const agents = await storage.getAgentsByOwner(ownerName);
    if (!agents.length) {
      res.json(success(config.nodeId, { images: [], apps: [], boards: [], cortex: [], memories: [] }));
      return;
    }

    // One IN query for all agents' file metadata (was listStorageFiles per agent, twice over).
    const filesByAgent = await storage.listStorageFilesForOwners(agents.map(a => a.gaii));

    // Gather images from storage files
    const images: Array<{ key: string; gaii: string; mimeType: string; size: number; url: string; tags: string[] }> = [];
    for (const agent of agents) {
      const files = filesByAgent[agent.gaii] ?? [];
      for (const f of files) {
        if (f.mimeType.startsWith('image/')) {
          images.push({
            key: f.key,
            gaii: agent.gaii,
            mimeType: f.mimeType,
            size: f.size,
            url: `/v1/pub/${encodeURIComponent(agent.gaii)}/${encodeURIComponent(f.key)}`,
            tags: f.tags || [],
          });
        }
      }
    }

    // Gather apps
    const apps: Array<{ owner: string; filename: string; size: number; url: string }> = [];
    for (const agent of agents) {
      const files = filesByAgent[agent.gaii] ?? [];
      for (const f of files) {
        if (f.key.startsWith('apps/') && !f.key.startsWith('apps/screenshots/') && f.visibility === 'public') {
          apps.push({
            owner: agent.owner,
            filename: f.key.slice(5),
            size: f.size,
            url: `/v1/apps/${encodeURIComponent(agent.owner)}/${encodeURIComponent(f.key.slice(5))}`,
          });
        }
      }
    }

    // Gather boards owned by user
    const allBoards = await storage.listBoards();
    const myBoards = allBoards.filter(b => agents.some(a => a.gaii === b.ownerGaii));
    const boards = myBoards.map(b => ({
      id: b.id,
      name: b.name,
      visibility: b.visibility,
    }));

    // Gather cortex extensions installed by user
    let cortex: Array<{ name: string; description: string; version: string; tags: string[]; componentTypes: string[] }> = [];
    if (config.cortexEnabled) {
      const allExt = await storage.listCortexExtensions({ namespace: ownerName });
      cortex = allExt.map(e => ({
        name: e.name,
        description: e.description,
        version: e.version,
        tags: e.tags,
        componentTypes: [...new Set(e.components.map(c => c.type))],
      }));
    }

    // Gather public/owner memory entries (exclude system keys). gaii identifies the
    // record's owning identity — the builder needs it to compose the anonymous
    // public-read URL (/v1/memory/:gaii/:key) for the generated portfolio.
    const memories: Array<{ key: string; gaii: string; visibility: string; tags: string[]; preview: string }> = [];
    // One IN query for all agents' memory (was listMemory per agent). Records carry ownerGaii.
    const mems = await storage.listMemoryForOwners(agents.map(a => a.gaii));
    for (const m of mems) {
      if (m.visibility !== 'private' && !m.key.startsWith('_sys.')) {
        // Extract a short text preview from the value
        let preview = '';
        if (typeof m.value === 'string') {
          preview = m.value.slice(0, 120);
        } else if (m.value && typeof m.value === 'object') {
          const v = m.value as Record<string, unknown>;
          // Try common text fields: description, summary, title, text, content
          for (const f of ['description', 'summary', 'title', 'text', 'content', 'name']) {
            if (typeof v[f] === 'string' && v[f]) { preview = (v[f] as string).slice(0, 120); break; }
          }
          if (!preview) preview = JSON.stringify(m.value).slice(0, 120);
        }
        memories.push({ key: m.key, gaii: m.ownerGaii, visibility: m.visibility, tags: m.tags || [], preview });
      }
    }

    res.json(success(config.nodeId, {
      images: images.slice(0, config.portfolioMaxImages * 2),
      apps,
      boards,
      cortex,
      memories,
    }));
  });

  /**
   * GET /v1/portfolio/members
   * Public showcase: node members (owners) who have PUBLISHED a portfolio (portfolio.config.enabled).
   * Cached briefly — listing all owners + reading each portfolio.config is O(owners). Doubles as the
   * node's "discover people here" list.
   */
  let membersCache: { at: number; data: Array<Record<string, unknown>> } | null = null;
  const MEMBERS_TTL_MS = 60_000;
  router.get('/v1/portfolio/members', optionalAuth(), async (_req, res) => {
    if (membersCache && Date.now() - membersCache.at < MEMBERS_TTL_MS) {
      res.json(success(config.nodeId, { members: membersCache.data, total: membersCache.data.length }));
      return;
    }
    const ghiis = await storage.listGHIIs();
    // Batch: owner→agents in one IN query, then the portfolio.config key across every first-agent
    // gaii in one IN query (was getAgentsByOwner + getMemory PER owner = O(2·owners)).
    const agentsByOwner = await storage.getAgentsByOwners(ghiis.map(g => g.username));
    const firstByOwner = new Map<string, string>();
    for (const g of ghiis) {
      const a = agentsByOwner[g.username];
      if (a?.length) firstByOwner.set(g.username, a[0].gaii);
    }
    const cfgRows = await storage.listMemoryForOwners([...firstByOwner.values()], { prefix: 'portfolio.config' });
    const enabledGaiis = new Set(
      cfgRows
        .filter(m => m.key === 'portfolio.config' && (m.value as Record<string, unknown> | null)?.enabled)
        .map(m => m.ownerGaii),
    );
    const members: Array<Record<string, unknown>> = [];
    for (const g of ghiis) {
      const gaii = firstByOwner.get(g.username);
      if (gaii && enabledGaiis.has(gaii)) {
        // `ghii` is the member's full identifier (owner@node). The showcase renders each member
        // as an ID card, and the identifier is the part that makes it one — a name is a label,
        // an identifier is addressable: other people and their agents reach you by it.
        members.push({ username: g.username, ghii: g.ghii, display_name: g.displayName, avatar: g.avatar, bio: g.bio });
      }
    }
    membersCache = { at: Date.now(), data: members };
    res.json(success(config.nodeId, { members, total: members.length }));
  });

  /**
   * GET /v1/portfolio/config
   * Returns the user's portfolio configuration from memory.
   */
  router.get('/v1/portfolio/config', requireAuth(), async (req, res) => {
    const ownerName = req.auth!.owner;
    const agents = await storage.getAgentsByOwner(ownerName);
    if (!agents.length) {
      res.json(success(config.nodeId, { config: null }));
      return;
    }
    const mem = await storage.getMemory(agents[0].gaii, 'portfolio.config');
    res.json(success(config.nodeId, {
      config: mem?.value ?? null,
      // Where the portfolio is (or would be) served standalone — null when the
      // portfolio origin is disabled or the username isn't a valid DNS label.
      standalone_url: portfolioStandaloneUrl(config, ownerName),
    }));
  });

  /**
   * PUT /v1/portfolio/config
   * Saves the user's portfolio configuration to memory.
   */
  router.put('/v1/portfolio/config', requireAuth(), async (req, res) => {
    const ownerName = req.auth!.owner;
    const agents = await storage.getAgentsByOwner(ownerName);
    if (!agents.length) {
      res.status(400).json(error(config.nodeId, 'NO_AGENT', 'No agent found for this owner'));
      return;
    }
    const body = req.body ?? {};
    const now = new Date().toISOString();
    const existing = await storage.getMemory(agents[0].gaii, 'portfolio.config');
    await storage.setMemory({
      key: 'portfolio.config',
      ownerGaii: agents[0].gaii,
      value: body,
      visibility: 'owner',
      tags: body.tags || ['portfolio'],
      ttlHours: null,
      version: existing ? existing.version + 1 : 1,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
    res.json(success(config.nodeId, { saved: true }));
    emitChange('portfolio');
  });

  /**
   * PUT /v1/portfolio/upload
   * Upload portfolio HTML file (owner auth, stores under agent's storage).
   */
  router.put('/v1/portfolio/upload', requireAuth(), async (req, res) => {
    const ownerName = req.auth!.owner;
    const agents = await storage.getAgentsByOwner(ownerName);
    if (!agents.length) {
      res.status(400).json(error(config.nodeId, 'NO_AGENT', 'No agent found for this owner'));
      return;
    }

    const contentType = req.headers['content-type'] ?? '';
    if (!contentType.includes('text/html')) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'Content-Type must be text/html'));
      return;
    }

    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    }
    const fileData = Buffer.concat(chunks);

    const maxBytes = (config.portfolioMaxSizeKb ?? 512) * 1024;
    if (fileData.length > maxBytes) {
      res.status(413).json(error(config.nodeId, 'QUOTA_EXCEEDED', `File exceeds ${config.portfolioMaxSizeKb ?? 512}KB limit`));
      return;
    }

    // Delete existing portfolio file if any (upsert)
    await storage.deleteStorageFile(agents[0].gaii, 'portfolio/index.html');
    await storage.createStorageFile({
      key: 'portfolio/index.html',
      ownerGaii: agents[0].gaii,
      visibility: 'public',
      mimeType: 'text/html',
      size: fileData.length,
      data: fileData,
      createdAt: new Date().toISOString(),
    });

    res.json(success(config.nodeId, { uploaded: true, sizeKb: Math.round(fileData.length / 1024) }));
    emitChange('portfolio');
  });

  /**
   * GET /v1/portfolio/data/:username
   * Returns public portfolio data for a user (no auth required for public, auth for gated sections).
   */
  router.get('/v1/portfolio/data/:username', optionalAuth(), async (req, res) => {
    const username = req.params.username as string;
    const resolved = await resolvePublishedPortfolio(storage, username);
    if (!resolved.ok) {
      const messages: Record<string, string> = {
        user_not_found: `User "${username}" not found`,
        no_agent: 'No agent found for this user',
        not_enabled: 'Portfolio not enabled for this user',
      };
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', messages[resolved.reason]));
      return;
    }

    // Anonymous-mode note: optionalAuth injects a truthy shared identity
    // (anonymous: true) — a bare !!req.auth would report every visitor as
    // authenticated. The viewer uses this flag for the portfolio auth bridge.
    const isAuthenticated = !!req.auth && req.auth.anonymous !== true;
    const isOwner = isAuthenticated && req.auth?.owner === username;

    res.json(success(config.nodeId, {
      username,
      display_name: resolved.ghii.displayName,
      bio: resolved.ghii.bio,
      avatar: resolved.ghii.avatar,
      has_html: !!resolved.html,
      portfolio_html: resolved.html,
      viewer_authenticated: isAuthenticated,
      viewer_is_owner: isOwner,
      // Identities whose memory records the viewer's fetch bridge may proxy on
      // behalf of the portfolio iframe (GHII + all agent GAIIs of this owner) —
      // the allowlist that keeps the bridge from reading anyone else's records.
      owner_gaiis: [resolved.ghii.ghii, ...resolved.agents.map(a => a.gaii)],
      // Standalone-origin URL (<username>.portfolio.<apex>) when the portfolio
      // origin is enabled and the username is a usable DNS label; null otherwise.
      standalone_url: portfolioStandaloneUrl(config, username),
    }));
  });

  return router;
}
