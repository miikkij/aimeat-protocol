/**
 * @file agent-face.ts
 * @description The Agent Face convention: a published app's markdown read-surface for agents.
 *   An app publishes ONE public memory record `apps.{filename}.agentface` (a markdown string,
 *   ≤ 256 KB) under the app owner's GHII — the same record family as the WebMCP tool manifest
 *   `apps.{filename}.tools` (models/app-tool-schemas.ts). When a request for an app root URL
 *   prefers text/markdown (Accept negotiation, or ?format=md), the node serves that record; when
 *   the app declares no face, the app HTML is converted via htmlToMarkdown as a fallback. BOTH
 *   variants get a node-generated "## Agent affordances" footer (WebMCP tools, bound skills,
 *   catalog, /auth.md) so an agent landing on any app can discover how to act and learn.
 *   SECURITY (Rule 10): these are ANONYMOUS reads — the face record is served ONLY when
 *   visibility === 'public'; any other visibility (or a non-string / oversize value) is treated
 *   exactly like an absent record (fallback conversion, no error, no existence disclosure).
 * @structure
 *   - agentFaceKey(filename)             — the convention memory key
 *   - AGENT_FACE_MAX_BYTES               — 256 KB cap on the served face
 *   - loadPublicAgentFace(storage, nodeId, ownerName, filename) — the record, or null (private = absent)
 *   - buildAgentAffordances(config, ownerName, filename) — the footer both variants carry
 *   - serveAppAgentFace(res, config, storage, app) — negotiate + send; false = caller serves bytes
 * @usage
 *   import { serveAppAgentFace } from '../services/agent-face.js';
 *   if (req.query.format === 'md' || (req.query.format === undefined && prefersMarkdown(req))) {
 *     if (await serveAppAgentFace(res, config, storage, app)) return;
 *   }
 * @version-history
 *   v1.0.0 — 2026-07-14 — Initial: Agent Face convention serving (phase 1)
 *   v1.2.0 — 2026-07-28 — buildAppAgentFace() split out of serveAppAgentFace() so the per-origin
 *     llms.txt / AGENTS.md / sitemap.md builders can compose the same body instead of each pointing
 *     at this one document (agent-readability phase 12b)
 *   v1.1.0 — 2026-07-21 — Resolve the face across owner-scope (GHII + the owner's agents/eco apps) so an
 *     owner's AGENT can publish a face for the owner's app — memory is keyed by the writer, so an
 *     MCP-agent write lands under its GAII; the serve path now finds the first PUBLIC copy in the union.
 */
import type { Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage, AppRecord } from '../storage/interface.js';
import { sendMarkdown, htmlToMarkdown } from './markdown-negotiation.js';
import { cached, TTL } from './cache.js';
import { getOwnerScopePublicMemory } from './owner-memory.js';

/** The memory key an app's agent face lives under (PUBLIC record, app owner's GHII) —
 *  same identifier family as the WebMCP tool manifest `apps.{filename}.tools`. */
export const agentFaceKey = (filename: string): string => `apps.${filename}.agentface`;

/** Hard cap on a served face. An oversize value is treated like an absent record (fallback). */
export const AGENT_FACE_MAX_BYTES = 256 * 1024;

/**
 * Load the app's PUBLIC agent-face markdown, or null. Anything short of a public record with a
 * markdown string body ≤ 256 KB — missing key, any non-public visibility, a non-string value,
 * oversize — returns null identically, so an anonymous reader cannot distinguish "no face" from
 * "private face" (Rule 10: no existence disclosure on anonymous reads).
 *
 * The record is resolved across the app owner's OWNER-SCOPE union (the owner's GHII + all the owner's
 * agents + eco apps), first PUBLIC copy GHII-first — memory is keyed by the writer, so an owner's agent
 * that publishes the face via MCP `memory_write` lands it under its own GAII; without the union the
 * owner-GHII-only lookup would miss it. A private copy on the same key never shadows a public one.
 */
export async function loadPublicAgentFace(
  storage: Storage,
  nodeId: string,
  ownerName: string,
  filename: string,
): Promise<string | null> {
  const rec = await getOwnerScopePublicMemory(storage, nodeId, ownerName, agentFaceKey(filename));
  if (!rec) return null;
  if (typeof rec.value !== 'string' || rec.value.length === 0) return null;
  if (Buffer.byteLength(rec.value, 'utf-8') > AGENT_FACE_MAX_BYTES) return null;
  return rec.value;
}

/**
 * The node-generated "## Agent affordances" footer appended to EVERY markdown variant of an app
 * (declared face and converted fallback alike): where to act (WebMCP tools), what to learn
 * (bound skills), where the app lives in the catalog, and how an agent registers on this node.
 */
export function buildAgentAffordances(config: AimeatConfig, ownerName: string, filename: string): string {
  const b = config.baseUrl;
  const o = encodeURIComponent(ownerName);
  const f = encodeURIComponent(filename);
  return `

## Agent affordances

- Act — WebMCP tool listing for this app: ${b}/v1/apps/${o}/${f}/webmcp
- Learn — skills bound to this app: ${b}/v1/apps/${o}/${f}/skills
- App catalog on this node (this app: ${ownerName}/${filename}): ${b}/app-catalog.html
- Register an agent on this node (RFC 8628 device flow): ${b}/auth.md
`;
}

/** Decode app body bytes (Buffer / Uint8Array / string) to a UTF-8 string. */
function appHtml(app: AppRecord): string {
  const data = app.data as Buffer | Uint8Array | string;
  return typeof data === 'string' ? data : Buffer.from(data).toString('utf-8');
}

/**
 * Serve the app's markdown read-surface: the public agent-face record when one exists, else the
 * app HTML converted via htmlToMarkdown — both with the affordances footer, sent through
 * sendMarkdown (text/markdown; charset=utf-8, Vary: Accept, x-markdown-tokens; the fallback also
 * carries x-original-tokens). Returns false WITHOUT responding when the app is not HTML and
 * declares no face (nothing sensible to convert) — the caller then serves the bytes as usual.
 *
 * The built markdown is cached per app version (services/cache.ts): invalidated by the
 * `domain:memory` tag (REST memory writes) and `domain:apps` (republish); the short public TTL
 * is the backstop for write paths that don't emit (e.g. MCP memory_write).
 */
export async function buildAppAgentFace(
  config: AimeatConfig,
  storage: Storage,
  app: AppRecord,
): Promise<{ markdown: string; fromFace: boolean } | null> {
  const isHtml = /html/i.test(app.mimeType);
  return cached(
    `agentface:${app.ownerName}/${app.filename}:v${app.versionNumber}`,
    TTL.public,
    async (): Promise<{ markdown: string; fromFace: boolean } | null> => {
      const face = await loadPublicAgentFace(storage, config.nodeId, app.ownerName, app.filename);
      if (face === null && !isHtml) return null;
      const footer = buildAgentAffordances(config, app.ownerName, app.filename);
      const body = face ?? htmlToMarkdown(appHtml(app)).trimEnd();
      return { markdown: body + footer, fromFace: face !== null };
    },
    ['domain:memory', 'domain:apps'],
  );
}

export async function serveAppAgentFace(
  res: Response,
  config: AimeatConfig,
  storage: Storage,
  app: AppRecord,
): Promise<boolean> {
  const built = await buildAppAgentFace(config, storage, app);
  if (built === null) return false;
  sendMarkdown(res, built.markdown, built.fromFace ? undefined : appHtml(app));
  return true;
}

/** The app body as a string — exported so the per-origin document builders can reuse it. */
export function appHtmlText(app: AppRecord): string { return appHtml(app); }
