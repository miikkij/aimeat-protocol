/**
 * @file invoke.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description THE CHOKEPOINT. Every proxied call to a remote MCP server passes through
 *   `callRemoteTool`, whatever door it came in by: the gateway tools, a flattened tool, the REST
 *   route, an app or an extension. One implementation, so the access check, the attribution and the
 *   metering happen where they were written once.
 *
 *   EVERY FAILURE IS A RETURNED VALUE, not a thrown error at depth. A refusal carries a sentence a
 *   person can act on and the caller decides how to show it, because this runs behind five
 *   different doors and an exception thrown here surfaces as whatever each of them happens to do
 *   with it. The same rule the connections read path follows, for the same reason.
 *
 *   WHOSE CREDENTIAL, AND WHO THE FAR SIDE IS TOLD ABOUT, are two different questions.
 *   `callerIdentity` answers the first. The second is always answered: every proxied request
 *   carries a header naming the real caller, so a server that wants to audit the chain can, even
 *   when one stored credential is spent by several of the owner's agents.
 * @structure RemoteCallResult · callRemoteTool · listRemoteTools · toolCacheHash
 * @usage const r = await callRemoteTool({ storage, config, server, tool, args, caller });
 * @version-history
 *   v1.1.0 — 2026-09-16 — Phase 6: a record naming a peer AIMEAT node is resolved to that peer's
 *     address on EVERY call, so a peering that ends or is demoted stops the calls with it.
 *   v1.0.0 — 2026-09-16 — Phase 1 of the MCP proxy.
 */
import { createHash } from 'node:crypto';
import type { Storage } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import type {
  McpServerRecord, McpServerCredential, RemoteToolSnapshot,
} from '../../models/mcp-server-schemas.js';
import { mcpClientPool } from './pool.js';
import { openMcpCredential } from './credential.js';
import { resolveWireAddress } from './transport.js';
import { refreshMcpOAuth } from './oauth.js';
import { resolveMcpAccess, applyLockedInput } from './grants.js';
import { recordUsageCall } from '../usage/usage-buffer.js';
import { ownerGhiiOf } from '../../utils/gaii.js';
import { logger } from '../../utils/logger.js';

/**
 * How long a single tool call may take.
 *
 * Separate from the connect deadline: a handshake that stalls is a broken server, and a call that
 * stalls may be a server doing real work. This is the ceiling on how long one of our requests can
 * be held open by somebody else's slowness.
 */
const CALL_TIMEOUT_MS = 60_000;

/** A proxied result. `ok: false` always carries `message`, and `message` is for a person. */
export type RemoteCallResult =
  | { ok: true; content: unknown; structuredContent?: unknown; isError: boolean }
  | { ok: false; code: RemoteCallRefusal; message: string };

export type RemoteCallRefusal =
  | 'SERVER_DISABLED'
  | 'NO_ENCRYPTION_KEY'
  | 'CREDENTIAL_UNREADABLE'
  | 'TRANSPORT_UNSUPPORTED'
  /** The record names a local process and this node does not run those at all. */
  | 'STDIO_DISABLED'
  /** It does run them, but nobody allowlisted this command. */
  | 'STDIO_NOT_ALLOWED'
  /** The record names a peer AIMEAT node this one has no active peering with. */
  | 'PEER_UNKNOWN'
  /** The peering exists but does not carry routing, which is member and genesis only. */
  | 'PEER_NOT_ROUTABLE'
  | 'UNREACHABLE'
  | 'UPSTREAM_UNAUTHORIZED'
  /** The owner's grant does not cover this tool, or its cap or its expiry ran out. */
  | 'NOT_GRANTED'
  /** A node-wide server costs morsels and the caller's owner has not got them. */
  | 'INSUFFICIENT'
  /** The operator priced this in money, which does not have a rail here yet. */
  | 'PRICE_UNSUPPORTED'
  | 'TOOL_FAILED';

export interface RemoteCallInput {
  storage: Storage;
  config: AimeatConfig;
  server: McpServerRecord;
  tool: string;
  args: Record<string, unknown>;
  /**
   * The exact principal that asked: a GHII, a GAII or a GEAI.
   *
   * Attribution AND, since phase 2, the subject of the grant lookup. The door above still decides
   * whether the caller may reach this server at all; what happens here is the narrowing the owner
   * wrote for this particular agent.
   */
  caller: string;
  /** What kind of principal it is, for the usage row. */
  callerKind?: 'owner' | 'agent' | 'app' | 'eco' | 'operator';
  /**
   * The session's scopes, so the grant check can answer the default case.
   *
   * Omitted means "the caller already proved its scope at the door", which is what the REST route
   * and the MCP tools do — requireScope and TOOL_SCOPES ran before this was reached. Passing them
   * lets a caller that has NOT been through such a door (an app, an extension) be checked here.
   */
  scopes?: string[];
}

