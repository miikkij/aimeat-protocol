/**
 * @file capability-aggregator.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Background job that scans extensions, actions, and cortex modules
 *   to auto-create/update capability records.
 * @version-history
 *   v1.4.0 - 2026-09-03 - An extension's or cortex's capability is owned by the installer's GHII
 *     (`alice@node-id`), not the bare name the extension record carries: every route compares
 *     ownerGhii against resolveIdentity(), so the bare name made "hide from agents" a 403 for the
 *     owner on 315 of 322 extension rows on aimeat.io. The refresh branches repair existing rows.
 *   v1.3.0 - 2026-09-03 - Two more sources, so the registry is what an agent can find by name here:
 *     every owner's app tool manifests (`apps.{appId}.tools`, one entry per tool) and every agent's
 *     PUBLIC offers (`agents.{agent}.offers`), both as discovery entries whose usage names the
 *     contract door. A cortex is marked callable:false (a library the app loads, nothing the server
 *     runs), existing records included. Wish wish-kyvykkyydet-rekisteri-ja-sivu.
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
import { AppToolsDocSchema } from '../models/app-tool-schemas.js';
import { OffersDocSchema, type Offer } from '../models/offer-schemas.js';

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

/**
 * The GHII a capability is owned by. `installedBy` on an extension or cortex record is the bare
 * owner name (`alice`), and every ownership check on the routes compares against
 * `resolveIdentity(...)`, which is `alice@node-id`; storing the bare name made the owner a stranger
 * to their own entries. A value that already carries a node stays as it is.
 */
