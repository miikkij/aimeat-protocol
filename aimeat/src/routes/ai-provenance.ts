/**
 * @file src/routes/ai-provenance.ts
 * @description The AI-provenance HTTP surface (TARGET-058, EU AI Act Article 50). Four routes: the
 *   published JSON Schema, resolve-by-id, the PUBLIC hash-keyed detection lookup, and declare.
 *
 *   THE DETECTION ENDPOINT IS PUBLIC FROM DAY ONE. `GET /v1/provenance/by-hash/:sha256` answers
 *   WITHOUT a session for content that is itself public, and it is rate-limited. That is deliberate
 *   and it is the one design decision here that would be genuinely expensive to reverse: the Code of
 *   Practice's Section 1 expects a "public access point that routes detection queries to their
 *   system", and building this as an admin API and opening it later is the corner the whole design
 *   exists to stay out of. It is keyed by CONTENT HASH, not by a database id, so a regulator,
 *   researcher or fact-checker can ask about bytes they already hold without us having handed them
 *   an identifier first.
 *
 *   NO EXISTENCE DISCLOSURE. `GET /v1/provenance/:id` returns an IDENTICAL 404 for "no such record"
 *   and "that record is not yours" — the same discipline services/agent-face.ts uses. A caller must
 *   not be able to probe which ids exist.
 *
 *   A DECLARATION IS NOT AN OBSERVATION. `POST /v1/provenance` writes `stampedBy: 'principal'` and
 *   `observed: false`, always. The service derives that from stampedBy rather than accepting it as a
 *   parameter, so no caller can claim this node witnessed a generation it did not.
 *
 *   AND A DECLARATION CANNOT PUBLISH ITSELF. There is no `visibility` parameter, because a
 *   caller-settable one is a way to publish a statement about content nobody may read. A record
 *   becomes anonymously resolvable exactly when something public points at it — attach it to a
 *   public memory key (`attachToMemoryKey`) and it resolves; make that key private and it returns to
 *   the identical 404. One visibility model, the platform's own, running in one direction.
 * @structure
 *   - GET  /v1/schemas/ai-provenance/v1.json — the published JSON Schema (raw, not enveloped)
 *   - GET  /v1/provenance/:id                — resolve; public record → anyone, else owner-only
 *   - GET  /v1/provenance/by-hash/:sha256    — PUBLIC detection lookup, rate-limited
 *   - POST /v1/provenance                    — declare, scope-gated, own namespace only
 * @usage
 *   import { aiProvenanceRouter } from './routes/ai-provenance.js';
 *   app.use(aiProvenanceRouter(config, storage));
 * @version-history
 *   v1.2.0 — 2026-08-01 — TARGET-058 Phase 3. A declaration that attaches to a memory key
 *     pre-renders its disclosure block against THAT key's visibility instead of the private default,
 *     so a record attached to a public key stops claiming no label is owed.
 *   v1.1.0 — 2026-08-01 — TARGET-058 Phase 2. Visibility is derived from the linked content instead
 *     of being stored on the record and settable by the declarer.
 *   v1.0.0 — 2026-08-01 — TARGET-058 Phase 1.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage, AiProvenanceRecordRow } from '../storage/interface.js';
import { requireAuth, requireScope } from '../auth/middleware.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { success, error } from '../middleware/envelope.js';
import { resolveIdentity, ownerGhiiOf } from '../utils/gaii.js';
import {
  AI_PROVENANCE_LEVELS, AI_PROVENANCE_METHODS, AI_HUMAN_INVOLVEMENT, AI_UPSTREAM_MARKS,
  AiProvenanceSourceSchema, CONTENT_HASH_PATTERN, aiProvenanceJsonSchema, AI_PROVENANCE_SCHEMA_PATH,
} from '../models/ai-provenance-schemas.js';
import { mintProvenance, projectForDetail, publiclyResolvable } from '../services/ai-provenance.js';
import type { SurfaceContext } from '../services/ai-disclosure.js';

/**
 * What a principal may DECLARE about content it produced elsewhere. Note what is absent: `spec`,
 * `generatedAt` defaults, `attestation` and `disclosure` are the service's to fill, and there is no
 * way to spell `observed` or `stampedBy` — a declarer cannot dress a claim up as an observation.
 */
