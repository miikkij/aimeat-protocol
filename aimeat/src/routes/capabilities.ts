/**
 * @file capabilities.ts
 * @description Capability Layer REST API: discovery, CRUD, invoke proxy, telemetry, vouch, test.
 * @structure
 *   - discovery: GET /v1/capabilities and /:id, with the private-row rules
 *   - SERVER_OWNED_CAPABILITY_FIELDS, and the webhook gate a PUT has to pass
 *   - CRUD: POST / PUT / DELETE, each rendering what services/capability-record.ts decided
 *   - invoke, telemetry, vouch, test
 * @usage Mounted by mountRoutes(); the shared write lives in services/capability-record.ts.
 * @version-history
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
 */
import { Router } from 'express';
import {
  createCapability, updateCapability, deleteCapability, vouchCapability, recordCapabilityInvocation,
} from '../services/capability-record.js';
import type { Request } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage, CapabilityFilter, CapabilityRecord } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { resolveIdentity } from '../utils/gaii.js';

/**
 * What a capability's owner may NOT put in a PUT body. Each of these is written by the node about
 * the record, so a client that could patch one would be making the node say something it never
 * decided. `PUT /v1/capabilities/:id` passes a body straight through to the shared write, which
 * merges what it is given, and only `id`, `ownerGhii` and `createdAt` were ever taken back out.
 *
 *   trust            the operator's review verdict and the vouch count. This is the one that was
 *                    exploitable: an owner PUT `{"trust":{"operatorReviewed":true,"codeAudited":true}}`
 *                    on their own capability and the public directory then showed it as reviewed and
 *                    audited by the node operator. It is written by storage.setCapabilityTrust and
 *                    the vouch counters, nowhere else.
 *   stats            invocation counters, written by storage.incrementCapabilityStats after a call
 *                    that really happened. A patch could claim any usage history it liked.
 *   operatorOverride the operator's disable switch and notes. It has its own operator-gated door,
 *                    PUT /v1/admin/capabilities/:id/override, and invoke refuses a capability whose
 *                    override says disabled — so a self-patch would be an un-disable.
 *   rejectionReason  the reviewer's words about why this was refused. Same reason as trust: the
 *                    subject of a review does not get to write the review.
 *   schemaHash       computed at create from the input and output schemas. The aggregator compares
 *                    it to decide a source has drifted and needs refreshing.
 *   scope            always 'local' on this node. Federation, when it arrives, decides this.
 *   id, ownerGhii    identity. Patching either moves the record to another address or another owner.
 *   createdAt        the record's birth date.
 *   updatedAt        stamped by the shared write on every patch.
 *
 * The last four are handled again in services/capability-record.ts, which deletes three of them and
 * stamps updatedAt itself. They are named here anyway, because this list is the door's contract with
 * its callers and should be readable without opening the service.
 *
 * A forbidden field is dropped rather than refused: the response carries the stored record, so a
 * client sees that its value did not take, and a UI that PUTs a whole record back keeps working.
 *
 * The MCP door needs none of this. `aimeat_capabilities_update` declares a fixed parameter list and
 * copies the eight fields it accepts into a fresh object, so nothing else can arrive. That is the
 * difference between a tool that publishes its parameters and a route that takes a body.
 */
const SERVER_OWNED_CAPABILITY_FIELDS = [
  'trust', 'stats', 'operatorOverride', 'rejectionReason', 'schemaHash', 'scope',
  'id', 'ownerGhii', 'createdAt', 'updatedAt',
] as const;

/** A refusal this file renders itself, in the shape the envelope wants. */
interface WebhookRefusal { status: number; code: string; message: string }

/**
 * The node's webhook policy, answered with the SAME three codes createCapability answers with:
 * WEBHOOKS_DISABLED, INVALID_WEBHOOK_URL and WEBHOOK_DOMAIN_NOT_ALLOWED. A caller that gets a
 * different code from PUT than from POST for the same URL learns nothing from either.
 *
 * WHY THIS RULE IS WRITTEN OUT HERE, in a route, when the create-time copy lives in
 * services/capability-record.ts. The honest home is inside updateCapability(), next to the copy it
 * mirrors, and that is where it should move the day anything else needs it. It is here because the
 * gate this repairs is a gap in ONE door: `aimeat_capabilities_update` declares a fixed parameter
 * list with no webhookUrl in it, so no webhook can reach the shared write from the tool surface at
 * all, and the HTTP body is the only way in. check:copied-logic exists to catch a decision written
 * out twice, so this comment is the answer to it: two copies, known, and the moment webhookUrl
 * becomes settable on the MCP door this check belongs in the shared write instead of here.
 */
