/**
 * @file src/services/route-capabilities.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The node's REST routes as capabilities that `discover` finds and `invoke` runs,
 *   generated from openapi.yaml.
 *
 *   WHY. A person with a browser reaches several hundred routes that no MCP tool covers
 *   (security/field-reach-exemptions.json). A new tool per route would grow every tool list past what
 *   a model can hold. A route capability gives an agent the same reach through the two tools it
 *   already has: it finds the route with `aimeat_discover` and runs it with `aimeat_invoke`, with its
 *   own credential, through the same route (services/route-invoke.ts). The route's own gates decide,
 *   so an agent the route admits gets the route's answer and an agent it refuses gets its refusal.
 *
 *   GENERATED, NEVER WRITTEN BY HAND. Every operation in openapi.yaml becomes one entry, except the
 *   kinds `routeExclusion()` names: a route a caller with a session has no reason to run as itself
 *   (sign-in, token and setup routes, explicitly public routes that take no session), a route only an
 *   outside credential or a federation peer's signature reaches, a route whose body is not JSON, a
 *   route that answers a stream or only a binary file, the MCP endpoint and `/v1/invoke` itself. The
 *   contract is read once per process, as the body contract is (services/openapi-body-contract.ts).
 *
 *   THE ID. `route:<METHOD> <path template>`, for example `route:DELETE /v1/admin/email/templates/{id}`.
 *   A tool id starts with `aimeat_`, so the two never collide. A lookup takes the Express spelling of
 *   the path too (`:id`), because the field-reach ledger writes routes that way.
 * @structure RouteCapability · routeExclusion(path, method, op, doc) · buildRouteCapabilities(doc) ·
 *   listRouteCapabilities() · findRouteCapability(id) · routeCapabilityContract(cap) · routeCapabilityId(method, path)
 * @usage
 *   const cap = findRouteCapability('route:GET /v1/ledger/usage/runs');
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial: REST routes reachable through aimeat_discover and aimeat_invoke.
 */
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { findOpenApiFile } from './openapi-file.js';
import { routeKey } from './openapi-body-contract.js';
import { logger } from '../utils/logger.js';

/** One input field, in the shape the tool catalog uses (tool-catalog/definitions/types.ts ToolInputField). */
export interface RouteInputField {
  type: 'object' | 'unknown';
  required?: boolean;
  description: string;
}

/** A path or query parameter as the contract declares it. */
export interface RouteParameter {
  name: string;
  in: 'path' | 'query';
  required: boolean;
  description?: string;
  schema?: unknown;
}

/** The permission word the contract says the route asks of an agent (`x-aimeat-scope`). */
export interface RoutePermission {
  word: string;
  or_scope?: string;
  enforced_in?: string;
  self_exempt?: boolean;
}

/** One route, as a caller of `invoke` sees it. Structurally a node capability (node-capabilities.ts). */
export interface RouteCapability {
  id: string;
  kind: 'route';
  title: string;
  description: string;
  /** The first path segment after /v1, the family a caller filters on. */
  segment: string;
  /** What `invoke` takes for it: `path`, `query` and `body`, each present only when the route has one. */
  input: Record<string, RouteInputField>;
  required: string[];
  /** Who calls it: whoever the route itself admits. */
  caller: 'route';
  method: string;
  /** The contract's own path template, `/v1/agents/{name}/telemetry`. */
  path: string;
  permission?: RoutePermission;
  parameters: RouteParameter[];
  /** The request body, when the contract declares one. Its schema is read with routeCapabilityContract(). */
  body?: { required: boolean };
}

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

/** Security schemes that are a node session. Any other named scheme is an outside credential. */
const SESSION_SCHEMES = new Set(['BearerAuth', 'bearerAuth']);

/**
 * Path prefixes a caller with a session has no reason to run through `invoke`, each with the reason.
 * They take or make a credential (a password, a refresh cookie, a device code, a setup code), or they
 * are the MCP endpoint and `invoke` itself. Through `invoke` their address-based limits would see the
 * node's own address instead of the caller's, so they stay REST-only.
 */
