/**
 * @file app-agent-surface.ts
 * @description What ONE published app offers an agent, in one document: the app's identity, the
 *   scopes it declares, the SKILL.md packs bound to it, the crew-defs it ships, and what it sells
 *   on the EXCHANGE. These facts already existed on this node, each behind a different endpoint,
 *   two of which need a session — so the agent standing on the app's own page, which is exactly
 *   where they matter, could reach almost none of them.
 *
 *   Everything here is PUBLIC by construction (Rule 10): skills are gated through the normal
 *   visibility rules with an ANONYMOUS accessor (public-only), offerings are already-public
 *   marketplace records, and the app itself is one the node serves openly. Nothing in this
 *   document depends on who is asking, which is what makes it cacheable and safe to inline.
 * @structure
 *   - AppAgentSurface — the served shape
 *   - buildAppAgentSurface(storage, config, app) — assemble + cache it
 * @usage
 *   import { buildAppAgentSurface } from '../services/app-agent-surface.js';
 *   const surface = await buildAppAgentSurface(storage, config, app);
 * @version-history
 *   v1.1.0 — 2026-08-01 — TARGET-058 Phase 4: `ai_transparency` on the surface — whether the app's own
 *     bytes carry a provenance record, whether it asked for the scope that lets it generate content,
 *     and the node's convention in one sentence. Every member is a fact the NODE holds rather than a
 *     claim the app makes about itself; a self-asserted "we label our output" would be worth nothing
 *     to a reader deciding whether to trust it.
 *   v1.0.0 — 2026-07-28 — Initial: one public description of an app's agent-facing surface, served
 *     on the WebMCP listing and registered in-page as `about-this-app` by the bridge library.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, AppRecord } from '../storage/interface.js';
import { cached, TTL } from './cache.js';
import { listSkillsByBinding } from './skills.js';
import { filterOfferings } from './exchange-market.js';
import { parseAppScopes } from './protected-resource.js';

/** The metered EXCHANGE coordinate an app's tools are sold under. */
export const appToolExt = (owner: string, filename: string): string => `apptool:${owner}/${filename}`;

/** One SKILL.md pack bound to this app (public ones only). */
export interface AppSurfaceSkill {
  ref: string;
  name: string;
  description: string;
  version: string;
  files: string[];
}

/** One crew-def the app ships (declarative data — the node never executes it). */
export interface AppSurfaceAgent {
  name: string;
  role?: string;
  goal?: string;
}

/** One EXCHANGE listing whose coordinate is this app's tool surface. */
export interface AppSurfaceOffering {
  offering_id: string;
  title: string;
  tool: string;
  unit: string;
  base_price: number;
  currency: string | null;
  provider: string;
}

export interface AppAgentSurface {
  app: string;
  owner: string;
  /** The app id is a FILENAME and keeps its extension; the subdomain label drops it. */
  app_id: string;
  name: string;
  description: string;
  version: string;
  /** Scopes the app declares in `<meta name="aimeat-scopes">` — what it asks the owner to grant. */
  scopes: string[];
  /** The app's markdown read-surface (agent face). */
  agent_face: string;
  /** SKILL.md packs bound to this app — the method, not just the API. */
  skills: AppSurfaceSkill[];
  /** Crew-defs bundled with the app, for an owner's fleet to deploy. */
  bundled_agents: AppSurfaceAgent[];
  /** Live EXCHANGE listings for this app's tools, and where to browse them. */
  exchange: { offerings: AppSurfaceOffering[]; browse: string };
  /** What this app says about AI transparency — see AppSurfaceAiTransparency. */
  ai_transparency: AppSurfaceAiTransparency;
}

/**
 * TARGET-058: what an agent evaluating this app can know about AI transparency BEFORE calling
 * anything (07-mcp-and-agent-plane.md §4).
 *
 * Every field here is a FACT the node holds, never a claim the app makes about itself: whether the
 * node stamped a record for the app's own bytes, whether the app asked for the AI scope it would
 * need to generate content, and where the node's transparency statement lives. An app that simply
 * asserted "we label our output" would be worth nothing to a reader deciding whether to trust it.
 */
