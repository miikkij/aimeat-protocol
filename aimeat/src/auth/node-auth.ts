/**
 * @file src/auth/node-auth.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the auth layer holds for each node this process serves, read for the node the
 *   code runs as.
 *
 *   The credential checks read a node's storage (its accounts, sessions, app grants, ecosystem apps,
 *   agents, personal access tokens and revoked tokens), a refusal reads its config, and the anonymous
 *   fallback its shared identity. Each node registers them at boot under its node id, and a read takes
 *   the value of the node the code runs as (utils/gaii.ts currentNodeId): a request of that node, what
 *   its createServer starts, its listeners and its socket handlers. A production process serves one
 *   node, so there every read names that node. In a process that serves more than one node, as the
 *   multi-node E2E suites do, node A's credentials are checked against node A's storage whichever
 *   node booted last.
 * @structure
 *   - PerNode<T>: a value per node, and the value registered last for code that runs as no node
 *   - registerSessionAuth / sessionStorage / sessionConfig: registered by middleware.ts initSessionAuth
 *   - enableAnonymousAuth / isAnonymousMode / getAnonymousCredentials: the anonymous fallback, re-exported
 *     from middleware.ts
 * @usage import { sessionStorage } from './node-auth.js';
 * @version-history
 *   v1.0.0 — 2026-09-26 — Initial: the auth layer's storage, config and anonymous identity, per node.
 *     The anonymous functions moved here from middleware.ts, which re-exports them.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { currentNodeId } from '../utils/gaii.js';

/**
 * A value each node of this process holds for itself.
 *
 * `set` files the value under a node id, or under the node the code runs as when none is given. `get`
 * answers with the value of the node the code runs as. When that node has none, what it answers
 * depends on `otherwise`: `'last'` answers with the value registered last, which is what a storage or
 * a config needs, because every node registers those at boot and code that runs as no node reads the
 * node registered last; `'none'` answers with nothing, which is what a mode needs whose absence means
 * off. Code that runs as no node at all reads the value registered last either way.
 */
export class PerNode<T> {
  private readonly byNode = new Map<string, T>();
  private last: T | undefined;

  constructor(private readonly otherwise: 'last' | 'none' = 'last') {}

  /** File `value` for `nodeId`, else for the node the code runs as; returns the key it used. */
  set(value: T, nodeId?: string | null): string {
    const key = nodeId ?? currentNodeId() ?? '';
    this.byNode.set(key, value);
    this.last = value;
    return key;
  }

  /** The value of the node the code runs as; see the class comment for a node that has none. */
  get(): T | undefined {
    const node = currentNodeId();
    if (node !== null && this.byNode.has(node)) return this.byNode.get(node);
    return node === null || this.otherwise === 'last' ? this.last : undefined;
  }
}

// ── The storage and config the credential checks read ─────────────────────────────────────────────

interface SessionAuth {
  storage: Storage | null;
  config: AimeatConfig | null;
}

const sessionAuth = new PerNode<SessionAuth>('last');

/** File a node's storage and config (middleware.ts initSessionAuth, once per node at boot). */
export function registerSessionAuth(storage: Storage | null, config: AimeatConfig | null): void {
  sessionAuth.set({ storage, config }, config?.nodeId);
}

/** The storage of the node the code runs as, else of the node registered last; null when none is. */
export function sessionStorage(): Storage | null {
  return sessionAuth.get()?.storage ?? null;
}

/** The config of the node the code runs as, else of the node registered last; null when none is. */
export function sessionConfig(): AimeatConfig | null {
  return sessionAuth.get()?.config ?? null;
}

// ── Anonymous mode: when a node enables it, its unauthenticated requests use this identity ────────

const anonymous = new PerNode<{ gaii: string; owner: string }>('none');

/**
 * Switch anonymous mode on for `nodeId` (server-bootstrap/service-init.ts, after the anonymous
 * identity is set up), else for the node the code runs as. A node that never calls this has the mode
 * off, whatever another node in the same process does.
 */
export function enableAnonymousAuth(gaii: string, owner: string, nodeId?: string): void {
  anonymous.set({ gaii, owner }, nodeId);
}

/** Is anonymous mode on for the node the code runs as? */
export function isAnonymousMode(): boolean {
  return anonymous.get() !== undefined;
}

/** The anonymous identity of the node the code runs as; empty when the mode is off there. */
export function getAnonymousCredentials(): { gaii: string; owner: string } {
  return anonymous.get() ?? { gaii: '', owner: '' };
}