const EXCLUDED_PREFIXES: ReadonlyArray<[string, string]> = [
  ['/v1/invoke', 'invoke itself: a dispatcher that dispatches to itself is a loop'],
  ['/v1/mcp/', 'the MCP endpoint and its OAuth routes'],
  ['/v1/auth/', 'sign-in and token routes'],
  ['/v1/oauth/', 'OAuth sign-in routes'],
  ['/v1/ghii/login', 'sign-in routes'],
  ['/v1/ghii/register', 'registration routes'],
  ['/v1/setup', 'first-run setup routes'],
  ['/v1/admin/setup', 'first-run setup routes'],
  ['/v1/agents/device-', 'device authorization: the agent has no session yet'],
  ['/v1/agents/v2/token', 'a key-holding agent exchanges its assertion for a session here'],
];

/** Exact routes for the same reason as EXCLUDED_PREFIXES: the MCP endpoint, and registration (POST /v1/ghii). */
const EXCLUDED_ROUTES = new Set(['GET /v1/mcp', 'POST /v1/mcp', 'DELETE /v1/mcp', 'POST /v1/ghii']);

/** Request body media types `invoke` can send: it sends JSON. */
const JSON_MEDIA = /^application\/json$|^\*\/\*$/;

/** Response media types `invoke` reads back: JSON and text. A route that answers only something else is not listed. */
const READABLE_MEDIA = /json|^text\/(?!event-stream)|yaml|markdown|xml/;

type RawDoc = {
  paths?: Record<string, Record<string, unknown> | undefined>;
  components?: Record<string, Record<string, unknown> | undefined>;
};
type RawOp = {
  summary?: string;
  description?: string;
  security?: Array<Record<string, unknown>>;
  parameters?: unknown[];
  requestBody?: { $ref?: string; required?: boolean; content?: Record<string, { schema?: unknown }> };
  responses?: Record<string, { $ref?: string; content?: Record<string, unknown> } | undefined>;
  'x-aimeat-scope'?: { word?: unknown; orScope?: unknown; enforcedIn?: unknown; selfExempt?: unknown };
};

function deref<T>(doc: RawDoc, value: unknown, section: string): T | undefined {
  const ref = (value as { $ref?: unknown } | undefined)?.$ref;
  if (typeof ref === 'string' && ref.startsWith(`#/components/${section}/`)) {
    return doc.components?.[section]?.[ref.slice(`#/components/${section}/`.length)] as T | undefined;
  }
  return value as T | undefined;
}

function paramsOf(doc: RawDoc, item: Record<string, unknown>, op: RawOp): RouteParameter[] {
  const raw = [...((item.parameters as unknown[]) ?? []), ...(op.parameters ?? [])];
  const byKey = new Map<string, RouteParameter>();
  for (const entry of raw) {
    const p = deref<{ name?: unknown; in?: unknown; required?: unknown; description?: unknown; schema?: unknown }>(doc, entry, 'parameters');
    if (!p || typeof p.name !== 'string' || (p.in !== 'path' && p.in !== 'query')) continue;
    // The operation's own declaration of a name replaces the path item's, as OpenAPI says.
    byKey.set(`${p.in}:${p.name}`, {
      name: p.name, in: p.in, required: p.in === 'path' || p.required === true,
      ...(typeof p.description === 'string' ? { description: p.description.trim() } : {}),
      ...(p.schema !== undefined ? { schema: p.schema } : {}),
    });
  }
  return [...byKey.values()];
}

/**
 * Why an operation is not a route capability, or null when it is one. Exported for the unit test
 * and for check:field-reach, which must agree with the catalogue about which routes `invoke` reaches.
 */
