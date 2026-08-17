/**
 * @file capability-aggregator.ts
 * @description Background job that scans extensions, actions, and cortex modules
 *   to auto-create/update capability records.
 * @version-history
 *   v1.2.0 - 2026-08-17 - Both scans use the `lean` listings (no extension source, no cortex
 *     manifest/seed-data): this job reads schemas and metadata, never code, and the full loads were
 *     measured at +203 MB of native churn per cron run on production.
 *   v1.1.0 - 2026-07-13 - Cortex capabilities now refresh when the source version or the
 *     derived usage (exports/api_surface/prompt) changes — previously a cortex capability
 *     was only updated when its exports were missing entirely, so a manifest enrichment
 *     or version bump never reached GET /v1/capabilities.
 *   v1.0.0 - 2026-05-02 - Initial aggregator
 */
import { createHash } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage, CapabilityRecord, CortexLibComponent, CortexPromptComponent } from '../storage/interface.js';
import { logger } from '../utils/logger.js';

function makeSchemaHash(input: unknown, output: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(input ?? {}) + JSON.stringify(output ?? {}))
    .digest('hex').slice(0, 16);
}

function makeDefaultTrust() {
  return { operatorReviewed: false, reviewedAt: null, vouchCount: 0, publisherTrustScore: 0, codeAudited: false, auditNotes: null };
}

function makeDefaultStats() {
  return { totalInvocations: 0, successCount: 0, errorCount: 0, lastInvokedAt: null, avgResponseMs: 0, lastError: null };
}

