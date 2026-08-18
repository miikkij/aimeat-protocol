/**
 * @file src/routes/organisms/gates.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Gate primitive routes (Phase 4): approval request/inbox, draft publish (with the
 *   publish-gate + change-guard), revert-to-draft, and human approval resolution. Extracted from
 *   src/routes/organisms.ts to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from src/routes/organisms.ts (max-file-lines)
 */
import type { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import type { AimeatConfig } from '../../config.js';
import type { Storage, PendingApprovalRecord } from '../../storage/interface.js';
import { success, error } from '../../middleware/envelope.js';
import { requireAuth, requireRole, requireScope } from '../../auth/middleware.js';
import { resolveIdentity } from '../../utils/gaii.js';
import { emitChange } from '../../services/event-bus.js';
import { shouldGate, gatePolicyFromManifest, type Risk } from '../../services/gate-policy.js';
import { expireOverdueApprovals } from '../../services/gate-expiry.js';
import { isKeyArchived } from '../../services/archive.js';
import { updateOrganismStructure } from '../../services/structure-snapshot.js';
import { canReadWorkspace } from '../../services/workspace-access.js';
import { roleSatisfies, type OrganismHelpers } from './shared.js';
import { logger } from '../../utils/logger.js';

export function registerOrganismGateRoutes(router: Router, config: AimeatConfig, storage: Storage, H: OrganismHelpers): void {
  const { memberRole, readManifest, writeDecision, readConfig, canWriteNamespace, publishDraft, publishDraftsBatch, revertToDraft } = H;

  // POST /v1/organisms/:id/approvals — request approval for an action (gate or auto-run).
  router.post('/v1/organisms/:id/approvals', requireAuth(), async (req, res) => {
    const id = req.params.id as string;
    const organism = await storage.getOrganism(id);
    if (!organism) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found'));
      return;
    }
    if (!(await memberRole(req, organism, id))) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Not an active member of this organism'));
      return;
    }

    // `arguments` is reserved in ESM strict mode — destructure it under a new name.
    const { action, arguments: actionArgs, risk, rule, stageId, flowGateId, approverRole, prompt, deadline } = req.body ?? {};
    if (!action || typeof action !== 'string') {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'action is required'));
      return;
    }
    const riskVal: Risk = ['low', 'medium', 'high'].includes(risk) ? risk : 'medium';
    const approverRoleVal = ['owner', 'admin', 'member'].includes(approverRole) ? approverRole : 'owner';

    const policy = gatePolicyFromManifest(await readManifest(id));
    const decision = shouldGate({ action, risk: riskVal, rule, policy });

    const actor = resolveIdentity(req.auth!, config.nodeId);
    const now = new Date().toISOString();
    const aid = uuidv4();
    const record: PendingApprovalRecord = {
      id: aid, organismId: id, actor, action,
      ...(actionArgs !== undefined ? { arguments: actionArgs } : {}),
      risk: riskVal, approverRole: approverRoleVal as PendingApprovalRecord['approverRole'],
      ...(typeof prompt === 'string' ? { prompt } : {}),
      ...(typeof stageId === 'string' ? { stageId } : {}),
      ...(typeof flowGateId === 'string' ? { flowGateId } : {}),
      ...(typeof deadline === 'string' ? { deadline } : {}),
      status: decision.gate ? 'pending' : 'approved',
      ...(decision.gate ? {} : { decidedBy: 'system', decidedAt: now, resolutionNote: `auto: ${decision.reason}` }),
      createdAt: now, updatedAt: now,
    };
    await storage.createPendingApproval(record);
    if (!decision.gate) {
      await writeDecision(id, actor, `auto-approved action: ${action}`, [aid]);
    }

    res.status(201).json(success(config.nodeId, { approval: record, gated: decision.gate, reason: decision.reason }, [
      { description: 'List pending approvals', method: 'GET', url: `/v1/organisms/${id}/approvals?status=pending` },
      ...(decision.gate ? [{ description: 'Resolve this approval', method: 'POST', url: `/v1/organisms/${id}/approvals/${aid}` }] : []),
    ]));
    emitChange('organisms');
  });

  // GET /v1/organisms/:id/approvals — the approval inbox (members).
  router.get('/v1/organisms/:id/approvals', requireAuth(), async (req, res) => {
    const id = req.params.id as string;
    const organism = await storage.getOrganism(id);
    if (!organism) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found'));
      return;
    }
    if (!(await memberRole(req, organism, id))) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Not an active member of this organism'));
      return;
    }
    // Durable pause: lazily abort any overdue pending approvals before listing.
    await expireOverdueApprovals(storage, new Date().toISOString());
    const status = req.query.status as string | undefined;
    const approvals = await storage.listPendingApprovals(id, status ? { status } : undefined);
    res.json(success(config.nodeId, { approvals, total: approvals.length }));
  });

  // POST /v1/organisms/:id/publish — snapshot a draft into a new version + latest (or gate it).
  router.post('/v1/organisms/:id/publish', requireAuth(), async (req, res) => {
    const id = req.params.id as string;
    const organism = await storage.getOrganism(id);
    if (!organism) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found'));
      return;
    }
    const role = await memberRole(req, organism, id);
    if (!role) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Not an active member of this organism'));
      return;
    }

    const { namespace, id: instance, ws, expected_version: expectedRaw } = req.body ?? {};
    const wsId = typeof ws === 'string' ? ws : undefined;
    // TARGET-009 S1: the publisher's optimistic lock (required by requires_expected_version spaces)
    const expectedVersion = typeof expectedRaw === 'number' && Number.isFinite(expectedRaw) ? expectedRaw : null;
    if (!namespace || typeof namespace !== 'string' || !instance || typeof instance !== 'string') {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'namespace and id (instance) are required'));
      return;
    }
    if (!canWriteNamespace(role, namespace)) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only an admin or whoever created this space can publish here. Ask one of them, or publish somewhere you own.'));
      return;
    }
    // Archived content is read-only — block publishing into an archived organism/workspace.
    const pubGuard = await isKeyArchived(storage, wsId ? `organism.${id}.w.${wsId}.` : `organism.${id}.`);
    if (pubGuard.archived) {
      res.status(409).json(error(config.nodeId, 'ARCHIVED', `This ${pubGuard.level} is archived (read-only). Unarchive it before publishing.`));
      return;
    }

    const publisher = resolveIdentity(req.auth!, config.nodeId);

    // Config decides whether publishing needs a review gate. Absent / disabled = publish now.
    const cfg = await readConfig(id);
    const pg = (cfg?.gates as Record<string, { enabled?: boolean; approverRole?: string }> | undefined)?.publish;
    if (pg?.enabled === true) {
      const approverRole = ['owner', 'admin', 'member'].includes(pg.approverRole as string) ? pg.approverRole! : 'owner';
      const now = new Date().toISOString();
      const aid = uuidv4();
      const record: PendingApprovalRecord = {
        id: aid, organismId: id, actor: publisher, action: 'publish',
        arguments: { namespace, instance, ws: wsId, expected_version: expectedVersion }, risk: 'medium',
        approverRole: approverRole as PendingApprovalRecord['approverRole'],
        prompt: `Publish ${namespace}.${instance}?`, status: 'pending', createdAt: now, updatedAt: now,
      };
      await storage.createPendingApproval(record);
      res.status(202).json(success(config.nodeId, { gated: true, approval: record }, [
        { description: 'Review pending approvals', method: 'GET', url: `/v1/organisms/${id}/approvals?status=pending` },
        { description: 'Resolve this approval', method: 'POST', url: `/v1/organisms/${id}/approvals/${aid}` },
      ]));
      emitChange('organisms');
      return;
    }

    const result = await publishDraft(id, wsId, namespace, instance, publisher, expectedVersion);
    if (!result.ok) {
      if (result.code === 'NO_DRAFT') {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', `No draft to publish at ${namespace}.${instance}`));
      } else {
        // A write-guard refusal is a CONFLICT (the record moved, or the space is append-only) —
        // distinct from a schema shape violation so writers know to re-read, not to reshape.
        const guardHit = (result.violations as Array<{ schema_rule?: string; message?: string }> | undefined)
          ?.find(v => String(v.schema_rule ?? '').startsWith('write_guard'));
        if (guardHit) {
          res.status(409).json(error(config.nodeId, 'WRITE_CONFLICT', guardHit.message ?? 'Write refused by the workspace write guard', 409, { violations: result.violations }));
        } else {
          res.status(422).json(error(config.nodeId, 'SCHEMA_VALIDATION_FAILED', 'Draft does not match the schema', 422, { violations: result.violations }));
        }
      }
      return;
    }
    if (result.skipped) {
      // No-op re-publish (draft identical to the live .latest) — no new version, no decision-log or
      // structure-snapshot churn. The stale draft was still consumed.
      res.json(success(config.nodeId, { published: true, namespace, id: instance, version: result.version, skipped: true }, [
        { description: 'View the workspace', method: 'GET', url: `/v1/organisms/${id}/workspace` },
      ]));
      emitChange('organisms');
      return;
    }
    await writeDecision(id, publisher, `published ${namespace}.${instance} v${result.version}`, [`${namespace}.${instance}`]);
    res.json(success(config.nodeId, { published: true, namespace, id: instance, version: result.version }, [
      { description: 'View the workspace', method: 'GET', url: `/v1/organisms/${id}/workspace` },
      { description: 'List version history', method: 'GET', url: `/v1/memory?prefix=${encodeURIComponent(`organism.${id}.${namespace}.${instance}.version.`)}` },
    ]));
    emitChange('organisms');
    // Content growth changes the structure fingerprint (doc/record counts) → record a timeline snapshot.
    void updateOrganismStructure(storage, config, id, { event: 'content published', actor: publisher }).catch(err => { logger.warn('guardHit: best-effort', { error: String(err) }); });
    // Activation (05-mittaus.md): published workspace content is the team persona's first durable
    // output. Write-once, fire-and-forget — measuring a publish must never fail it.
    void import('../../services/onboarding-funnel.js')
      .then(m => m.recordActivation(storage, config, req.auth!.owner, 'workspace'))
      .catch(err => { logger.warn('publish: activation marker is best-effort', { error: String(err) }); });
  });

  // POST /v1/organisms/:id/workspace/records/publish — BATCH publish (Phase 2, data-access redesign).
  // Publishes MANY drafts in one workspace+namespace as ONE operation (a 520-record CADENCE import was
  // ~11k separate ops); the data path (publishDraftsBatch) amortises the namespace/manifest reads and
  // commits every version+latest in one bulk write. Same authorization as the single publish — active
  // member, meta.* needs admin/creator, archived is read-only. The publish REVIEW gate is per-decision,
  // so when it's enabled this batch path is refused (use POST /v1/organisms/:id/publish one at a time).
  // Body: { ws?, namespace, instances: [], expected_versions?: { <instance>: <version> } }.
  // A17 (E2E test-quality audit). `requireAuth()` alone here meant the batch door asked less than the
  // single-record door it amortises, and less than the memory door the records land in — so an app
  // grant carrying any one scope could publish a workspace's records in bulk. organism:write is the
  // word: it is what the MCP surface already requires for workspace writes, and it is in
  // GRANDFATHERED_SCOPES, so every agent AND (as of today) every live app grant already carries it.
  // Owner sessions are unaffected — requireScope waves them through — so the SPA and CADENCE's own
  // owner-session imports do not change.
  router.post('/v1/organisms/:id/workspace/records/publish', requireAuth(), requireScope('organism:write'), async (req, res) => {
    const id = req.params.id as string;
    const organism = await storage.getOrganism(id);
    if (!organism) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found')); return; }
    const role = await memberRole(req, organism, id);
    if (!role) { res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Not an active member of this organism')); return; }

    const { namespace, instances, records, ws, expected_versions: expectedVersions } = req.body ?? {};
    const wsId = typeof ws === 'string' ? ws : undefined;
    // Two shapes: `instances` (draft ids — publish each record's existing draft) OR `records`
    // ([{id, value, visibility?}] — DRAFT-LESS import: publish the supplied values directly, no draft
    // round-trip). records is the fast import path (one request for a whole CSV migration).
    const hasRecords = Array.isArray(records) && records.length > 0;
    const list: unknown[] = hasRecords ? records : (Array.isArray(instances) ? instances : []);
    if (typeof namespace !== 'string' || !namespace || list.length === 0) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'namespace (string) and instances[] or records[] (non-empty) are required'));
      return;
    }
    if (list.length > 1000) { res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'At most 1000 records per request')); return; }
    if (!canWriteNamespace(role, namespace)) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only an admin or whoever created this space can publish here. Ask one of them, or publish somewhere you own.'));
      return;
    }
    const pubGuard = await isKeyArchived(storage, wsId ? `organism.${id}.w.${wsId}.` : `organism.${id}.`);
    if (pubGuard.archived) {
      res.status(409).json(error(config.nodeId, 'ARCHIVED', `This ${pubGuard.level} is archived (read-only). Unarchive it before publishing.`));
      return;
    }
    // The publish review gate is a per-decision workflow — a batch publish would bypass it, so refuse.
    const cfg = await readConfig(id);
    const pg = (cfg?.gates as Record<string, { enabled?: boolean }> | undefined)?.publish;
    if (pg?.enabled === true) {
      res.status(409).json(error(config.nodeId, 'GATE_ENABLED', 'The publish review gate is enabled — publish records one at a time via POST /v1/organisms/:id/publish'));
      return;
    }

    const publisher = resolveIdentity(req.auth!, config.nodeId);
    const expMap = (expectedVersions && typeof expectedVersions === 'object') ? expectedVersions as Record<string, number | null> : undefined;
    let ids: string[];
    let directValues: Record<string, { value: unknown; visibility?: 'private' | 'owner' | 'group' | 'members' | 'public' | 'workspace' }> | undefined;
    if (hasRecords) {
      directValues = {};
      ids = [];
      for (const r of records as Array<{ id?: unknown; value?: unknown; visibility?: unknown }>) {
        if (!r || typeof r.id !== 'string' || !r.id) continue;
        ids.push(r.id);
        directValues[r.id] = { value: r.value, visibility: typeof r.visibility === 'string' ? r.visibility as 'private' : undefined };
      }
    } else {
      ids = (instances as unknown[]).filter((x): x is string => typeof x === 'string' && !!x);
    }
    const { results } = await publishDraftsBatch(id, wsId, namespace, ids, publisher, expMap, directValues);

    const published = results.filter(r => r.ok && !r.skipped);
    if (published.length > 0) {
      await writeDecision(id, publisher, `published ${published.length} record(s) in ${namespace}`, published.map(r => `${namespace}.${r.instance}`));
      emitChange('organisms');
      void updateOrganismStructure(storage, config, id, { event: 'content published (batch)', actor: publisher }).catch(err => { logger.warn('expMap: best-effort', { error: String(err) }); });
    }
    res.json(success(config.nodeId, {
      published: published.length,
      skipped: results.filter(r => r.ok && r.skipped).length,
      failed: results.filter(r => !r.ok).length,
      results,
    }));
  });

  // POST /v1/organisms/:id/revert — reopen a published record for editing (copy .latest → .draft).
  // Same write access as publish; not gated (creating a private draft is not a publish).
  router.post('/v1/organisms/:id/revert', requireAuth(), async (req, res) => {
    const id = req.params.id as string;
    const organism = await storage.getOrganism(id);
    if (!organism) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found'));
      return;
    }
    const role = await memberRole(req, organism, id);
    if (!role) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Not an active member of this organism'));
      return;
    }
    const { namespace, id: instance, ws } = req.body ?? {};
    const wsId = typeof ws === 'string' ? ws : undefined;
    if (!namespace || typeof namespace !== 'string' || !instance || typeof instance !== 'string') {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'namespace and id (instance) are required'));
      return;
    }
    if (!canWriteNamespace(role, namespace)) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', 'Only an admin or whoever created this space can change this. Ask one of them.'));
      return;
    }

    const reverter = resolveIdentity(req.auth!, config.nodeId);
    // Organism membership is not workspace access. Revert READS the published record and writes its
    // full value back as a `.draft` under the caller's own identity, so without this the record list
    // for a workspace answers a non-granted member 404 while revert hands them the same record's
    // contents, one call at a time. canReadWorkspace is the gate the read doors use; 404 rather than
    // 403 for the same reason they do, so the refusal does not confirm the record exists.
    if (wsId && !(await canReadWorkspace(storage, config, organism, req.auth!.sub, req.auth!.owner, reverter, wsId))) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `No published record at ${namespace}.${instance} to reopen`));
      return;
    }
    const result = await revertToDraft(id, wsId, namespace, instance, reverter);
    if (!result.ok) {
      if (result.code === 'NO_LATEST') {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', `No published record at ${namespace}.${instance} to reopen`));
      } else {
        res.status(409).json(error(config.nodeId, 'DRAFT_EXISTS', `A draft already exists for ${namespace}.${instance} — edit it directly`));
      }
      return;
    }
    res.json(success(config.nodeId, { reopened: true, namespace, id: instance }, [
      { description: 'View the workspace', method: 'GET', url: `/v1/organisms/${id}/workspace` },
      { description: 'Publish the edited draft', method: 'POST', url: `/v1/organisms/${id}/publish` },
    ]));
    emitChange('organisms');
  });

  // POST /v1/organisms/:id/approvals/:aid — resolve (approve | reject | edit). Human-only, role-gated.
  router.post('/v1/organisms/:id/approvals/:aid', requireAuth(), requireRole('owner'), async (req, res) => {
    const id = req.params.id as string;
    const aid = req.params.aid as string;
    const organism = await storage.getOrganism(id);
    if (!organism) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Organism not found'));
      return;
    }
    // Durable pause: abort overdue approvals first, so a resolve of an expired one 409s below.
    await expireOverdueApprovals(storage, new Date().toISOString());
    const approval = await storage.getPendingApproval(aid);
    if (!approval || approval.organismId !== id) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Approval not found'));
      return;
    }
    if (approval.status !== 'pending') {
      res.status(409).json(error(config.nodeId, 'ALREADY_RESOLVED', `Approval already ${approval.status}`));
      return;
    }

    // Approver must be an active member whose role satisfies the approval's approverRole.
    const role = await memberRole(req, organism, id);
    if (!role || !roleSatisfies(approval.approverRole, role)) {
      res.status(403).json(error(config.nodeId, 'ACCESS_DENIED', `Resolving this approval requires role "${approval.approverRole}"`));
      return;
    }

    const { decision: d, note, editedArguments } = req.body ?? {};
    if (!['approve', 'reject', 'edit'].includes(d)) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'decision must be "approve", "reject", or "edit"'));
      return;
    }

    const decider = resolveIdentity(req.auth!, config.nodeId);
    const now = new Date().toISOString();

    // A publish gate executes the publish on approve/edit BEFORE the decision is recorded, so a
    // failed publish (no draft / invalid) leaves the approval pending rather than falsely approved.
    if (approval.action === 'publish' && d !== 'reject') {
      const pargs = approval.arguments as Record<string, unknown> | undefined;
      const ns = typeof pargs?.namespace === 'string' ? pargs.namespace : undefined;
      const inst = typeof pargs?.instance === 'string' ? pargs.instance : undefined;
      const pws = typeof pargs?.ws === 'string' ? pargs.ws : undefined;
      if (ns && inst) {
        const pexp = typeof pargs?.expected_version === 'number' ? pargs.expected_version : null;
        const pub = await publishDraft(id, pws, ns, inst, decider, pexp);
        if (!pub.ok) {
          if (pub.code === 'NO_DRAFT') {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `No draft to publish at ${ns}.${inst}`));
          } else {
            res.status(422).json(error(config.nodeId, 'SCHEMA_VALIDATION_FAILED', 'Draft does not match the schema', 422, { violations: pub.violations }));
          }
          return;
        }
      }
    }

    const newStatus: PendingApprovalRecord['status'] = d === 'approve' ? 'approved' : d === 'reject' ? 'rejected' : 'edited';
    const updates: Partial<PendingApprovalRecord> = { status: newStatus, decidedBy: decider, decidedAt: now, updatedAt: now };
    if (typeof note === 'string') updates.resolutionNote = note;
    if (d === 'edit' && editedArguments !== undefined) updates.arguments = editedArguments;

    const updated = await storage.updatePendingApproval(aid, updates);
    const verb = d === 'approve' ? 'approved' : d === 'reject' ? 'rejected' : 'edited & approved';
    await writeDecision(id, decider, `${verb} gate: ${approval.action}`, [aid]);

    res.json(success(config.nodeId, { approval: updated, decision: d }, [
      { description: 'View the decision log', method: 'GET', url: `/v1/organisms/${id}/workspace` },
    ]));
    emitChange('organisms');
  });
}
