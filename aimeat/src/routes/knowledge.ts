import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import type { AimeatConfig } from '../config.js';
import type { Storage, KnowledgeManifest, MemoryLinkRecord, OperatorReviewRecord, OperatorReviewAction } from '../storage/interface.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { ManifestSchema } from '../schemas/knowledge-package.js';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
/* eslint-disable @typescript-eslint/no-require-imports */
const ajvPkg = require('ajv');
const formatsPkg = require('ajv-formats');
/* eslint-enable @typescript-eslint/no-require-imports */
const AjvClass = ajvPkg.default ?? ajvPkg;
const addFormats = formatsPkg.default ?? formatsPkg;

const ajv = new AjvClass({ allErrors: true });
addFormats(ajv);
const validateManifest = ajv.compile(ManifestSchema);

export function knowledgeRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  /* ── POST /v1/packages/import — Import a knowledge package from AI Chat output ── */
  router.post('/v1/packages/import', requireAuth(), async (req, res) => {
    const ownerGaii = req.auth!.sub as string;
    const ghii = req.auth!.owner as string;
    const { package: pkg, overrides } = req.body;

    if (!pkg || typeof pkg !== 'object') {
      res.status(400).json(error(config.nodeId, 'INVALID_PACKAGE', 'Request body must include a "package" object'));
      return;
    }

    // Normalize AI chat output format → strict manifest format
    if (!pkg.type && pkg.aimeat_knowledge_package) pkg.type = 'knowledge-package';
    if (!pkg.type) pkg.type = 'knowledge-package';
    if (!pkg.name && pkg.title) pkg.name = pkg.title;
    if (!pkg.name && pkg.id) pkg.name = pkg.id;
    if (!pkg.version) pkg.version = '1.0.0';
    if (!pkg.author) pkg.author = ghii;
    if (!pkg.synthesis) {
      pkg.synthesis = { level: 'original', description: 'Imported from AI chat' };
    }
    if (!pkg.sharing) {
      const catalogListed = overrides?.catalog_listed ?? false;
      pkg.sharing = {
        catalog_listed: catalogListed,
        allow_clone: catalogListed,
        morsel_price: 0,
      };
    }
    if (!pkg.tags) pkg.tags = [];
    if (!pkg.language) pkg.language = 'en';
    // Normalize entries: ensure each has title, default visibility
    if (Array.isArray(pkg.entries)) {
      for (const entry of pkg.entries) {
        if (!entry.title) entry.title = entry.key || 'Untitled';
        if (!entry.visibility) entry.visibility = 'private';
      }
    }

    // Validate manifest structure
    const manifest = pkg as KnowledgeManifest;
    if (!validateManifest(manifest)) {
      res.status(400).json(error(config.nodeId, 'SCHEMA_VALIDATION', 'Package manifest validation failed', validateManifest.errors));
      return;
    }

    const packageId = uuidv4();
    const now = new Date().toISOString();
    const manifestKey = `packages/${packageId}/manifest`;

    // Apply overrides to entries if provided
    if (overrides?.entries) {
      for (const entry of manifest.entries) {
        const entryName = entry.key.split('/').pop() ?? entry.key;
        const entryOverride = overrides.entries[entryName];
        if (entryOverride?.visibility) {
          entry.visibility = entryOverride.visibility;
        }
      }
    }
    if (overrides?.catalog_listed !== undefined) {
      manifest.sharing.catalog_listed = overrides.catalog_listed;
      // If catalog_listed is enabled and allow_clone wasn't explicitly set, enable cloning
      if (overrides.catalog_listed && !manifest.sharing.allow_clone) {
        manifest.sharing.allow_clone = true;
      }
    }

    // Store manifest
    manifest.created = now;
    manifest.updated = now;
    await storage.setMemory({
      key: manifestKey,
      ownerGaii,
      value: manifest,
      visibility: manifest.sharing.catalog_listed ? 'public' : 'owner',
      tags: ['knowledge-package', manifest.content_type, ...manifest.tags],
      ttlHours: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });

    // Store entries — content can be in pkg.entry_data, req.body.entry_data,
    // or directly on each entry's .value field (AI chat output format)
    const entryData = (pkg as any).entry_data ?? (req.body.entry_data ?? {});
    // Extract inline values from entries into entryData
    for (const entry of manifest.entries) {
      if ((entry as any).value !== undefined) {
        const entryName = entry.key.split('/').pop() ?? entry.key;
        if (!entryData[entry.key] && !entryData[entryName]) {
          entryData[entryName] = (entry as any).value;
        }
      }
    }
    const createdEntries: string[] = [];
    for (const entry of manifest.entries) {
      const entryKey = entry.key.startsWith('packages/')
        ? entry.key
        : `packages/${packageId}/${entry.key}`;
      entry.key = entryKey; // Normalize
      const data = entryData[entry.key] ?? entryData[entry.key.split('/').pop() ?? ''] ?? {};
      await storage.setMemory({
        key: entryKey,
        ownerGaii,
        value: data,
        visibility: entry.visibility,
        tags: ['knowledge-entry', manifest.content_type, ...manifest.tags],
        ttlHours: null,
        version: 1,
        createdAt: now,
        updatedAt: now,
      });
      createdEntries.push(entryKey);
    }

    // Create memory links if specified
    for (const link of manifest.links ?? []) {
      await storage.createLink({
        source: manifestKey,
        target: link.target,
        relation: link.relation,
        description: link.description,
        linked_at: link.linked_at || now,
        linked_by: ghii,
      });
    }

    // Create organism consent grant if requested
    if (overrides?.organism_share) {
      await storage.createConsent({
        id: uuidv4(),
        ownerGaii,
        dataPattern: `packages/${packageId}/*`,
        recipient: `organism.${overrides.organism_share}`,
        purpose: 'Knowledge package shared with organism',
        scope: 'private',
        expires: null,
        status: 'active',
        grantedAt: now,
        revokedAt: null,
      });
    }

    res.status(201).json(success(config.nodeId, {
      package_id: packageId,
      manifest_key: manifestKey,
      entries_created: createdEntries.length,
      catalog_listed: manifest.sharing.catalog_listed,
    }, [
      { description: 'View package manifest', method: 'GET', url: `/v1/memory/${encodeURIComponent(manifestKey)}` },
      { description: 'List your packages', method: 'GET', url: '/v1/memory?prefix=packages/&tags=knowledge-package' },
    ]));
  });

  /* ── GET /v1/packages/:id — Get package manifest ── */
  router.get('/v1/packages/:id', async (req, res) => {
    const packageId = req.params.id as string;
    const manifestKey = `packages/${packageId}/manifest`;

    // Try public read first
    const memories = await storage.listMemory('', { prefix: manifestKey, visibility: 'public' });
    const manifest = memories[0];
    if (!manifest) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Package not found or not public'));
      return;
    }

    res.json(success(config.nodeId, {
      package_id: packageId,
      manifest: manifest.value,
      tags: manifest.tags,
      created_at: manifest.createdAt,
      updated_at: manifest.updatedAt,
    }));
  });

  /* ── POST /v1/packages/:id/link — Create a link from this package to another memory ── */
  router.post('/v1/packages/:id/link', requireAuth(), requireRole('agent'), async (req, res) => {
    const ownerGaii = req.auth!.sub as string;
    const ghii = req.auth!.owner as string;
    const packageId = req.params.id as string;
    const { target, relation, description } = req.body;

    if (!target || !relation || !description) {
      res.status(400).json(error(config.nodeId, 'MISSING_FIELDS', 'target, relation, and description are required'));
      return;
    }

    const validRelations = ['related-to', 'extends', 'derived-from', 'contradicts', 'supersedes', 'references'];
    if (!validRelations.includes(relation)) {
      res.status(400).json(error(config.nodeId, 'INVALID_RELATION', `relation must be one of: ${validRelations.join(', ')}`));
      return;
    }

    const manifestKey = `packages/${packageId}/manifest`;
    const existing = await storage.getMemory(ownerGaii, manifestKey);
    if (!existing) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Package not found'));
      return;
    }

    const now = new Date().toISOString();
    const link: MemoryLinkRecord = {
      source: manifestKey,
      target,
      relation,
      description,
      linked_at: now,
      linked_by: ghii,
    };

    await storage.createLink(link);

    // Also update the manifest's links array
    const manifestValue = existing.value as KnowledgeManifest;
    manifestValue.links = manifestValue.links ?? [];
    manifestValue.links.push({ target, relation, description, linked_at: now });
    manifestValue.updated = now;
    existing.value = manifestValue;
    existing.updatedAt = now;
    existing.version += 1;
    await storage.setMemory(existing);

    res.status(201).json(success(config.nodeId, { link }, [
      { description: 'List package links', method: 'GET', url: `/v1/packages/${packageId}/links` },
    ]));
  });

  /* ── GET /v1/packages/:id/links — List links for a package ── */
  router.get('/v1/packages/:id/links', async (req, res) => {
    const packageId = req.params.id as string;
    const manifestKey = `packages/${packageId}/manifest`;
    const direction = (req.query.direction as string) ?? 'both';
    const relation = req.query.relation as string | undefined;

    const links = await storage.listLinks(manifestKey, {
      direction: direction as 'outgoing' | 'incoming' | 'both',
      relation,
    });

    res.json(success(config.nodeId, { links, count: links.length }));
  });

  /* ── DELETE /v1/packages/:id/link — Delete a link ── */
  router.delete('/v1/packages/:id/link', requireAuth(), requireRole('agent'), async (req, res) => {
    const packageId = req.params.id as string;
    const { target } = req.body;
    if (!target) {
      res.status(400).json(error(config.nodeId, 'MISSING_FIELDS', 'target is required'));
      return;
    }

    const manifestKey = `packages/${packageId}/manifest`;
    const deleted = await storage.deleteLink(manifestKey, target);
    if (!deleted) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Link not found'));
      return;
    }

    res.json(success(config.nodeId, { deleted: true }));
  });

  /* ── GET /v1/packages/:id/broken-links — Find broken links ── */
  router.get('/v1/packages/:id/broken-links', requireAuth(), requireRole('agent'), async (req, res) => {
    const ownerGaii = req.auth!.sub as string;
    const broken = await storage.findBrokenLinks(ownerGaii);

    res.json(success(config.nodeId, { broken_links: broken, count: broken.length }));
  });

  /* ── Built-in prompt templates (used when no custom template is stored) ── */
  const DEFAULT_HUMAN_PROMPT = `You are a knowledge packager for AIMEAT node {node_id}.

Take the research, notes, or content I provide and structure it as an AIMEAT knowledge package.

Output a JSON object with this structure:
\`\`\`json
{
  "aimeat_knowledge_package": true,
  "package": {
    "type": "knowledge-package",
    "name": "Package Title",
    "version": "1.0.0",
    "author": "{ghii}",
    "description": "Brief description",
    "content_type": "research",
    "language": "en",
    "tags": ["tag1", "tag2"],
    "synthesis": { "level": "original", "description": "How it was created" },
    "sharing": { "catalog_listed": false, "allow_clone": false, "morsel_price": 0 },
    "entries": [
      { "key": "section-name", "title": "Section Name", "value": "content here", "visibility": "private" }
    ],
    "references": [
      { "title": "Source Title", "url": "https://example.com/source", "type": "article", "verified": false }
    ]
  }
}
\`\`\`

Valid content_type values: idea, research, plan, dataset, document, tutorial, collection, article, story, fiction.
Valid visibility values: private, owner, public.
Valid synthesis levels: original, assisted, synthesized, ai-generated.
Valid reference types: article, paper, book, website, dataset, video, code, standard, patent, report.

IMPORTANT: Always include a "references" array with any sources, citations, links, or references used. Each reference should have a title, url (if available), type, and verified: false (since you cannot verify links). Even if no explicit sources are provided, include any URLs or documents mentioned in the content.

Node URL: {node_url}
Owner: {ghii}`;

  const DEFAULT_AGENT_PROMPT = `You are an AIMEAT knowledge packager agent.

Authenticate: POST {auth_endpoint}
API Spec: {openapi_spec}
Agent GAII: {agent_gaii}
Node: {node_id} at {node_url}

Import packages via POST {node_url}/v1/packages/import with body:
{ "package": <knowledge_package_json>, "overrides": {} }

Output structured AIMEAT knowledge packages as JSON.`;

  /* ── GET /v1/templates/knowledge-packager-human — Get human prompt template ── */
  router.get('/v1/templates/knowledge-packager-human', requireAuth(), async (req, res) => {
    const ghii = req.auth!.owner as string;
    const nodeUrl = config.baseUrl || `http://localhost:${config.port}`;
    const stored = await storage.getMemory(req.auth!.sub as string, 'templates/knowledge-packager-human');

    let text = stored
      ? (typeof stored.value === 'string' ? stored.value : JSON.stringify(stored.value))
      : DEFAULT_HUMAN_PROMPT;
    text = text.replace(/\{ghii\}/g, ghii);
    text = text.replace(/\{node_url\}/g, nodeUrl);
    text = text.replace(/\{node_id\}/g, config.nodeId);

    res.json(success(config.nodeId, { prompt: text, ghii, node_url: nodeUrl, node_id: config.nodeId }));
  });

  /* ── GET /v1/templates/knowledge-packager-agent — Get agent prompt template ── */
  router.get('/v1/templates/knowledge-packager-agent', requireAuth(), async (req, res) => {
    const ghii = req.auth!.owner as string;
    const gaii = req.auth!.sub as string;
    const nodeUrl = config.baseUrl || `http://localhost:${config.port}`;
    const stored = await storage.getMemory(gaii, 'templates/knowledge-packager-agent');

    let text = stored
      ? (typeof stored.value === 'string' ? stored.value : JSON.stringify(stored.value))
      : DEFAULT_AGENT_PROMPT;
    text = text.replace(/\{ghii\}/g, ghii);
    text = text.replace(/\{node_url\}/g, nodeUrl);
    text = text.replace(/\{node_id\}/g, config.nodeId);
    text = text.replace(/\{agent_gaii\}/g, gaii);
    text = text.replace(/\{auth_endpoint\}/g, `${nodeUrl}/v1/auth/token`);
    text = text.replace(/\{openapi_spec\}/g, `${nodeUrl}/v1/openapi.yaml`);

    res.json(success(config.nodeId, { prompt: text, ghii, gaii, node_url: nodeUrl, node_id: config.nodeId }));
  });

  /* ── Chat session prompt templates ── */
  const DEFAULT_CHAT_SESSION_PROMPT = `You are about to connect to an AIMEAT node as a chat session agent.

This lets your conversation be registered on the AIMEAT network, giving you access to the user's memory, knowledge packages, wallet, and other AIMEAT services.

## How to Connect

### Step 1: Get a connectivity key
The user needs to generate one from their profile, or you can request one:

\`\`\`
POST {node_url}/v1/auth/connectivity-key
Authorization: Bearer <owner_jwt>
Content-Type: application/json

{
  "agent_name": "session-<platform>-<timestamp>",
  "description": "Chat session from <platform>"
}
\`\`\`

### Step 2: Register using the connectivity key
\`\`\`
POST {node_url}/v1/agents/connect
Content-Type: application/json

{
  "connectivity_key": "<key_from_step_1>",
  "agent_name": "session-<platform>-<timestamp>",
  "display_name": "Chat Session — <Platform Name>"
}
\`\`\`

This returns your agent credentials (GAII + private key). Store the private key — it's shown only once.

### Step 3: Authenticate
Sign your GAII + timestamp with your Ed25519 private key:
\`\`\`
POST {node_url}/v1/auth/token
Content-Type: application/json

{
  "gaii": "<your_gaii>",
  "timestamp": "<ISO_timestamp>",
  "signature": "<base64_ed25519_signature>"
}
\`\`\`

### Step 4: Use AIMEAT services
With your JWT token, you can now:
- Read/write memory: GET/POST {node_url}/v1/memory
- Access knowledge: GET {node_url}/v1/packages
- Check wallet: GET {node_url}/v1/wallet
- Browse catalogue: GET {node_url}/v1/catalogue
- Post to boards: POST {node_url}/v1/boards/:id/posts

Node: {node_id}
Node URL: {node_url}
Owner: {ghii}
API Spec: {node_url}/v1/openapi.yaml`;

  const DEFAULT_CHAT_SESSION_QUICK_PROMPT = `Read this URL and follow the instructions: {node_url}/v1/prompts/anonymous/share

This will connect you to my AIMEAT node ({node_id}) where you can access my memory, knowledge, and other AI services.

Node: {node_url}
Owner: {ghii}`;

  /* ── GET /v1/templates/chat-session-human — Get chat session human prompt ── */
  router.get('/v1/templates/chat-session-human', requireAuth(), async (req, res) => {
    const ghii = req.auth!.owner as string;
    const nodeUrl = config.baseUrl || `http://localhost:${config.port}`;
    const stored = await storage.getMemory(req.auth!.sub as string, 'templates/chat-session-human');

    let text = stored
      ? (typeof stored.value === 'string' ? stored.value : JSON.stringify(stored.value))
      : DEFAULT_CHAT_SESSION_PROMPT;
    text = text.replace(/\{ghii\}/g, ghii);
    text = text.replace(/\{node_url\}/g, nodeUrl);
    text = text.replace(/\{node_id\}/g, config.nodeId);

    res.json(success(config.nodeId, { prompt: text, ghii, node_url: nodeUrl, node_id: config.nodeId }));
  });

  /* ── GET /v1/templates/chat-session-quick — Get quick session prompt (paste into any AI) ── */
  router.get('/v1/templates/chat-session-quick', requireAuth(), async (req, res) => {
    const ghii = req.auth!.owner as string;
    const nodeUrl = config.baseUrl || `http://localhost:${config.port}`;
    const stored = await storage.getMemory(req.auth!.sub as string, 'templates/chat-session-quick');

    let text = stored
      ? (typeof stored.value === 'string' ? stored.value : JSON.stringify(stored.value))
      : DEFAULT_CHAT_SESSION_QUICK_PROMPT;
    text = text.replace(/\{ghii\}/g, ghii);
    text = text.replace(/\{node_url\}/g, nodeUrl);
    text = text.replace(/\{node_id\}/g, config.nodeId);

    res.json(success(config.nodeId, { prompt: text, ghii, node_url: nodeUrl, node_id: config.nodeId }));
  });

  /* ── PATCH /v1/packages/:id/sharing — Update package sharing settings ── */
  router.patch('/v1/packages/:id/sharing', requireAuth(), requireRole('agent'), async (req, res) => {
    const ownerGaii = req.auth!.sub as string;
    const packageId = req.params.id as string;
    const { catalog_listed, allow_clone } = req.body ?? {};

    const manifestKey = `packages/${packageId}/manifest`;
    const existing = await storage.getMemory(ownerGaii, manifestKey);
    if (!existing) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Package not found'));
      return;
    }

    const manifest: Record<string, any> = typeof existing.value === 'string'
      ? JSON.parse(existing.value as string)
      : Object.assign({}, existing.value as Record<string, any>);
    if (!manifest.sharing) manifest.sharing = { catalog_listed: false, allow_clone: false, morsel_price: 0 };

    if (catalog_listed !== undefined) manifest.sharing.catalog_listed = !!catalog_listed;
    if (allow_clone !== undefined) manifest.sharing.allow_clone = !!allow_clone;
    // If catalog_listed enabled, ensure allow_clone is also enabled
    if (manifest.sharing.catalog_listed && !manifest.sharing.allow_clone && allow_clone === undefined) {
      manifest.sharing.allow_clone = true;
    }
    manifest.updated = new Date().toISOString();

    const now = new Date().toISOString();
    await storage.setMemory({
      key: manifestKey,
      ownerGaii,
      value: manifest,
      visibility: manifest.sharing.catalog_listed ? 'public' : 'owner',
      tags: existing.tags || ['knowledge-package'],
      ttlHours: null,
      version: (existing.version || 0) + 1,
      createdAt: existing.createdAt || now,
      updatedAt: now,
    });

    res.json(success(config.nodeId, {
      package_id: packageId,
      sharing: manifest.sharing,
    }));
  });

  /* ── PATCH /v1/packages/:id/entries/:entryKey/visibility — Change entry visibility ── */
  router.patch('/v1/packages/:id/entries/:entryKey/visibility', requireAuth(), requireRole('agent'), async (req, res) => {
    const ownerGaii = req.auth!.sub as string;
    const packageId = req.params.id as string;
    const entryKey = req.params.entryKey as string;
    const { visibility } = req.body ?? {};

    if (!['private', 'owner', 'public'].includes(visibility)) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'Visibility must be private, owner, or public'));
      return;
    }

    const manifestKey = `packages/${packageId}/manifest`;
    const existing = await storage.getMemory(ownerGaii, manifestKey);
    if (!existing) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Package not found'));
      return;
    }

    const manifest: Record<string, any> = typeof existing.value === 'string'
      ? JSON.parse(existing.value as string)
      : Object.assign({}, existing.value as Record<string, any>);

    // Find and update the entry in the manifest
    const entries = manifest.entries || [];
    const entry = entries.find((e: any) => e.key === entryKey || e.key.endsWith('/' + entryKey));
    if (!entry) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Entry not found in package'));
      return;
    }

    entry.visibility = visibility;
    manifest.updated = new Date().toISOString();

    const now = new Date().toISOString();
    await storage.setMemory({
      key: manifestKey,
      ownerGaii,
      value: manifest,
      visibility: manifest.sharing?.catalog_listed ? 'public' : 'owner',
      tags: existing.tags || ['knowledge-package'],
      ttlHours: null,
      version: (existing.version || 0) + 1,
      createdAt: existing.createdAt || now,
      updatedAt: now,
    });

    // Also update the individual entry's memory record visibility
    const fullEntryKey = entry.key.startsWith('packages/')
      ? entry.key
      : `packages/${packageId}/${entry.key}`;
    const entryRecord = await storage.getMemory(ownerGaii, fullEntryKey);
    if (entryRecord) {
      await storage.setMemory({
        ...entryRecord,
        visibility,
        updatedAt: now,
        version: (entryRecord.version || 0) + 1,
      });
    }

    res.json(success(config.nodeId, {
      package_id: packageId,
      entry_key: entryKey,
      visibility,
    }));
  });

  /* ── POST /v1/packages/:id/clone — Clone public entries to your own namespace ── */
  router.post('/v1/packages/:id/clone', requireAuth(), async (req, res) => {
    const requesterGaii = req.auth!.sub as string;
    const requesterGhii = req.auth!.owner as string;
    const sourcePackageId = req.params.id as string;
    const { target_prefix, entries: requestedEntries } = req.body;

    const sourceManifestKey = `packages/${sourcePackageId}/manifest`;

    // Find the source manifest (search across all agents for public memory)
    const allAgents = await storage.listAgents();
    let sourceManifest: any = null;
    let sourceOwnerGaii = '';

    for (const agent of allAgents) {
      const mem = await storage.getMemory(agent.gaii, sourceManifestKey);
      if (mem && mem.visibility === 'public') {
        sourceManifest = mem;
        sourceOwnerGaii = agent.gaii;
        break;
      }
    }

    if (!sourceManifest || !sourceManifest.value) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Source package not found or not public'));
      return;
    }

    const manifest = sourceManifest.value as KnowledgeManifest;

    if (!manifest.sharing?.allow_clone) {
      res.status(403).json(error(config.nodeId, 'CLONE_DISABLED', 'This package does not allow cloning'));
      return;
    }

    // Clone requested entries (only public ones)
    const publicEntries = manifest.entries.filter(e => e.visibility === 'public');
    const toClone = requestedEntries
      ? publicEntries.filter(e => requestedEntries.includes(e.key.split('/').pop()))
      : publicEntries;

    const now = new Date().toISOString();
    const newPackageId = randomUUID();
    const clonedEntries: string[] = [];

    for (const entry of toClone) {
      const sourceEntry = await storage.getMemory(sourceOwnerGaii, entry.key);
      if (!sourceEntry) continue;

      const entryName = entry.key.split('/').pop() ?? entry.key;
      const newKey = `packages/${newPackageId}/${entryName}`;

      await storage.setMemory({
        key: newKey,
        ownerGaii: requesterGaii,
        value: sourceEntry.value,
        visibility: entry.visibility,
        tags: [...sourceEntry.tags, 'cloned'],
        ttlHours: null,
        version: 1,
        createdAt: now,
        updatedAt: now,
      });
      clonedEntries.push(newKey);
    }

    // Create cloned manifest
    const clonedManifest: KnowledgeManifest = {
      ...manifest,
      version: '1.0.0',
      author: requesterGhii,
      created: now,
      updated: now,
      entries: toClone.map(e => ({
        ...e,
        key: `packages/${newPackageId}/${e.key.split('/').pop()}`,
      })),
      links: [{
        target: sourceManifestKey,
        relation: 'derived-from' as const,
        description: `Cloned from ${manifest.name} by ${manifest.author}`,
        linked_at: now,
      }],
      sharing: {
        catalog_listed: false,
        allow_clone: manifest.sharing.allow_clone,
        license: manifest.sharing.license,
        morsel_price: 0,
      },
    };

    await storage.setMemory({
      key: `packages/${newPackageId}/manifest`,
      ownerGaii: requesterGaii,
      value: clonedManifest,
      visibility: 'owner',
      tags: ['knowledge-package', manifest.content_type, ...manifest.tags, 'cloned'],
      ttlHours: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });

    // Create derived-from link
    await storage.createLink({
      source: `packages/${newPackageId}/manifest`,
      target: sourceManifestKey,
      relation: 'derived-from',
      description: `Cloned from ${manifest.name}`,
      linked_at: now,
      linked_by: requesterGhii,
    });

    res.status(201).json(success(config.nodeId, {
      cloned_package_id: newPackageId,
      entries_cloned: clonedEntries.length,
      source_package_id: sourcePackageId,
    }, [
      { description: 'View cloned package', method: 'GET', url: `/v1/packages/${newPackageId}` },
    ]));
  });

  /* ── GET /v1/packages/:id/export — Export package as portable JSON ── */
  router.get('/v1/packages/:id/export', async (req, res) => {
    const packageId = req.params.id as string;
    const manifestKey = `packages/${packageId}/manifest`;
    const requestedEntries = req.query.entries
      ? (req.query.entries as string).split(',').map(e => e.trim())
      : null;

    // Find public manifest
    const allAgents = await storage.listAgents();
    let sourceManifest: any = null;
    let sourceOwnerGaii = '';

    for (const agent of allAgents) {
      const mem = await storage.getMemory(agent.gaii, manifestKey);
      if (mem && mem.visibility === 'public') {
        sourceManifest = mem;
        sourceOwnerGaii = agent.gaii;
        break;
      }
    }

    if (!sourceManifest) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Package not found or not public'));
      return;
    }

    const manifest = sourceManifest.value as KnowledgeManifest;
    const nodeUrl = config.baseUrl || `http://localhost:${config.port}`;

    // Collect public entry data
    const entryData: Record<string, unknown> = {};
    const publicEntries = manifest.entries.filter(e => e.visibility === 'public');
    const entriesToExport = requestedEntries
      ? publicEntries.filter(e => requestedEntries.includes(e.key.split('/').pop() ?? ''))
      : publicEntries;

    for (const entry of entriesToExport) {
      const mem = await storage.getMemory(sourceOwnerGaii, entry.key);
      if (mem) {
        const entryName = entry.key.split('/').pop() ?? entry.key;
        entryData[entryName] = mem.value;
      }
    }

    const exportData = {
      aimeat_knowledge_package: true,
      exported_from: {
        node_url: nodeUrl,
        node_id: config.nodeId,
        package_id: packageId,
        author_ghii: manifest.author,
        api_spec: `${nodeUrl}/v1/openapi.yaml`,
        auth_endpoint: `${nodeUrl}/v1/auth/token`,
      },
      package: {
        ...manifest,
        entries: entriesToExport,
      },
      entry_data: entryData,
      trust_advisory: 'This knowledge was shared by another user. Verify critical information independently before relying on it.',
    };

    const safeName = manifest.name.replace(/[^a-z0-9]/gi, '-');
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}.json"`);
    res.json(exportData);
  });

  /* ── POST /v1/packages/:id/contribute — Contribute a package to an organism ── */
  router.post('/v1/packages/:id/contribute', requireAuth(), requireRole('agent'), async (req, res) => {
    const ownerGaii = req.auth!.sub as string;
    const ghii = req.auth!.owner as string;
    const packageId = req.params.id as string;
    const { organism_id } = req.body;

    if (!organism_id) {
      res.status(400).json(error(config.nodeId, 'MISSING_FIELDS', 'organism_id is required'));
      return;
    }

    // Verify organism exists and user is a member
    const organism = await storage.getOrganism(organism_id);
    if (!organism) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found'));
      return;
    }

    const membership = await storage.getMembership(organism_id, ghii);
    if (!membership) {
      res.status(403).json(error(config.nodeId, 'NOT_MEMBER', 'You are not a member of this organism'));
      return;
    }

    // Verify the package exists and belongs to the requester
    const manifestKey = `packages/${packageId}/manifest`;
    const manifest = await storage.getMemory(ownerGaii, manifestKey);
    if (!manifest) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Package not found'));
      return;
    }

    const now = new Date().toISOString();

    // Create consent grant for the organism
    await storage.createConsent({
      id: uuidv4(),
      ownerGaii,
      dataPattern: `packages/${packageId}/*`,
      recipient: `organism.${organism_id}`,
      purpose: `Knowledge package contributed to organism: ${organism.name || organism_id}`,
      scope: 'private',
      expires: null,
      status: 'active',
      grantedAt: now,
      revokedAt: null,
    });

    // Tag the manifest with the organism
    const existingTags = manifest.tags || [];
    if (!existingTags.includes(`organism:${organism_id}`)) {
      manifest.tags = [...existingTags, `organism:${organism_id}`];
      manifest.updatedAt = now;
      manifest.version += 1;
      await storage.setMemory(manifest);
    }

    res.status(201).json(success(config.nodeId, {
      package_id: packageId,
      organism_id,
      contributed: true,
    }));
  });

  /* ── GET /v1/packages/organism/:id — List packages shared with an organism ── */
  router.get('/v1/packages/organism/:id', requireAuth(), async (req, res) => {
    const ghii = req.auth!.owner as string;
    const organismId = req.params.id as string;

    // Verify membership
    const membership = await storage.getMembership(organismId, ghii);
    if (!membership) {
      res.status(403).json(error(config.nodeId, 'NOT_MEMBER', 'You are not a member of this organism'));
      return;
    }

    // Find consents granted to this organism for package data
    const allAgents = await storage.listAgents();
    const packages: any[] = [];

    for (const agent of allAgents) {
      const consents = await storage.listConsents(agent.gaii, { recipient: `organism.${organismId}`, status: 'active' });
      for (const consent of consents) {
        if (consent.dataPattern.startsWith('packages/') && consent.dataPattern.endsWith('/*')) {
          const prefix = consent.dataPattern.replace('/*', '/manifest');
          const manifest = await storage.getMemory(agent.gaii, prefix);
          if (manifest && (manifest.value as any)?.type === 'knowledge-package') {
            packages.push({
              key: prefix,
              manifest: manifest.value,
              ownerGaii: agent.gaii,
              contributed_at: consent.grantedAt,
            });
          }
        }
      }
    }

    res.json(success(config.nodeId, { packages, count: packages.length }));
  });

  /* ── GET /v1/packages/:id/reputation — Get quality signals for a package ── */
  router.get('/v1/packages/:id/reputation', async (req, res) => {
    const packageId = req.params.id as string;
    const manifestKey = `packages/${packageId}/manifest`;

    // Find the manifest
    const allAgents = await storage.listAgents();
    let manifest: any = null;

    for (const agent of allAgents) {
      const mem = await storage.getMemory(agent.gaii, manifestKey);
      if (mem) { manifest = mem; break; }
    }

    if (!manifest) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Package not found'));
      return;
    }

    const value = manifest.value as KnowledgeManifest;

    // Count clones (derived-from links pointing to this package)
    const incomingLinks = await storage.listLinks(manifestKey, { direction: 'incoming', relation: 'derived-from' });
    const cloneCount = incomingLinks.length;

    // Citation quality
    const refs = value.references || [];
    const verifiedCount = refs.filter(r => r.verified).length;
    const citationQuality = refs.length > 0 ? Math.round((verifiedCount / refs.length) * 100) : null;

    // Flag count (from memory record)
    const flagCount = manifest.flagCount ?? 0;

    // Reviews
    const reviews = await storage.listReviews(manifestKey);
    const lastReview = reviews.length > 0 ? reviews[reviews.length - 1] : null;

    res.json(success(config.nodeId, {
      package_id: packageId,
      clone_count: cloneCount,
      flag_count: flagCount,
      citation_quality_percent: citationQuality,
      references_total: refs.length,
      references_verified: verifiedCount,
      synthesis_level: value.synthesis?.level,
      maturity: value.maturity,
      last_updated: value.updated || manifest.updatedAt,
      last_review: lastReview ? {
        action: lastReview.action,
        reason: lastReview.reason,
        timestamp: lastReview.timestamp,
      } : null,
    }));
  });

  /* ── GET /v1/admin/knowledge — List all packages for operator review ── */
  router.get('/v1/admin/knowledge', requireAuth(), requireRole('operator'), async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page as string || '1'));
    const perPage = Math.min(50, Math.max(1, parseInt(req.query.limit as string || '20')));
    const filterFlagged = req.query.flagged === 'true';
    const filterAuthor = req.query.author as string | undefined;
    const filterType = req.query.content_type as string | undefined;

    const allAgents = await storage.listAgents();
    const seenKeys = new Set<string>();
    let manifests: any[] = [];

    // Collect from all agents
    for (const agent of allAgents) {
      const agentManifests = await storage.listMemory(agent.gaii, {
        prefix: 'packages/',
        tags: ['knowledge-package'],
      });
      for (const m of agentManifests) {
        if (m.key.endsWith('/manifest') && (m.value as any)?.type === 'knowledge-package' && !seenKeys.has(m.key)) {
          seenKeys.add(m.key);
          manifests.push({
            key: m.key,
            value: m.value,
            ownerGaii: m.ownerGaii,
            visibility: m.visibility,
            flagCount: m.flagCount ?? 0,
            createdAt: m.createdAt,
            updatedAt: m.updatedAt,
            isSystem: (m.tags || []).includes('system-knowledge'),
          });
        }
      }
    }

    // Also collect system packages stored under operator GAII
    const operatorGaii = req.auth!.sub as string;
    const operatorManifests = await storage.listMemory(operatorGaii, {
      prefix: 'packages/',
      tags: ['knowledge-package'],
    });
    for (const m of operatorManifests) {
      if (m.key.endsWith('/manifest') && (m.value as any)?.type === 'knowledge-package' && !seenKeys.has(m.key)) {
        seenKeys.add(m.key);
        manifests.push({
          key: m.key,
          value: m.value,
          ownerGaii: m.ownerGaii,
          visibility: m.visibility,
          flagCount: m.flagCount ?? 0,
          createdAt: m.createdAt,
          updatedAt: m.updatedAt,
          isSystem: true,
        });
      }
    }

    // Apply filters
    if (filterFlagged) manifests = manifests.filter(m => m.flagCount > 0);
    if (filterAuthor) manifests = manifests.filter(m => m.value.author === filterAuthor);
    if (filterType) manifests = manifests.filter(m => m.value.content_type === filterType);

    // Sort: flagged first, then newest
    manifests.sort((a, b) => {
      if (a.flagCount !== b.flagCount) return b.flagCount - a.flagCount;
      return (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt);
    });

    const total = manifests.length;
    const paged = manifests.slice((page - 1) * perPage, page * perPage);

    res.json(success(config.nodeId, {
      packages: paged.map(m => ({
        key: m.key,
        package_id: m.key.replace('packages/', '').replace('/manifest', ''),
        name: m.value.name,
        author: m.value.author,
        content_type: m.value.content_type,
        tags: m.value.tags || [],
        visibility: m.visibility,
        flag_count: m.flagCount,
        maturity: m.value.maturity,
        entries_count: (m.value.entries || []).length,
        is_system: m.isSystem || false,
        created: m.value.created || m.createdAt,
      })),
      total,
      page,
      per_page: perPage,
    }));
  });

  /* ── POST /v1/admin/knowledge/import — Operator creates system knowledge ── */
  router.post('/v1/admin/knowledge/import', requireAuth(), requireRole('operator'), async (req, res) => {
    const operatorGaii = req.auth!.sub as string;
    const ownerName = req.auth!.owner as string;
    const { name, content_type, tags, maturity, visibility, catalog_listed, entries } = req.body;

    if (!name || typeof name !== 'string') {
      res.status(400).json(error(config.nodeId, 'INVALID_NAME', 'Package name is required'));
      return;
    }

    const validTypes = ['idea', 'research', 'plan', 'dataset', 'document', 'tutorial', 'collection', 'article', 'story', 'fiction'];
    if (!content_type || !validTypes.includes(content_type)) {
      res.status(400).json(error(config.nodeId, 'INVALID_TYPE', `content_type must be one of: ${validTypes.join(', ')}`));
      return;
    }

    if (!entries || !Array.isArray(entries) || entries.length === 0) {
      res.status(400).json(error(config.nodeId, 'NO_ENTRIES', 'At least one entry is required'));
      return;
    }

    const packageId = uuidv4();
    const now = new Date().toISOString();
    const manifestKey = `packages/${packageId}/manifest`;
    const parsedTags = (typeof tags === 'string' ? tags.split(',').map((t: string) => t.trim()).filter(Boolean) : (tags || [])) as string[];
    const entryVisibility = visibility === 'operator' ? 'private' : 'public';

    const manifest: KnowledgeManifest = {
      type: 'knowledge-package',
      name,
      version: '1.0.0',
      author: ownerName,
      content_type: content_type as KnowledgeManifest['content_type'],
      tags: parsedTags,
      language: 'en',
      maturity: maturity || 'published',
      synthesis: { level: 'original', description: 'System knowledge created by operator' },
      references: [],
      entries: entries.map((e: any, i: number) => ({
        key: `packages/${packageId}/entry-${i}`,
        title: e.title || `Entry ${i + 1}`,
        visibility: entryVisibility as 'public' | 'private' | 'owner',
      })),
      links: [],
      sharing: {
        catalog_listed: catalog_listed ?? (visibility !== 'operator'),
        allow_clone: visibility !== 'operator',
        morsel_price: 0,
      },
      created: now,
      updated: now,
    };

    // Store manifest
    await storage.setMemory({
      key: manifestKey,
      ownerGaii: operatorGaii,
      value: manifest,
      visibility: entryVisibility,
      tags: ['knowledge-package', 'system-knowledge', content_type, ...parsedTags],
      ttlHours: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });

    // Store entries
    const createdEntries: string[] = [];
    for (let i = 0; i < entries.length; i++) {
      const entryKey = `packages/${packageId}/entry-${i}`;
      await storage.setMemory({
        key: entryKey,
        ownerGaii: operatorGaii,
        value: { title: entries[i].title || `Entry ${i + 1}`, body: entries[i].content || '' },
        visibility: entryVisibility,
        tags: ['knowledge-entry', 'system-knowledge', content_type, ...parsedTags],
        ttlHours: null,
        version: 1,
        createdAt: now,
        updatedAt: now,
      });
      createdEntries.push(entryKey);
    }

    res.status(201).json(success(config.nodeId, {
      package_id: packageId,
      manifest_key: manifestKey,
      entries_created: createdEntries.length,
      visibility,
      catalog_listed: manifest.sharing.catalog_listed,
    }));
  });

  /* ── DELETE /v1/admin/knowledge/:id — Operator deletes a package ── */
  router.delete('/v1/admin/knowledge/:id', requireAuth(), requireRole('operator'), async (req, res) => {
    const packageId = req.params.id as string;
    const manifestKey = `packages/${packageId}/manifest`;

    // Find the package across all agents
    const allAgents = await storage.listAgents();
    let found = false;

    for (const agent of allAgents) {
      const mem = await storage.getMemory(agent.gaii, manifestKey);
      if (mem) {
        // Delete manifest and all entries
        const allEntries = await storage.listMemory(agent.gaii, { prefix: `packages/${packageId}/` });
        for (const entry of allEntries) {
          await storage.deleteMemory(agent.gaii, entry.key);
        }
        found = true;
        break;
      }
    }

    // Also try operator's own GAII for system packages
    if (!found) {
      const operatorGaii = req.auth!.sub as string;
      const mem = await storage.getMemory(operatorGaii, manifestKey);
      if (mem) {
        const allEntries = await storage.listMemory(operatorGaii, { prefix: `packages/${packageId}/` });
        for (const entry of allEntries) {
          await storage.deleteMemory(operatorGaii, entry.key);
        }
        found = true;
      }
    }

    if (!found) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Package not found'));
      return;
    }

    res.json(success(config.nodeId, { deleted: packageId }));
  });

  /* ── POST /v1/admin/knowledge/:id/review — Operator reviews a package ── */
  router.post('/v1/admin/knowledge/:id/review', requireAuth(), requireRole('operator'), async (req, res) => {
    const operatorGaii = req.auth!.sub as string;
    const packageId = req.params.id as string;
    const { reason, custom_text, action: reviewAction } = req.body;

    const validReasons = ['routine_review', 'legal_compliance', 'community_report', 'content_quality', 'storage_issue', 'custom'];
    const validActions = ['approve', 'flag', 'delist', 'restrict', 'note'];

    if (!reason || !validReasons.includes(reason)) {
      res.status(400).json(error(config.nodeId, 'INVALID_REASON', `reason must be one of: ${validReasons.join(', ')}`));
      return;
    }
    if (!reviewAction || !validActions.includes(reviewAction)) {
      res.status(400).json(error(config.nodeId, 'INVALID_ACTION', `action must be one of: ${validActions.join(', ')}`));
      return;
    }

    const manifestKey = `packages/${packageId}/manifest`;

    // Find the package (search all agents)
    const allAgents = await storage.listAgents();
    let manifest: any = null;

    for (const agent of allAgents) {
      const mem = await storage.getMemory(agent.gaii, manifestKey);
      if (mem) { manifest = mem; break; }
    }

    if (!manifest) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Package not found'));
      return;
    }

    const now = new Date().toISOString();

    // Create review record
    const review: OperatorReviewRecord = {
      id: uuidv4(),
      packageId: manifestKey,
      operatorGaii,
      reason: reason as OperatorReviewRecord['reason'],
      customText: custom_text,
      action: reviewAction as OperatorReviewAction,
      timestamp: now,
    };
    await storage.createReview(review);

    // Create audit entry (transparent to package owner)
    await storage.addConsentAuditEntry({
      id: uuidv4(),
      consentId: 'operator-review',
      ownerGaii: manifest.ownerGaii,
      accessorGaii: operatorGaii,
      memoryKey: manifestKey,
      action: 'read' as const,
      timestamp: now,
      allowed: true,
    });

    // Apply action to the package
    const manifestValue = manifest.value as KnowledgeManifest;
    switch (reviewAction) {
      case 'approve':
        manifest.flagCount = 0;
        break;
      case 'flag':
        manifest.flagCount = (manifest.flagCount ?? 0) + 5;
        break;
      case 'delist':
        manifestValue.sharing.catalog_listed = false;
        manifest.value = manifestValue;
        break;
      case 'restrict':
        manifest.visibility = 'private';
        manifestValue.sharing.catalog_listed = false;
        manifest.value = manifestValue;
        break;
      case 'note':
        break;
    }

    manifest.updatedAt = now;
    manifest.version += 1;
    await storage.setMemory(manifest);

    res.json(success(config.nodeId, {
      review_id: review.id,
      action: reviewAction,
      reason,
      package_id: packageId,
    }));
  });

  /* ── GET /v1/packages/:id/reviews — List operator reviews for a package ── */
  router.get('/v1/packages/:id/reviews', requireAuth(), async (req, res) => {
    const packageId = req.params.id as string;
    const manifestKey = `packages/${packageId}/manifest`;

    const reviews = await storage.listReviews(manifestKey);

    res.json(success(config.nodeId, {
      reviews: reviews.map(r => ({
        id: r.id,
        reason: r.reason,
        action: r.action,
        custom_text: r.customText,
        timestamp: r.timestamp,
      })),
      count: reviews.length,
    }));
  });

  return router;
}
