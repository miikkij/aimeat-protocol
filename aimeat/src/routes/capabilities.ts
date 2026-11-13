/**
 * @file capabilities.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Capability Layer REST API: discovery, CRUD, invoke proxy, telemetry, vouch, test.
 * @structure
 *   - discovery: GET /v1/capabilities and /:id, with the private-row rules
 *   - CRUD: POST / PUT / DELETE, each rendering what services/capability-record.ts decided
 *   - invoke, telemetry, vouch, test
 * @usage Mounted by mountRoutes(); the shared write lives in services/capability-record.ts.
 * @version-history
 *   v1.7.0 — 2026-11-13 — PUT passes the body to updateCapability and decides nothing itself. The list
 *     of fields the node owns and the webhook policy of an update moved to
 *     services/capability-record.ts (PATCHABLE_CAPABILITY_FIELDS, webhookPolicyRefusal), where they
 *     read the normalised source and webhook and hold for every caller of the service.
 *   v1.6.4 — 2026-11-03 — Invoke passes a thrown refusal's details, so MCP_CAPABILITY_NEEDS_APPROVAL names the node setting that asked (secaudit2026nov02d round 13b).
 *   v1.6.3 — 2026-10-27 — Invoke passes the acting principal (callerPrincipal) beside the caller's authority, so a remote MCP server's grant for an app narrows that app here too (secaudit2026oct26).
 *   2026-10-26 — GET /:id and invoke serve a private capability, one with an unknown visibility word, and
 *     a draft, pending_review or rejected one to the owner, the owner's agents and apps, and the operator
 *     only; everyone else gets 404 NOT_FOUND (services/capability-reach.ts; secaudit2026oct22).
 *   2026-10-21 — The list's anonymous branch asks isAnonymousPrincipal, so the minted anonymous token sees
 *     public active capabilities only (secaudit 2026-10, anonymous-claim-not-signed).
 *   v1.6.1 — 2026-10-16 — The list's policy no longer carries `publishers`: the setting behind it was enforced nowhere (QA audit D8-05).
 *   2026-10-16 — POST, PUT and DELETE /v1/capabilities admit the owner's agent holding capability:write, the
 *     word aimeat_capabilities_create/_update/_delete declare, and POST/DELETE /:id/vouch admit the owner's
 *     agent holding the same word, which aimeat_capabilities_vouch now declares too: the node MCP, the connector MCP and /local/call (which call
 *     these routes) give one answer. An agent's capability is stored under its own GAII, as the MCP tools
 *     store it. requireRole('agent') keeps an app grant and an ecosystem app out (QA audit D2-02).
 *   v1.6.0 — 2026-10-05 — Operator checks ask isOperatorCaller/operatorOverride: the operator's agent holding operator:admin passes as on MCP, and a pass in another person's account writes the operator trail (secaudit 2026-10, C2).
 *   v1.1.0 - 2026-09-03 - The list's policy carries call_counting (whether direct extension calls
 *     are counted into stats); source_type filter accepts app-tool and offering.
 *   v1.0.0 - 2026-05-02 - Initial capability layer endpoints
 *   v1.0.1 - 2026-07-29 - POST /v1/capabilities: normalise `source` per field. A partial source
 *            (e.g. {type:'manual'}) built a record with ref undefined and crashed the insert into a
 *            500 (sourceRef is NOT NULL on both backends); an unknown type or a missing ref on a
 *            non-manual type is now a 400 INVALID_INPUT.
 *   v1.1.0 - 2026-08-11 - August 2026 audit step 8: create, update, delete, vouch and the
 *            post-invoke record moved into services/capability-record.ts, which the MCP tools now
 *            call as well. This file keeps the envelope and nothing else. PUT now applies the
 *            moderation gate to a status change, which it never did — publishing a public
 *            capability on a moderated node no longer skips the review the tool door enforced.
 *   v1.2.0 - 2026-08-14 - August 2026 audit NEW-2: PUT handed the whole request body to the shared
 *            write, so an owner could award themselves the node operator's review by patching
 *            `trust`, and could set their own invocation counters by patching `stats`. The body is
 *            now filtered against SERVER_OWNED_CAPABILITY_FIELDS before it leaves this file.
 *   v1.3.0 - 2026-08-14 - August 2026 audit: PUT applied no webhook policy at all, so a node running
 *            capabilityWebhooks 'disabled' or 'allowlist_only' was defeated in two requests - create
 *            without a webhook, then PUT one on. The gate now fires on a CHANGE of the webhook the
 *            node would end up calling, with the same three refusal codes createCapability gives.
 *   v1.4.0 - 2026-08-15 - The telemetry ping stops taking three things on the caller's word. It is
 *            self-reported by design (a client-side call is one the node never saw, and a
 *            third-party caller is the normal case), but any authenticated principal could ping ANY
 *            id — including one that does not exist, which wrote stats for a row nobody owns — with
 *            an unbounded duration that moves the published average by any amount, and with free
 *            `lastError` text rendered on somebody else's public capability record. The capability
 *            must now exist, the duration is clamped, and the error TEXT is taken from the owner
 *            only; a third party still counts their failure. E2E test-quality audit finding A12.
 *   v1.5.0 - 2026-09-24 - POST /:id/invoke hands the service the session's scopes (heldScopes), so a
 *            capability over a remote MCP tool refuses a caller without mcp:use.
 *   v1.5.1 - 2026-09-24 - …and whether the caller is the owner in person (callAuthority), so an app
 *            under a grant is never taken for its owner.
 */
