/**
 * @file cors-overview.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The operator's CORS page in one read, and the one write it has. Which browser
 *   origins this instance answers by default, the three cookie doors that take no wildcard and what
 *   is named for them, the people and the agents who keep a list of their own, how many memory
 *   records carry one, and the order the four lists rank in. One implementation behind
 *   GET /v1/admin/cors/overview and the aimeat_admin_cors_overview tool, and one behind the two
 *   PUT routes and aimeat_admin_cors_set, so every surface says and does the same thing.
 *
 *   THE RULES HERE ARE THE MIDDLEWARE'S. The precedence list, the cookie doors and the wildcard rule
 *   are read from src/middleware/cors.ts rather than restated, so the page cannot drift from what
 *   the door actually does.
 * @structure
 *   - validateOrigins(value)                    -- pure: the one check both PUT doors apply
 *   - buildCorsOverview(config, storage)        -- the composed read the route and the tool serve
 *   - setCorsList(storage, config, who, origins) -- the write behind the two PUT routes and the tool
 * @usage
 *   const overview = await buildCorsOverview(config, storage);
 *   const r = await setCorsList(storage, config, 'alice@node', ['https://app.example']);
 * @version-history
 *   v1.0.0 -- 2026-09-08 -- Initial: the CORS page in the poster face (design canvas "AIMEAT Admin
 *     CORS", direction A).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { COOKIE_AUTHED_PATHS } from '../middleware/cors.js';
import { emitChange } from '../services/event-bus.js';

/** The order the middleware asks the lists in; the first non-empty one is the whole answer. */
export const CORS_PRECEDENCE = ['record', 'agent', 'person', 'default'] as const;

export interface CorsPersonRow { ghii: string; owner_name: string; display_name: string | null; allowed_origins: string[] }
export interface CorsAgentRow { gaii: string; owner: string; display_name: string | null; allowed_origins: string[] }

export interface CorsOverview {
  generated_at: string;
  default: {
    origins: string[];
    /** True when the default list answers every origin (`*`). */
    wildcard: boolean;
    env: 'AIMEAT_CORS_ALLOWED_ORIGINS';
    config_key: 'cors.allowed_origins';
  };
  /** The doors that hand back a token on the sign-in cookie: they answer only an origin named in the
   *  default list, never the wildcard. `named` is what the default list names for them. */
  cookie_doors: { paths: string[]; named: string[] };
  people: { total: number; with_list: CorsPersonRow[] };
  agents: { total: number; with_list: CorsAgentRow[] };
  /** Memory records that carry a list of their own, set by the agent that owns them. */
  records: { with_list: number };
  /** With anonymous mode on, a request without a credential is answered from any origin. */
  anonymous_mode: boolean;
  precedence: typeof CORS_PRECEDENCE;
}

export type ValidatedOrigins = { ok: true; origins: string[] | null } | { ok: false; message: string };

/**
 * The one check every CORS write applies: `null` clears, otherwise an array in which each entry is
 * `*` or an http(s) URL. Anything else is refused before it is saved, with the message the routes
 * have always answered.
 */
