/**
 * @file portfolio.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Portfolio routes — builder content catalog, per-user portfolio config,
 *   HTML upload (stored as a storage file), public showcase listing, and the public
 *   portfolio-data endpoint consumed by the SPA viewer.
 * @structure catalog / members / config (GET+PUT) / upload / data/:username
 *   portfolioWriteGaii() / portfolioReadGaiis() — which identity a portfolio is stored under
 *   (both in services/portfolio-config.ts, re-exported here)
 * @version-history
 *   v1.13.0 — 2026-10-18 — The publish gate (plan doc-mvcn6c7e4e5q, V4): PUT /v1/portfolio/config with
 *     `enabled: true` and PUT /v1/portfolio/upload with `enable: true`, by a caller the owner is asked
 *     about, store everything but the switch and answer 202 with `publish_request`
 *     (services/portfolio-publish-gate.ts). The keys, the identities and the switch writes moved to
 *     services/portfolio-config.ts by pure extraction; the PUT config write is mergePortfolioConfig.
 *   v1.12.0 — 2026-10-17 — SECURITY: portfolio/index.html is stored with visibility 'owner'. The
 *     origin serves the page from storage when the switch is on; the public file answered at
 *     /v1/pub for a page taken off the web (plan doc-mvcn6c7e4e5q, V0.3; migration 0103 for
 *     stored pages). GET /v1/portfolio/config's `html.url` is read by the owner's session.
 *   v1.11.0 — 2026-10-08 — writePortfolioHtml takes the writer and records the page's AI provenance
 *     (an agent's page is stamped model-written, a person's is not); resolvePublishedPortfolio names
 *     the record, and the portfolio origin serves its marks with the page.
 *   v1.10.1 — 2026-10-05 — The file's workspace binding goes to fileTarget (secaudit 2026-10, DATA-4).
 *   v1.10.0 — 2026-10-03 — `enable: true` on the JSON upload (and on the MCP tool) switches the page
 *     on unless the owner switched it off; the answer carries `served`. A card an AI published was
 *     stored and answered 404 for anyone who never pasted a mat. Without `enable`, nothing changes.
 *   v1.9.0 — 2026-09-29 — TARGET-082 review: the catalog's images pass the caller's reader too.
 *   v1.8.0 — 2026-09-29 — TARGET-082 V4: the catalog's memory entries pass the caller's ContentReader
 *     (presentMemories) before a preview is cut from a value.
 *   v1.7.1 — 2026-09-24 — /v1/portfolio/members reads services/portfolio-members.ts (moved there
 *     unchanged, so the /v1/members page body can use the same list).
 *   v1.7.0 — 2026-09-03 — GET /v1/portfolio/config also says where the stored page IS: `html`
 *     carries the public-file address of portfolio/index.html, its size and when it was stored, or
 *     null when no page has been made. The Portfolio tab previews the page and reads its title from
 *     that address, and it works for a page taken off the web too, since the public reader
 *     (data/:username) refuses those and the file itself does not move.
 *   v1.6.0 — 2026-08-10 — PUT /v1/portfolio/upload also accepts application/json { html }. The
 *     raw text/html body is what a browser sends and what this route was built for, but the
 *     connector has one JSON dispatch point for every request, so an agent served locally could
 *     not reach this route at all — which is why aimeat_portfolio_publish reached the agent
 *     surface with no connector half. Raw uploads behave exactly as before.
 *   v1.5.0 — 2026-08-09 — PUT /v1/portfolio/config MERGES onto the stored config instead of
 *     replacing it. A partial PUT from any surface silently dropped every field it did not
 *     send; the welcome-mat path next door has always merged, and the two disagreeing is how
 *     one would eventually erase the other's work.
 *   v1.4.1 — 2026-08-08 — /v1/portfolio/members looks in every identity a portfolio can live
 *     under, not just the owner's first agent. v1.4.0 moved agentless writes to the GHII but left
 *     this listing keyed on the first agent, so an account without an agent had a portfolio that
 *     was published and served yet appeared on no list — and an account that made its mat before
 *     connecting an agent stayed invisible afterwards too.
 *   v1.4.0 — 2026-08-07 — The portfolio no longer requires an agent (remake phase 2). The welcome
 *     mat IS the portfolio and is made BEFORE the first agent, so the 400 NO_AGENT on upload/config
 *     would have blocked the entire new path, and resolvePublishedPortfolio's `no_agent` refusal
 *     would have made the first thing anyone builds here invisible. Writes go to the first agent
 *     when there is one (old path unchanged) and to the owner's GHII when there is not; reads try
 *     every identity, so a mat made before an agent stays visible after one arrives.
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
import type { Storage, GHIIRecord, AgentRecord, AiProvenanceRecordRow } from '../storage/interface.js';
import { requireAuth, optionalAuth, requireScope } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { emitChange } from '../services/event-bus.js';
import { listPublishedMembers } from '../services/portfolio-members.js';
import { readerFor } from '../services/classification/reader.js';
import { presentMemories } from '../services/classification/present-memory.js';
import { fileTarget } from '../services/classification/labels.js';
import { provenanceForWrite, storeHeldProvenance } from '../services/ai-provenance.js';
import { loadServedProvenance, provenanceItemBlock } from '../services/ai-provenance-marks.js';
import { resolveIdentity } from '../utils/gaii.js';
import {
  PORTFOLIO_HTML_KEY, PORTFOLIO_CONFIG_KEY, portfolioWriteGaii, portfolioReadGaiis, switchPortfolioOnUnlessTurnedOff,
  mergePortfolioConfig,
} from '../services/portfolio-config.js';
import { callerOf } from '../middleware/caller.js';
import { portfolioRaiseAsk, filePortfolioAsk } from '../services/portfolio-publish-gate.js';
import { publishAskedFields, askedStatus } from '../services/app-publish-gate.js';

/** Result of resolving a username to their published portfolio. */
export type PortfolioResolution =
  | { ok: true; html: string | null; ghii: GHIIRecord; agents: AgentRecord[]; portfolioConfig: Record<string, unknown>;
      /** The page's AI-provenance record, when it has one: the serve path sends its marks. */
      aiProvenanceId?: string }
  | { ok: false; reason: 'user_not_found' | 'not_enabled' };

