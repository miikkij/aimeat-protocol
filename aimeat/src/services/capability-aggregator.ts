/**
 * @file capability-aggregator.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Background job that scans extensions, actions, and cortex modules
 *   to auto-create/update capability records.
 * @version-history
 *   v1.8.0 - 2026-10-16 - The cleanup step runs for a source type only when that type's scan
 *     completed: a scan that throws (or an owner's app manifests that cannot be read) changes no
 *     row of its type, and the result lists `failedScans`. An action row switches on again like
 *     the other kinds, and an insert of an id that already exists is taken as the existing row
 *     (its source ref restored) instead of stopping the scan (QA audit F2-01).
 *   v1.7.0 - 2026-10-13 - The pacing amount is written as `cost.toll_morsels`, its 4.0.0 name
 *     (decision-4-0-0-sharing-morsel-price-ja-cost-morsels-saavat-nimen-toll).
 *   v1.6.0 - 2026-10-13 - aggregateExtensionCapabilities and aggregateExtensionNow: the extension
 *     part of the scan for ONE extension, which a package install and an activation run before they
 *     answer. The scan's own extension loop calls the same function, so the rows are made one way.
 *   v1.5.0 - 2026-10-11 - A capability's `cost.morsels` is the pacing amount per use: an action's
 *     tollMorsels, an app tool's tollMorsels plus its old price.morsels, an offer's normalized
 *     tollMorsels. A morsel is pacing, not a price.
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
import { OffersDocSchema, normalizeOfferPacing, TOLL_MORSELS_MAX, type Offer } from '../models/offer-schemas.js';

/**
 * An app tool's pacing amount per use: `tollMorsels`, plus a 3.26.x `price.morsels`, which is pacing
 * now (ruling decision-morseli-on-tahdistus-ei-hinta-tarjouksen-kaksi-arvoa). Read through a loose
 * shape so the old field is found whether or not the tool schema still declares it.
 */
function toolPacing(tool: object): number {
  const t = tool as { tollMorsels?: number; price?: { morsels?: number } | null };
  const toll = (t.tollMorsels ?? 0) + (t.price?.morsels && t.price.morsels > 0 ? t.price.morsels : 0);
  return Math.min(toll, TOLL_MORSELS_MAX);
}

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

/**
 * Insert a capability row, or take the row that already holds its id. Two runs of the scan at
 * once (the boot run, an install, the operator's trigger) can both see a ref as new, and a row
 * whose source ref was patched away from its id is not found by ref; in both cases the plain
 * INSERT failed on the primary key and stopped the scan part-way, which then disabled every row
 * the scan had not reached. An auto-generated row's id IS its source ref, so the existing row's
 * ref is set back to it. Answers true when a row was created. Any other error propagates.
 */
async function createOrAdopt(storage: Storage, cap: CapabilityRecord): Promise<boolean> {
  try {
    await storage.createCapability(cap);
    return true;
  } catch (err) {
    const existing = await storage.getCapability(cap.id);
    if (!existing) throw err;
    if (existing.source.ref !== cap.source.ref || existing.source.type !== cap.source.type) {
      await storage.updateCapability(existing.id, { source: cap.source, updatedAt: cap.updatedAt });
    }
    return false;
  }
}

/** What the aggregator reads of one extension: its name, its actions' shapes and who installed it. */
type AggregatedExtension = Awaited<ReturnType<Storage['listExtensions']>>[number];

/**
 * One active extension's actions as capability rows: a row is made for a new action, switched on
 * again when the extension came back, and refreshed when its version, shape or owner changed.
 * `seenRefs`, when given, collects the refs for the full scan's cleanup.
 *
 * Exported so that whatever makes an extension live can do this for that one extension BEFORE it
 * answers (a package install, an activation). The full scan walks every owner, agent, app tool list
 * and cortex on the node and runs on a five-minute clock; an app tool is bound to the row
 * `ext:<name>:<action>`, so until 2026-10-13 every tool of a freshly installed package answered 404
 * CAPABILITY_NOT_FOUND until that clock came round.
 */