export function validateOrigins(value: unknown): ValidatedOrigins {
  if (value === null) return { ok: true, origins: null };
  if (!Array.isArray(value)) return { ok: false, message: 'allowed_origins must be an array of origin URLs or null to clear' };
  for (const origin of value) {
    if (typeof origin !== 'string' || (origin !== '*' && !/^https?:\/\//.test(origin))) {
      return { ok: false, message: `Invalid origin: ${String(origin)}. Must be an http(s) URL or '*'` };
    }
  }
  return { ok: true, origins: value as string[] };
}

export async function buildCorsOverview(config: AimeatConfig, storage: Storage): Promise<CorsOverview> {
  const origins = config.corsAllowedOrigins ?? [];
  const [ghiis, agents, records] = await Promise.all([
    storage.listGHIIs(),
    storage.listAgents(),
    storage.countMemoryWithOrigins(),
  ]);
  return {
    generated_at: new Date().toISOString(),
    default: {
      origins,
      wildcard: origins.includes('*'),
      env: 'AIMEAT_CORS_ALLOWED_ORIGINS',
      config_key: 'cors.allowed_origins',
    },
    cookie_doors: { paths: [...COOKIE_AUTHED_PATHS].sort(), named: origins.filter(o => o !== '*') },
    people: {
      total: ghiis.length,
      with_list: ghiis
        .filter(g => Array.isArray(g.allowedOrigins) && g.allowedOrigins.length > 0)
        .map(g => ({ ghii: g.ghii, owner_name: g.ownerName, display_name: g.displayName ?? null, allowed_origins: g.allowedOrigins as string[] }))
        .sort((a, b) => a.owner_name.localeCompare(b.owner_name)),
    },
    agents: {
      total: agents.length,
      with_list: agents
        .filter(a => Array.isArray(a.allowedOrigins) && a.allowedOrigins.length > 0)
        .map(a => ({ gaii: a.gaii, owner: a.owner, display_name: a.displayName ?? null, allowed_origins: a.allowedOrigins as string[] }))
        .sort((a, b) => a.gaii.localeCompare(b.gaii)),
    },
    records: { with_list: records },
    anonymous_mode: config.anonymousMode,
    precedence: CORS_PRECEDENCE,
  };
}

export type SetCorsResult =
  | { ok: true; kind: 'person'; ghii: string; allowed_origins: string[] | null }
  | { ok: true; kind: 'agent'; gaii: string; allowed_origins: string[] | null }
  | { ok: false; code: 'NOT_FOUND' | 'INVALID_INPUT' | 'INTERNAL'; message: string };

/**
 * Set or clear a list for a person or an agent. `who` is an agent's address (`name#owner@node`), a
 * person's (`owner@node`) or a bare owner name; the `#` is what tells an agent from a person.
 * The change event is the one each PUT route has always emitted, so the admin page re-reads.
 */
export async function setCorsList(storage: Storage, config: AimeatConfig, who: string, rawOrigins: unknown): Promise<SetCorsResult> {
  void config;
  const checked = validateOrigins(rawOrigins);
  if (!checked.ok) return { ok: false, code: 'INVALID_INPUT', message: checked.message };
  // `null` rather than `undefined` for "back to the default". Undefined is the absence of an
  // instruction, and the Postgres provider reads it as "leave this column alone"; SQLite rewrites the
  // whole row and reads it as cleared. The two admin doors passed undefined for as long as they
  // existed, so Clear never cleared on the production backend; the suite that drives both found it.
  const updates: Record<string, unknown> = { allowedOrigins: checked.origins === null ? null : checked.origins };

  if (who.includes('#')) {
    const agent = await storage.getAgent(who);
    if (!agent) return { ok: false, code: 'NOT_FOUND', message: `Agent not found: ${who}` };
    const updated = await storage.updateAgent(who, updates);
    if (!updated) return { ok: false, code: 'INTERNAL', message: 'This one is on us — the change could not be saved. It is already reported; try again in a moment.' };
    emitChange('config');
    return { ok: true, kind: 'agent', gaii: updated.gaii, allowed_origins: updated.allowedOrigins ?? null };
  }

  const record = who.includes('@') ? await storage.getGHII(who) : await storage.getGHIIByOwner(who);
  if (!record) return { ok: false, code: 'NOT_FOUND', message: `GHII not found: ${who}` };
  const updated = await storage.updateGHII(record.ghii, updates);
  if (!updated) return { ok: false, code: 'INTERNAL', message: 'This one is on us — the change could not be saved. It is already reported; try again in a moment.' };
  emitChange('features');
  return { ok: true, kind: 'person', ghii: updated.ghii, allowed_origins: updated.allowedOrigins ?? null };
}
