/**
 * @file mcp-server-schemas.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Types for REMOTE MCP SERVERS: an MCP server somewhere else that this node connects
 *   OUT to, holds the credential for, and hands back to whoever the owner allows. The node has been
 *   an MCP server only; this is the client half.
 *
 *   THE WORD. This is not a "connection". `connection` already means an outbound ACCOUNT at an
 *   external service (TARGET-057: Gmail, Mastodon, Bluesky) and that meaning is load-bearing in
 *   src/models/connection-schemas.ts, three scope words and a settings panel. One term, one
 *   meaning: a thing in this file is a remote MCP server, and its scope words are `mcp:*`.
 *
 *   WHAT IS BORROWED FROM TARGET-057, DELIBERATELY. The credential is ciphertext in the same format
 *   from the same sealer; the refresh is the same single-flight claim; the OAuth client may be the
 *   node's or one the owner brought. Those problems were solved once and solving them again would
 *   produce a second answer to the same question.
 *
 *   WHAT IS NOT BORROWED, AND WHY. `ConnectionRecord.provider` is a key into a closed registry of
 *   hand-written provider recipes, because there are eleven providers and each needs its own
 *   resource allowlist. An MCP server is the opposite shape: an arbitrary endpoint that DESCRIBES
 *   ITSELF over the protocol, and the node learns its tools by asking. A registry key cannot hold
 *   that, so this is its own record rather than a twelfth provider.
 *
 *   THREE FIELDS CARRY THE CONFIGURABILITY, and they are separate on purpose:
 *     - `ownership`      — whose server it is: one owner's, the whole node's, or an organism's.
 *     - `callerIdentity` — who the FAR SIDE thinks is calling when an agent or app calls through.
 *     - `exposure`       — whether its tools are reached through the three gateway tools, or
 *                          flattened into the tool list with their own schemas.
 *   Collapsing any two of them produces a model that cannot express a real case: a node-wide server
 *   spent under each owner's own OAuth token, or a personal server an owner wants flattened while
 *   the operator's stays behind the gateway.
 * @structure
 *   - McpOwnership / McpAuthMode / McpCallerIdentity / McpExposure — the four enums
 *   - McpTransport — the discriminated union over the four kinds of server we can reach
 *   - McpServerCredential — the decrypted payload; never leaves the node
 *   - RemoteToolSnapshot — one tool as the far side described it, cached
 *   - McpServerRecord — the stored row, credential encrypted
 *   - PublicMcpServer — the only projection any response returns
 *   - McpPrice / normalizeMcpPrice — what a call costs, in money only, and the one check every door uses
 * @usage import type { McpServerRecord } from '../models/mcp-server-schemas.js';
 * @version-history
 *   v1.1.0 — 2026-09-16 — McpPrice is money only. Morsels are a pacer and buy nothing; a morsel price
 *     is refused on every door through normalizeMcpPrice.
 *   v1.0.0 — 2026-09-16 — Phase 1 of the MCP proxy: registry, client and gateway.
 */

/**
 * Whose server it is. This decides who may reach it at all, before any grant is consulted.
 *
 * `node` is the operator's registry: attached once, offered to owners under a policy. Its
 * `ownerGhii` is null, which is what stops it being charged to, or erased with, any one account.
 */
export type McpOwnership = 'owner' | 'node' | 'organism';

/**
 * How the far side authenticates us.
 *
 * `per-user-oauth` is not a variant of `oauth`: under `oauth` the node holds ONE credential and
 * every permitted caller spends it, and under `per-user-oauth` each person authorises separately
 * and the node holds one credential each. The difference is who the far side bills and audits, so
 * it is a stored decision rather than something inferred at call time.
 */
export type McpAuthMode = 'none' | 'static' | 'oauth' | 'per-user-oauth';

/**
 * Who the far side thinks is calling when an agent, an app or a member calls through.
 *
 * The node adds a header naming the real caller in every case; this says whose CREDENTIAL is spent.
 * `owner-only` is the refusal: the server may be used by the human and by nothing acting for them,
 * which is the right answer for a server whose terms forbid automation.
 */
export type McpCallerIdentity = 'node-credential' | 'per-user-oauth' | 'owner-only';

/**
 * How this server's tools reach an AI client.
 *
 * `gateway` costs the AI one lookup before its first call and costs the tool list nothing.
 * `flatten` puts every allowed tool in the list with its real schema, which is what an AI uses
 * best and what a tool list can least afford: this node already publishes about 340 tools. The
 * owner decides per server, because the answer depends on how much they use it.
 */
export type McpExposure = 'gateway' | 'flatten';

/**
 * Who on this node may use an operator's server.
 *
 * Only meaningful when `ownership` is `node`. An owner's own server needs no such word — it is
 * theirs — and an organism's is decided by membership.
 */
export type McpAvailability =
  /** Everyone with an account here. */
  | 'all-owners'
  /** Only the owners the operator named. */
  | 'allowlist';

