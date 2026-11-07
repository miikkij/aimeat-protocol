/**
 * @file src/routes/csm.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Routes for CSM (Community Service Manifest) definitions — the YAML/JSON
 *   schemas that describe a service's data shape and rules. Registers, versions and deletes CSMs,
 *   answers each one and its versions to the callers its visibility admits, drafts one from a sample,
 *   and serves the built-in CSM templates. Every decision is services/csm-service.ts, which the MCP
 *   tool aimeat_csm calls too; this file reads the request and writes the answer.
 *
 * @structure
 *   - csmRouter(config, storage): Router mounting the /v1/csm endpoints
 *   - writeInputOf(req): the definition and settings a POST or PUT carries (YAML text or JSON)
 *   - POST /v1/csm · GET /v1/csm · GET /v1/csm/templates(/:type) · POST /v1/csm/draft ·
 *     GET/PUT/PATCH/DELETE /v1/csm/:name · GET /v1/csm/:name/versions(/:version)
 *
 * @version-history
 *   v2.0.0 — 2026-11-07 — The developer's CSM ruling of 2026-11-07: a new name carries the owner's
 *     prefix, a CSM has a visibility (GET answers 404 for one the caller may not read), versions with
 *     PUT /v1/csm/{name} (expected version in the body or If-Match, 409 VERSION_CONFLICT) and the
 *     version list, PATCH sets the visibility, POST /v1/csm/draft infers one from a sample. POST, PUT,
 *     PATCH, DELETE and the draft take the owner or a principal holding csm:write, so an agent can make
 *     a CSM; DELETE answers 409 IN_USE while a module uses the CSM. The logic moved to
 *     services/csm-service.ts, the templates loader with it.
 *   v1.1.0 — 2026-10-05 — Operator checks ask isOperatorCaller/operatorOverride: the operator's agent holding operator:admin passes as on MCP, and a pass in another person's account writes the operator trail (secaudit 2026-10, C2).
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { Router, type Request, type Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth, requireRoleOrScope } from '../auth/middleware.js';
import { validateBody } from '../models/schemas.js';
import { CsmWriteBodySchema, CsmVisibilityBodySchema, CsmDraftBodySchema } from '../models/csm-schemas.js';
import { success, error } from '../middleware/envelope.js';
import { callerOf } from '../middleware/caller.js';
import type { CallerContext } from '../services/caller-context.js';
import {
  CSM_WRITE_SCOPE, csmLinks, csmTemplates, listCsmsFor, getCsmFor, listCsmVersionsFor, getCsmVersionFor,
  createCsmAs, updateCsmAs, setCsmVisibilityAs, deleteCsmAs, draftCsmFromSample,
  type CsmAnswer, type CsmWriteInput,
} from '../services/csm-service.js';

/** The fields of a JSON body that are settings beside the definition, never part of it. */
const SETTING_FIELDS = ['visibility', 'federate', 'expected_version'] as const;

/** The definition and settings a POST or PUT carries, or the refusal text. */
function writeInputOf(req: Request): (CsmWriteInput & { expected_version?: unknown }) | { refusal: string } {
  const contentType = req.headers['content-type'] ?? '';
  const query = req.query as Record<string, unknown>;
  const fromQuery = {
    ...(typeof query.visibility === 'string' ? { visibility: query.visibility } : {}),
    ...(typeof query.expected_version === 'string' ? { expected_version: query.expected_version } : {}),
  };
  if (typeof req.body === 'string') return { yaml: req.body, ...fromQuery };
  if (Buffer.isBuffer(req.body)) return { yaml: req.body.toString('utf-8'), ...fromQuery };
  if (contentType.includes('text/yaml') || contentType.includes('application/x-yaml')) {
    return { refusal: 'For YAML content, send raw text with Content-Type: text/yaml' };
  }
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) return { refusal: 'Request body is required' };
  const body = req.body as Record<string, unknown>;
  const settings = Object.fromEntries(SETTING_FIELDS.filter(f => body[f] !== undefined).map(f => [f, body[f]]));
  if (typeof body.yaml === 'string') return { yaml: body.yaml, ...settings };
  if (body.definition && typeof body.definition === 'object') return { definition: body.definition, ...settings };
  // The body is the definition itself, as POST /v1/csm has always taken it.
  const definition = Object.fromEntries(Object.entries(body).filter(([k]) => !(SETTING_FIELDS as readonly string[]).includes(k)));
  return { definition, ...settings };
}

/** The version an If-Match header names (`3`, `"3"` or `W/"3"`), or undefined. */
function ifMatchVersion(req: Request): number | undefined {
  const raw = req.headers['if-match'];
  const m = typeof raw === 'string' ? /^\s*(?:W\/)?"?(\d+)"?\s*$/.exec(raw) : null;
  return m ? Number(m[1]) : undefined;
}

/** The caller of a read: null when nobody (or the anonymous identity) is signed in. */
function viewerOf(req: Request, config: AimeatConfig, storage: Storage): CallerContext | null {
  return req.auth && !req.auth.anonymous ? callerOf(req, config.nodeId, storage) : null;
}