/**
 * The hash the tool cache is compared on.
 *
 * Over the NAMES AND SCHEMAS ONLY, in sorted order. A server that reorders its tool list, or that
 * rewords a description, has not changed what any client can do — and telling every live session to
 * re-list because a full stop moved is noise that costs every one of them a round trip.
 */
export function toolCacheHash(tools: RemoteToolSnapshot[]): string {
  const material = [...tools]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((t) => `${t.name}:${JSON.stringify(t.inputSchema)}`)
    .join('\n');
  return createHash('sha256').update(material).digest('hex');
}

/**
 * Open the stored credential, or say why not.
 *
 * `auth: 'none'` legitimately has no credential and is not a failure. Everything else that cannot
 * produce one is, and the server is parked rather than retried: a node with a rotated key answers
 * the owner "reconnect this", which is true and actionable, instead of failing every call forever.
 */
async function resolveCredential(
  storage: Storage, config: AimeatConfig, server: McpServerRecord,
): Promise<{ credential: McpServerCredential | null } | { refusal: RemoteCallResult }> {
  if (server.auth === 'none' || !server.credential) return { credential: null };

  // Renew BEFORE the call rather than after a 401. A token that dies mid-flight costs a failed
  // call and a parked server, and the owner is told to reconnect something that only needed a
  // renewal. Single-flight inside, and a no-op when the token has time left or never expires.
  const fresh = await refreshMcpOAuth(storage, config, server);
  if (fresh === null) {
    await storage.setMcpServerStatus(
      server.id, 'needs_reauth', 'The stored credential could not be opened.',
    );
    return {
      refusal: {
        ok: false,
        code: 'CREDENTIAL_UNREADABLE',
        message: `The credential for "${server.slug}" cannot be read any more. Connect it again.`,
      },
    };
  }
  const row = fresh;
  if (!row.credential) return { credential: null };

  const opened = openMcpCredential(row.credential, config);
  if (opened === 'no-key') {
    return {
      refusal: {
        ok: false,
        code: 'NO_ENCRYPTION_KEY',
        message: 'This node has no encryption key configured, so it cannot open the stored '
          + 'credential. Set AIMEAT_ENCRYPTION_KEY.',
      },
    };
  }
  if (opened === null) {
    await storage.setMcpServerStatus(
      server.id, 'needs_reauth', 'The stored credential could not be opened.',
    );
    return {
      refusal: {
        ok: false,
        code: 'CREDENTIAL_UNREADABLE',
        message: `The credential for "${server.slug}" cannot be read any more. Connect it again.`,
      },
    };
  }
  return { credential: opened };
}

/** A 401/403 from the far side means the credential is dead, not that the call was wrong. */
function isUnauthorized(err: unknown): boolean {
  const m = err instanceof Error ? err.message : String(err);
  return /\b401\b|\b403\b|unauthorized|forbidden/i.test(m);
}

/**
 * Ask a server what it can do, and cache the answer.
 *
 * Returns the tools and whether the list actually CHANGED, because the caller uses that to decide
 * whether to tell our own clients to re-list. A refresh that found the same twelve tools must not
 * wake every session.
 */
export async function listRemoteTools(
  storage: Storage, config: AimeatConfig, server: McpServerRecord, identity = 'node',
): Promise<
  | { ok: true; tools: RemoteToolSnapshot[]; changed: boolean }
  | { ok: false; code: RemoteCallRefusal; message: string }
> {
  const resolved = await resolveCredential(storage, config, server);
  if ('refusal' in resolved) return resolved.refusal as { ok: false; code: RemoteCallRefusal; message: string };

  const wire = await resolveWireAddress(storage, server);
  if (!wire.ok) return wire;

  try {
    const client = await mcpClientPool.acquire(wire.server, resolved.credential, identity, config);
    const listed = await client.listTools();
    const tools: RemoteToolSnapshot[] = listed.tools.map((t) => ({
      name: t.name,
      description: t.description ?? '',
      inputSchema: (t.inputSchema ?? {}) as Record<string, unknown>,
      ...(t.annotations ? { annotations: t.annotations as Record<string, unknown> } : {}),
    }));
    const hash = toolCacheHash(tools);
    const changed = hash !== server.toolCacheHash;
    await storage.setMcpServerToolCache(server.id, tools, hash);
    await storage.touchMcpServerOk(server.id);
    return { ok: true, tools, changed };
  } catch (err) {
    return { ok: false, ...(await parkAndDescribe(storage, server, err)) };
  }
}

