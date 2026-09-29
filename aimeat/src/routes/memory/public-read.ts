/**
 * @file src/routes/memory/public-read.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description GET /v1/memory/:gaii/:key, the cross-owner read: public records for anyone, members
 *   records for a signed-in member, anything else through the shared access guard (consent, group
 *   shares, workspace bindings). Moved out of routes/memory/key.ts (max-file-lines) when the order of
 *   its checks changed (TARGET-082 review, 2026-09-29):
 *   - the visibility gate and the access guard decide FIRST, and the classification reader
 *     (presentMemory) runs only for a reader the gate admitted. It ran first, so an outsider asking
 *     for a key wrote a `refused` classification audit row into its owner's log;
 *   - an organism's record admitted for a reader outside that organism, by a group share or by its
 *     own visibility (public, members), which its classification keeps inside its organism,
 *     answers 403 CLASSIFIED with the label and why (services/group-shares-classification.ts);
 *   - an AI shown a warning-classified record gets `classificationWarning` in the answer.
 * @structure registerPublicReadRoute(router, ctx)
 * @usage registerPublicReadRoute(router, ctx);   // from registerKeyRoutes, last
 * @version-history
 *   v1.1.1 — 2026-09-30 — The CLASSIFIED refusal is refuseClassified(): a plain sentence and the way
 *     forward, the label and the reason in details (check:plain-language).
 *   v1.1.0 — 2026-09-30 — TARGET-082 review, item 1: a public or members record under
 *     `organism.<id>.` passes the organism check for a non-member, as a shared one did.
 *   v1.0.0 — 2026-09-29 — Moved from routes/memory/key.ts; the gate now runs before the reader.
 */
import type { Router } from 'express';
import { success, error } from '../../middleware/envelope.js';
import { refuseClassified } from '../../middleware/refusals.js';
import { authorizeRead } from '../../services/access-guard.js';
import { presentMemory } from '../../services/classification/present-memory.js';
import { readerFor } from '../../services/classification/reader.js';
import { warningField } from '../../services/classification-exits.js';
import { shareCarriesKey } from '../../services/group-shares-classification.js';
import { ownDoorRefusal } from '../../utils/own-door-keys.js';
import { loadServedProvenance, envelopeMeta, setProvenanceHeaders } from '../../services/ai-provenance-marks.js';
import { type MemoryRouteCtx, visibilityToZone } from './shared.js';

