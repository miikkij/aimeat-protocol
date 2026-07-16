/**
 * @file library-packs.ts
 * @description Serves the library-pack registry — the per-library AI documentation surface
 *   of the Library Acceleration Program. GET /v1/library-packs returns the compact index
 *   (no aiDoc/changelog); GET /v1/library-packs/:id returns one pack WITH its full AI usage
 *   doc (ai_doc), changelog and rendered include lines. Public data (CORS *), no auth — this
 *   is what the build-app prompt tells AIs to fetch before using a capability pack.
 *
 *   Two pack sources merge into one index:
 *   - scope 'node': the static curated registry (src/data/library-packs.ts).
 *   - scope 'community': ACTIVE + PUBLIC user-installed cortex extensions that ship a lib
 *     component — the shape the profile→Extensions generator produces (type:prompt doc +
 *     type:lib api_surface + version). Their type:prompt content serves as the ai_doc, so a
 *     user-published library is discoverable/usable by build-time AIs exactly like node packs.
 * @structure libraryPacksRouter(config, storage) → Router · communityPackIndex() ·
 *   communityPackDetail() · libraryPackIds()
 * @usage app.use(libraryPacksRouter(config, storage)) from routes-loader.
 * @version-history
 *   v1.1.0 — 2026-07-17 — community packs: active+public user cortexes with a lib component
 *     appear in the index (scope 'community') and serve their type:prompt doc as ai_doc.
 *   v1.0.0 — 2026-07-16 — initial: index + by-id endpoints over the library-pack registry
 *     (Library Acceleration Program, Phase 1).
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage, CortexExtensionRecord } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';
import { getLibraryPacks, getLibraryPackIndex, getLibraryPack, renderPackText } from '../data/library-packs.js';

/** Known index categories a community pack may declare via labels.domain / tags. */
const KNOWN_CATEGORIES = new Set(['core', 'ai', 'ui', 'visualization', 'diagrams', 'canvas', 'game', '3d', 'realtime', 'economy', 'media']);

function communityCategory(ext: CortexExtensionRecord): string {
  const domain = (ext.labels && ext.labels.domain) || '';
  if (KNOWN_CATEGORIES.has(domain)) return domain;
  const tagHit = (ext.tags || []).find(t => KNOWN_CATEGORIES.has(t));
  return tagHit || 'ui';
}

/** ACTIVE + PUBLIC user cortexes with a lib component, minus the node-curated registry ids. */
async function communityExtensions(storage: Storage): Promise<CortexExtensionRecord[]> {
  const staticIds = new Set(getLibraryPacks().map(p => p.id));
  const all = await storage.listCortexExtensions({ status: 'active' });
  return all.filter(ext =>
    ext.visibility === 'public'
    && !staticIds.has(ext.name)
    && ext.components.some(c => c.type === 'lib'),
  );
}

/** Compact index entry for a community cortex — same field shape as the static index. */
function communityIndexEntry(ext: CortexExtensionRecord, baseUrl: string) {
  const lib = ext.components.find(c => c.type === 'lib') as unknown as { filename: string };
  const url = `/v1/cortex/${ext.name}/libs/${lib.filename}`;
  return {
    id: ext.name,
    kind: 'cortex' as const,
    scope: 'community' as const,
    category: communityCategory(ext),
    title: ext.shortName || ext.name,
    description: ext.description,
    url,
    include: [`<script src="${baseUrl.replace(/\/+$/, '')}${url}"></script>`],
    requires: [] as string[],
    version: ext.version,
    license: ext.license || 'unspecified',
    apiSurface: `AIMEAT (see ai_doc — community lib by ${ext.author || ext.installedBy})`,
    tierHint: 'T2' as const,
    interviewTriggers: ext.tags || [],
    sizeEstimate: '?',
    // Community packs are unvetted by the node — always preview (no AEB gate ran on them).
    status: 'preview' as const,
  };
}