/**
 * What one call costs, when the operator decided it costs something.
 *
 * MONEY ONLY. A morsel is a pacer, not a currency and not a credit, and it buys nothing: that is a
 * rule in CLAUDE.md, and phase 4 broke it by letting an operator put a morsel price on a server,
 * which is treating morsels as money. Ruled again by the developer on 2026-09-16: "MORSELS ARE NOT
 * MONEY". Morsels keep their real job on a paid call, which is pacing, and the shared metered rail
 * already burns that toll on every call it settles.
 *
 * `perCall` is integer 6-decimal MICRO-units, the same unit EntitlementUnit `money` uses, so a price
 * written here means the same number the rail will charge.
 */
export interface McpPrice {
  unit: 'money';
  /** Per call, in integer 6-decimal micro-units of `currency`. */
  perCall: number;
  /** ISO 4217. The rail defaults to EUR when it is absent. */
  currency?: string;
}

/**
 * Read a price somebody sent, or say plainly why it is not one.
 *
 * ONE IMPLEMENTATION FOR EVERY DOOR that writes a price: the operator's REST routes and the MCP tool
 * both call this, so a morsel price cannot be refused on one door and stored through the other.
 *
 * `null` and a price of zero both mean "free", because that is how a person says it. A morsel price
 * is refused rather than quietly dropped, so an operator who meant it learns why at once instead of
 * finding later that the server was free all along.
 */
export function normalizeMcpPrice(
  raw: unknown,
): { ok: true; price: McpPrice | null } | { ok: false; message: string } {
  if (raw === null || raw === undefined) return { ok: true, price: null };
  if (typeof raw !== 'object') {
    return { ok: false, message: 'A price is an amount per call and a currency, or nothing for free.' };
  }
  const p = raw as Record<string, unknown>;
  if (p.unit === 'morsels') {
    return {
      ok: false,
      message: 'A server cannot be priced in morsels. Morsels pace how much gets used; they are not '
        + 'money and they buy nothing. Price it in money, or leave it free.',
    };
  }
  if (p.unit !== undefined && p.unit !== 'money') {
    return { ok: false, message: 'A price is in money: an amount per call and a currency.' };
  }
  const perCall = typeof p.perCall === 'number' && Number.isFinite(p.perCall) ? Math.floor(p.perCall) : NaN;
  if (Number.isNaN(perCall) || perCall < 0) {
    return { ok: false, message: 'The amount per call has to be a whole number, zero or more.' };
  }
  if (perCall === 0) return { ok: true, price: null };
  const currency = typeof p.currency === 'string' && /^[A-Z]{3}$/.test(p.currency) ? p.currency : undefined;
  if (p.currency !== undefined && !currency) {
    return { ok: false, message: 'The currency is a three-letter code, such as EUR or USD.' };
  }
  return { ok: true, price: { unit: 'money', perCall, ...(currency ? { currency } : {}) } };
}

/**
 * `needs_reauth` is a user-visible state and not an error: it is what a failed refresh resolves to,
 * and the settings panel renders it as a button that fixes it. `unreachable` is the far side being
 * down or gone, which ages a server out of discovery without detaching it.
 */
export type McpServerStatus = 'active' | 'needs_reauth' | 'unreachable' | 'disabled';

/** Where the server is and how we speak to it. */
export type McpTransport =
  /** A hosted server reachable by URL. The ordinary case, and the only one enabled by default. */
  | { kind: 'http'; url: string; headers?: Record<string, string> }
  /** The older SSE transport, for servers that have not moved to Streamable HTTP. */
  | { kind: 'sse'; url: string; headers?: Record<string, string> }
  /**
   * A process this node spawns. Operator only, allowlisted command, off unless
   * AIMEAT_MCP_STDIO_ENABLED is true: it runs somebody else's code on the host.
   */
  | { kind: 'stdio'; command: string; args: string[]; env?: Record<string, string> }
  /** A peer AIMEAT node, reached under the federation tier already agreed with it. */
  | { kind: 'aimeat'; peerNodeId: string };

/**
 * Decrypted credential payload. Interpreted per `shape`; never leaves the node, never appears in a
 * response, never reaches a log. Same two shapes as TARGET-057 minus `session`, which is an
 * AT-Proto detail with no MCP equivalent.
 */
export interface McpServerCredential {
  shape: 'oauth2' | 'static';
  /** oauth2: the access token. static: the whole secret, sent as a bearer or a named header. */
  accessToken: string;
  /** oauth2 only. */
  refreshToken?: string;
  /** For `static` servers that want the secret somewhere other than Authorization. */
  headerName?: string;
  /**
   * oauth2 only: the client registration that MINTED these tokens.
   *
   * Sealed with them rather than stored beside them, because a refresh must use the same client,
   * and it is as secret as the token it sits next to. Two rows that can disagree is how a
   * connection authorises fine and then dies on its first renewal.
   */
  oauthClient?: { client_id: string; client_secret?: string };
}