export function registerPublicReadRoute(router: Router, ctx: MemoryRouteCtx): void {
  const { config, storage, stats, resolve } = ctx;

  // GET /v1/memory/:gaii/:key — public memory read (no auth for public entries)
  // This allows Tier 0 access to public memory, with consent checking for non-public data
  router.get('/v1/memory/:gaii/:key', async (req, res) => {
    const gaii = decodeURIComponent(req.params.gaii as string);
    const key = decodeURIComponent(req.params.key as string);

    // Soft read (?soft=1): 200 + { value: null, exists: false } instead of a 404 for keys that
    // legitimately may not exist yet — avoids browser-console 404 noise. SECURITY: the soft
    // response is byte-identical for "missing" and "exists but hidden" so it never reveals
    // the existence of non-public records (mirrors the 404 parity of the hard path).
    const soft = !!req.query.soft;
    const miss = () => {
      if (soft) { res.json(success(config.nodeId, { key, value: null, exists: false })); return; }
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Public memory not found: ${key}`));
    };

    // ONE CAPABILITY, ONE DOOR: a Design Book part is read through the Design Book, which benches a
    // component again before it hands one out. This door names that one (utils/own-door-keys.ts).
    const ownDoor = ownDoorRefusal(gaii, key, config.nodeId);
    if (ownDoor) {
      res.status(403).json(error(config.nodeId, ownDoor.code, ownDoor.message, 403, { door: ownDoor.door }));
      return;
    }

    const stored = await storage.getMemory(gaii, key);
    if (!stored) { miss(); return; }

    // The reader, resolved: an OWNER session carries a bare `sub`, while memberships, group shares
    // and consent grants are keyed under the resolved identity (see the non-public branch below).
    const isAnonymousReader = !req.auth?.sub || req.auth.anonymous === true;
    const accessorGaii = isAnonymousReader ? 'anonymous' : resolve(req);
    /** An organism's record goes to a reader outside that organism only when its label lets it leave. */
    const keptInside = async (via: string): Promise<boolean> => {
      const carried = await shareCarriesKey({ storage, config }, stored.ownerGaii, key, accessorGaii);
      if (carried.carries) return false;
      // The plain sentence and the way forward come from the builder; the label and the reader's
      // reason are in details (check:plain-language).
      res.status(403).json(refuseClassified(config, {
        thing: 'record',
        done: `handed out ${via}`,
        details: { label: carried.label, reason: carried.reason },
      }));
      return true;
    };

    // WHO MAY READ IT is decided first, on the stored record's visibility; the classification reader
    // runs below, only for a reader admitted here, so an outsider leaves no classification audit row
    // in the owner's log (TARGET-082 review).
    if (stored.visibility === 'public') {
      // Shared guard: audits the public read when the consent layer is enabled.
      await authorizeRead(storage, config, {
        ownerGaii: stored.ownerGaii,
        accessorGaii: req.auth?.sub ?? 'anonymous',
        resourceKey: key,
        visibility: 'public',
        action: 'read',
      });
      // Public visibility is the holder's word about their copy; an organism's record still leaves
      // the organism only when its classification lets it (TARGET-082 review, item 1).
      if (await keptInside('as a public record')) return;
    } else if (stored.visibility === 'members') {
      // Members data — readable by any authenticated user of this node. The check MUST exclude the
      // anonymous-mode shared identity: global optionalAuth injects a truthy req.auth (anonymous:
      // true) for unauthenticated visitors, so a bare req.auth truthiness gate would leak members
      // records to everyone. Anonymous behaves like other non-public records: a miss.
      if (!req.auth || req.auth.anonymous === true) { miss(); return; }
      await authorizeRead(storage, config, {
        ownerGaii: stored.ownerGaii,
        accessorGaii: req.auth.sub,
        resourceKey: key,
        visibility: 'members',
        action: 'read',
      });
      // Every signed-in account of the node is not every member of the organism (item 1).
      if (await keptInside('to every account of this node')) return;
    } else {
      // Non-public data: if consent is not enabled, fall back to old behavior (404)
      if (!config.consentEnabled) { miss(); return; }
      // Non-public data with consent enabled: shared guard decides + audits the attempt. For a
      // 'workspace' record the guard runs canReadWorkspace(record.workspaceRef) — thread the ref + the
      // accessor's sub/owner so a workspace member is recognised (parity with the storage-file /v1/pub path).
      // Resolve to the GHII/GAII. An OWNER session carries a BARE `sub` (just `alice`), while group
      // membership and consent grants are both keyed under the resolved identity (`alice@node`), so
      // passing the bare name matched neither and a human could not read what was shared with them —
      // only their agents could, whose `sub` is already a full GAII. Same fix, same reason, as the
      // storage-file twin GET /v1/pub, which resolves here and has since 2026-07-05.
      const decision = await authorizeRead(storage, config, {
        ownerGaii: stored.ownerGaii,
        accessorGaii,
        resourceKey: key,
        visibility: stored.visibility,
        groupId: stored.groupId,
        workspaceRef: stored.workspaceRef,
        accessorSub: req.auth?.sub,
        accessorOwner: req.auth?.owner as string | undefined,
        action: 'read',
      });
      if (!decision.allowed) {
        res.status(403).json(error(config.nodeId, 'CONSENT_DENIED', `You have not given permission for this: ${decision.reason}. You can change what you share in Profile → Consent.`));
        return;
      }
      // A key-space share hands an organism's record to a reader outside the organism only when its
      // classification lets it leave (services/group-shares-classification.ts). Kept inside, it is
      // said as that: the reader was given the key space, and would otherwise be told about consent.
      if (decision.reason === 'group_share' && await keptInside('through the share')) return;
    }

    // The one presentation of a memory value (classification + credential mask). A record this
    // reader may not see answers exactly as an absent one.
    const record = await presentMemory(readerFor({ storage, config }, req.auth), stored);
    if (!record) { miss(); return; }
    stats?.increment('memory_reads');

    const ddc = { flagCount: record.flagCount ?? 0, version: record.version, freshness: record.updatedAt, visibility: record.visibility };
    const body = {
      key: record.key,
      value: record.value,
      visibility: record.visibility,
      zone: visibilityToZone(record.visibility),
      tags: record.tags,
      version: record.version,
      owner_gaii: record.ownerGaii,
      created_at: record.createdAt,
      updated_at: record.updatedAt,
      ...warningField(record),
    };

    if (record.visibility === 'public') {
      // TARGET-058: an anonymous reader of public content gets the public projection of its
      // provenance. This is the SAME record `/v1/provenance/:id` serves them, because the item is
      // public — which is exactly what makes that record resolvable in the first place.
      const prov = await loadServedProvenance(storage, config, record.aiProvenanceId);
      setProvenanceHeaders(res, prov);
      res.json(success(config.nodeId, { ...body, ai_provenance_id: record.aiProvenanceId ?? null, _ddc: ddc }, undefined, envelopeMeta(prov)));
      return;
    }
    res.json(success(config.nodeId, { ...body, _ddc: ddc }));
  });
}
