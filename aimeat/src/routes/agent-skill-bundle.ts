/**
 * @file agent-skill-bundle.ts
 * @description REST endpoints for skill bundle download and version check.
 *   Agents download runtime-specific skill bundles as ZIP files, and check
 *   for updates via a lightweight version endpoint.
 * @structure
 *   - GET /v1/agents/:name/skill-bundle          -- Download ZIP bundle
 *   - GET /v1/agents/:name/skill-bundle/version   -- Version check (lightweight)
 * @version-history
 *   v1.0.0 -- 2026-05-23 -- Initial creation for Agent Integration Phase A
 *   v1.0.1 -- 2026-06-13 -- archiver v8: archiver('zip') -> new ZipArchive()
 */

import { Router } from 'express';
import { ZipArchive } from 'archiver';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';
import { refuseNotYours } from '../middleware/refusals.js';
import { requireAuth } from '../auth/middleware.js';
import { buildGAII } from '../utils/gaii.js';
import { generateBundle } from '../services/skill-bundle/generator.js';
import { HermesAdapter } from '../services/skill-bundle/hermes-adapter.js';
import { GenericAdapter } from '../services/skill-bundle/generic-adapter.js';
import type { RuntimeAdapter, BundleContext } from '../services/skill-bundle/types.js';

const ADAPTERS: Record<string, RuntimeAdapter> = {
  hermes: new HermesAdapter(),
  generic: new GenericAdapter(),
};

export function agentSkillBundleRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  async function buildContext(agentName: string, agentGaii: string): Promise<BundleContext> {
    const agent = await storage.getAgent(agentGaii);

    const ownerName = agentGaii.split('#')[1]?.split('@')[0] ?? '';
    const ownerGhii = `${ownerName}@${config.nodeId}`;

    const systemRules = (config.agentSystemPrinciples ?? []).map((text, idx) => ({
      id: `system-${idx + 1}`,
      description: text,
      source: 'system',
    }));
    const ownerDefaults = await storage.getOwnerAgentDefaults(ownerGhii);
    const ownerRules = (ownerDefaults?.rules ?? []).map(r => ({ ...r, source: 'owner' }));
    const agentDirectives = await storage.getAgentDirectives(agentGaii);
    const agentRules = (agentDirectives?.rules ?? []).map(r => ({ ...r, source: 'agent' }));

    return {
      agentName,
      agentGaii,
      nodeId: config.nodeId,
      nodeUrl: config.baseUrl,
      directives: {
        purpose: agentDirectives?.purpose,
        rules: [...systemRules, ...ownerRules, ...agentRules],
        memoryAreas: agentDirectives?.memoryAreas?.map(a => a.keyPrefix),
        resources: agentDirectives?.resources?.map(r => ({ key: r.reference, description: r.description })),
      },
      capabilities: {
        technical: agent?.technicalCapabilities?.map(c => c.name),
        domain: agent?.domainCapabilities,
      },
      webhookUrl: agent?.webhookUrl,
    };
  }

  function resolveAndAuthorize(req: Express.Request, agentName: string): string | null {
    const roles = req.auth!.roles as string[];
    const isOwner = roles.includes('owner') && !roles.includes('agent');
    if (isOwner) return buildGAII(agentName, req.auth!.owner as string, config.nodeId);
    if (roles.includes('agent')) {
      const agentGaii = buildGAII(agentName, req.auth!.owner as string, config.nodeId);
      return req.auth!.sub === agentGaii ? agentGaii : null;
    }
    return null;
  }

  /* -- GET /v1/agents/:name/skill-bundle -- Download ZIP bundle (owner + own agent) -- */
  router.get('/v1/agents/:name/skill-bundle', requireAuth(), async (req, res) => {
    const agentName = req.params.name as string;
    const agentGaii = resolveAndAuthorize(req, agentName);
    if (!agentGaii) {
      res.status(403).json(refuseNotYours(config, { thing: 'agent', action: 'use', listUrl: '/v1/agents' }));
      return;
    }
    const agent = await storage.getAgent(agentGaii);
    if (!agent) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Agent '${agentName}' not found`));
      return;
    }

    const runtimeParam = (req.query.runtime as string)?.toLowerCase() || agent?.platform?.toLowerCase() || 'generic';
    const adapter = ADAPTERS[runtimeParam] ?? ADAPTERS.generic;

    const ctx = await buildContext(agentName, agentGaii);
    const bundle = generateBundle(ctx, adapter);

    const archive = new ZipArchive({ zlib: { level: 6 } });
    const chunks: Buffer[] = [];

    archive.on('data', (chunk: Buffer) => chunks.push(chunk));
    archive.on('end', () => {
      const buffer = Buffer.concat(chunks);
      res.set({
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${bundle.metadata.bundleName}.zip"`,
        'Content-Length': String(buffer.length),
        'X-Bundle-Version': bundle.metadata.version,
        'X-Bundle-Runtime': bundle.metadata.runtime,
      });
      res.send(buffer);
    });
    archive.on('error', (err) => {
      res.status(500).json(error(config.nodeId, 'ZIP_ERROR', `Failed to generate bundle: ${err.message}`));
    });

    for (const file of bundle.files) {
      archive.append(file.content, { name: `${bundle.metadata.bundleName}/${file.path}` });
    }

    await archive.finalize();
  });

  /* -- GET /v1/agents/:name/skill-bundle/version -- Version check (owner + own agent) -- */
  router.get('/v1/agents/:name/skill-bundle/version', requireAuth(), async (req, res) => {
    const agentName = req.params.name as string;
    const agentGaii = resolveAndAuthorize(req, agentName);
    if (!agentGaii) {
      res.status(403).json(refuseNotYours(config, { thing: 'agent', action: 'use', listUrl: '/v1/agents' }));
      return;
    }
    const agent = await storage.getAgent(agentGaii);
    if (!agent) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Agent '${agentName}' not found`));
      return;
    }

    const runtimeParam = (req.query.runtime as string)?.toLowerCase() || agent?.platform?.toLowerCase() || 'generic';
    const adapter = ADAPTERS[runtimeParam] ?? ADAPTERS.generic;

    const ctx = await buildContext(agentName, agentGaii);
    const bundle = generateBundle(ctx, adapter);

    res.json(success(config.nodeId, {
      version: bundle.metadata.version,
      runtime: bundle.metadata.runtime,
      bundle_name: bundle.metadata.bundleName,
      generated_at: bundle.metadata.generatedAt,
    }));
  });

  return router;
}
