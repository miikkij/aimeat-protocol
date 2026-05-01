/**
 * @file capability-aggregator.ts
 * @description Background job that scans extensions, actions, and cortex modules
 *   to auto-create/update capability records.
 * @version-history
 *   v1.0.0 - 2026-05-02 - Initial aggregator
 */
import { createHash } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage, CapabilityRecord } from '../storage/interface.js';
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

  // 1. Scan active extensions
  try {
    const extensions = await storage.listExtensions();
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
            summary: (action as any).description || ext.description || '',
            ownerGhii: ext.installedBy || `operator@${config.nodeId}`,
            visibility: 'public', scope: 'local', status: 'active',
            rejectionReason: null, deprecationMessage: null, replacedBy: null,
            source: { type: 'extension', ref, version: ext.version },
            authRequired: 'registered', callable: true,
            inputSchema: (action as any).inputSchema || null,
            outputSchema: (action as any).outputSchema || null,
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
        } else if (existing.source.version !== ext.version || existing.schemaHash !== schemaHash) {
          await storage.updateCapability(existing.id, {
            source: { type: 'extension', ref, version: ext.version },
            inputSchema: (action as any).inputSchema || null,
            outputSchema: (action as any).outputSchema || null,
            schemaHash, updatedAt: now,
          });
          updated++;
        }
      }
    }
  } catch { /* extensions may not be enabled */ }

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
  } catch { /* actions may fail */ }

  // 3. Scan active cortex modules (callable in browser)
  try {
    const cortexList = await storage.listCortexExtensions({ status: 'active' });
    for (const cortex of cortexList) {
      const ref = `cortex:${cortex.name}`;
      seenRefs.add(ref);
      const existing = await storage.getCapabilityBySourceRef(ref);

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
          inputSchema: null, outputSchema: null, exports: null,
          usage: `await loadScript('/v1/cortex/${cortex.name}/libs/${cortex.name}.js')`,
          whenToUse: '', whenNotToUse: '',
          examples: [],
          dependencies: [{ type: 'sdk', id: 'aimeat-data', required: true, minVersion: null }],
          schemaHash: '', webhookUrl: null, cost: null, trustRequired: null,
          trust: makeDefaultTrust(), redactedFields: [],
          operatorOverride: null, stats: makeDefaultStats(),
          tags: cortex.tags || [], createdAt: now, updatedAt: now,
        };
        await storage.createCapability(cap);
        created++;
      }
    }
  } catch { /* cortex may not be enabled */ }

  // 4. Disable capabilities whose sources are gone
  for (const sourceType of ['extension', 'action', 'cortex']) {
    try {
      const existing = await storage.listCapabilitiesBySourceType(sourceType);
      for (const cap of existing) {
        if (!seenRefs.has(cap.source.ref) && cap.status === 'active') {
          await storage.updateCapability(cap.id, { status: 'disabled', updatedAt: now });
          disabled++;
        }
      }
    } catch { /* ignore */ }
  }

  if (created || updated || disabled) {
    logger.info(`Capability aggregation: ${created} created, ${updated} updated, ${disabled} disabled`);
  }

  return { created, updated, disabled };
}