/**
 * Turn a thrown transport error into a parked server and a sentence.
 *
 * The status matters as much as the message: `needs_reauth` is a thing the owner can fix and the
 * panel renders as a button, while `unreachable` is somebody else's outage and ages the server out
 * of discovery without detaching it. Reporting both as "error" would make them the same to a reader
 * and the wrong one actionable.
 */
async function parkAndDescribe(
  storage: Storage, server: McpServerRecord, err: unknown,
): Promise<{ code: RemoteCallRefusal; message: string }> {
  const raw = err instanceof Error ? err.message : String(err);

  // The stdio policy attaches its own code, because "this node does not run local processes" and
  // "nobody allowlisted that command" are fixed in two different places.
  const tagged = (err as { code?: unknown }).code;
  if (tagged === 'STDIO_DISABLED' || tagged === 'STDIO_NOT_ALLOWED') {
    return { code: tagged, message: raw };
  }
  if (/cannot run a local MCP server|peer AIMEAT node/i.test(raw)) {
    return { code: 'TRANSPORT_UNSUPPORTED', message: raw };
  }
  if (isUnauthorized(err)) {
    await storage.setMcpServerStatus(server.id, 'needs_reauth', raw);
    await mcpClientPool.invalidate(server.id);
    return {
      code: 'UPSTREAM_UNAUTHORIZED',
      message: `"${server.slug}" refused this node's credential. Connect it again.`,
    };
  }
  await storage.setMcpServerStatus(server.id, 'unreachable', raw);
  await mcpClientPool.invalidate(server.id);
  // The reason is logged rather than returned verbatim: an upstream error string can carry the
  // endpoint, and the endpoint is the one thing this whole design keeps away from callers.
  logger.warn('mcp-client: a remote server could not be reached', { server: server.slug, error: raw });
  return { code: 'UNREACHABLE', message: `"${server.slug}" could not be reached.` };
}

/**
 * Call one tool on one remote server.
 *
 * The caller has ALREADY decided this principal may do this: access is resolved before this is
 * reached, by the door that knows who is asking. What happens here is the call itself, its
 * attribution and its measurement.
 */