export async function runCapabilityAggregation(config: AimeatConfig, storage: Storage): Promise<{ created: number; updated: number; disabled: number }> {
  let created = 0, updated = 0, disabled = 0;
  const seenRefs = new Set<string>();
  const now = new Date().toISOString();

  // 1. Scan active extensions. `lean`: schemas and metadata only — this scan never executes code,
  // and loading every action's full source cost +203 MB of native churn per cron run on production
  // (memory trace 2026-08-17).
  try {
    const extensions = await storage.listExtensions({ lean: true });
    for (const ext of extensions) {
      if (ext.status !== 'active' || !ext.actions) continue;
      for (const action of ext.actions) {
        const ref = `ext:${ext.name}:${action.id}`;
        seenRefs.add(ref);
        const existing = await storage.getCapabilityBySourceRef(ref);
        const schemaHash = makeSchemaHash(action.inputSchema, action.outputSchema);

        if (!existing) {
          const cap: CapabilityRecord = {
            id: ref, name: `${ext.name}: ${action.id}`,
            summary: (action as { description?: string }).description || ext.description || '',
            ownerGhii: ext.installedBy || `operator@${config.nodeId}`,
            visibility: 'public', scope: 'local', status: 'active',
            rejectionReason: null, deprecationMessage: null, replacedBy: null,
            source: { type: 'extension', ref, version: ext.version },
            authRequired: 'registered', callable: true,
            inputSchema: action.inputSchema || null,
            outputSchema: action.outputSchema || null,
            exports: null,
            usage: `await AIMEAT.capabilities.invoke('${ref}', input)`,
            whenToUse: '', whenNotToUse: '',
            examples: [], dependencies: [], schemaHash,
            webhookUrl: null, cost: null, trustRequired: null,
            trust: makeDefaultTrust(), redactedFields: [],
            operatorOverride: null, stats: makeDefaultStats(),
            tags: [], createdAt: now, updatedAt: now,
          };
          await storage.createCapability(cap);
          created++;
        } else if (existing.status === 'disabled') {
          // Re-enable: source is active again (extension was reinstalled)
          await storage.updateCapability(existing.id, {
            status: 'active',
            source: { type: 'extension', ref, version: ext.version },
            inputSchema: action.inputSchema || null,
            outputSchema: action.outputSchema || null,
            schemaHash, updatedAt: now,
          });
          updated++;
        } else if (existing.source.version !== ext.version || existing.schemaHash !== schemaHash) {
          await storage.updateCapability(existing.id, {
            source: { type: 'extension', ref, version: ext.version },
            inputSchema: action.inputSchema || null,
            outputSchema: action.outputSchema || null,
            schemaHash, updatedAt: now,
          });
          updated++;
        }
      }
    }
  } catch (err) { logger.error('Capability aggregator: extension scan failed', { error: String(err) }); }

  // 2. Scan published actions (discovery only, callable: false)
  try {
    const actions = await storage.listActions();
    for (const action of actions) {
      const ref = `action:${action.providerGaii}:${action.id}`;
      seenRefs.add(ref);
      const existing = await storage.getCapabilityBySourceRef(ref);

      if (!existing) {
        const schemaHash = makeSchemaHash(action.inputSchema, action.outputSchema);
        const cap: CapabilityRecord = {
          id: ref, name: action.displayName || action.id,
          summary: action.description || '',
          ownerGhii: action.providerGaii,
          visibility: 'public', scope: 'local', status: 'active',
          rejectionReason: null, deprecationMessage: null, replacedBy: null,
          source: { type: 'action', ref, version: action.updatedAt },
          authRequired: 'registered', callable: false,
          inputSchema: action.inputSchema || null,
          outputSchema: action.outputSchema || null,
          exports: null,
          usage: `POST /v1/work/request with { action_id: '${action.id}', provider_gaii: '${action.providerGaii}', input: {...} }`,
          whenToUse: '', whenNotToUse: '',
          examples: [], dependencies: [], schemaHash,
          webhookUrl: null,
          cost: action.pricing ? { morsels: action.pricing.baseMorsels || 0 } : null,
          trustRequired: null,
          trust: makeDefaultTrust(), redactedFields: [],
          operatorOverride: null, stats: makeDefaultStats(),
          tags: action.tags || [], createdAt: now, updatedAt: now,
        };
        await storage.createCapability(cap);
        created++;
      }
    }
  } catch (err) { logger.error('Capability aggregator: action scan failed', { error: String(err) }); }

  // 3. Scan active cortex modules (callable in browser). `lean`: no raw manifest YAML, no seed-data
  // entries — this scan reads lib exports/api_surface and prompt content only.
  try {
    const cortexList = await storage.listCortexExtensions({ status: 'active', lean: true });
    logger.info(`Capability aggregator: found ${cortexList.length} active cortex modules`);
    for (const cortex of cortexList) {
      const ref = `cortex:${cortex.name}`;
      seenRefs.add(ref);
      const existing = await storage.getCapabilityBySourceRef(ref);

      // Extract lib component exports and API surface from cortex manifest
      const components = cortex.components || [];
      const libComponents = components.filter((c): c is CortexLibComponent => c.type === 'lib');
      const promptComponents = components.filter((c): c is CortexPromptComponent => c.type === 'prompt');

      let apiSurface = '';
      let libExports: string[] = [];
      let libFilename = `${cortex.name}.js`;
      for (const lib of libComponents) {
        if (lib.exports) libExports = libExports.concat(lib.exports);
        const surface = (lib as { apiSurface?: string }).apiSurface || lib.api_surface;
        if (surface) apiSurface += surface + '\n';
        if (lib.filename) libFilename = lib.filename;
      }

      // Extract prompt content for usage guidance
      let promptContent = '';
      for (const p of promptComponents) {
        if (p.content) promptContent += p.content + '\n';
      }

      const usageLines = [`await loadScript('/v1/cortex/${cortex.name}/libs/${libFilename}')`];
      if (apiSurface) usageLines.push('\nAPI:\n' + apiSurface.trim());

      if (!existing) {
        const cap: CapabilityRecord = {
          id: ref, name: cortex.name,
          summary: cortex.description || '',
          ownerGhii: cortex.installedBy || `operator@${config.nodeId}`,
          visibility: cortex.visibility === 'public' ? 'public' : 'private',
          scope: 'local', status: 'active',
          rejectionReason: null, deprecationMessage: null, replacedBy: null,
          source: { type: 'cortex', ref, version: cortex.version },
          authRequired: 'registered', callable: true,
          inputSchema: null, outputSchema: null,
          exports: libExports.length > 0 ? libExports.map(name => ({
            name, description: '', inputSchema: {}, outputSchema: {}, example: null,
          })) : null,
          usage: usageLines.join('\n'),
          whenToUse: promptContent ? promptContent.slice(0, 500) : '',
          whenNotToUse: '',
          examples: [],
          dependencies: [{ type: 'sdk', id: 'aimeat-data', required: true, minVersion: null }],
          schemaHash: '', webhookUrl: null, cost: null, trustRequired: null,
          trust: makeDefaultTrust(), redactedFields: [],
          operatorOverride: null, stats: makeDefaultStats(),
          tags: cortex.tags || [], createdAt: now, updatedAt: now,
        };
        await storage.createCapability(cap);
        created++;
      } else if (existing.status === 'disabled') {
        // Re-enable: cortex is active again (was reinstalled)
        await storage.updateCapability(existing.id, {
          status: 'active',
          source: { type: 'cortex', ref, version: cortex.version },
          exports: libExports.length > 0 ? libExports.map(name => ({
            name, description: '', inputSchema: {}, outputSchema: {}, example: null,
          })) : existing.exports,
          usage: usageLines.join('\n'),
          updatedAt: now,
        });
        updated++;
      } else if (
        existing.source.version !== cortex.version
        || existing.usage !== usageLines.join('\n')
        || (existing.exports === null && libExports.length > 0)
      ) {
        // Refresh: the source version bumped, the derived usage (exports/api_surface/prompt)
        // changed, or exports were missing — mirror the extension branch so a manifest
        // enrichment actually reaches GET /v1/capabilities.
        await storage.updateCapability(existing.id, {
          source: { type: 'cortex', ref, version: cortex.version },
          summary: cortex.description || existing.summary,
          exports: libExports.length > 0 ? libExports.map(name => ({
            name, description: '', inputSchema: {}, outputSchema: {}, example: null,
          })) : existing.exports,
          usage: usageLines.join('\n'),
          whenToUse: promptContent ? promptContent.slice(0, 500) : existing.whenToUse,
          updatedAt: now,
        });
        updated++;
      }
    }
  } catch (err) { logger.error('Capability aggregator: cortex scan failed', { error: String(err) }); }

  // 4. Disable or delete capabilities whose sources are gone
  for (const sourceType of ['extension', 'action', 'cortex']) {
    try {
      const existing = await storage.listCapabilitiesBySourceType(sourceType);
      for (const cap of existing) {
        if (!seenRefs.has(cap.source.ref)) {
          if (cap.status === 'active') {
            await storage.updateCapability(cap.id, { status: 'disabled', updatedAt: now });
            disabled++;
          } else if (cap.status === 'disabled' && cap.source.type !== 'manual') {
            // Clean up stale disabled auto-generated capabilities
            await storage.deleteCapability(cap.id);
            disabled++;
          }
        }
      }
    } catch (err) { logger.error('Capability aggregator: cleanup scan failed', { error: String(err) }); }
  }

  if (created || updated || disabled) {
    logger.info(`Capability aggregation: ${created} created, ${updated} updated, ${disabled} disabled`);
  }

  return { created, updated, disabled };
}
