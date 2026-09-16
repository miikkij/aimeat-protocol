/**
 * @file registry.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who may see and use a remote MCP server, and what attaching one does.
 *
 *   TWO SENTENCES, ONE PLACE. "List the servers this caller may use" and "this server is one the
 *   caller may use" are the whole authorization model of this subsystem. Writing them inline in the
 *   REST route and then again in the MCP tools is the drift the August 2026 audit measured 315
 *   instances of, including agents deleting another owner's extension. Both doors call these.
 *
 *   ABSENT AND NOT-YOURS ANSWER ALIKE. `requireUsableServer` returns null for both, deliberately:
 *   naming another owner's server id must not confirm that it exists.
 *
 *   ATTACHING PROBES BEFORE IT SAVES. A server that cannot be reached, or that refuses the
 *   credential, is reported at the moment the owner is still looking at the form — not later, as a
 *   tool that mysteriously never answers. The probe also fills the tool cache, so the first real
 *   call does not pay for a list.
 *
 *   THE SLUG IS THE NAME AND IT NEVER CHANGES. It is what a caller says instead of a URL and what
 *   prefixes a flattened tool, so renaming it would silently break every grant naming it. Attach
 *   validates it; nothing updates it.
 * @structure attachMcpServer · listUsableServers · requireUsableServer · detachMcpServer
 * @usage const server = await requireUsableServer(storage, ownerGhii, idOrSlug);
 * @version-history
 *   v1.0.0 — 2026-09-16 — Phase 1 of the MCP proxy. Owner-owned servers only; node-wide is phase 4
 *     and organism-bound is phase 5, and both refuse by name until then rather than half-working.
 */
import { randomUUID } from 'node:crypto';
import type { Storage } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import {
  MCP_SLUG_RE, toPublicMcpServer,
  type McpServerRecord, type McpServerCredential, type McpTransport,
  type McpCallerIdentity, type McpExposure, type PublicMcpServer,
} from '../../models/mcp-server-schemas.js';
import { sealMcpCredential, requireEncryptionKey } from './credential.js';
import { listRemoteTools } from './invoke.js';
import { mcpClientPool } from './pool.js';
import { recordAccountEvent } from '../account-events.js';
import { emitChange } from '../event-bus.js';

export interface AttachInput {
  storage: Storage;
  config: AimeatConfig;
  /** The owner this server belongs to. Always a GHII, from resolveIdentity(). */
  ownerGhii: string;
  /** The exact principal that attached it, for provenance. */
  createdBy: string;
  slug: string;
  title: string;
  description?: string;
  transport: McpTransport;
  /** Omitted means the server needs no credential. */
  credential?: McpServerCredential;
  callerIdentity?: McpCallerIdentity;
  exposure?: McpExposure;
  /**
   * Attach it now and sign in afterwards, for a server that uses OAuth.
   *
   * The row is created parked in `needs_reauth` and the probe is SKIPPED, because a server
   * that needs a token will refuse an anonymous tools/list and the owner would be told their
   * address was wrong when it was right. The round hangs the credential on this row.
   */
  deferCredential?: boolean;
}

export type AttachResult =
  | { ok: true; server: PublicMcpServer; tools: string[] }
  | { ok: false; code: AttachRefusal; message: string };

export type AttachRefusal =
  | 'BAD_SLUG'
  | 'SLUG_TAKEN'
  | 'NO_ENCRYPTION_KEY'
  | 'UNREACHABLE';

/**
 * Attach a remote MCP server to an owner.
 *
 * The order matters and is the "refuse before you write" rule: validate, then check the name is
 * free, then require the key, THEN write. A row inserted before the probe would leave a broken
 * server attached whenever the probe failed, and the owner would have to delete something they
 * never successfully created.
 */
