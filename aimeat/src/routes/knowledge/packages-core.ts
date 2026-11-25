/**
 * @file src/routes/knowledge/packages-core.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Core knowledge package routes — import, get manifest, and link CRUD
 *   (create/list/delete/broken-links). Extracted from src/routes/knowledge.ts to satisfy
 *   max-file-lines.
 * @version-history
 *   2026-11-25 — POST /v1/knowledge/import calls services/knowledge/package-import.ts, where its work
 *     moved unchanged, so the MCP tool aimeat_knowledge_create creates a package the same way.
 *   2026-11-21 — POST /v1/knowledge/import: each entry gets its content risk marks at the intake point.
 *   2026-11-14 — GET /v1/knowledge/:id/links reads through packageLinksFor (services/knowledge/package-links.ts),
 *     which aimeat_knowledge_links asks too: an agent holding memory:read-as-owner reaches its owner's
 *     private package (structure programme 2026-11, unit 2b, B15).
 *   2026-11-05 — An imported entry at 'group' is stored private: an import names no group.
 *   2026-11-04 — No prefix scan for a storage without getMemoryByKeysAnyOwner: it is required on
 *     Storage (codebase analysis 2026-11-03, item D-e).
 *   2026-10-24 — POST /v1/knowledge/import refuses the shared anonymous principal with
 *     refuseAnonymousPrincipal (secaudit2026oct22, routes/auth.ts:anonymous-mint:writes-outside-anonymous-namespace).
 *   2026-10-22 — broken-links asks whether a public record is at the target with one read by that key,
 *     where it read every owner and agent of the node on each request (check:unbounded-lists).
 *   2026-10-22 — A link row belongs to the namespace that holds its source manifest: POST /link and the
 *     import write the row under the manifest's ownerGaii, DELETE /link deletes that namespace's row
 *     only, and GET /links lists the outgoing rows of the record it found (the caller's own first).
 *     Another account that wrote a record at packages/<id>/manifest read, replaced and deleted the
 *     owner's rows (secaudit 2026-10, v78). linked_by is the contributor's full identity
 *     (callerOf().ownerGhii), not the bare account name, so owner erasure finds it; broken-links reads
 *     the package's rows in the caller's own account, where it read no row at all (v79).
 *   2026-10-19 — POST /v1/knowledge/:id/link appends to the manifest's links on the manifest's version
 *     (record-cas.ts updateMemoryRecord), where it wrote back the manifest it had read (check:atomic-writes).
 *   2026-10-18 — On a node that shows its content to signed-in accounts only, POST /v1/knowledge/import
 *     stores a listed package at the audience 'members' (unlisted) and a public entry at 'members', with
 *     the warning PUBLIC_IS_SIGNED_IN_HERE, before the publish gate (plan V1.6).
 *   2026-10-18 — POST /v1/knowledge/import asks the publish gate for a listed package or a public
 *     entry: an agent without publish:public stores the package unlisted and those entries private,
 *     and gets 202 with `publish_request` (services/knowledge-publish-ask.ts; plan doc-mvcn6c7e4e5q, V4).
 *   2026-10-17 — A package's audience (sharing.audience: owner, members, organism:<id>, public) and an
 *     entry's members or organism:<id>: POST /v1/knowledge/import stores the records at the memory tier
 *     services/knowledge-audience.ts names and refuses an organism the writer is not in (400
 *     NOT_ORGANISM_MEMBER) before anything is written; entry overrides pass the schema too.
 *     GET /v1/knowledge/:id/links answers only a caller who may read the package (plan V3.6).
 *   2026-10-15 — GET /v1/knowledge/:id finds its manifest with helpers.ts findReadableManifest, which the
 *     reputation read shares (feature-list audit 207).
 *   2026-10-13 — POST /v1/knowledge/import stores the pacing amount as sharing.toll_morsels; the 3.x
 *     name sharing.morsel_price is accepted with the Deprecation headers and counted, and a mismatch
 *     of the two is 400 TOLL_MORSELS_MISMATCH. GET /v1/knowledge/:id answers the new name
 *     (decision-4-0-0-sharing-morsel-price-ja-cost-morsels-saavat-nimen-toll).
 *   2026-10-12 — requireRestScope (auth/rest-scope-gate.ts): memory:write on POST /v1/knowledge/:id/link, DELETE /v1/knowledge/:id/link; memory:read on GET /v1/knowledge/:id/broken-links. Allowed with the Deprecation headers before 4.0.0, refused from it (wish-rest-reitit-ilman-scope-tarkistusta-agentti-p-see-kaikkeen).
 *   2026-10-12 — The organism-share consent's reach is `local`, the name `private` now has (Core 2026-11 AUTHZ-18).
 *   v1.0.0 — 2026-07-13 — Extracted from src/routes/knowledge.ts (max-file-lines)
 *   v1.1.0 — 2026-07-16 — GET /:id public manifest lookup batches owners+agents (was O(owners+agents) scan)
 *   v1.2.0 — 2026-08-01 — TARGET-058 Phase 3: importing a package whose `synthesis.level` is not
 *     `original` mints an addressable provenance record (`stampedBy: 'principal'` — the author
 *     declares it, the node did not witness it) and attaches it to the manifest; GET /:id serves it
 *     on `meta.provenance` + the AI-Disclosure headers.
 *   v1.3.0 — 2026-09-12 — The compiled schema moves to ./manifest-validator.ts so the operator's
 *     import can use it too, and the refusal's `details` reach the caller: they were being passed
 *     as error()'s fourth argument, which is httpStatus, so "the details below say which part" has
 *     carried none since the line was written. The untyped require('ajv') hid it.
 *   v1.4.0 — 2026-09-29 — TARGET-082 V4: GET /:id passes the manifest it found through the caller's
 *     classification reader (readerFor, presentMemory): one the caller may not see answers 404 like a
 *     missing one, and one shown to an AI under a warning label carries `classificationWarning`.
 *   v1.5.0 — 2026-10-08 — POST /v1/knowledge/import records provenance through provenanceForWrite for
 *     the manifest and each entry: `ai_provenance` from the body (a declaration
 *     the caller may not make is 403 before anything is stored), else the synthesis level as a
 *     declaration for a caller who may declare, else the node's stamp for an agent. It minted
 *     directly, past the provenance:write gate, and stamped no entry (aiprov E10).
 */