export function routeExclusion(path: string, method: string, op: RawOp, doc: RawDoc, item: Record<string, unknown> = {}): string | null {
  if (!path.startsWith('/v1/')) return 'not an API route under /v1';
  if (EXCLUDED_ROUTES.has(`${method.toUpperCase()} ${path}`)) return 'the MCP endpoint, or registration';
  for (const [prefix, why] of EXCLUDED_PREFIXES) if (path.startsWith(prefix)) return why;
  const security = op.security;
  if (Array.isArray(security)) {
    // `security: []`, or only `{}`: an explicitly public route for a caller with no session at all.
    if (security.every(alt => Object.keys(alt ?? {}).length === 0)) return 'a public route that takes no session';
    const sessionOk = security.some(alt => Object.keys(alt ?? {}).length === 0 || Object.keys(alt).some(s => SESSION_SCHEMES.has(s)));
    if (!sessionOk) return 'only an outside credential reaches it';
  }
  // A federation peer signs its request in headers; no session carries that signature.
  const headers = [...((item.parameters as unknown[]) ?? []), ...(op.parameters ?? [])]
    .map(p => deref<{ in?: unknown; name?: unknown }>(doc, p, 'parameters'))
    .filter(p => p?.in === 'header' && typeof p.name === 'string');
  if (headers.some(p => /signature|source-node/i.test(String(p!.name)))) return 'a federation peer signs it';
  const body = deref<RawOp['requestBody']>(doc, op.requestBody, 'requestBodies');
  if (body?.content && !Object.keys(body.content).some(m => JSON_MEDIA.test(m))) return 'its body is not JSON';
  const success = Object.entries(op.responses ?? {}).filter(([code]) => /^2/.test(code))
    .map(([, r]) => deref<{ content?: Record<string, unknown> }>(doc, r, 'responses'));
  const media = success.flatMap(r => Object.keys(r?.content ?? {}));
  if (media.includes('text/event-stream')) return 'it answers a stream';
  if (media.length > 0 && !media.some(m => READABLE_MEDIA.test(m))) return 'it answers only a binary file';
  return null;
}

/** `route:GET /v1/agents/{name}/telemetry`. */
export function routeCapabilityId(method: string, path: string): string {
  return `route:${method.toUpperCase()} ${path}`;
}

function permissionOf(op: RawOp): RoutePermission | undefined {
  const x = op['x-aimeat-scope'];
  if (!x || typeof x.word !== 'string') return undefined;
  return {
    word: x.word,
    ...(typeof x.orScope === 'string' ? { or_scope: x.orScope } : {}),
    ...(typeof x.enforcedIn === 'string' ? { enforced_in: x.enforcedIn } : {}),
    ...(x.selfExempt === true ? { self_exempt: true } : {}),
  };
}