const DeclareProvenanceSchema = z.object({
  level: z.enum(AI_PROVENANCE_LEVELS),
  humanInvolvement: z.enum(AI_HUMAN_INVOLVEMENT),
  method: z.enum(AI_PROVENANCE_METHODS).optional(),
  /** The exact bytes, hashed server-side. Prefer this over `contentHash` when you hold them. */
  content: z.string().max(2_000_000).optional(),
  /** A pre-computed `sha256:<64 lower-case hex>`, when the declarer holds bytes we should not see. */
  contentHash: z.string().trim().regex(CONTENT_HASH_PATTERN, 'contentHash must be `sha256:<64 lower-case hex>`').optional(),
  generatedAt: z.string().trim().max(40).optional(),
  generator: z.object({
    model: z.string().trim().min(1).max(400).optional(),
    provider: z.string().trim().min(1).max(400).optional(),
    pipeline: z.string().trim().min(1).max(400).optional(),
    upstreamMarks: z.enum(AI_UPSTREAM_MARKS).optional(),
  }).optional(),
  sources: z.array(AiProvenanceSourceSchema).max(100).optional(),
  derivedFrom: z.array(z.string().trim().min(1).max(400)).max(100).optional(),
  notes: z.string().trim().max(1_000).optional(),
  /**
   * Attach the record to one of the caller's OWN memory keys. The key is resolved inside the
   * caller's own namespace — there is no way to name someone else's — which is what makes "a
   * principal may only declare provenance for content in its own namespace" true by construction
   * rather than by a check that could be forgotten.
   */
  attachToMemoryKey: z.string().trim().min(1).max(500).optional(),
});

