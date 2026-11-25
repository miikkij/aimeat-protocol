/**
 * @file src/services/knowledge/package-import.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Creating a knowledge package, once, for every surface that creates one: POST
 *   /v1/knowledge/import and the MCP tool aimeat_knowledge_create.
 *
 *   WHY THIS FILE EXISTS. The import did its work inside the route, so an agent over MCP could add an
 *   entry to a package (aimeat_knowledge_contribute) and could not create one. An agent that had
 *   research to keep wrote it into an organism workspace instead. Under the rule in CLAUDE.md
 *   (Backend: one capability, one implementation) the tool calls the function the route calls, so the
 *   schema check, the audience check, the publish gate and the provenance happen here once.
 *
 *   The work and its order are the route's as they were on 2026-11-24, moved unchanged: normalise the
 *   AI chat output into a strict manifest, refuse what the schema, the audience rule or the provenance
 *   rule refuses BEFORE anything is written, then write the manifest, each entry, the links and the
 *   organism consent, then file the publish request when the gate asked for one.
 * @structure KnowledgeImportBody · KnowledgeImportResult · importKnowledgePackage()
 * @usage
 *   const out = await importKnowledgePackage({ storage, config }, callerOf(req, nodeId, storage), req.auth?.app, req.body);
 *   if (!out.ok) return res.status(out.status).json(error(nodeId, out.code, out.message, undefined, out.details));
 * @version-history
 *   v1.0.0 — 2026-11-25 — Moved out of POST /v1/knowledge/import (routes/knowledge/packages-core.ts)
 *     for the MCP tool aimeat_knowledge_create (wish-knowledge-package-luonti-mcp-hen-ja-sana-package-yksiselitte).
 */
import { v4 as uuidv4 } from 'uuid';
import type { AimeatConfig } from '../../config.js';
import type { Storage, KnowledgeManifest, MemoryRecord } from '../../storage/interface.js';
import type { CallerContext } from '../caller-context.js';
import { checkAudienceWrite } from '../audience-write.js';
import {
  KNOWLEDGE_PACKAGE_LEVELS, KNOWLEDGE_PACKAGE_SPELLING, packageAudienceOf, manifestRecordVisibility, entryRecordVisibility,
} from './audience.js';
import { validateManifest } from './manifest-validator.js';
import { emitChange } from '../event-bus.js';
import { recordPublicActivity } from '../public-activity.js';
import { provenanceForWrite, provenanceDeclarationRefusal, type DeclaredProvenance } from '../ai/provenance.js';
import { parseDeclaredProvenanceInput } from '../ai/provenance-input.js';
import { memoryContentBytes } from '../../utils/memory-content.js';
import { logger } from '../../utils/logger.js';
import { normalizeKnowledgeSharing } from '../toll-morsels-names.js';
import { knowledgePublishAsk, fileKnowledgeAsk } from './publish-ask.js';
import { closedNodeLevel, closedNodeWarnings } from '../closed-node-level.js';
import { contentRiskAfterWrite } from '../content/risk-intake.js';
import { isAnonymousPrincipal, ANONYMOUS_PRINCIPAL_REFUSAL } from '../../auth/anonymous-principal.js';

/** The request: what POST /v1/knowledge/import reads from its body, and the MCP tool's input. */
export interface KnowledgeImportBody {
  package?: unknown;
  overrides?: { catalog_listed?: boolean; organism_share?: string; entries?: Record<string, { visibility?: string }> };
  entry_data?: Record<string, unknown>;
  ai_provenance?: unknown;
}

export type KnowledgeImportResult =
  | { ok: true; status: 201 | 202; data: Record<string, unknown>; packageId: string; manifestKey: string }
  | { ok: false; status: number; code: string; message: string; details?: unknown };

/**
 * Create one knowledge package under the caller's own identity (resolveIdentity: the GHII of an owner
 * in person, the GAII of an agent), so the agent that created it can add to it with
 * aimeat_knowledge_contribute. `app` is the app grant a request came with, for the publish gate.
 */