/** Build the route capabilities from a parsed openapi document. Exported for the unit test. */
export function buildRouteCapabilities(doc: RawDoc): RouteCapability[] {
  const out: RouteCapability[] = [];
  for (const [path, rawItem] of Object.entries(doc.paths ?? {})) {
    const item = (rawItem ?? {}) as Record<string, unknown>;
    for (const m of METHODS) {
      const op = item[m] as RawOp | undefined;
      if (!op || routeExclusion(path, m, op, doc, item) !== null) continue;
      const method = m.toUpperCase();
      const parameters = paramsOf(doc, item, op);
      const pathParams = parameters.filter(p => p.in === 'path');
      const queryParams = parameters.filter(p => p.in === 'query');
      const body = deref<RawOp['requestBody']>(doc, op.requestBody, 'requestBodies');
      const permission = permissionOf(op);
      const input: Record<string, RouteInputField> = {};
      if (pathParams.length) {
        input.path = { type: 'object', required: true, description: `The path values: ${pathParams.map(p => p.name).join(', ')}.` };
      }
      if (queryParams.length) {
        input.query = { type: 'object', description: `Query values, by name: ${queryParams.map(p => p.name).join(', ')}. A name the route does not declare is refused.` };
      }
      if (body && method !== 'GET') {
        input.body = { type: 'unknown', required: body.required === true, description: 'The request body as the route takes it, sent as JSON.' };
      }
      const summary = typeof op.summary === 'string' ? op.summary.trim() : '';
      const text = typeof op.description === 'string' ? op.description.trim() : '';
      const words = permission ? ` An agent needs the permission ${permission.word}${permission.or_scope ? ` or ${permission.or_scope}` : ''}; the owner in person needs none.` : '';
      out.push({
        id: routeCapabilityId(method, path),
        kind: 'route',
        title: summary || `${method} ${path}`,
        description: `${method} ${path}. ${[summary, text].filter(Boolean).join('\n\n')}${words}`.trim(),
        segment: path.split('/')[2] || 'other',
        input,
        required: Object.entries(input).filter(([, f]) => f.required).map(([k]) => k),
        caller: 'route',
        method,
        path,
        ...(permission ? { permission } : {}),
        parameters,
        ...(body && method !== 'GET' ? { body: { required: body.required === true } } : {}),
      });
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

// process-local: openapi.yaml read once per process; every process reads the same file.
let loaded: { caps: RouteCapability[]; byKey: Map<string, RouteCapability>; doc: RawDoc } | null = null;

function load(): NonNullable<typeof loaded> {
  if (loaded) return loaded;
  let doc: RawDoc = {};
  const file = findOpenApiFile();
  if (file) {
    try { doc = parse(readFileSync(file, 'utf-8')) as RawDoc; }
    catch (err) { logger.warn('route capabilities: could not read openapi.yaml; no route is a capability', { error: String(err) }); }
  } else {
    logger.warn('route capabilities: no openapi.yaml in this install; no route is a capability');
  }
  const caps = buildRouteCapabilities(doc);
  const byKey = new Map(caps.map(c => [routeKey(c.method, c.path), c]));
  // Only the parts the contract read needs are kept: the component schemas, for a body schema's $refs.
  loaded = { caps, byKey, doc: { components: { schemas: doc.components?.schemas ?? {} } } };
  return loaded;
}

/** Every route capability this node has. Read from openapi.yaml at the first call, then cached. */
export function listRouteCapabilities(): RouteCapability[] {
  return load().caps;
}

/**
 * The route capability by id, or undefined. Takes `route:<METHOD> <path>` with the path written as the
 * contract writes it (`{id}`) or as Express does (`:id`), and any case of the method.
 */
export function findRouteCapability(id: string): RouteCapability | undefined {
  const m = /^route:\s*([A-Za-z]+)\s+(\/\S*)$/.exec(id.trim());
  if (!m) return undefined;
  return load().byKey.get(routeKey(m[1], m[2]));
}

/** How deep a body schema's $refs are written out in a contract read; deeper ones stay as `$ref`. */
const REF_DEPTH = 6;

function resolveRefs(schema: unknown, schemas: Record<string, unknown>, depth: number): unknown {
  if (Array.isArray(schema)) return schema.map(s => resolveRefs(s, schemas, depth));
  if (schema === null || typeof schema !== 'object') return schema;
  const ref = (schema as { $ref?: unknown }).$ref;
  if (typeof ref === 'string' && ref.startsWith('#/components/schemas/')) {
    const target = schemas[ref.slice('#/components/schemas/'.length)];
    return depth > 0 && target !== undefined ? resolveRefs(target, schemas, depth - 1) : schema;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
    if (k === 'example' || k === 'examples') continue;
    out[k] = resolveRefs(v, schemas, depth);
  }
  return out;
}

/** The full contract of one route capability: the entry plus its JSON body schema, $refs written out. */
export function routeCapabilityContract(cap: RouteCapability): RouteCapability & { body_schema?: unknown } {
  if (!cap.body) return cap;
  const file = findOpenApiFile();
  if (!file) return cap;
  try {
    // The body schema is read from the file again rather than kept for every route: a contract read is
    // rare, and the whole document held in memory for it would be most of the process's catalogue.
    const doc = parse(readFileSync(file, 'utf-8')) as RawDoc;
    const op = (doc.paths?.[cap.path] as Record<string, RawOp> | undefined)?.[cap.method.toLowerCase()];
    const body = op ? deref<RawOp['requestBody']>(doc, op.requestBody, 'requestBodies') : undefined;
    const schema = body?.content?.['application/json']?.schema ?? body?.content?.['*/*']?.schema;
    if (schema === undefined) return cap;
    return { ...cap, body_schema: resolveRefs(schema, (doc.components?.schemas ?? {}) as Record<string, unknown>, REF_DEPTH) };
  } catch (err) {
    logger.warn('route capabilities: could not read a body schema', { capability: cap.id, error: String(err) });
    return cap;
  }
}
