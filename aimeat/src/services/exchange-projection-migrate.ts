/**
 * @file src/services/exchange-projection-migrate.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description TARGET-050 slice 3: bring hand-authored EXCHANGE listings into the projection model by
 *   flipping the `exchange` flag on in their source and letting the reconcile adopt them. Moved out of
 *   services/exchange-projection.ts unchanged when the fourth source (data packages, plan
 *   doc-mvwxcas3dom3, D5.1) took that file toward the line limit.
 * @structure migrateLegacyOfferings
 * @usage const report = await migrateLegacyOfferings(storage, ownerGhii, { dryRun: true });
 * @version-history
 *   v1.0.0 — 2026-11-01 — Pure extraction from services/exchange-projection.ts (v1.8.0).
 */
import type { Storage } from '../storage/interface.js';
import { AppToolsDocSchema, appToolsKey, type AppTool } from '../models/app-tool-schemas.js';
import { OffersDocSchema, type Offer } from '../models/offer-schemas.js';
import { listAllOfferings } from './exchange-market.js';
import { reconcileOwnerOfferings, type ReconcileReport } from './exchange-projection.js';
import { updateRecord, UNCHANGED } from './record-cas.js';
import { localAccountName } from '../utils/gaii.js';

/** A stored source document as its schema reads it, or null when it is absent or does not validate. */
const parsedOrNull = <T>(schema: { safeParse(v: unknown): { success: true; data: T } | { success: false } }, v: unknown): T | null => {
  const p = schema.safeParse(v);
  return p.success ? p.data : null;
};

// ── MIGRATION (TARGET-050 slice 3) ───────────────────────────────────────────

/**
 * Bring hand-authored listings into the projection model: for each of the owner's listed offerings that is
 * not yet a projection, flip the `exchange` flag ON in its SOURCE (so the source now explains why the
 * listing exists) and let reconcile adopt the existing record — keeping its `offeringId`, so entitlements
 * referencing `offering:{id}` keep resolving. A listing whose source is gone is reported as an orphan and
 * left exactly as it is. Idempotent; `dryRun` writes nothing.
 */
export async function migrateLegacyOfferings(
  storage: Storage, ownerGhii: string, opts?: { dryRun?: boolean },
): Promise<ReconcileReport & { orphans: string[]; flagged: string[] }> {
  const dryRun = opts?.dryRun === true;
  const ownerName = localAccountName(ownerGhii);
  const legacy = (await listAllOfferings(storage)).filter(o => o.providerOwner === ownerName && o.state === 'listed' && !o.auto);
  const orphans: string[] = []; const flagged: string[] = [];

  for (const o of legacy) {
    if (o.kind === 'app-tool' && o.surface?.kind === 'app-tool') {
      const { appId, tool: toolName } = o.surface;
      // The flag is set on the manifest's version (updateRecord), so a tool list published meanwhile
      // is read again and flagged rather than replaced; a dry run decides on the same read.
      let seen: 'orphan' | 'listed' | 'flag' = 'orphan';
      await updateRecord(storage, ownerGhii, appToolsKey(appId), (v) => parsedOrNull(AppToolsDocSchema, v), (doc) => {
        const tool = doc?.tools.find((t: AppTool) => t.name === toolName);
        seen = !doc || !tool ? 'orphan' : tool.exchange === true ? 'listed' : 'flag';
        if (seen !== 'flag' || dryRun || !doc || !tool) return UNCHANGED;
        tool.exchange = true;
        if (!tool.usageTerms && o.usageTerms) tool.usageTerms = { ...o.usageTerms };
        return { ...doc, updatedAt: new Date().toISOString() };
      }, { tag: 'app-tools', visibility: 'public' });
      if (seen === 'orphan') orphans.push(`${o.offeringId} (${o.ext}/${o.action})`);
      else if (seen === 'flag') flagged.push(`${appId}/${toolName}`);
      continue;
    }
    if (o.kind === 'ext-action') {
      const ext = await storage.getExtension(o.ext);
      const act = ext?.actions.find(a => a.id === o.action);
      if (!ext || !act || ext.installedBy !== ownerName) { orphans.push(`${o.offeringId} (${o.ext}/${o.action})`); continue; }
      if (act.commercial?.exchange === true) continue;
      flagged.push(`${ext.name}/${act.id}`);
      if (!dryRun && act.commercial) {
        act.commercial.exchange = true;
        if (!act.commercial.usageTerms && o.usageTerms) act.commercial.usageTerms = { ...o.usageTerms };
        await storage.updateExtension(ext.name, { actions: ext.actions });
      }
      continue;
    }
    if (o.kind === 'agent-work' && o.surface?.kind === 'agent-work') {
      const agentName = o.surface.agentName;
      const agent = (await storage.listAgents()).find(a => a.owner === ownerName && a.name === agentName);
      // As for an app tool list: the flag is set on the offers record's version.
      let seen: 'orphan' | 'listed' | 'flag' = 'orphan';
      if (agent) await updateRecord(storage, agent.gaii, `agents.${agentName}.offers`, (v) => parsedOrNull(OffersDocSchema, v), (doc) => {
        const offer = doc?.offers.find((f: Offer) => f.id === o.action);
        seen = !doc || !offer ? 'orphan' : offer.exchange === true ? 'listed' : 'flag';
        if (seen !== 'flag' || dryRun || !doc || !offer) return UNCHANGED;
        offer.exchange = true;
        offer.visibility = 'public';
        if (!offer.inputSchema && o.taskSpec?.inputSchema) offer.inputSchema = o.taskSpec.inputSchema;
        if (!offer.outputSchema && o.taskSpec?.outputSchema) offer.outputSchema = o.taskSpec.outputSchema;
        if (!offer.usageTerms && o.usageTerms) offer.usageTerms = { ...o.usageTerms };
        return { ...doc, updatedAt: new Date().toISOString() };
      }, { tag: 'offers', visibility: (stored) => stored?.visibility ?? 'owner' });
      if (seen === 'orphan') orphans.push(`${o.offeringId} (${o.ext}/${o.action})`);
      else if (seen === 'flag') flagged.push(`${agentName}:${o.action}`);
      continue;
    }
    orphans.push(`${o.offeringId} (${o.ext}/${o.action})`);
  }

  const report = await reconcileOwnerOfferings(storage, ownerGhii, { dryRun });
  return { ...report, orphans, flagged };
}