function ownerGhiiOf(installedBy: string | null | undefined, nodeId: string): string {
  if (!installedBy) return `operator@${nodeId}`;
  return installedBy.includes('@') ? installedBy : `${installedBy}@${nodeId}`;
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
            ownerGhii: ownerGhiiOf(ext.installedBy, config.nodeId),
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
        } else if (existing.source.version !== ext.version || existing.schemaHash !== schemaHash
          || existing.ownerGhii !== ownerGhiiOf(ext.installedBy, config.nodeId)) {
          // The owner is repaired too: rows written before 2026-09-03 carry the bare installer name,
          // which no route's `ownerGhii === resolveIdentity(...)` check ever matched.
          await storage.updateCapability(existing.id, {
            source: { type: 'extension', ref, version: ext.version },
            ownerGhii: ownerGhiiOf(ext.installedBy, config.nodeId),
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
          ownerGhii: ownerGhiiOf(cortex.installedBy, config.nodeId),
          visibility: cortex.visibility === 'public' ? 'public' : 'private',
          scope: 'local', status: 'active',
          rejectionReason: null, deprecationMessage: null, replacedBy: null,
          source: { type: 'cortex', ref, version: cortex.version },
          // A cortex is a library the app loads in the browser; nothing on the server runs it, so it is
          // findable here and never callable. Saying callable:true made `callable=true` lists lie.
          authRequired: 'registered', callable: false,
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
          status: 'active', callable: false,
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
        || existing.callable === true
        || existing.ownerGhii !== ownerGhiiOf(cortex.installedBy, config.nodeId)
      ) {
        // Refresh: the source version bumped, the derived usage (exports/api_surface/prompt)
        // changed, exports were missing, or the record still says callable from before cortexes
        // were marked browser-only — mirror the extension branch so a manifest enrichment actually
        // reaches GET /v1/capabilities.
        await storage.updateCapability(existing.id, {
          callable: false,
          ownerGhii: ownerGhiiOf(cortex.installedBy, config.nodeId),
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

  // 4. Scan every owner's app tool manifests (`apps.{appId}.tools`): each tool is a discovery entry.
  // The call itself goes through the contract door (EXCHANGE offering → aimeat_app_tool_invoke), so
  // the entry is not callable here; its usage names that door. The manifest is the owner's own public
  // record, read the same way the EXCHANGE projection reads it.
  try {
    const owners = await storage.listOwners();
    for (const owner of owners) {
      const ownerGhii = `${owner.name}@${config.nodeId}`;
      let records: Array<{ key: string; value: unknown }> = [];
      try {
        records = (await storage.listMemory(ownerGhii, { prefix: 'apps.' })).filter(r => /^apps\..+\.tools$/.test(r.key));
      } catch (err) {
        logger.warn('Capability aggregator: an owner\'s app manifests could not be read; their tools stay as they were', { owner: owner.name, error: String(err) });
        records = [];
      }
      for (const rec of records) {
        const appId = rec.key.replace(/^apps\./, '').replace(/\.tools$/, '');
        const parsed = AppToolsDocSchema.safeParse(rec.value);
        if (!parsed.success) continue;
        for (const tool of parsed.data.tools) {
          const ref = `app-tool:${owner.name}/${appId}:${tool.name}`;
          seenRefs.add(ref);
          const existing = await storage.getCapabilityBySourceRef(ref);
          const schemaHash = makeSchemaHash(tool.inputSchema, tool.outputSchema);
          const morsels = tool.price && tool.price.morsels > 0 ? tool.price.morsels : 0;
          const version = String(parsed.data.version ?? parsed.data.updatedAt ?? '1');
          const fields = {
            name: `${appId}: ${tool.name}`,
            summary: tool.description || '',
            inputSchema: (tool.inputSchema as Record<string, unknown> | undefined) ?? null,
            outputSchema: (tool.outputSchema as Record<string, unknown> | undefined) ?? null,
            usage: `aimeat_app_tool_invoke { app_id: '${appId}', tool: '${tool.name}', input: {...} } under a contract for this app tool (aimeat_exchange_offerings → aimeat_exchange_accept), or the owner's own apps free of charge`,
            cost: morsels ? { morsels } : null,
            schemaHash,
          };
          if (!existing) {
            const cap: CapabilityRecord = {
              id: ref, ...fields,
              ownerGhii, visibility: 'public', scope: 'local', status: 'active',
              rejectionReason: null, deprecationMessage: null, replacedBy: null,
              source: { type: 'app-tool', ref, version },
              authRequired: 'registered', callable: false,
              exports: null, whenToUse: '', whenNotToUse: '', examples: [], dependencies: [],
              webhookUrl: null, trustRequired: null,
              trust: makeDefaultTrust(), redactedFields: [], operatorOverride: null, stats: makeDefaultStats(),
              tags: [], createdAt: now, updatedAt: now,
            };
            await storage.createCapability(cap);
            created++;
          } else if (existing.status === 'disabled' || existing.schemaHash !== schemaHash || existing.summary !== fields.summary || existing.usage !== fields.usage || existing.source.version !== version) {
            await storage.updateCapability(existing.id, { ...fields, status: 'active', source: { type: 'app-tool', ref, version }, updatedAt: now });
            updated++;
          }
        }
      }
    }
  } catch (err) { logger.error('Capability aggregator: app-tool scan failed', { error: String(err) }); }

  // 5. Scan every agent's published offers (`agents.{agent}.offers`): a PUBLIC offer is a discovery
  // entry, priced or not. The work is commissioned through the offer's own door (a work request, or
  // an EXCHANGE contract when the offer is listed), so the entry is not callable here.
  try {
    const agents = await storage.listAgents();
    for (const agent of agents) {
      const rec = await storage.getMemory(agent.gaii, `agents.${agent.name}.offers`);
      if (!rec) continue;
      const parsed = OffersDocSchema.safeParse(rec.value);
      if (!parsed.success) continue;
      for (const offer of parsed.data.offers as Offer[]) {
        if (offer.visibility !== 'public') continue;
        const ref = `offering:${agent.owner}/${agent.name}:${offer.id}`;
        seenRefs.add(ref);
        const existing = await storage.getCapabilityBySourceRef(ref);
        const schemaHash = makeSchemaHash(offer.inputSchema, offer.outputSchema);
        const morsels = offer.price && offer.price.morsels > 0 ? offer.price.morsels : 0;
        const version = String(parsed.data.version ?? parsed.data.updatedAt ?? '1');
        const fields = {
          name: offer.title || `${agent.name}: ${offer.id}`,
          summary: offer.ask || '',
          inputSchema: (offer.inputSchema as Record<string, unknown> | undefined) ?? null,
          outputSchema: (offer.outputSchema as Record<string, unknown> | undefined) ?? null,
          usage: offer.exchange === true
            ? `Listed on EXCHANGE: contract it (aimeat_exchange_offerings → aimeat_exchange_accept) and start the task with aimeat_exchange_work; the agent delivers later.`
            : `Ask the agent's owner for this work: aimeat_dm_send to ${agent.name}#${agent.owner}, or a work request naming offer '${offer.id}'.`,
          cost: morsels ? { morsels } : null,
          schemaHash,
          tags: (offer.tags ?? []) as string[],
        };
        if (!existing) {
          const cap: CapabilityRecord = {
            id: ref, ...fields,
            ownerGhii: `${agent.owner}@${config.nodeId}`, visibility: 'public', scope: 'local', status: 'active',
            rejectionReason: null, deprecationMessage: null, replacedBy: null,
            source: { type: 'offering', ref, version },
            authRequired: 'registered', callable: false,
            exports: null, whenToUse: offer.example ? String(offer.example).slice(0, 500) : '', whenNotToUse: '', examples: [], dependencies: [],
            webhookUrl: null, trustRequired: null,
            trust: makeDefaultTrust(), redactedFields: [], operatorOverride: null, stats: makeDefaultStats(),
            createdAt: now, updatedAt: now,
          };
          await storage.createCapability(cap);
          created++;
        } else if (existing.status === 'disabled' || existing.schemaHash !== schemaHash || existing.summary !== fields.summary || existing.usage !== fields.usage || existing.source.version !== version) {
          await storage.updateCapability(existing.id, { ...fields, status: 'active', source: { type: 'offering', ref, version }, updatedAt: now });
          updated++;
        }
      }
    }
  } catch (err) { logger.error('Capability aggregator: offering scan failed', { error: String(err) }); }

  // 6. Disable or delete capabilities whose sources are gone
  for (const sourceType of ['extension', 'action', 'cortex', 'app-tool', 'offering']) {
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