/**
 * One tool as the far side described it, as of `lastListedAt`.
 *
 * CACHED RATHER THAN ASKED PER CALL, and the reason is the tool list: an AI client asks us for
 * every tool it can use on every session, and reaching eight remote servers before we can answer
 * makes our own tool list as slow as the slowest thing anyone attached. The cache is refreshed on
 * connect, on a timer, and whenever the far side sends `tools/listChanged`.
 *
 * `inputSchema` is the upstream JSON Schema, stored verbatim. We do not rewrite it: a schema we
 * edited is a schema that disagrees with the server that will validate the call.
 */
export interface RemoteToolSnapshot {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
}

/**
 * One remote MCP server. `ownership` + `ownerGhii` + `slug` is the natural key: an owner's servers
 * are named uniquely to them, and the operator's live in their own space so an owner cannot shadow
 * one by attaching a server with the same name.
 */
export interface McpServerRecord {
  id: string;

  /**
   * Short stable name, `^[a-z0-9][a-z0-9-]{0,30}[a-z0-9]$`. It is the handle a caller names instead
   * of a URL, and the prefix a flattened tool carries (`jira__create_issue`), so it is validated on
   * write and never changed afterwards: renaming it would silently break every grant naming it.
   */
  slug: string;
  title: string;
  description: string;

  ownership: McpOwnership;
  /** GHII of the owner. Null when `ownership` is `node` — an operator's server belongs to nobody. */
  ownerGhii: string | null;
  /** Set when `ownership` is `organism`. */
  organismId: string | null;
  /** Optionally narrows an organism's server to one workspace inside it. */
  ws: string | null;
  /** The principal that attached it, for provenance. Immutable. */
  createdBy: string;

  transport: McpTransport;

  auth: McpAuthMode;
  /** Ciphertext `iv:tag:ct` of a JSON McpServerCredential. Never in any response. */
  credential: string | null;
  credentialShape: 'oauth2' | 'static' | null;
  /** Null is valid: plenty of tokens do not expire. */
  expiresAt: string | null;
  /** Which client registration minted the token, so the refresh renews with the same one. */
  providerClientId: string | null;

  callerIdentity: McpCallerIdentity;
  exposure: McpExposure;

  toolCache: RemoteToolSnapshot[];
  /** sha256 of the normalised tool list. Changing it is what triggers a downstream listChanged. */
  toolCacheHash: string;
  lastListedAt: string | null;

  /**
   * Node-wide only: who may use it, and what a call costs.
   *
   * Both are null or absent on an owner's own server, because neither question applies: a person
   * does not allowlist themselves and does not bill themselves.
   */
  availability: McpAvailability | null;
  /** Owner GHIIs, when `availability` is `allowlist`. Empty means nobody but the operator. */
  allowlist: string[];
  /** What one call costs. Null means free to whoever `availability` admits. */
  price: McpPrice | null;

  /** Whether this server joins the node's directory, and who may see it there. */
  directory: {
    listed: boolean;
    visibility: 'private' | 'members' | 'public';
    tags: string[];
  };

  /** The one-gesture stop. Halts every caller on this server at once, without detaching it. */
  enabled: boolean;
  status: McpServerStatus;
  lastOkAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * What any response is allowed to say about a server.
 *
 * NO URL, NO HEADERS, NO CREDENTIAL, NO OAUTH CLIENT. The URL is out for the same reason the
 * credential is: an app that learns the endpoint can call it directly and leave every gate in this
 * system behind. A caller names the slug; the node builds the request.
 */
export interface PublicMcpServer {
  id: string;
  slug: string;
  title: string;
  description: string;
  ownership: McpOwnership;
  status: McpServerStatus;
  enabled: boolean;
  exposure: McpExposure;
  /** How many tools the far side offers. The names come from the tools call, not from a listing. */
  toolCount: number;
  lastOkAt: string | null;
}

/** The projection, in one place, so no route can invent a wider one by accident. */
export function toPublicMcpServer(row: McpServerRecord): PublicMcpServer {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    ownership: row.ownership,
    status: row.status,
    enabled: row.enabled,
    exposure: row.exposure,
    toolCount: row.toolCache.length,
    lastOkAt: row.lastOkAt,
  };
}

/** `^[a-z0-9][a-z0-9-]{0,30}[a-z0-9]$` — see McpServerRecord.slug. */
export const MCP_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,30}[a-z0-9]$/;

/**
 * The separator between a server's slug and a tool's own name in a flattened tool.
 *
 * Two underscores, because a single one is common inside an upstream tool name and would make
 * `jira_create_issue` ambiguous about where the slug ends. The slug pattern forbids underscores
 * entirely, so `slug__tool` splits on the FIRST occurrence with no ambiguity at all.
 */
export const MCP_TOOL_SEPARATOR = '__';