/** Full detail for a community cortex: ai_doc = its type:prompt content ({{node_url}} rendered). */
function communityPackDetail(ext: CortexExtensionRecord, baseUrl: string) {
  const entry = communityIndexEntry(ext, baseUrl);
  const prompt = ext.components.find(c => c.type === 'prompt') as { content?: string } | undefined;
  const lib = ext.components.find(c => c.type === 'lib') as { api_surface?: string } | undefined;
  const doc = (prompt && prompt.content) || (lib && lib.api_surface) || ext.description;
  const base = baseUrl.replace(/\/+$/, '');
  return {
    ...entry,
    ai_doc: String(doc).replaceAll('{{node_url}}', base).replaceAll('{{BASE_URL}}', base),
    changelog: [
      { version: ext.version, date: (ext.activatedAt || ext.installedAt || '').slice(0, 10), summary: `Community cortex library published on this node by ${ext.installedBy}. Unvetted by the node operator — read the ai_doc and prefer node-scope packs when one covers the same need.` },
    ],
  };
}

export function libraryPacksRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  // GET /v1/library-packs[?kind=&category=&status=&scope=] — compact index (node + community).
  router.get('/v1/library-packs', async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    const kind = typeof req.query.kind === 'string' ? req.query.kind : undefined;
    const category = typeof req.query.category === 'string' ? req.query.category : undefined;
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const scope = typeof req.query.scope === 'string' ? req.query.scope : undefined;
    const lang = typeof req.query.lang === 'string' ? req.query.lang : undefined;

    const staticIndex = getLibraryPackIndex(lang).map(p => ({
      ...p,
      scope: 'node' as const,
      include: p.include.map(l => renderPackText(l, config.baseUrl)),
    }));
    let community: ReturnType<typeof communityIndexEntry>[] = [];
    try {
      community = (await communityExtensions(storage)).map(e => communityIndexEntry(e, config.baseUrl));
    } catch { /* community listing is best-effort — the curated index always serves */ }

    let packs: Array<Record<string, unknown>> = [...staticIndex, ...community];
    if (kind) packs = packs.filter(p => p.kind === kind);
    if (category) packs = packs.filter(p => p.category === category);
    if (status) packs = packs.filter(p => p.status === status);
    if (scope) packs = packs.filter(p => p.scope === scope);
    res.json(success(config.nodeId, { packs }, [
      { description: 'One pack with its full AI usage doc + changelog', method: 'GET', url: '/v1/library-packs/{id}' },
    ]));
  });

  // GET /v1/library-packs/:id — one pack WITH ai_doc + changelog (the doc an AI reads before use).
  router.get('/v1/library-packs/:id', async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    const id = req.params.id as string;
    const pack = getLibraryPack(id);
    if (!pack) {
      // Community fallback: an active+public user cortex with a lib component.
      try {
        const ext = (await communityExtensions(storage)).find(e => e.name === id);
        if (ext) {
          res.json(success(config.nodeId, { pack: communityPackDetail(ext, config.baseUrl) }));
          return;
        }
      } catch { /* fall through to 404 */ }
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `No library pack "${id}"`));
      return;
    }
    // Strip the prompt-rendering fields (promptLine/promptGroup) — they are build-prompt
    // internals, not part of the pack contract.
    const rest: Record<string, unknown> = { ...pack };
    delete rest.promptLine;
    delete rest.promptGroup;
    delete rest.aiDoc;
    res.json(success(config.nodeId, {
      pack: {
        ...rest,
        scope: 'node',
        include: pack.include.map(l => renderPackText(l, config.baseUrl)),
        ai_doc: renderPackText(pack.aiDoc, config.baseUrl),
      },
    }));
  });

  return router;
}

/** Names of all registered packs — for E2E/consistency checks. */
export function libraryPackIds(): string[] {
  return getLibraryPacks().map(p => p.id);
}