export function aiProvenanceRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();
  const resolve = (req: Request) => resolveIdentity(req.auth!, config.nodeId);

  // Both read endpoints are unauthenticated, so they are keyed by IP, not by GAII: anonymous mode
  // injects ONE shared identity for every visitor, which would collapse a GAII-keyed limiter into a
  // single global bucket and let one caller exhaust it for everyone.
  //
  // They get SEPARATE bucket stores on purpose. A detection sweep over many hashes and a reader
  // resolving individual record ids are different budgets, and sharing one store means a burst of
  // detection queries silently stops labels resolving on ordinary pages — which is the failure that
  // matters most, since a label that cannot resolve reads as "no provenance".
  const hashLookupRateLimit = rateLimit({ windowMs: 60_000, max: 60, keyBy: 'ip' });
  const resolveRateLimit = rateLimit({ windowMs: 60_000, max: 120, keyBy: 'ip' });
  const declareRateLimit = rateLimit(config.rateLimits.memory);

  /** What this caller (if any) may see beyond public records. Never trusts a client-supplied id. */
  function callerOwner(req: Request): string | undefined {
    // optionalAuth() injects a shared anonymous identity, so `req.auth` is truthy even for an
    // anonymous caller — checking `!req.auth` here would hand every visitor the same owner scope.
    if (!req.auth || req.auth.anonymous === true) return undefined;
    return ownerGhiiOf(resolve(req));
  }

  /** Serve a record, projected to what this surface is allowed to show. */
  function serve(row: AiProvenanceRecordRow, isOwner: boolean) {
    // AIMEAT_AI_PROVENANCE_DETAIL governs what a PUBLIC surface serves and nothing else: the owner
    // always sees the whole record, and the stored record is never reduced.
    const record = isOwner ? row.record : projectForDetail(row.record, config.aiProvenanceDetail);
    return {
      id: row.id,
      content_hash: row.contentHash,
      generated_at: row.generatedAt,
      // The document keeps ONE spelling on every carrier it travels on — camelCase — while the
      // fields around it are route DTO fields and stay snake_case. Different kinds of thing.
      provenance: record,
    };
  }

  // ── GET /v1/schemas/ai-provenance/v1.json ──
  // Served RAW (not in the AIMEAT envelope) and versioned, because the consumers are external JSON
  // Schema validators that expect a schema document at the URL, not a schema wrapped in a protocol.
  router.get(AI_PROVENANCE_SCHEMA_PATH, (_req: Request, res: Response) => {
    res.type('application/schema+json');
    // Immutable by promise: a v2 gets its own URL rather than mutating under a pinned consumer.
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.json(aiProvenanceJsonSchema(config.baseUrl));
  });

  // ── GET /v1/provenance/by-hash/:sha256 ──
  // PUBLIC and UNAUTHENTICATED for public content. See the file header for why this is not an
  // admin API. An authenticated caller additionally sees their own private records; the widening is
  // done in SQL, so a third party's private row never enters the process.
  router.get('/v1/provenance/by-hash/:sha256', hashLookupRateLimit, async (req: Request, res: Response) => {
    const raw = String(req.params.sha256 ?? '').trim().toLowerCase();
    const hash = raw.startsWith('sha256:') ? raw : `sha256:${raw}`;
    if (!CONTENT_HASH_PATTERN.test(hash)) {
      return res.status(400).json(error(config.nodeId, 'INVALID_HASH',
        'Expected a SHA-256 digest as 64 lower-case hex characters, with or without the `sha256:` prefix.'));
    }

    const owner = callerOwner(req);
    const rows = await storage.findAiProvenanceByHash(hash, owner ? { ownerGhii: owner } : undefined);
    res.json(success(config.nodeId, {
      content_hash: hash,
      // An empty list is a real, useful answer here: "this node has no statement about these bytes".
      // It is NOT "a human wrote it" — absence is unstated, and the caller must read it that way.
      count: rows.length,
      records: rows.map((r) => serve(r, !!owner && r.ownerGhii === owner)),
    }, [
      { description: 'The record schema', method: 'GET', url: AI_PROVENANCE_SCHEMA_PATH },
    ]));
  });

  // ── GET /v1/provenance/:id ──
  router.get('/v1/provenance/:id', resolveRateLimit, async (req: Request, res: Response) => {
    const row = await storage.getAiProvenance(String(req.params.id ?? ''));
    const owner = callerOwner(req);
    const isOwner = !!row && !!owner && row.ownerGhii === owner;

    // VISIBILITY FOLLOWS THE CONTENT. Not a flag on the record — a live question about whether
    // anything public points at it. Publishing the content makes this resolve; unpublishing takes
    // it straight back to the 404 below, with nothing to remember to do.
    const isPublic = !!row && !isOwner && (await publiclyResolvable(storage, [row.id])).has(row.id);

    // ONE 404 for all of "no such record", "not yours" and "its content is not public". Different
    // answers here would turn this endpoint into an oracle for which ids exist on this node.
    if (!row || (!isPublic && !isOwner)) {
      return res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'No such provenance record.'));
    }
    // The correction procedure, offered where a person actually arrives: a visible label's "details"
    // link lands here, so this is the one page where somebody who thinks a label is wrong or missing
    // already has the identifier in front of them (Code of Practice Section 2, Commitment 2).
    res.json(success(config.nodeId, serve(row, isOwner), [
      {
        description: 'Report this as mislabelled or undisclosed AI content',
        method: 'POST',
        url: '/v1/flags',
      },
      { description: 'How this node marks AI content', method: 'GET', url: '/v1/ai-transparency' },
    ]));
  });

  // ── POST /v1/provenance ──
  // Declare provenance for content produced elsewhere. Scope-gated (owner sessions bypass scopes,
  // as everywhere), rate-limited, and confined to the caller's own namespace by construction.
  router.post('/v1/provenance',
    requireAuth(), requireScope('provenance:write'), declareRateLimit,
    async (req: Request, res: Response) => {
      const parsed = DeclareProvenanceSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json(error(config.nodeId, 'INVALID_BODY', 'Invalid provenance declaration.', 400, {
          violations: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        }));
      }
      const input = parsed.data;
      if (!input.content && !input.contentHash) {
        return res.status(400).json(error(config.nodeId, 'INVALID_BODY',
          'Supply `content` (hashed here) or a pre-computed `contentHash`. A record about no particular bytes cannot be looked up later.'));
      }
      if (input.generatedAt && Number.isNaN(Date.parse(input.generatedAt))) {
        return res.status(400).json(error(config.nodeId, 'INVALID_BODY', 'generatedAt must be an ISO 8601 date-time.'));
      }

      // The acting principal (GAII/GEAI/GHII) is what we attribute to; the OWNER is what we
      // authorize against. Both come from the resolved identity — never from the request body.
      const principal = resolve(req);
      const ownerGhii = ownerGhiiOf(principal);

      // Attaching is confined to the caller's own namespace because the key is looked up IN that
      // namespace. There is no request shape that names another owner's record.
      let attachTo: string | undefined;
      // The surface the disclosure block is pre-rendered against. When the caller is attaching the
      // record to something, we KNOW where it is about to be served — so use that item's visibility
      // instead of the private default. Without this a declared record always claimed "no label
      // owed", including for a record attached to a public key, which made the pre-rendered block a
      // statement about a surface the content was never on.
      let surface: SurfaceContext = { visibility: 'private', humanAudience: true };
      if (input.attachToMemoryKey) {
        const existing = await storage.getMemory(principal, input.attachToMemoryKey);
        if (!existing) {
          return res.status(404).json(error(config.nodeId, 'NOT_FOUND',
            `No memory record "${input.attachToMemoryKey}" in your namespace.`));
        }
        attachTo = input.attachToMemoryKey;
        surface = { visibility: existing.visibility, humanAudience: true };
      }

      const row = await mintProvenance(storage, {
        stampedBy: 'principal',
        ownerGhii,
        principal,
        level: input.level,
        humanInvolvement: input.humanInvolvement,
        method: input.method,
        content: input.content,
        contentHash: input.contentHash,
        generatedAt: input.generatedAt,
        generator: input.generator,
        sources: input.sources,
        derivedFrom: input.derivedFrom,
        notes: input.notes,
        surface,
        labelPolicy: config.aiLabelPublic,
        nodeId: config.nodeId,
        baseUrl: config.baseUrl,
      });

      if (attachTo) {
        const existing = await storage.getMemory(principal, attachTo);
        if (existing) {
          await storage.setMemory({ ...existing, aiProvenanceId: row.id, updatedAt: new Date().toISOString() });
        }
      }

      res.status(201).json(success(config.nodeId, serve(row, true), [
        { description: 'Resolve this record', method: 'GET', url: `/v1/provenance/${row.id}` },
        ...(row.contentHash
          ? [{ description: 'Look it up by content hash', method: 'GET', url: `/v1/provenance/by-hash/${row.contentHash.replace('sha256:', '')}` }]
          : []),
      ]));
    });

  return router;
}