export async function aggregateExtensionCapabilities(
  config: AimeatConfig, storage: Storage, ext: AggregatedExtension, seenRefs?: Set<string>,
): Promise<{ created: number; updated: number }> {
  let created = 0, updated = 0;
  if (ext.status !== 'active' || !ext.actions) return { created, updated };
  const now = new Date().toISOString();
  for (const action of ext.actions) {
    const ref = `ext:${ext.name}:${action.id}`;
    seenRefs?.add(ref);
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
      if (await createOrAdopt(storage, cap)) created++;
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
  return { created, updated };
}

/**
 * The same, for an extension that just went live, by name. Never throws: the install or the
 * activation that calls it has already happened, and the five-minute scan makes the rows if this
 * could not.
 */
export async function aggregateExtensionNow(config: AimeatConfig, storage: Storage, name: string): Promise<void> {
  try {
    const ext = await storage.getExtension(name);
    if (ext) await aggregateExtensionCapabilities(config, storage, ext);
  } catch (err) {
    logger.error('Capability aggregator: the rows of an extension that just went live were not made; the next scan makes them', { extension: name, error: String(err) });
  }
}

/** The five source types the scan reads, in the order it reads them. */
const SCANNED_SOURCE_TYPES = ['extension', 'action', 'cortex', 'app-tool', 'offering'] as const;

export interface CapabilityAggregationResult {
  created: number;
  updated: number;
  disabled: number;
  /** Source types whose scan did not complete this run; their rows were left exactly as they were. */
  failedScans: string[];
}

export async function runCapabilityAggregation(config: AimeatConfig, storage: Storage): Promise<CapabilityAggregationResult> {
  let created = 0, updated = 0, disabled = 0;
  const seenRefs = new Set<string>();
  const now = new Date().toISOString();
  // A source type enters this set only when its scan ran to the end. The cleanup step (6) reads
  // "not seen" as "source gone", which is true only for a complete scan: a scan that stopped
  // part-way has not seen the rows after the failure, and would disable them on one run and
  // delete them on the next.
  const completed = new Set<string>();

  // 1. Scan active extensions. `lean`: schemas and metadata only — this scan never executes code,
  // and loading every action's full source cost +203 MB of native churn per cron run on production
  // (memory trace 2026-08-17).
  try {
    const extensions = await storage.listExtensions({ lean: true });
    for (const ext of extensions) {
      const made = await aggregateExtensionCapabilities(config, storage, ext, seenRefs);
      created += made.created;
      updated += made.updated;
    }
    completed.add('extension');
  } catch (err) { logger.error('Capability aggregator: extension scan failed; its rows stay as they were this run', { error: String(err) }); }

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
          // `cost.toll_morsels` holds the action's PACING amount per use, not a price.
          cost: action.pricing ? { toll_morsels: action.pricing.tollMorsels || 0 } : null,
          trustRequired: null,
          trust: makeDefaultTrust(), redactedFields: [],
          operatorOverride: null, stats: makeDefaultStats(),
          tags: action.tags || [], createdAt: now, updatedAt: now,
        };
        if (await createOrAdopt(storage, cap)) created++;
      } else if (existing.status === 'disabled') {
        // Re-enable: the action is published again. Without this branch an action row stayed
        // disabled after one missed scan until the next one deleted it.
        await storage.updateCapability(existing.id, { status: 'active', source: { type: 'action', ref, version: action.updatedAt }, updatedAt: now });
        updated++;
      }
    }
    completed.add('action');
  } catch (err) { logger.error('Capability aggregator: action scan failed; its rows stay as they were this run', { error: String(err) }); }

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
        if (await createOrAdopt(storage, cap)) created++;
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
    completed.add('cortex');
  } catch (err) { logger.error('Capability aggregator: cortex scan failed; its rows stay as they were this run', { error: String(err) }); }

  // 4. Scan every owner's app tool manifests (`apps.{appId}.tools`): each tool is a discovery entry.
  // The call itself goes through the contract door (EXCHANGE offering → aimeat_app_tool_invoke), so
  // the entry is not callable here; its usage names that door. The manifest is the owner's own public
  // record, read the same way the EXCHANGE projection reads it.
  try {
    const owners = await storage.listOwners();
    // One unreadable owner does not stop the other owners' tools from being refreshed, but it
    // makes the scan incomplete: the cleanup cannot tell that owner's tools from removed ones.
    let everyOwnerRead = true;
    for (const owner of owners) {
      const ownerGhii = `${owner.name}@${config.nodeId}`;
      let records: Array<{ key: string; value: unknown }> = [];
      try {
        records = (await storage.listMemory(ownerGhii, { prefix: 'apps.' })).filter(r => /^apps\..+\.tools$/.test(r.key));
      } catch (err) {
        logger.warn('Capability aggregator: an owner\'s app manifests could not be read; their tools stay as they were', { owner: owner.name, error: String(err) });
        everyOwnerRead = false;
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
          const morsels = toolPacing(tool);
          const version = String(parsed.data.version ?? parsed.data.updatedAt ?? '1');
          const fields = {
            name: `${appId}: ${tool.name}`,
            summary: tool.description || '',
            inputSchema: (tool.inputSchema as Record<string, unknown> | undefined) ?? null,
            outputSchema: (tool.outputSchema as Record<string, unknown> | undefined) ?? null,
            usage: `aimeat_app_tool_invoke { app_id: '${appId}', tool: '${tool.name}', input: {...} } under a contract for this app tool (aimeat_exchange_offerings → aimeat_exchange_accept), or the owner's own apps free of charge`,
            cost: morsels ? { toll_morsels: morsels } : null,
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
            if (await createOrAdopt(storage, cap)) created++;
          } else if (existing.status === 'disabled' || existing.schemaHash !== schemaHash || existing.summary !== fields.summary || existing.usage !== fields.usage || existing.source.version !== version) {
            await storage.updateCapability(existing.id, { ...fields, status: 'active', source: { type: 'app-tool', ref, version }, updatedAt: now });
            updated++;
          }
        }
      }
    }
    if (everyOwnerRead) completed.add('app-tool');
  } catch (err) { logger.error('Capability aggregator: app-tool scan failed; its rows stay as they were this run', { error: String(err) }); }

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
        // The offer's pacing amount; an old `price.morsels` adds to it (normalizeOfferPacing).
        const morsels = normalizeOfferPacing(offer).tollMorsels ?? 0;
        const version = String(parsed.data.version ?? parsed.data.updatedAt ?? '1');
        const fields = {
          name: offer.title || `${agent.name}: ${offer.id}`,
          summary: offer.ask || '',
          inputSchema: (offer.inputSchema as Record<string, unknown> | undefined) ?? null,
          outputSchema: (offer.outputSchema as Record<string, unknown> | undefined) ?? null,
          usage: offer.exchange === true
            ? `Listed on EXCHANGE: contract it (aimeat_exchange_offerings → aimeat_exchange_accept) and start the task with aimeat_exchange_work; the agent delivers later.`
            : `Ask the agent's owner for this work: aimeat_dm_send to ${agent.name}#${agent.owner}, or a work request naming offer '${offer.id}'.`,
          cost: morsels ? { toll_morsels: morsels } : null,
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
          if (await createOrAdopt(storage, cap)) created++;
        } else if (existing.status === 'disabled' || existing.schemaHash !== schemaHash || existing.summary !== fields.summary || existing.usage !== fields.usage || existing.source.version !== version) {
          await storage.updateCapability(existing.id, { ...fields, status: 'active', source: { type: 'offering', ref, version }, updatedAt: now });
          updated++;
        }
      }
    }
    completed.add('offering');
  } catch (err) { logger.error('Capability aggregator: offering scan failed; its rows stay as they were this run', { error: String(err) }); }

  // 6. Disable or delete capabilities whose sources are gone, for the source types whose scan
  // completed. A failed scan changes no row of its type.
  const failedScans = SCANNED_SOURCE_TYPES.filter(t => !completed.has(t));
  for (const sourceType of SCANNED_SOURCE_TYPES) {
    if (!completed.has(sourceType)) continue;
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

  if (created || updated || disabled || failedScans.length) {
    logger.info(`Capability aggregation: ${created} created, ${updated} updated, ${disabled} disabled`, { failedScans });
  }

  return { created, updated, disabled, failedScans };
}