export function csmRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();
  const deps = { storage, config };
  const write = [requireAuth(), requireRoleOrScope('owner', CSM_WRITE_SCOPE)];

  const send = <T>(res: Response, out: CsmAnswer<T>, links?: Array<{ description: string; method: string; url: string }>) => {
    if (!out.ok) {
      res.status(out.status).json(error(config.nodeId, out.code, out.message, out.status, out.details));
      return;
    }
    res.status(out.status).json(success(config.nodeId, out.data, links));
  };

  // POST /v1/csm — Register a new CSM service in the caller's account (text/yaml or application/json)
  router.post('/v1/csm', ...write, validateBody(CsmWriteBodySchema, config.nodeId), async (req, res) => {
    const input = writeInputOf(req);
    if ('refusal' in input) { res.status(400).json(error(config.nodeId, 'INVALID_INPUT', input.refusal)); return; }
    const out = await createCsmAs(deps, callerOf(req, config.nodeId, storage), input);
    send(res, out, out.ok ? [
      { description: 'List all CSM services', method: 'GET', url: '/v1/csm' },
      ...csmLinks(out.data.csm.name),
      { description: 'Write data matching this schema', method: 'POST', url: '/v1/memory' },
    ] : undefined);
  });

  // GET /v1/csm — The CSM services this caller may read; no sign-in needed for the public ones
  router.get('/v1/csm', async (req, res) => {
    const serviceType = typeof req.query.type === 'string' ? req.query.type
      : typeof req.query.service_type === 'string' ? req.query.service_type : undefined;
    send(res, await listCsmsFor(deps, viewerOf(req, config, storage), serviceType ? { serviceType } : {}));
  });

  // GET /v1/csm/templates — List available CSM templates (public, Tier 0)
  router.get('/v1/csm/templates', (_req, res) => {
    const templates = csmTemplates();
    res.json(success(config.nodeId, {
      templates: templates.map(t => ({ type: t.type, name: t.name, description: t.description, schema_mode: t.schemaMode })),
      total: templates.length,
    }, templates.map(t => ({ description: `View ${t.type} template`, method: 'GET', url: `/v1/csm/templates/${t.type}` }))));
  });

  // GET /v1/csm/templates/:type — Get a specific CSM template as YAML
  router.get('/v1/csm/templates/:type', (req, res) => {
    const type = req.params.type as string;
    const template = csmTemplates().find(t => t.type === type);
    if (!template) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND',
        `CSM template "${type}" not found. Use GET /v1/csm/templates to list available templates.`));
      return;
    }
    // ?format=json answers the YAML inside the envelope, for a client that reads JSON only (the CLI dispatch).
    if (req.query.format === 'json') {
      res.json(success(config.nodeId, { type: template.type, name: template.name, description: template.description, schema_mode: template.schemaMode, yaml: template.yaml }));
      return;
    }
    res.status(200).type('application/x-yaml').send(template.yaml);
  });

  // POST /v1/csm/draft — A CSM definition inferred from one sample object; stores nothing
  router.post('/v1/csm/draft', ...write, validateBody(CsmDraftBodySchema, config.nodeId), async (req, res) => {
    const body = (req as typeof req & { validated: Record<string, unknown> }).validated;
    const out = await draftCsmFromSample(deps, callerOf(req, config.nodeId, storage), body);
    send(res, out, out.ok ? [{ description: 'Register it', method: 'POST', url: '/v1/csm' }] : undefined);
  });

  // GET /v1/csm/:name — One CSM service, its compiled JSON Schema and the schema's hash
  router.get('/v1/csm/:name', async (req, res) => {
    const name = req.params.name as string;
    const out = await getCsmFor(deps, viewerOf(req, config, storage), name);
    send(res, out, out.ok ? [
      ...csmLinks(name).slice(1),
      { description: 'Replace the definition (the next version)', method: 'PUT', url: `/v1/csm/${encodeURIComponent(name)}` },
      { description: 'Delete this CSM service', method: 'DELETE', url: `/v1/csm/${encodeURIComponent(name)}` },
    ] : undefined);
  });

  // GET /v1/csm/:name/versions — Every version, oldest first, the current one last
  router.get('/v1/csm/:name/versions', async (req, res) => {
    send(res, await listCsmVersionsFor(deps, viewerOf(req, config, storage), req.params.name as string));
  });

  // GET /v1/csm/:name/versions/:version — One version's definition and compiled schema
  router.get('/v1/csm/:name/versions/:version', async (req, res) => {
    const version = Number(req.params.version as string);
    send(res, await getCsmVersionFor(deps, viewerOf(req, config, storage), req.params.name as string, version));
  });

  // PUT /v1/csm/:name — Replace the definition; the expected version in the body or If-Match
  router.put('/v1/csm/:name', ...write, validateBody(CsmWriteBodySchema, config.nodeId), async (req, res) => {
    const input = writeInputOf(req);
    if ('refusal' in input) { res.status(400).json(error(config.nodeId, 'INVALID_INPUT', input.refusal)); return; }
    const expected = input.expected_version ?? ifMatchVersion(req);
    const name = req.params.name as string;
    const out = await updateCsmAs(deps, callerOf(req, config.nodeId, storage), name, { ...input, expected_version: expected });
    send(res, out, out.ok ? csmLinks(name) : undefined);
  });

  // PATCH /v1/csm/:name — { visibility }: who may read the CSM
  router.patch('/v1/csm/:name', ...write, validateBody(CsmVisibilityBodySchema, config.nodeId), async (req, res) => {
    const { visibility } = (req as typeof req & { validated: { visibility: string } }).validated;
    const name = req.params.name as string;
    const out = await setCsmVisibilityAs(deps, callerOf(req, config.nodeId, storage), name, visibility);
    send(res, out, out.ok ? csmLinks(name) : undefined);
  });

  // DELETE /v1/csm/:name — Delete a CSM service and its schema; refused while a module uses it
  router.delete('/v1/csm/:name', ...write, async (req, res) => {
    const out = await deleteCsmAs(deps, callerOf(req, config.nodeId, storage), req.params.name as string);
    send(res, out, out.ok ? [
      { description: 'Register a new CSM service', method: 'POST', url: '/v1/csm' },
      { description: 'List remaining CSM services', method: 'GET', url: '/v1/csm' },
    ] : undefined);
  });

  return router;
}