import { Router } from 'express';
import {
  createCapability, updateCapability, deleteCapability, vouchCapability, unvouchCapability, recordCapabilityInvocation,
} from '../services/capability-record.js';
import type { Request } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage, CapabilityFilter } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';
import { isAnonymousPrincipal } from '../auth/anonymous-principal.js';
import { requireAuth, requireRole, requireScope } from '../auth/middleware.js';
import { callAuthority } from '../auth/effective-scopes.js';
import { resolveIdentity, callerPrincipal } from '../utils/gaii.js';
import { isOperatorCaller, operatorOverride } from '../services/operator-override.js';
import { capabilityHiddenFrom } from '../services/capability-reach.js';

/** A self-reported client-side call cannot legitimately claim to have taken longer than this, and
 *  an unbounded number moves the published average by any amount the reporter chooses. One hour. */
const MAX_TELEMETRY_DURATION_MS = 3_600_000;

export function capabilitiesRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();
  const resolve = (req: Request) => resolveIdentity(req.auth!, config.nodeId);
  /** Who is asking, in the shape the shared write expects. */
  const caller = async (req: Request) => ({ gaii: resolve(req), isOperator: await isOperatorCaller(storage, req.auth) });

  // ── Discovery (Tier 0 for public, Tier 1 for private) ──

  router.get('/v1/capabilities', async (req, res) => {
    const filters: CapabilityFilter = {};
    if (req.query.search) filters.search = req.query.search as string;
    if (req.query.tags) filters.tags = (req.query.tags as string).split(',');
    if (req.query.callable !== undefined) filters.callable = req.query.callable === 'true';
    if (req.query.authRequired) filters.authRequired = req.query.authRequired as string;
    if (req.query.source_type) filters.sourceType = req.query.source_type as string;
    if (req.query.status) filters.status = req.query.status as string;
    if (req.query.owner) filters.ownerGhii = req.query.owner as string;
    filters.page = parseInt(req.query.page as string) || 1;
    filters.perPage = parseInt(req.query.per_page as string) || 20;

    // Anonymous callers (incl. the shared anonymous identity injected by global optionalAuth in
    // anonymous mode — req.auth is TRUTHY then) see only PUBLIC + active capabilities. Testing
    // `!req.auth` alone leaked owner-marked-private rows (ownerGhii, webhookUrl) to the anon internet.
    if (!req.auth || isAnonymousPrincipal(req.auth)) {
      filters.visibility = 'public';
      if (!filters.status) filters.status = 'active';
    } else if (!(await isOperatorCaller(storage, req.auth))) {
      // Registered non-operator: PUBLIC capabilities + your OWN (any visibility). Never another owner's
      // private rows (which carry webhookUrl / ownerGhii). Mirrors the anonymous restriction above — the
      // anon path was gated, but registered users previously saw every owner's private capabilities.
      filters.publicOrOwner = resolve(req);
    }

    const result = await storage.listCapabilities(filters);
    res.json(success(config.nodeId, {
      ...result,
      policy: {
        publishing: config.capabilityPublishing,
        webhooks: config.capabilityWebhooks,
        // Whether direct extension calls are counted into stats; proxy calls always are.
        call_counting: config.capabilityCallCounting,
      },
    }));
  });

  router.get('/v1/capabilities/:id', async (req, res) => {
    const cap = await storage.getCapability(req.params.id as string);
    if (!cap) return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Capability not found'));

    // A private capability, an unknown visibility word, and a capability never published (draft,
    // pending_review, rejected) are served to the owner's side and the operator only, and answer
    // everyone else as a missing id does (services/capability-reach.ts; secaudit2026oct22).
    if (capabilityHiddenFrom(cap, req.auth ? resolve(req) : null) && !(req.auth && await operatorOverride(storage, config, req.auth,
      { ownerOf: cap.ownerGhii, area: 'capability', action: 'read', subject: cap.name }))) {
      return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Capability not found'));
    }

    res.json(success(config.nodeId, cap));
  });

  // ── CRUD (the owner, or the owner's agent holding capability:write, manages its own capabilities) ──
  // WHO. The word the three MCP tools declare, asked of an agent here too: the connector's tools and
  // /local/call call these routes, so an owner-only gate refused there what the node MCP allowed.
  // The identity is resolveIdentity's, so an agent's capability lands under its own GAII, as the MCP
  // tools have always stored it, and ownership is compared on the same id (QA audit D2-02).

  router.post('/v1/capabilities', requireAuth(), requireRole('agent'), requireScope('capability:write'), async (req, res) => {
    const body = req.body;
    const created = await createCapability({ storage, config }, await caller(req), {
      id: body.id, name: body.name, summary: body.summary, visibility: body.visibility,
      source: body.source, status: body.status,
      authRequired: body.authRequired, callable: body.callable,
      inputSchema: body.inputSchema, outputSchema: body.outputSchema, exports: body.exports,
      usage: body.usage, whenToUse: body.whenToUse, whenNotToUse: body.whenNotToUse,
      examples: body.examples, dependencies: body.dependencies,
      webhookUrl: body.webhookUrl, cost: body.cost, trustRequired: body.trustRequired,
      redactedFields: body.redactedFields, tags: body.tags,
    });
    if (!created.ok) return res.status(created.status).json(error(config.nodeId, created.code, created.message));
    res.status(201).json(success(config.nodeId, created.value));
  });

  router.put('/v1/capabilities/:id', requireAuth(), requireRole('agent'), requireScope('capability:write'), async (req, res) => {
    // The body goes to updateCapability as it arrived. Which of its keys an update may carry, the
    // source check and the webhook policy are all decided there, on the normalised values, after the
    // NOT_FOUND and FORBIDDEN answers: a caller who does not own the capability learns nothing about
    // the webhook it holds. A key the update does not take is dropped, never refused: the answer is
    // the stored record, so a client that PUTs a whole record back keeps working.
    const body: unknown = req.body;
    const patch = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {};
    const updated = await updateCapability({ storage, config }, await caller(req), req.params.id as string, patch);
    if (!updated.ok) return res.status(updated.status).json(error(config.nodeId, updated.code, updated.message));
    res.json(success(config.nodeId, updated.value));
  });

  router.delete('/v1/capabilities/:id', requireAuth(), requireRole('agent'), requireScope('capability:write'), async (req, res) => {
    const removed = await deleteCapability({ storage, config }, await caller(req), req.params.id as string);
    if (!removed.ok) return res.status(removed.status).json(error(config.nodeId, removed.code, removed.message));
    res.json(success(config.nodeId, { deleted: true }));
  });

  // ── Invoke (Tier 1) ──

  router.post('/v1/capabilities/:id/invoke', requireAuth(), requireScope('work:request'), async (req, res) => {
    const cap = await storage.getCapability(req.params.id as string);
    if (!cap) return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Capability not found'));

    const callerGhii = resolve(req);
    // Ownership (SECURITY): what the read route hides, invoke hides too, with the same 404: a private
    // capability, an unknown visibility word, and a capability never published reach the owner's side
    // and the operator only (services/capability-reach.ts; secaudit2026oct22).
    if (capabilityHiddenFrom(cap, callerGhii) && !(await operatorOverride(storage, config, req.auth,
      { ownerOf: cap.ownerGhii, area: 'capability', action: 'invoke', subject: cap.name }))) {
      return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Capability not found'));
    }
    const jwt = (req.headers.authorization || '').replace('Bearer ', '');
    const mode = (req.query.mode as string) === 'raw' ? 'raw' as const : 'normal' as const;
    const input = req.body.input || {};

    try {
      const { invokeCapability } = await import('../services/capability-invoke.js');
      // This door proves work:request only. What else the session holds, and whether it is the
      // owner in person, goes with the call, so a capability over a remote MCP tool asks for
      // mcp:use there, as every MCP door does.
      // The grant on a remote MCP server is matched against the acting principal: an app under a
      // grant by its eco: identity, as POST /v1/mcp-servers/:id/call does (secaudit2026oct26).
      const result = await invokeCapability(config, storage, cap, input, callerGhii, jwt, mode,
        undefined, { ...callAuthority(req.auth!), principal: callerPrincipal(req.auth!, config.nodeId) });

      await recordCapabilityInvocation({ storage }, cap, callerGhii, input, { ok: true, durationMs: result.duration_ms });

      res.json(success(config.nodeId, result));
    } catch (err) {
      const e = err as { statusCode?: number; code?: string; message?: string; details?: unknown };
      const statusCode = e.statusCode || 500;
      const code = e.code || 'INVOKE_FAILED';
      const message = err instanceof Error ? err.message : String(err);

      await recordCapabilityInvocation({ storage }, cap, callerGhii, input, { ok: false, message });

      // This refusal names the node setting that asked in details; other throws keep their old shape.
      res.status(statusCode).json(error(config.nodeId, code, message, undefined,
        code === 'MCP_CAPABILITY_NEEDS_APPROVAL' ? e.details : undefined));
    }
  });

  // ── Telemetry (client-side stats ping) ──

  // A client-side invocation is one the node never saw, so this counter is self-reported by
  // whoever called it — that is the feature, and third-party callers are the normal case. Three
  // things are still not the caller's to decide, and all three were: that the capability EXISTS
  // (a ping to any id wrote stats for a row nobody owns), how long it took (an unbounded number
  // moves the published average by any amount), and `lastError` — free text that is rendered on
  // somebody else's public capability record, which is a stranger writing on the owner's page.
  // The error TEXT is accepted from the owner only; a third party still counts their failure.
  router.post('/v1/capabilities/:id/telemetry', requireAuth(), requireScope('work:request'), async (req, res) => {
    const capId = req.params.id as string;
    const cap = await storage.getCapability(capId);
    if (!cap) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Capability not found'));
      return;
    }
    const { duration_ms, status: telStatus } = req.body ?? {};
    const raw = typeof duration_ms === 'number' && Number.isFinite(duration_ms) ? duration_ms : 0;
    const totalMs = Math.min(Math.max(raw, 0), MAX_TELEMETRY_DURATION_MS);
    if (telStatus === 'success') {
      await storage.incrementCapabilityStats(capId, { success: 1, error: 0, totalMs });
    } else {
      const isOwner = cap.ownerGhii === resolve(req);
      const reported = typeof req.body?.error === 'string' ? req.body.error.slice(0, 500) : undefined;
      await storage.incrementCapabilityStats(capId, {
        success: 0, error: 1, totalMs,
        lastError: isOwner ? reported : 'Reported by a caller (details withheld)',
      });
    }
    res.status(204).end();
  });

  // ── Vouching ──
  // WHO. The owner, or the owner's agent holding capability:write, the word the scope model gives a
  // vouch (public/views/profile/agents/scope-model.js) and aimeat_capabilities_vouch now declares. A vouch is keyed on the OWNER GHII whoever casts it (voucherGhiiOf in
  // services/capability-record.ts), so an agent vouches in its owner's name and can never vouch for a
  // capability of its own owner (QA audit D2-02).

  router.post('/v1/capabilities/:id/vouch', requireAuth(), requireRole('agent'), requireScope('capability:write'), async (req, res) => {
    const comment = typeof (req.body as Record<string, unknown> | undefined)?.comment === 'string'
      ? (req.body as Record<string, string>).comment : undefined;
    const vouched = await vouchCapability({ storage, config }, await caller(req), req.params.id as string, comment);
    if (!vouched.ok) return res.status(vouched.status).json(error(config.nodeId, vouched.code, vouched.message));
    res.json(success(config.nodeId, vouched.value));
  });

  // Removes the CALLER'S vouch only — whose vouch goes is decided by who is asking, in the
  // service, never by the route decrementing a number.
  router.delete('/v1/capabilities/:id/vouch', requireAuth(), requireRole('agent'), requireScope('capability:write'), async (req, res) => {
    const out = await unvouchCapability({ storage, config }, await caller(req), req.params.id as string);
    if (!out.ok) return res.status(out.status).json(error(config.nodeId, out.code, out.message));
    res.json(success(config.nodeId, out.value));
  });

  // ── Test (dry-run invoke for manual webhook capabilities) ──

  router.post('/v1/capabilities/:id/test', requireAuth(), requireRole('owner'), async (req, res) => {
    const cap = await storage.getCapability(req.params.id as string);
    if (!cap) return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Capability not found'));
    if (cap.ownerGhii !== resolve(req) && !(await operatorOverride(storage, config, req.auth,
      { ownerOf: cap.ownerGhii, area: 'capability', action: 'test', subject: cap.name }))) {
      return res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'Not the owner'));
    }
    if (!cap.callable || cap.source.type !== 'manual') {
      return res.status(400).json(error(config.nodeId, 'NOT_TESTABLE', 'Only manual callable capabilities can be tested'));
    }

    const { invokeCapability } = await import('../services/capability-invoke.js');
    const jwt = (req.headers.authorization || '').replace('Bearer ', '');
    try {
      const result = await invokeCapability(config, storage, cap, req.body.input || {}, resolve(req), jwt, 'normal');
      res.json(success(config.nodeId, { status: 'success', result: result.result, duration_ms: result.duration_ms }));
    } catch (err) {
      res.json(success(config.nodeId, { status: 'error', error: err instanceof Error ? err.message : String(err), duration_ms: 0 }));
    }
  });

  return router;
}