import type { Router } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage, KnowledgeManifest, MemoryLinkRecord } from '../../storage/interface.js';
import { requireAuth, requireRole, requireScope } from '../../auth/middleware.js';
import { refuseAnonymousPrincipal } from '../../auth/anonymous-principal.js';
import { success, error } from '../../middleware/envelope.js';
import { emitChange } from '../../services/event-bus.js';
import type { KnowledgeHelpers } from './helpers.js';
import { loadServedProvenance, envelopeMeta, setProvenanceHeaders } from '../../services/ai/provenance-marks.js';
import { localAccountName } from '../../utils/gaii.js';
import { classificationWarningOf } from '../../services/classification/present-memory.js';
import { requireRestScope } from '../../auth/rest-scope-gate.js';
import { presentKnowledgeManifest } from '../../services/toll-morsels-names.js';
import { callerOf } from '../../middleware/caller.js';
import { packageLinksFor } from '../../services/knowledge/package-links.js';
import { isAnonymousPrincipal } from '../../auth/anonymous-principal.js';
import { updateMemoryRecord, UNCHANGED } from '../../services/record-cas.js';
import { importKnowledgePackage } from '../../services/knowledge/package-import.js';

export function registerPackagesCoreRoutes(
  router: Router,
  config: AimeatConfig,
  storage: Storage,
  helpers: KnowledgeHelpers,
): void {
  const { resolve, findReadableManifest, findOwnerScopeMemory } = helpers;

  /* ── POST /v1/knowledge/import — Import a knowledge package from AI Chat output ── */
  // The package is stored under packages/<id>/ and may be listed in the catalogue, outside the
  // anonymous.* namespace, so the shared anonymous principal does not import one. The work is
  // services/knowledge/package-import.ts, which the MCP tool aimeat_knowledge_create calls too.
  router.post('/v1/knowledge/import', requireAuth(), refuseAnonymousPrincipal(), requireScope('memory:write'), async (req, res) => {
    const out = await importKnowledgePackage({ storage, config }, callerOf(req, config.nodeId, storage), req.auth?.app, req.body ?? {});
    if (!out.ok) {
      // `details` is the FIFTH argument; the fourth is httpStatus (v1.3.0 above).
      res.status(out.status).json(error(config.nodeId, out.code, out.message, undefined, out.details));
      return;
    }
    res.status(out.status).json(success(config.nodeId, out.data, [
      { description: 'View package manifest', method: 'GET', url: `/v1/memory/${encodeURIComponent(out.manifestKey)}` },
      { description: 'List your packages', method: 'GET', url: '/v1/memory?prefix=packages/&tags=knowledge-package' },
    ]));
  });

  /* ── GET /v1/knowledge/:id — Get package manifest ── */
  router.get('/v1/knowledge/:id', async (req, res) => {
    const packageId = req.params.id as string;
    const manifestKey = `packages/${packageId}/manifest`;

    // A public manifest of any account, else the caller's own in any visibility, as the
    // classification reader shows it (TARGET-082): helpers.ts findReadableManifest, which the
    // reputation read asks too, so the two cannot answer differently.
    const manifest = (await findReadableManifest(req, manifestKey))?.record;
    if (!manifest) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Package not found or not public'));
      return;
    }

    // TARGET-058: the package's provenance rides on `meta.provenance`, the ONE envelope carrier, and
    // on the AI-Disclosure / Link headers. The read above is the authorization decision; provenance
    // travels with the content it describes, so no second check is owed here.
    const prov = await loadServedProvenance(storage, config, manifest.aiProvenanceId);
    setProvenanceHeaders(res, prov);
    const warning = classificationWarningOf(manifest);
    res.json(success(config.nodeId, {
      package_id: packageId,
      // A manifest stored before 4.0.0 answers its sharing.morsel_price as sharing.toll_morsels.
      manifest: presentKnowledgeManifest(manifest.value),
      ...(warning ? { classificationWarning: warning } : {}),
      tags: manifest.tags,
      created_at: manifest.createdAt,
      updated_at: manifest.updatedAt,
    }, undefined, envelopeMeta(prov)));
  });

  /* ── POST /v1/knowledge/:id/link — Create a link from this package to another memory ── */
  router.post('/v1/knowledge/:id/link', requireAuth(), requireRestScope('memory:write'), requireRole('agent'), async (req, res) => {
    const ownerGaii = resolve(req);
    // The contributor in its full identity (MemoryLinkRecord.linked_by), which owner erasure deletes by.
    const ghii = callerOf(req, config.nodeId, storage).ownerGhii;
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

    // A row of the namespace that holds the manifest found above: another account's row with the same
    // source and target is a different row and stays (secaudit 2026-10, v78).
    await storage.createLink(link, ownerGaii);

    // Also update the manifest's links array: on the stored manifest's version (record-cas.ts), so a
    // link added at the same moment stays.
    await updateMemoryRecord(storage, ownerGaii, manifestKey, (rec) => {
      if (!rec) return UNCHANGED;
      const manifestValue = structuredClone(rec.value) as KnowledgeManifest;
      manifestValue.links = manifestValue.links ?? [];
      manifestValue.links.push({ target, relation, description, linked_at: now });
      manifestValue.updated = now;
      return { value: manifestValue };
    });

    res.status(201).json(success(config.nodeId, { link }, [
      { description: 'List package links', method: 'GET', url: `/v1/knowledge/${packageId}/links` },
    ]));
    emitChange('knowledge');
  });

  /* ── GET /v1/knowledge/:id/links — List links for a package ── */
  router.get('/v1/knowledge/:id/links', async (req, res) => {
    const packageId = req.params.id as string;
    const direction = (req.query.direction as string) ?? 'both';
    const relation = req.query.relation as string | undefined;

    // The links of a package are read on the terms of the package itself, the one rule
    // aimeat_knowledge_links asks too (services/knowledge/package-links.ts): a package this caller may
    // not read answers like a missing one, the caller's own package comes first, and the rows are
    // those of the namespace that holds the manifest found (secaudit 2026-10, v78).
    const signedIn = !!req.auth && !isAnonymousPrincipal(req.auth);
    const found = await packageLinksFor(storage, config,
      { caller: signedIn ? callerOf(req, config.nodeId, storage) : null, auth: req.auth },
      packageId, { direction: direction as 'outgoing' | 'incoming' | 'both', relation });
    if (!found.found) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Package not found or not public'));
      return;
    }
    const links = found.links;

    res.json(success(config.nodeId, { links, count: links.length }));
  });

  /* ── DELETE /v1/knowledge/:id/link — Delete a link ── */
  router.delete('/v1/knowledge/:id/link', requireAuth(), requireRestScope('memory:write'), requireRole('agent'), async (req, res) => {
    const packageId = req.params.id as string;
    const { target } = req.body;
    if (!target) {
      res.status(400).json(error(config.nodeId, 'MISSING_FIELDS', 'target is required'));
      return;
    }

    const manifestKey = `packages/${packageId}/manifest`;
    // Ownership (SECURITY): only the package owner may delete its links. Mirror the POST /link guard —
    // resolve the caller's identity and require the manifest to exist in THEIR namespace (else 404).
    const ownerGaii = resolve(req);
    const manifest = await storage.getMemory(ownerGaii, manifestKey);
    if (!manifest) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Package not found'));
      return;
    }
    // Only this namespace's row: another account's record at the same key reaches no row of the
    // package owner (secaudit 2026-10, v78).
    const deleted = await storage.deleteLink(manifestKey, target, ownerGaii);
    if (!deleted) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Link not found'));
      return;
    }

    res.json(success(config.nodeId, { deleted: true }));
    emitChange('knowledge');
  });

  /* ── GET /v1/knowledge/:id/broken-links — Find broken links ── */
  // The links of this package whose source or target is gone. It asked the storage for the caller's
  // rows by contributor, which no row matched (the contributor was stored as the bare account name), so
  // it always answered an empty list (secaudit 2026-10, v79). Now: the package in the caller's own
  // account (the owner in person also finds one their agent holds), that namespace's rows, and a
  // target counts as present when it is a record in the same account, a public record, or a package
  // the caller may read. A package not in the caller's account answers an empty list, as before.
  router.get('/v1/knowledge/:id/broken-links', requireAuth(), requireRestScope('memory:read'), requireRole('agent'), async (req, res) => {
    const manifestKey = `packages/${req.params.id as string}/manifest`;
    const found = await findOwnerScopeMemory(req, manifestKey);
    const broken: MemoryLinkRecord[] = [];
    if (found) {
      for (const link of await storage.findBrokenLinks(found.ownerGaii, manifestKey)) {
        const sourceGone = !(await storage.getMemory(found.ownerGaii, link.source));
        if (sourceGone || !(await targetPresent(req, found.ownerGaii, link.target))) broken.push(link);
      }
    }

    res.json(success(config.nodeId, { broken_links: broken, count: broken.length }));
  });

  /** Whether a link target outside the source's namespace still exists for this caller. */
  async function targetPresent(req: Express.Request, sourceOwner: string, target: string): Promise<boolean> {
    const account = localAccountName(sourceOwner);
    const sameAccount = [`${account}@${config.nodeId}`, ...(await storage.getAgentsByOwner(account)).map(a => a.gaii)];
    if ((await storage.listMemoryForOwners(sameAccount, { prefix: target })).some(r => r.key === target)) return true;
    if (await publicRecordAt(target)) return true;
    // A package shared with the node's accounts or an organism the caller is in.
    return /^packages\/[^/]+\/manifest$/.test(target) && !!(await findReadableManifest(req, target));
  }

  /**
   * Whether a person or an agent of this node holds a public, not archived record at exactly `target`.
   * One read by the key (any owner), filtered to this node's people and agents; it read every owner
   * and every agent of the node on each call before (check:unbounded-lists).
   */
  async function publicRecordAt(target: string): Promise<boolean> {
    const rows = await storage.getMemoryByKeysAnyOwner([target]);
    const ofThisNode = (gaii: string) => !gaii.startsWith('eco:') && !gaii.startsWith('ext:') && gaii.endsWith(`@${config.nodeId}`);
    return rows.some(r => r.key === target && r.visibility === 'public' && !r.archived && ofThisNode(r.ownerGaii));
  }
}