export async function callRemoteTool(input: RemoteCallInput): Promise<RemoteCallResult> {
  const { storage, config, server, tool, args, caller } = input;
  const started = Date.now();

  // The owner is who this is FOR, whoever asked. An agent's call is its owner's usage, the way
  // every other meter in this node collapses a principal to the human it acts for.
  const ownerGhii = server.ownerGhii ?? ownerGhiiOf(caller);

  let charged = 0;
  const record = (outcome: 'ok' | 'refused' | 'error', reason = ''): void => {
    recordUsageCall({
      ownerGhii,
      actorGaii: caller,
      actorKind: input.callerKind ?? 'owner',
      surface: 'mcp-remote',
      // slug/tool, never the endpoint: a usage row is read by people and exported.
      coordinate: `${server.slug}/${tool}`,
      outcome,
      reason,
      durationMs: Date.now() - started,
      // What this call actually cost, so an owner's spend on the operator's registry is visible in
      // the same stream as everything else they are charged for.
      ...(charged > 0 ? { chargedUnits: charged, unit: 'morsels' as const } : {}),
    });
  };

  if (!server.enabled || server.status === 'disabled') {
    record('refused', 'SERVER_DISABLED');
    return {
      ok: false,
      code: 'SERVER_DISABLED',
      message: `"${server.slug}" is switched off.`,
    };
  }

  // The owner's narrowing, before anything is spent. A refusal here is `refused` and not `error` in
  // the usage stream on purpose: the system worked, and what it recorded is a demand signal saying
  // which agent wanted which tool it could not have.
  const access = await resolveMcpAccess({
    storage, server, grantee: caller, tool,
    scopes: input.scopes ?? ['mcp:use'],
  });
  if (!access.allowed) {
    record('refused', access.code);
    return { ok: false, code: 'NOT_GRANTED', message: access.message };
  }
  // The grant's fixed arguments WIN over what the caller sent. "Only in project SUPPORT" is not a
  // suggestion, and a caller supplying its own project must not steer out of the fence.
  const effectiveArgs = applyLockedInput(args, access.lockedInput);

  // The operator's price, when there is one. Charged BEFORE the call and given back if the call
  // never happened, which is the same order the app-tool path uses and for the same reason: a
  // caller must never be charged for something that did not run.
  const toll = await chargeForCall(storage, server, ownerGhii);
  if (toll.ok) charged = toll.charged;
  if (!toll.ok) {
    record('refused', toll.code);
    return { ok: false, code: toll.code, message: toll.message };
  }

  const resolved = await resolveCredential(storage, config, server);
  if ('refusal' in resolved) {
    const refusal = resolved.refusal as { ok: false; code: RemoteCallRefusal; message: string };
    record('refused', refusal.code);
    return refusal;
  }

  const identity = server.callerIdentity === 'per-user-oauth' ? ownerGhii : 'node';

  // A peer node is an address this node looks up rather than one somebody typed, and the peering
  // is re-read on every call so a demoted or ended relationship stops the calls with it.
  const wire = await resolveWireAddress(storage, server);
  if (!wire.ok) {
    record('refused', wire.code);
    return { ok: false, code: wire.code, message: wire.message };
  }

  try {
    const client = await mcpClientPool.acquire(wire.server, resolved.credential, identity, config);
    const result = await client.callTool({ name: tool, arguments: effectiveArgs }, undefined, {
      timeout: CALL_TIMEOUT_MS,
    });
    await storage.touchMcpServerOk(server.id);

    // isError true is the TOOL saying no, which is a successful proxy of an unsuccessful call. The
    // distinction matters in the usage stream: 'error' there means OUR system failed.
    const isError = result.isError === true;
    record(isError ? 'refused' : 'ok', isError ? 'TOOL_REFUSED' : '');
    return {
      ok: true,
      content: result.content,
      ...(result.structuredContent !== undefined ? { structuredContent: result.structuredContent } : {}),
      isError,
    };
  } catch (err) {
    // The call never happened, so whatever it cost goes back. Refunding before the row is written
    // means a failure cannot leave somebody paying for nothing even if the next line throws.
    await toll.refund();
    const described = await parkAndDescribe(storage, server, err);
    record('error', described.code);
    return { ok: false, ...described };
  }
}

/** What a priced call cost, and how to give it back. */
type Toll =
  | { ok: true; charged: number; refund: () => Promise<void> }
  | { ok: false; code: 'INSUFFICIENT' | 'PRICE_UNSUPPORTED'; message: string };

/**
 * Charge the caller's owner for one call on a priced node-wide server.
 *
 * FREE UNLESS THE OPERATOR SAID OTHERWISE, and an owner's own server is never priced at all — a
 * person does not bill themselves.
 *
 * MORSELS ONLY, DELIBERATELY. A morsel is this node's own pacer and `debitBalance` already resolves
 * every agent to the human it acts for, so charging one is a complete act with nothing else to
 * arrange. MONEY is refused by name rather than half-implemented: real money here means the
 * entitlement rails — an offering the owner accepted, a budget, a receipt, a payout to the operator
 * — and inventing a second path to move it would be exactly the parallel mechanism this project
 * keeps deleting. The refusal says so, so an operator who priced in money learns why immediately
 * instead of discovering that nobody was ever charged.
 */
async function chargeForCall(
  storage: Storage, server: McpServerRecord, ownerGhii: string,
): Promise<Toll> {
  const price = server.ownership === 'node' ? server.price : null;
  if (!price || price.perCall <= 0) return { ok: true, charged: 0, refund: async () => {} };

  if (price.unit !== 'morsels') {
    return {
      ok: false,
      code: 'PRICE_UNSUPPORTED',
      message: `"${server.slug}" is priced in money, which this node cannot charge for a proxied `
        + 'call yet. Whoever runs it can price it in morsels instead.',
    };
  }

  const paid = await storage.debitBalance(ownerGhii, price.perCall);
  if (!paid) {
    return {
      ok: false,
      code: 'INSUFFICIENT',
      message: `"${server.slug}" costs ${price.perCall} morsel(s) a call, and this account has not `
        + 'got them right now.',
    };
  }
  return {
    ok: true,
    charged: price.perCall,
    refund: async () => { await storage.creditBalance(ownerGhii, price.perCall); },
  };
}
