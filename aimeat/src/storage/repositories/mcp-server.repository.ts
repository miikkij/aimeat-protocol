/**
 * @file src/storage/repositories/mcp-server.repository.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Repository interface for remote MCP servers: an MCP server elsewhere that this node
 *   connects out to and holds the credential for.
 *
 *   Three contracts, stated here rather than left to callers, and each one is the same contract the
 *   connection repository states for the same reason:
 *
 *   1. NO METHOD APPLIES AUTHORIZATION. Every read returns whatever matches. The route compares
 *      `ownerGhii` against resolveIdentity() and answers an IDENTICAL 404 for "absent" and "not
 *      yours", because anything else enumerates other people's servers.
 *   2. THE CREDENTIAL IS CIPHERTEXT ON THE WAY IN AND OUT. This layer never encrypts or decrypts;
 *      services/mcp-client does. A repository that decrypted would put a live token in every query
 *      result whether the caller wanted one or not.
 *   3. claimMcpRefresh() IS THE SINGLE-FLIGHT GATE and must be atomic. Several MCP servers rotate
 *      the refresh token as part of issuing a new one, so two concurrent calls on one server
 *      produce one working token and one server wrongly parked in `needs_reauth` — a failure caused
 *      entirely by our own concurrency, with nothing wrong at the far side.
 * @structure
 *   - createMcpServer / getMcpServer / findMcpServerBySlug / listMcpServers
 *   - updateMcpServer — the owner-editable fields, never the credential
 *   - updateMcpServerCredential / setMcpServerStatus / touchMcpServerOk
 *   - setMcpServerToolCache — the cached tool list plus its hash
 *   - claimMcpRefresh / releaseMcpRefresh — the single-flight pair
 *   - deleteMcpServer / deleteMcpServersByOwner
 * @usage
 *   import type { McpServerRepository } from './repositories/mcp-server.repository.js';
 * @version-history
 *   v1.0.0 — 2026-09-16 — Phase 1 of the MCP proxy.
 */
import type {
  McpServerRecord, McpServerStatus, McpOwnership, RemoteToolSnapshot,
} from '../../models/mcp-server-schemas.js';

/** Narrowing for a listing. All fields optional; omitted means "any". */
export interface McpServerQuery {
  ownership?: McpOwnership;
  ownerGhii?: string;
  organismId?: string;
  ws?: string;
  status?: McpServerStatus;
  /** Omitted returns both; the settings panel wants both, the call path wants only enabled ones. */
  enabled?: boolean;
  /** Only servers that joined the directory, for the discovery source. */
  listed?: boolean;
}

/** The fields an owner may change after attaching. Deliberately not the slug, and not the credential. */
export type McpServerPatch = Partial<Pick<
  McpServerRecord,
  'title' | 'description' | 'transport' | 'callerIdentity' | 'exposure' | 'directory' | 'enabled'
>>;

export interface McpServerRepository {
  createMcpServer(row: McpServerRecord): Promise<void>;

  /** By node-local id. Applies NO authorization — see the file header. */
  getMcpServer(id: string): Promise<McpServerRecord | undefined>;

  /**
   * The call path's lookup: resolve the name a caller gave to the server they meant.
   *
   * Scoped by ownership rather than filtered afterwards. `owner` needs the GHII because two people
   * may both have a server called `jira`; `node` must NOT take one, because an operator's server
   * belongs to nobody and a query that accepted an owner here would let the first caller to guess a
   * slug claim it. A lookup that can return the wrong row and is then filtered is a lookup that
   * leaks the day somebody forgets the filter.
   */
  findMcpServerBySlug(
    slug: string, ownership: McpOwnership, ownerGhii?: string, organismId?: string,
  ): Promise<McpServerRecord | undefined>;

  listMcpServers(query?: McpServerQuery): Promise<McpServerRecord[]>;

  /** The owner-editable fields. Silently ignores anything not in McpServerPatch. */
  updateMcpServer(id: string, patch: McpServerPatch): Promise<void>;

  /**
   * Replace the stored credential after a refresh or a re-authorisation. Takes ciphertext.
   * Clears `lastError` and sets status back to `active`, because a token exchange that worked is
   * exactly the evidence that whatever was wrong no longer is.
   */
  updateMcpServerCredential(
    id: string, credential: string | null, expiresAt: string | null,
  ): Promise<void>;

  /** Move to `needs_reauth`, `unreachable` or `disabled`, with a reason the owner can act on. */
  setMcpServerStatus(id: string, status: McpServerStatus, error?: string | null): Promise<void>;

  /** Record that a call through this server just worked. Clears `lastError`. */
  touchMcpServerOk(id: string): Promise<void>;

  /**
   * Store the tool list the far side just described, with the hash of it.
   *
   * The hash is the caller's, not ours, because the caller is the one that knows whether the list
   * really changed: it compares before writing and only tells our own clients to re-list when the
   * hash moved. A refresh that found the same twelve tools must not wake every session.
   */
  setMcpServerToolCache(id: string, tools: RemoteToolSnapshot[], hash: string): Promise<void>;

  /**
   * SINGLE-FLIGHT REFRESH, claim half. Returns true only to the caller that won; every other
   * concurrent caller gets false and waits for the winner rather than refreshing too.
   *
   * `staleAfterMs` releases a claim whose holder died mid-refresh, so a crash cannot wedge a
   * server permanently.
   */
  claimMcpRefresh(id: string, staleAfterMs: number): Promise<boolean>;

  /** Release a claim taken by claimMcpRefresh(), win or lose. */
  releaseMcpRefresh(id: string): Promise<void>;

  deleteMcpServer(id: string): Promise<void>;

  /**
   * Erase every server one owner holds. Returns how many went.
   *
   * WHY THIS IS ONE CALL AND NOT A LOOP IN THE CALLER. It exists for account erasure, where a
   * surviving row is not untidy but a live credential: the row is addressed by a GHII string, and a
   * deleted username is released for reuse, so leaving one behind hands the next person to register
   * that name the previous person's access to somebody's issue tracker.
   */
  deleteMcpServersByOwner(ownerGhii: string): Promise<number>;
}
