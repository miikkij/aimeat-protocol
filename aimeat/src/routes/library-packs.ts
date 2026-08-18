/**
 * @file library-packs.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
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
 *   v1.2.0 — 2026-08-15 — A community pack's proof ledger is read by KEY and by WRITER, not by the
 *     packId inside the value. `libpack.proofs.*` is an ordinary public memory prefix, so any owner
 *     could publish a record naming somebody else's pack and see their forged `proven_models`
 *     served on the landing page, the Libraries tab and llms.txt — and replace the real ledger
 *     outright when their record was scanned last. The write side had the owner gate from the
 *     start (contribution-proofs.ts:137); only the read trusted the value. E2E test-quality audit
 *     finding A32.
 *   2026-07-19 — Self-reported acceleration proofs (AppDev KB Phase 8): community-pack + template proofs; self_reported labeling
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
import { parseGaiiLoose } from '../utils/gaii.js';
import { logger } from '../utils/logger.js';

/** The public memory prefix the proof ledger lives under — packProofsKey() in
 *  services/contribution-proofs.ts builds the same string on the write side. */
const PACK_PROOFS_PREFIX = 'libpack.proofs.';

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

/** Self-reported per-model proofs for community packs, keyed by pack id — one prefix read
 *  over the public `libpack.proofs.{packId}` records (attached via aimeat_appdev_proof_attach).
 *
 *  The ledger belongs to the pack's owner: attachContributionProof writes it under that owner's
 *  GHII and refuses anybody else (services/contribution-proofs.ts:137). This read has to ask the
 *  same question, because `libpack.proofs.*` is an ordinary public memory prefix any owner may
 *  write. Two things decide a record here, and neither is the value: the KEY names the pack, and
 *  the WRITER must be that pack's owner. Keying off `value.packId` let a stranger's record claim
 *  another pack and — depending on scan order — replace the genuine ledger in this map. */
async function loadCommunityProofs(storage: Storage, exts: CortexExtensionRecord[]): Promise<Map<string, unknown[]>> {
  const out = new Map<string, unknown[]>();
  const ownerByPack = new Map(exts.map(e => [e.name, e.installedBy]));
  try {
    const { items } = await storage.listAllMemory({ prefix: PACK_PROOFS_PREFIX, visibility: 'public', limit: 500 });
    for (const rec of items) {
      const packId = rec.key.slice(PACK_PROOFS_PREFIX.length);
      const packOwner = ownerByPack.get(packId);
      if (!packOwner || parseGaiiLoose(rec.ownerGaii).owner !== packOwner) continue;
      const v = rec.value as { proofs?: unknown[] } | null;
      if (Array.isArray(v?.proofs)) out.set(packId, v.proofs);
    }
  } catch (err) { logger.warn('loadCommunityProofs: best-effort — packs serve without proofs', { error: String(err) }); }
  return out;
}

/** Attach self-reported proofs (+ passing-model summary) to a community entry. Proofs never
 *  upgrade the vetting status — a community pack stays `preview`; self_reported labels the trust. */
function withCommunityProofs<T extends { id: string }>(entry: T, proofsByPack: Map<string, unknown[]>): T & Record<string, unknown> {
  const proofs = proofsByPack.get(entry.id);
  if (!proofs || proofs.length === 0) return entry;
  const proven = proofs
    .filter((p): p is { model: string; verdict: string } => !!p && typeof p === 'object' && (p as { verdict?: string }).verdict === 'pass')
    .map(p => p.model);
  return { ...entry, proofs, self_reported: true, proven_models: [...new Set(proven)] };
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
    let community: Array<Record<string, unknown>> = [];
    try {
      const exts = await communityExtensions(storage);
      const proofsByPack = await loadCommunityProofs(storage, exts);
      community = exts.map(e => withCommunityProofs(communityIndexEntry(e, config.baseUrl), proofsByPack));
    } catch (err) { logger.warn('GET /v1/library-packs: community listing is best-effort — the curated index always serves', { error: String(err) }); }

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
        const exts = await communityExtensions(storage);
        const ext = exts.find(e => e.name === id);
        if (ext) {
          const proofsByPack = await loadCommunityProofs(storage, exts);
          res.json(success(config.nodeId, {
            pack: withCommunityProofs(communityPackDetail(ext, config.baseUrl), proofsByPack),
          }));
          return;
        }
      } catch (err) { logger.warn('ext: fall through to 404', { error: String(err) }); }
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