export async function importKnowledgePackage(
  deps: { storage: Storage; config: AimeatConfig },
  caller: CallerContext,
  app: string | undefined,
  body: KnowledgeImportBody,
): Promise<KnowledgeImportResult> {
  const { storage, config } = deps;
  // The package is stored under packages/<id>/ and may be listed in the catalogue, outside the
  // anonymous.* namespace, so the shared anonymous principal does not create one. The route refuses
  // it in its middleware first; this is the same refusal for the surfaces without one.
  if (isAnonymousPrincipal(caller.auth)) return { ok: false, status: 401, code: 'AUTH_REQUIRED', message: ANONYMOUS_PRINCIPAL_REFUSAL };
  const ownerGaii = caller.principal;
  const ghii = caller.owner;
  const { overrides } = body;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- AI chat output, normalised below and then checked by the schema
  const pkg = body.package as any;

  if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) {
    return { ok: false, status: 400, code: 'INVALID_PACKAGE', message: 'Request body must include a "package" object' };
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
      toll_morsels: 0,
    };
  }
  // The pacing amount is sharing.toll_morsels; the 3.x name morsel_price is taken with the
  // Deprecation headers, counted, and stored under the new name. Two names that disagree are 400.
  const sharing = normalizeKnowledgeSharing(pkg.sharing);
  if (!sharing.ok) return { ok: false, status: sharing.status, code: sharing.code, message: sharing.message };
  pkg.sharing = sharing.value;
  if (!pkg.tags) pkg.tags = [];
  if (!pkg.language) pkg.language = 'en';
  // Normalize entries: ensure each has title, default visibility
  if (Array.isArray(pkg.entries)) {
    for (const entry of pkg.entries) {
      if (!entry || typeof entry !== 'object') continue;
      if (!entry.title) entry.title = entry.key || 'Untitled';
      if (!entry.visibility) entry.visibility = 'private';
      // Normalize 'shared' → 'owner' (memory layer doesn't have shared; prompt may produce it)
      if (entry.visibility === 'shared') entry.visibility = 'owner';
    }
  }

  // An entry override may name an audience too; it is applied before the checks below.
  if (overrides?.entries && Array.isArray(pkg.entries)) {
    for (const entry of pkg.entries) {
      const entryOverride = overrides.entries[String(entry?.key ?? '').split('/').pop() ?? ''];
      if (entryOverride?.visibility) entry.visibility = entryOverride.visibility;
    }
  }
  // An import names no group, so an entry at 'group' would open to nobody but its owner. Private keeps
  // the entry with the same reader, and PATCH .../entries/{key}/visibility shares it with a group.
  if (Array.isArray(pkg.entries)) {
    for (const entry of pkg.entries) if (entry?.visibility === 'group') entry.visibility = 'private';
  }

  // Validate manifest structure
  const manifest = pkg as KnowledgeManifest;
  if (!validateManifest(manifest)) {
    return {
      ok: false, status: 400, code: 'SCHEMA_VALIDATION',
      message: 'The description file for this package has something wrong in it. The details below say which part.',
      details: validateManifest.errors,
    };
  }

  const packageId = uuidv4();
  const now = new Date().toISOString();
  const manifestKey = `packages/${packageId}/manifest`;

  // Entry overrides were applied before the validation above, so an override passes the schema too.
  if (overrides?.catalog_listed !== undefined) {
    manifest.sharing.catalog_listed = overrides.catalog_listed;
    // If catalog_listed is enabled and allow_clone wasn't explicitly set, enable cloning
    if (overrides.catalog_listed && !manifest.sharing.allow_clone) {
      manifest.sharing.allow_clone = true;
    }
  }

  // sharing.audience 'public' is the catalogue, so it lists the package; any other audience on a
  // listed package is a contradiction, refused as PATCH /v1/knowledge/:id/sharing refuses it.
  if (manifest.sharing.audience === 'public') manifest.sharing.catalog_listed = true;
  else if (manifest.sharing.audience !== undefined && manifest.sharing.catalog_listed) {
    return { ok: false, status: 400, code: 'INVALID_INPUT', message: 'catalog_listed is true exactly when the audience is public; send one of the two.' };
  }

  // An audience that names an organism is refused before anything is written when the writer is
  // not in it: the package's own, and each entry's (services/audience-write.ts, plan V3.6).
  const named = [
    ...(manifest.sharing.audience !== undefined && !manifest.sharing.catalog_listed ? [manifest.sharing.audience] : []),
    ...manifest.entries.map(e => e.visibility).filter(v => v.startsWith('organism:')),
  ];
  for (const value of named) {
    const checked = await checkAudienceWrite(storage, value, caller.auth, KNOWLEDGE_PACKAGE_LEVELS, KNOWLEDGE_PACKAGE_SPELLING);
    if (!checked.ok) return { ok: false, status: checked.status, code: checked.code, message: checked.message };
  }

  // A node that shows its content to signed-in accounts only stores a listed package and its public
  // entries at 'members' instead, and says so (services/closed-node-level.ts, plan V1.6). Before the
  // gate, so a lowered package asks nothing.
  const pkgClosed = closedNodeLevel(config, manifest.sharing.catalog_listed === true ? 'public' : undefined, 'members' as const);
  let closedWarning = pkgClosed.warning;
  if (pkgClosed.warning) {
    manifest.sharing.catalog_listed = false;
    manifest.sharing.audience = 'members';
  }
  for (const e of manifest.entries) {
    const entryClosed = closedNodeLevel(config, e.visibility, 'members' as const);
    if (entryClosed.warning) { e.visibility = entryClosed.level; closedWarning = entryClosed.warning; }
  }

  // A listed package or a public entry asks the node's publish gate before anything is stored (plan
  // doc-mvcn6c7e4e5q, V4). On an ask the package is stored unlisted with its author and those
  // entries private, and one request naming them is filed after the write.
  const listed = manifest.sharing.catalog_listed === true;
  const keptEntries = manifest.entries.filter(e => e.visibility === 'public');
  const publishAsk = knowledgePublishAsk({ storage, config }, caller, app, listed || keptEntries.length > 0);
  if (publishAsk.kind === 'refused') return { ok: false, status: publishAsk.status, code: publishAsk.code, message: publishAsk.message };
  if (publishAsk.kind === 'ask') {
    manifest.sharing.catalog_listed = false;
    if (manifest.sharing.audience === 'public') manifest.sharing.audience = 'owner';
    for (const e of keptEntries) e.visibility = 'private';
  }

  // Resolve entry data — can be in body.entry_data, pkg.entry_data,
  // or directly on each entry's .value field (AI chat output format)
  const entryData: Record<string, unknown> = body.entry_data ?? pkg.entry_data ?? {};
  // Extract inline values from entries into entryData
  for (const entry of manifest.entries) {
    if ((entry as { value?: unknown }).value !== undefined) {
      const entryName = entry.key.split('/').pop() ?? entry.key;
      if (!entryData[entry.key] && !entryData[entryName]) {
        entryData[entryName] = (entry as { value?: unknown }).value;
      }
    }
  }

  // Normalize entry keys to full path BEFORE storing manifest
  for (const entry of manifest.entries) {
    if (!entry.key.startsWith('packages/')) {
      entry.key = `packages/${packageId}/${entry.key}`;
    }
  }

  // Store manifest (with normalized entry keys)
  manifest.created = now;
  manifest.updated = now;

  // TARGET-058, through THE write decision (provenanceForWrite) since 2026-10-08 (aiprov E10).
  //   - `ai_provenance` in the body is the caller's own statement, and a declaration the caller
  //     may not make is refused before anything is stored.
  //   - `synthesis.level` is the SAME vocabulary as the record's `level` (the record borrowed it
  //     from here), so a package saying anything other than `original` states AI involvement. It is
  //     honoured as a declaration by a caller who may declare; for an agent that may not, the
  //     node's own stamp (model-written, no review) says the same without taking its word.
  //   - `humanInvolvement` defaults to `none`: the manifest has no field for review, so nobody has
  //     told us a person read the substance (decision D4).
  // The manifest and every entry get their own record, because each is a different set of bytes.
  const principal = ownerGaii;
  const declaration = parseDeclaredProvenanceInput(body.ai_provenance);
  if (!declaration.ok) {
    return { ok: false, status: 400, code: 'INVALID_INPUT', message: 'The ai_provenance block does not parse.', details: { violations: declaration.violations } };
  }
  const scopes = [...caller.scopes];
  const explicitRefusal = await provenanceDeclarationRefusal(storage, {
    principal, declared: declaration.declared, enabled: config.aiProvenance, scopes,
  });
  if (explicitRefusal) return { ok: false, status: 403, code: explicitRefusal.code, message: explicitRefusal.message };
  let declared: DeclaredProvenance | undefined = declaration.declared;
  if (!declared && manifest.synthesis && manifest.synthesis.level !== 'original') {
    const fromSynthesis: DeclaredProvenance = {
      level: manifest.synthesis.level,
      ...(manifest.synthesis.model ? { model: manifest.synthesis.model } : {}),
      ...(manifest.synthesis.description ? { notes: manifest.synthesis.description } : {}),
    };
    const mayNot = await provenanceDeclarationRefusal(storage, { principal, declared: fromSynthesis, enabled: config.aiProvenance, scopes });
    if (!mayNot) declared = fromSynthesis;
  }
  const recordFor = (content: unknown, visibility: MemoryRecord['visibility']) => provenanceForWrite(storage, {
    principal, scopes, content: memoryContentBytes(content), declared,
    pipeline: 'knowledge.import', surface: { visibility, humanAudience: true },
    labelPolicy: config.aiLabelPublic, nodeId: config.nodeId, baseUrl: config.baseUrl, enabled: config.aiProvenance,
  });
  const aiProvenanceId = await recordFor(manifest, manifestRecordVisibility(manifest));

  await storage.setMemory({
    key: manifestKey,
    ownerGaii,
    value: manifest,
    visibility: manifestRecordVisibility(manifest),
    tags: ['knowledge-package', manifest.content_type, ...manifest.tags],
    ttlHours: null,
    version: 1,
    createdAt: now,
    updatedAt: now,
    ...(aiProvenanceId ? { aiProvenanceId } : {}),
  });

  // Store entries with their content
  const createdEntries: string[] = [];
  for (const entry of manifest.entries) {
    const shortKey = entry.key.split('/').pop() ?? '';
    const data = entryData[entry.key] ?? entryData[shortKey] ?? {};
    // Each entry's own record: the package's declaration about these bytes, or the stamp.
    const entryProvenanceId = await recordFor(data, entryRecordVisibility(entry.visibility));
    await storage.setMemory({
      key: entry.key,
      ownerGaii,
      value: data,
      visibility: entryRecordVisibility(entry.visibility),
      tags: ['knowledge-entry', manifest.content_type, ...manifest.tags],
      ttlHours: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
      ...(entryProvenanceId ? { aiProvenanceId: entryProvenanceId } : {}),
    });
    createdEntries.push(entry.key);
    // An imported package is content from outside: each entry's risk marks are written beside it.
    contentRiskAfterWrite({ storage, config }, { kind: 'memory', owner: ownerGaii, key: entry.key }, { point: 'intake' });
  }

  // Create memory links if specified: rows of the namespace that holds the manifest just written,
  // contributed by the caller's account in its full identity (secaudit 2026-10, v78 and v79).
  const linkedBy = caller.ownerGhii;
  for (const link of manifest.links ?? []) {
    await storage.createLink({
      source: manifestKey,
      target: link.target,
      relation: link.relation,
      description: link.description,
      linked_at: link.linked_at || now,
      linked_by: linkedBy,
    }, ownerGaii);
  }

  // Create organism consent grant if requested
  if (overrides?.organism_share) {
    await storage.createConsent({
      id: uuidv4(),
      ownerGaii,
      dataPattern: `packages/${packageId}/*`,
      recipient: `organism.${overrides.organism_share}`,
      purpose: 'Knowledge package shared with organism',
      scope: 'local',
      expires: null,
      status: 'active',
      grantedAt: now,
      revokedAt: null,
    });
  }

  // The request the publish gate asked for, now that the package it names exists.
  const asked = publishAsk.kind === 'ask'
    ? await fileKnowledgeAsk({ storage, config }, ghii, publishAsk.requester, {
      ownerGaii, packageId, name: String(manifest.name ?? packageId),
      field: listed ? 'audience' : 'entries', from: listed ? packageAudienceOf(manifest) : 'private',
      entries: keptEntries.map(e => e.key),
    })
    : closedNodeWarnings(closedWarning);

  emitChange('knowledge');
  // Public landing feed — only when the package opts into the public catalogue.
  if (manifest.sharing.catalog_listed) {
    void recordPublicActivity(storage, config, {
      category: 'agents',
      actor: ghii,
      summary: `Knowledge package "${manifest.name}" published`,
      detail: manifest.synthesis?.description || '',
      link: `/v1/knowledge/${packageId}`,
    }).catch(err => { logger.warn('knowledge import: feed is best-effort', { error: String(err) }); });
  }

  return {
    ok: true,
    status: asked.publish_request ? 202 : 201,
    packageId,
    manifestKey,
    data: {
      package_id: packageId,
      manifest_key: manifestKey,
      entries_created: createdEntries.length,
      catalog_listed: manifest.sharing.catalog_listed,
      audience: packageAudienceOf(manifest),
      ...asked,
    },
  };
}