export async function attachMcpServer(input: AttachInput): Promise<AttachResult> {
  const { storage, config, ownerGhii, slug } = input;

  if (!MCP_SLUG_RE.test(slug)) {
    return {
      ok: false,
      code: 'BAD_SLUG',
      message: 'A server name is 2 to 32 characters of lowercase letters, digits and dashes, '
        + 'starting and ending with a letter or digit. It is what you will say instead of a URL.',
    };
  }

  const clash = await storage.findMcpServerBySlug(slug, 'owner', ownerGhii);
  if (clash) {
    return {
      ok: false,
      code: 'SLUG_TAKEN',
      message: `You already have a server called "${slug}".`,
    };
  }

  let sealed: string | null = null;
  if (input.credential) {
    const key = requireEncryptionKey(config);
    if (!key) {
      // No degraded mode. Storing a token in the clear because a key was missing is worse than
      // not storing it at all.
      return {
        ok: false,
        code: 'NO_ENCRYPTION_KEY',
        message: 'This node has no encryption key configured, so it cannot hold a credential for '
          + 'this server. Set AIMEAT_ENCRYPTION_KEY.',
      };
    }
    sealed = sealMcpCredential(input.credential, key);
  }

  const now = new Date().toISOString();
  const row: McpServerRecord = {
    id: randomUUID(),
    slug,
    title: input.title || slug,
    description: input.description ?? '',
    ownership: 'owner',
    ownerGhii,
    organismId: null,
    ws: null,
    createdBy: input.createdBy,
    transport: input.transport,
    auth: input.credential ? (input.credential.shape === 'oauth2' ? 'oauth' : 'static') : 'none',
    credential: sealed,
    credentialShape: input.credential?.shape ?? null,
    expiresAt: null,
    providerClientId: null,
    callerIdentity: input.callerIdentity ?? 'node-credential',
    exposure: input.exposure ?? 'gateway',
    toolCache: [],
    toolCacheHash: '',
    lastListedAt: null,
    directory: { listed: false, visibility: 'private', tags: [] },
    enabled: true,
    // A deferred credential is not a healthy server yet: it is one waiting for a person to
    // sign in, which is exactly what needs_reauth means everywhere else here, and the panel
    // already renders that as a button rather than an error.
    status: input.deferCredential ? 'needs_reauth' : 'active',
    lastOkAt: null,
    lastError: null,
    createdAt: now,
    updatedAt: now,
  };

  await storage.createMcpServer(row);

  // A server awaiting sign-in cannot answer a tool list yet, and probing it would report the
  // address as wrong when it is right. The round fills the cache when it completes.
  if (input.deferCredential) {
    emitChange('mcp-servers', ownerGhii);
    return { ok: true, server: toPublicMcpServer(row), tools: [] };
  }

  // Probe. A server that does not answer is reported while the owner is still looking at the form.
  const probed = await listRemoteTools(storage, config, row);
  if (!probed.ok) {
    // The row stays, parked, rather than being rolled back: an owner who mistyped a token wants to
    // fix the token, not retype the whole attachment. listRemoteTools has already set the status
    // and the reason, so the panel can render the fix.
    return { ok: false, code: 'UNREACHABLE', message: probed.message };
  }

  // Attaching a server is news. A CALL through it is not, and there is deliberately no event for
  // one: a tool can be invoked hundreds of times an hour and a row each would fill the owner's
  // window in minutes, while the per-call record already exists in UsageCall. Same ruling as
  // app_tool_first_use. recordAccountEvent handles its own failures and never throws, so there is
  // nothing to catch here.
  await recordAccountEvent(storage, {
    ownerGhii,
    kind: 'mcp_server_connected',
    actorGaii: input.createdBy,
    subject: slug,
    data: { tools: String(probed.tools.length) },
  }, config);

  // The settings panel is a live surface: this is what makes a newly attached server appear
  // without a reload. Emitted HERE rather than in each door, so the REST route and the MCP tool
  // cannot announce differently — which is the same reason the access checks live in this file.
  emitChange('mcp-servers', ownerGhii);

  const stored = await storage.getMcpServer(row.id);
  return {
    ok: true,
    server: toPublicMcpServer(stored ?? row),
    tools: probed.tools.map((t) => t.name),
  };
}

/**
 * The servers this caller may use.
 *
 * Scoped by the query, so there is nothing to filter afterwards. A lookup that can return someone
 * else's row and is then filtered is a lookup that leaks the day somebody forgets the filter.
 */
export async function listUsableServers(
  storage: Storage, ownerGhii: string,
): Promise<PublicMcpServer[]> {
  const rows = await storage.listMcpServers({ ownership: 'owner', ownerGhii });
  return rows.map(toPublicMcpServer);
}

/**
 * The server, if this caller may use it. Null when they may not, and null when there is none — the
 * same answer for both, so a refusal cannot be used to discover what another owner has.
 *
 * Accepts either the id or the slug, because a person and an AI name it differently: a UI holds the
 * id it was given, and an agent says "jira".
 */
export async function requireUsableServer(
  storage: Storage, ownerGhii: string, idOrSlug: string,
): Promise<McpServerRecord | null> {
  const bySlug = await storage.findMcpServerBySlug(idOrSlug, 'owner', ownerGhii);
  if (bySlug) return bySlug;
  const byId = await storage.getMcpServer(idOrSlug);
  if (!byId || byId.ownerGhii !== ownerGhii) return null;
  return byId;
}

/** What either door may change after a server is attached. Not the slug and not the credential. */
export interface McpServerSettings {
  enabled?: boolean;
  title?: string;
  description?: string;
  exposure?: McpExposure;
}

/**
 * Change a server's settings.
 *
 * ONE IMPLEMENTATION, TWO DOORS. The REST route and aimeat_mcp_update both call this, so the
 * pool invalidation and the change announcement cannot happen on one door and not the other — and
 * a tool that reached `storage.updateMcpServer` directly would be the second implementation this
 * project has fixed the same defect in three times.
 *
 * SWITCHING OFF STOPS IT, rather than marking it for later. A pooled client would keep answering
 * through a server the owner has just switched off, for as long as the idle sweeper takes to
 * notice, and "I turned it off and it kept working" is the worst possible answer to somebody
 * cutting an integration.
 */
export async function updateMcpServerSettings(
  storage: Storage, server: McpServerRecord, settings: McpServerSettings,
): Promise<McpServerRecord> {
  await storage.updateMcpServer(server.id, settings);
  if (settings.enabled === false) await mcpClientPool.invalidate(server.id);
  if (server.ownerGhii) emitChange('mcp-servers', server.ownerGhii);
  return (await storage.getMcpServer(server.id)) ?? server;
}

/**
 * Detach a server.
 *
 * The pool is invalidated FIRST. A client left open would keep answering calls through a server the
 * owner has just removed, for as long as the idle sweeper takes to notice — and "I deleted it and
 * it kept working" is the worst possible answer to a person removing an integration.
 */
export async function detachMcpServer(
  storage: Storage, server: McpServerRecord,
): Promise<void> {
  await mcpClientPool.invalidate(server.id);
  await storage.deleteMcpServer(server.id);
  if (server.ownerGhii) emitChange('mcp-servers', server.ownerGhii);
}
