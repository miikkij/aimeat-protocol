/**
 * @file portfolio.ts
 * @description Portfolio routes — builder content catalog, per-user portfolio config,
 *   HTML upload (stored as a storage file), public showcase listing, and the public
 *   portfolio-data endpoint consumed by the SPA viewer.
 * @structure catalog / members / config (GET+PUT) / upload / data/:username
 * @version-history
 *   v1.1.0 — 2026-07-03 — Catalog memories entries carry the owning gaii so the builder
 *     can compose anonymous public-read URLs (/v1/memory/:gaii/:key) into the prompt.
 *   v1.0.0 — 2026-03-06 — Initial portfolio API.
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, optionalAuth } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { emitChange } from '../services/event-bus.js';

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

    // Gather images from storage files
    const images: Array<{ key: string; gaii: string; mimeType: string; size: number; url: string; tags: string[] }> = [];
    for (const agent of agents) {
      const files = await storage.listStorageFiles(agent.gaii);
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
      const files = await storage.listStorageFiles(agent.gaii);
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
    for (const agent of agents) {
      const mems = await storage.listMemory(agent.gaii);
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
          memories.push({ key: m.key, gaii: agent.gaii, visibility: m.visibility, tags: m.tags || [], preview });
        }
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
    const members: Array<Record<string, unknown>> = [];
    for (const g of ghiis) {
      try {
        const agents = await storage.getAgentsByOwner(g.username);
        if (!agents.length) continue;
        const cfg = await storage.getMemory(agents[0].gaii, 'portfolio.config');
        if (cfg?.value && (cfg.value as Record<string, unknown>).enabled) {
          members.push({ username: g.username, display_name: g.displayName, avatar: g.avatar, bio: g.bio });
        }
      } catch { /* skip a bad owner record */ }
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
    res.json(success(config.nodeId, { config: mem?.value ?? null }));
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
    const ghiiRecord = await storage.getGHIIByOwner(username);
    if (!ghiiRecord) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `User "${username}" not found`));
      return;
    }

    const agents = await storage.getAgentsByOwner(username);
    if (!agents.length) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No agent found for this user'));
      return;
    }

    // Get portfolio config
    const configMem = await storage.getMemory(agents[0].gaii, 'portfolio.config');
    if (!configMem?.value || !(configMem.value as Record<string, unknown>).enabled) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Portfolio not enabled for this user'));
      return;
    }

    const isAuthenticated = !!req.auth;
    const isOwner = req.auth?.owner === username;

    // Check if a generated portfolio HTML file exists in storage
    let portfolioHtml: string | null = null;
    const htmlFile = await storage.getStorageFile(agents[0].gaii, 'portfolio/index.html');
    if (htmlFile) {
      portfolioHtml = htmlFile.data.toString('utf-8');
    }

    res.json(success(config.nodeId, {
      username,
      display_name: ghiiRecord.displayName,
      bio: ghiiRecord.bio,
      avatar: ghiiRecord.avatar,
      has_html: !!portfolioHtml,
      portfolio_html: portfolioHtml,
      viewer_authenticated: isAuthenticated,
      viewer_is_owner: isOwner,
    }));
  });

  return router;
}