// The keys, the identities and the switch writes live in services/portfolio-config.ts (a service
// switches the page on too); re-exported here for every importer of this file.
export {
  PORTFOLIO_HTML_KEY, PORTFOLIO_CONFIG_KEY, portfolioWriteGaii, portfolioReadGaiis, switchPortfolioOnUnlessTurnedOff,
} from '../services/portfolio-config.js';

/**
 * Store one owner's welcome page, replacing whatever was there.
 *
 * Three copies of this existed — this route, the MCP publish tool, and the welcome-mat accept path —
 * and each wrote the same file under the same key with the same visibility. Which identity the page
 * lands under is already resolved in one place (portfolioWriteGaii above); the WRITE had no reason
 * to be resolved in three, and a fourth surface would have made a fourth.
 *
 * Returns the target identity, because every caller reports it back one way or another.
 *
 * `writer` is who wrote the page, for its AI-provenance record (B10): an agent that writes a page
 * and says nothing about it is stamped model-written (Mint-3), a person writing in person is not.
 * The page is public, so the record resolves for every visitor, and the portfolio origin serves its
 * marks with the page.
 */
export async function writePortfolioHtml(
  storage: Storage,
  target: string,
  data: Buffer,
  writer?: { config: AimeatConfig; principal: string; pipeline: string },
): Promise<string> {
  const held: AiProvenanceRecordRow[] = [];
  const aiProvenanceId = writer ? await provenanceForWrite(storage, {
    principal: writer.principal, content: data, pipeline: writer.pipeline,
    surface: { visibility: 'public', humanAudience: true },
    labelPolicy: writer.config.aiLabelPublic, nodeId: writer.config.nodeId, baseUrl: writer.config.baseUrl,
    enabled: writer.config.aiProvenance, held,
  }) : undefined;
  await storage.deleteStorageFile(target, PORTFOLIO_HTML_KEY);
  // The FILE is the owner's: the portfolio origin serves the page from storage while the switch is
  // on, and a public file stayed readable at /v1/pub after its owner took the page off the web.
  await storage.createStorageFile({
    key: PORTFOLIO_HTML_KEY,
    ownerGaii: target,
    visibility: 'owner',
    mimeType: 'text/html',
    size: data.length,
    data,
    createdAt: new Date().toISOString(),
    ...(aiProvenanceId ? { aiProvenanceId } : {}),
  });
  await storeHeldProvenance(storage, held);
  return target;
}

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

  const agents = await storage.getAgentsByOwner(username);
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
  router.get('/v1/portfolio/catalog', requireAuth(), requireScope('memory:read'), async (req, res) => {
    const ownerName = req.auth!.owner;
    const agents = await storage.getAgentsByOwner(ownerName);
    if (!agents.length) {
      res.json(success(config.nodeId, { images: [], apps: [], boards: [], cortex: [], memories: [] }));
      return;
    }

    // One IN query for all agents' file metadata (was listStorageFiles per agent, twice over).
    const filesByAgent = await storage.listStorageFilesForOwners(agents.map(a => a.gaii));
    // The files the catalog offers pass the caller's classification reader, as its memory entries do.
    const fileReader = readerFor({ storage, config }, req.auth);

    // Gather images from storage files
    const images: Array<{ key: string; gaii: string; mimeType: string; size: number; url: string; tags: string[] }> = [];
    for (const agent of agents) {
      const files = await fileReader.show(filesByAgent[agent.gaii] ?? [], f => fileTarget(f.ownerGaii, f.key, f.workspaceRef));
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
    // Only the records the builder could list pass the classification check, and it runs before a
    // preview is cut, so a record the caller may not see gives no preview either.
    const mems = await presentMemories(readerFor({ storage, config }, req.auth),
      (await storage.listMemoryForOwners(agents.map(a => a.gaii))).filter(m => m.visibility !== 'private' && !m.key.startsWith('_sys.')));
    for (const m of mems) {
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
   * node's "discover people here" list. The listing lives in services/portfolio-members.ts.
   */
  router.get('/v1/portfolio/members', optionalAuth(), async (_req, res) => {
    const members = await listPublishedMembers(storage);
    res.json(success(config.nodeId, { members, total: members.length }));
  });

  /**
   * GET /v1/portfolio/config
   * Returns the user's portfolio configuration from memory.
   */
  router.get('/v1/portfolio/config', requireAuth(), requireScope('memory:read'), async (req, res) => {
    const ownerName = req.auth!.owner;
    // Read across every identity this owner's portfolio could live under: the mat is written
    // under the GHII before any agent exists, and must stay visible once one does.
    let value: unknown = null;
    const candidates = await portfolioReadGaiis(storage, ownerName, config.nodeId);
    for (const gaii of candidates) {
      const mem = await storage.getMemory(gaii, PORTFOLIO_CONFIG_KEY);
      if (mem?.value) { value = mem.value; break; }
    }
    // The stored page itself, wherever it lives. Metadata only: the tab fetches the bytes from the
    // public-file address when it previews, and a config read stays a config read.
    let html: { url: string; size_kb: number; stored_at: string } | null = null;
    for (const gaii of candidates) {
      const meta = await storage.getStorageFileMeta(gaii, PORTFOLIO_HTML_KEY);
      if (meta) {
        html = {
          url: `/v1/pub/${encodeURIComponent(gaii)}/${PORTFOLIO_HTML_KEY}`,
          // Whole kilobytes, rounded up: a 300-byte page is "1 kB", never "0 kB".
          size_kb: Math.ceil(meta.size / 1024),
          stored_at: meta.createdAt,
        };
        break;
      }
    }
    res.json(success(config.nodeId, {
      config: value,
      // Where the portfolio is (or would be) served standalone — null when the
      // portfolio origin is disabled or the username isn't a valid DNS label.
      standalone_url: portfolioStandaloneUrl(config, ownerName),
      html,
    }));
  });

  /**
   * PUT /v1/portfolio/config
   * Saves the user's portfolio configuration to memory.
   *
   * MERGES onto what is already stored. It used to write the body as the whole value, so any other
   * surface that PUTs a partial config silently dropped every field it did not happen to send —
   * the welcome-mat path next door (routes/home/welcome-mat.ts) has always merged, and this generic
   * route disagreeing with it is how one of them would eventually erase the other's work. A caller
   * that wants a field GONE sends it as null rather than omitting it.
   */
  router.put('/v1/portfolio/config', requireAuth(), requireScope('memory:write'), async (req, res) => {
    const ownerName = req.auth!.owner;
    const target = await portfolioWriteGaii(storage, ownerName, config.nodeId);
    let body = (req.body ?? {}) as Record<string, unknown>;
    // The publish gate (plan doc-mvcn6c7e4e5q, V4): switching the page on makes it public. A caller the
    // node asks the owner about saves the rest of the config with the switch as it was, and the
    // request to switch it on is filed after the write.
    const gate = body.enabled === true
      ? await portfolioRaiseAsk({ storage, config }, callerOf(req, config.nodeId, storage), req.auth?.app, ownerName, { overridesOff: true })
      : { kind: 'go' as const };
    if (gate.kind === 'refused') {
      res.status(gate.status).json(error(config.nodeId, gate.code, gate.message));
      return;
    }
    if (gate.kind === 'ask') body = Object.fromEntries(Object.entries(body).filter(([k]) => k !== 'enabled'));
    await mergePortfolioConfig(storage, target, body);
    const asked = gate.kind === 'ask' ? await filePortfolioAsk({ storage, config }, ownerName, gate) : undefined;
    res.status(askedStatus(asked, 200)).json(success(config.nodeId, { saved: true, ...publishAskedFields(asked) }));
    emitChange('portfolio');
  });

  /**
   * PUT /v1/portfolio/upload
   * Upload portfolio HTML file (owner auth, stores under agent's storage).
   * Two content types, one behaviour: `text/html` with the document as the raw body (what the
   * browser sends), or `application/json` with `{ "html": "..." }`.
   */
  router.put('/v1/portfolio/upload', requireAuth(), requireScope('storage:write'), async (req, res) => {
    const ownerName = req.auth!.owner;
    // The NO_AGENT refusal that used to stand here is gone (11-avoimet-kysymykset.md): under the
    // remake the welcome mat IS the portfolio and it comes BEFORE the first agent, so the check
    // would have blocked the whole path. An owner who has an agent still writes under it.
    const target = await portfolioWriteGaii(storage, ownerName, config.nodeId);

    const contentType = req.headers['content-type'] ?? '';
    const isJson = contentType.includes('application/json');
    if (!contentType.includes('text/html') && !isJson) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT',
        'Content-Type must be text/html (raw body) or application/json with an "html" field'));
      return;
    }

    let fileData: Buffer;
    if (isJson) {
      // The JSON door is what an agent can actually reach. The connector speaks JSON over one
      // dispatch point, including the tunnel, so a raw text/html PUT is not a request it can make
      // — and aimeat_portfolio_publish sat on the agent surface with no connector half because of
      // it. Same shape as aimeat_company_portfolio_publish, which has taken { html } all along.
      const html = (req.body as { html?: unknown } | undefined)?.html;
      if (typeof html !== 'string' || html.length === 0) {
        res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'html is required and must be a non-empty string'));
        return;
      }
      fileData = Buffer.from(html, 'utf8');
    } else {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      }
      fileData = Buffer.concat(chunks);
    }

    const maxBytes = (config.portfolioMaxSizeKb ?? 512) * 1024;
    if (fileData.length > maxBytes) {
      res.status(413).json(error(config.nodeId, 'QUOTA_EXCEEDED', `File exceeds ${config.portfolioMaxSizeKb ?? 512}KB limit`));
      return;
    }

    // The JSON body is the agent's road (the connector's aimeat_portfolio_publish). `enable: true`
    // switches the page on, as the node's MCP tool does; without it the file and the switch stay two
    // acts. A browser upload keeps the Portfolio tab's own switch.
    const asksOn = isJson && (req.body as { enable?: unknown } | undefined)?.enable === true;
    // The publish gate (V4): switching a page on that was never switched makes it public. Asked before
    // the page is written, so a refusal stores nothing; on an ask the page is stored and stays off.
    const gate = asksOn
      ? await portfolioRaiseAsk({ storage, config }, callerOf(req, config.nodeId, storage), req.auth?.app, ownerName, { overridesOff: false })
      : { kind: 'go' as const };
    if (gate.kind === 'refused') {
      res.status(gate.status).json(error(config.nodeId, gate.code, gate.message));
      return;
    }
    const enable = asksOn && gate.kind === 'go';

    await writePortfolioHtml(storage, target, fileData,
      { config, principal: resolveIdentity(req.auth!, config.nodeId), pipeline: 'rest.portfolio.upload' });
    const served = isJson ? await switchPortfolioOnUnlessTurnedOff(storage, config.nodeId, ownerName, target, enable) : undefined;
    const asked = gate.kind === 'ask' ? await filePortfolioAsk({ storage, config }, ownerName, gate) : undefined;

    res.status(askedStatus(asked, 200)).json(success(config.nodeId, {
      uploaded: true, sizeKb: Math.round(fileData.length / 1024),
      ...(served === undefined ? {} : { served }),
      ...publishAskedFields(asked),
    }));
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
      // How the page was made (`ai_provenance`), when it names a record, so a viewer can show the label.
      ...provenanceItemBlock(await loadServedProvenance(storage, config, resolved.aiProvenanceId)),
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