function webhookPolicyRefusal(config: AimeatConfig, url: string): WebhookRefusal | null {
  if (config.capabilityWebhooks === 'disabled') {
    return { status: 403, code: 'WEBHOOKS_DISABLED', message: 'Webhook capabilities are disabled on this node' };
  }
  if (config.capabilityWebhooks !== 'allowlist_only') return null;

  let domain: string;
  try {
    domain = new URL(url).hostname;
  } catch {
    return { status: 400, code: 'INVALID_WEBHOOK_URL', message: 'Invalid webhook URL' };
  }
  if (config.capabilityWebhookDomainAllowlist.includes(domain)) return null;
  return { status: 403, code: 'WEBHOOK_DOMAIN_NOT_ALLOWED', message: `Domain '${domain}' is not on the webhook allowlist` };
}

/** No webhook is the empty string, whatever shape "no webhook" arrived in. */
function webhookString(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

/**
 * The source type the record will carry once this patch is applied. A `source` object with no
 * `type` normalises to 'manual' at create (normaliseSource in services/capability-record.ts), so it
 * is read the same way here. Reading it any other way is the NEW-1 defect again: the gate and the
 * stored record disagreeing about what the request was.
 *
 * The two storage providers do not in fact agree on what a partial `source` does to the stored row
 * (sqlite merges it over the existing one, postgres-kysely writes all three columns from what it was
 * given), so there is no single answer to read. 'manual' is the reading that refuses.
 */
function patchedSourceType(cap: CapabilityRecord, patch: Record<string, unknown>): string {
  const patched = patch.source;
  if (!patched || typeof patched !== 'object') return cap.source.type;
  const type = (patched as { type?: unknown }).type;
  return typeof type === 'string' ? type : 'manual';
}

/**
 * The webhook this patch is asking the node to start calling, or null if it is asking for nothing
 * new. Null means the PUT goes through untouched.
 *
 * THE GATE FIRES ON A CHANGE, NOT ON PRESENCE. A UI PUTs the whole record back, so an unchanged
 * webhookUrl arrives in the body of every unrelated patch: gating on presence would refuse a rename
 * on a node running 'disabled', which is a capability the owner already has and the policy never
 * meant to take away. What the policy is about is the node being made to call somewhere it has not
 * agreed to call, so the comparison is against what is stored.
 *
 * The pair compared is (url, is it manual), not the url alone, because invoke only calls webhookUrl
 * for a manual source. Both halves matter:
 *   - a url appearing where there was none, or one domain becoming another  -> gate
 *   - the same url on a record that was already a manual webhook            -> through
 *   - clearing it                                                          -> through, always
 *   - a source flipping to 'manual' while a webhook sits on the record      -> gate
 * That last one is not hypothetical tidiness. Without it the two-step way in survives: PUT the
 * webhook onto a non-manual source (ungated, because create does not gate those either and invoke
 * ignores them), then PUT the source back to 'manual' with no webhookUrl in the body at all, and
 * the record is the manual webhook capability the node refuses to be handed in one request.
 */
function proposedWebhook(cap: CapabilityRecord, patch: Record<string, unknown>): string | null {
  const stored = webhookString(cap.webhookUrl);
  const next = 'webhookUrl' in patch ? webhookString(patch.webhookUrl) : stored;
  if (!next || patchedSourceType(cap, patch) !== 'manual') return null;
  if (next === stored && cap.source.type === 'manual') return null;
  return next;
}

export function capabilitiesRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();
  const resolve = (req: Request) => resolveIdentity(req.auth!, config.nodeId);
  /** Who is asking, in the shape the shared write expects. */
  const caller = (req: Request) => ({ gaii: resolve(req), isOperator: req.auth!.roles.includes('operator') });

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
    if (!req.auth || req.auth.anonymous) {
      filters.visibility = 'public';
      if (!filters.status) filters.status = 'active';
    } else if (!(req.auth.roles ?? []).includes('operator')) {
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
        publishers: config.capabilityPublishers,
        webhooks: config.capabilityWebhooks,
      },
    }));
  });

  router.get('/v1/capabilities/:id', async (req, res) => {
    const cap = await storage.getCapability(req.params.id as string);
    if (!cap) return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Capability not found'));

    if (cap.visibility === 'private' && (!req.auth || resolve(req) !== cap.ownerGhii)) {
      return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Capability not found'));
    }

    res.json(success(config.nodeId, cap));
  });

  // ── CRUD (Owner, manages own capabilities) ──

  router.post('/v1/capabilities', requireAuth(), requireRole('owner'), async (req, res) => {
    const body = req.body;
    const created = await createCapability({ storage, config }, caller(req), {
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

  router.put('/v1/capabilities/:id', requireAuth(), requireRole('owner'), async (req, res) => {
    // The body is the caller's, so the fields the node owns come out before it goes any further.
    const patch: Record<string, unknown> = { ...(req.body as Record<string, unknown> | null ?? {}) };
    for (const field of SERVER_OWNED_CAPABILITY_FIELDS) delete patch[field];

    // The webhook policy, which this door applied nowhere. Only create was gated, so a node running
    // capabilityWebhooks 'disabled' or 'allowlist_only' was two requests from being defeated: create
    // a capability with no webhook, then PUT one on. The operator's setting decided nothing.
    //
    // The read costs an extra getCapability, so it happens only when the patch touches one of the two
    // fields the answer depends on. NOT_FOUND and FORBIDDEN stay updateCapability's to give, and this
    // gate stands aside for both: answering them here would make the refusal an oracle, telling a
    // stranger whether some other owner's capability already carries the URL they just sent.
    if ('webhookUrl' in patch || 'source' in patch) {
      const who = caller(req);
      const cap = await storage.getCapability(req.params.id as string);
      if (cap && (cap.ownerGhii === who.gaii || who.isOperator)) {
        const proposed = proposedWebhook(cap, patch);
        const refusal = proposed ? webhookPolicyRefusal(config, proposed) : null;
        if (refusal) return res.status(refusal.status).json(error(config.nodeId, refusal.code, refusal.message));
      }
    }

    const updated = await updateCapability({ storage, config }, caller(req), req.params.id as string, patch);
    if (!updated.ok) return res.status(updated.status).json(error(config.nodeId, updated.code, updated.message));
    res.json(success(config.nodeId, updated.value));
  });

  router.delete('/v1/capabilities/:id', requireAuth(), requireRole('owner'), async (req, res) => {
    const removed = await deleteCapability({ storage, config }, caller(req), req.params.id as string);
    if (!removed.ok) return res.status(removed.status).json(error(config.nodeId, removed.code, removed.message));
    res.json(success(config.nodeId, { deleted: true }));
  });

  // ── Invoke (Tier 1) ──

  router.post('/v1/capabilities/:id/invoke', requireAuth(), async (req, res) => {
    const cap = await storage.getCapability(req.params.id as string);
    if (!cap) return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Capability not found'));

    const callerGhii = resolve(req);
    // Ownership (SECURITY): a PRIVATE capability may only be invoked by its owner (or an operator) — the
    // read route hides private caps from non-owners, so invoke must too (404, don't confirm existence).
    if (cap.visibility === 'private' && callerGhii !== cap.ownerGhii && !req.auth!.roles.includes('operator')) {
      return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Capability not found'));
    }
    const jwt = (req.headers.authorization || '').replace('Bearer ', '');
    const mode = (req.query.mode as string) === 'raw' ? 'raw' as const : 'normal' as const;
    const input = req.body.input || {};

    try {
      const { invokeCapability } = await import('../services/capability-invoke.js');
      const result = await invokeCapability(config, storage, cap, input, callerGhii, jwt, mode);

      await recordCapabilityInvocation({ storage }, cap, callerGhii, input, { ok: true, durationMs: result.duration_ms });

      res.json(success(config.nodeId, result));
    } catch (err) {
      const e = err as { statusCode?: number; code?: string; message?: string };
      const statusCode = e.statusCode || 500;
      const code = e.code || 'INVOKE_FAILED';
      const message = err instanceof Error ? err.message : String(err);

      await recordCapabilityInvocation({ storage }, cap, callerGhii, input, { ok: false, message });

      res.status(statusCode).json(error(config.nodeId, code, message));
    }
  });

  // ── Telemetry (client-side stats ping) ──

  router.post('/v1/capabilities/:id/telemetry', requireAuth(), async (req, res) => {
    const { duration_ms, status: telStatus } = req.body;
    const capId = req.params.id as string;
    if (telStatus === 'success') {
      await storage.incrementCapabilityStats(capId, { success: 1, error: 0, totalMs: duration_ms || 0 });
    } else {
      await storage.incrementCapabilityStats(capId, { success: 0, error: 1, totalMs: duration_ms || 0, lastError: req.body.error });
    }
    res.status(204).end();
  });

  // ── Vouching ──

  router.post('/v1/capabilities/:id/vouch', requireAuth(), requireRole('owner'), async (req, res) => {
    const vouched = await vouchCapability({ storage, config }, caller(req), req.params.id as string);
    if (!vouched.ok) return res.status(vouched.status).json(error(config.nodeId, vouched.code, vouched.message));
    res.json(success(config.nodeId, vouched.value));
  });

  router.delete('/v1/capabilities/:id/vouch', requireAuth(), requireRole('owner'), async (req, res) => {
    const cap = await storage.getCapability(req.params.id as string);
    if (!cap) return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Capability not found'));
    await storage.decrementVouchCount(req.params.id as string);
    const updated = await storage.getCapability(req.params.id as string);
    res.json(success(config.nodeId, { vouchCount: updated?.trust.vouchCount ?? 0 }));
  });

  // ── Test (dry-run invoke for manual webhook capabilities) ──

  router.post('/v1/capabilities/:id/test', requireAuth(), requireRole('owner'), async (req, res) => {
    const cap = await storage.getCapability(req.params.id as string);
    if (!cap) return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Capability not found'));
    if (cap.ownerGhii !== resolve(req) && !req.auth!.roles.includes('operator')) {
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