export interface AppSurfaceAiTransparency {
  /** Absolute URL of the node's machine-readable transparency statement. */
  statement: string;
  /**
   * True when the app's own bytes carry a provenance record — i.e. the node can say how the app
   * itself was built. False means UNSTATED, never "a person wrote it".
   */
  app_provenance: boolean;
  /** The record for the app's bytes, when there is one, so a reader need not fetch it separately. */
  app_provenance_url?: string;
  /**
   * True when the app declares an AI scope, so it can generate content through the node's own model
   * path. An agent reading this knows the app's OUTPUT may be model-written even where a particular
   * response carries no record.
   */
  generative: boolean;
  /**
   * What this node does with a declaration, stated once so an agent does not have to infer it: an
   * undeclared write by a non-human principal is recorded as model-written.
   */
  convention: string;
}

/** Read a string field off a loosely-typed crew-def without inventing one. */
function str(o: Record<string, unknown>, key: string): string | undefined {
  const v = o[key];
  return typeof v === 'string' && v.trim() !== '' ? v : undefined;
}

/** Decode app body bytes to a UTF-8 string. */
function appHtml(app: AppRecord): string {
  const data = app.data as Buffer | Uint8Array | string;
  return typeof data === 'string' ? data : Buffer.from(data).toString('utf-8');
}

/**
 * Assemble the app's public agent-facing surface. Cached per published version and dropped by the
 * `domain:apps` (republish) and `domain:memory` (skills + offerings are memory records) tags.
 */
export async function buildAppAgentSurface(
  storage: Storage,
  config: AimeatConfig,
  app: AppRecord,
): Promise<AppAgentSurface> {
  const b = config.baseUrl.replace(/\/+$/, '');
  const owner = app.ownerName;
  const filename = app.filename;
  const o = encodeURIComponent(owner);
  const f = encodeURIComponent(filename);

  return cached(
    `app-surface:${owner}/${filename}:v${app.versionNumber}`,
    TTL.dashboard,
    async (): Promise<AppAgentSurface> => {
      // Anonymous accessor: the visibility gate then yields PUBLIC skills only, which is the whole
      // set an unauthenticated in-page agent is allowed to know about.
      const skills = await listSkillsByBinding(storage, config, `app:${owner}/${filename}`, { ownerName: null });
      const offerings = await filterOfferings(storage, { ext: appToolExt(owner, filename) });
      const crew = app.manifest?.cortex?.agents ?? [];
      const scopes = parseAppScopes(appHtml(app));

      return {
        app: `${owner}/${filename}`,
        owner,
        app_id: filename,
        name: app.manifest?.name ?? filename,
        description: app.manifest?.description ?? '',
        version: app.manifest?.version ?? String(app.versionNumber),
        scopes,
        agent_face: `${b}/v1/apps/${o}/${f}?format=md`,
        skills: skills.map(s => ({
          ref: s.ref,
          name: s.name,
          description: s.description,
          version: s.version,
          files: (s.files ?? []).map(file => file.path),
        })),
        bundled_agents: crew.map((a, i) => {
          const entry: AppSurfaceAgent = { name: str(a, 'name') ?? str(a, 'agent') ?? `agent-${i + 1}` };
          const role = str(a, 'role');
          const goal = str(a, 'goal') ?? str(a, 'description');
          if (role) entry.role = role;
          if (goal) entry.goal = goal;
          return entry;
        }),
        exchange: {
          offerings: offerings.map(off => ({
            offering_id: off.offeringId,
            title: off.title,
            tool: off.action,
            unit: off.unit,
            base_price: off.basePrice,
            currency: off.currency,
            provider: off.providerOwner,
          })),
          browse: `${b}/v1/exchange/offerings?ext=${encodeURIComponent(appToolExt(owner, filename))}`,
        },
        ai_transparency: {
          statement: `${b}/v1/ai-transparency`,
          app_provenance: !!app.aiProvenanceId,
          ...(app.aiProvenanceId ? { app_provenance_url: `${b}/v1/provenance/${app.aiProvenanceId}` } : {}),
          // `ai:*` covers the current spelling and anything narrower a future scope adds, so this
          // does not need editing every time the AI scope vocabulary grows.
          generative: scopes.some(s => s === 'ai' || s.startsWith('ai:')),
          convention: 'Content written through this node by a non-human principal that declares no '
            + '`ai_provenance` is recorded as model-written with no human review. An absent record '
            + 'means the origin is UNSTATED — it never means a person wrote it.',
        },
      };
    },
    ['domain:apps', 'domain:memory'],
  );
}
