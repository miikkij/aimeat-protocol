/**
 * @file src/storage/repositories/sso-connection.repository.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Storage contract for SSO connections (BR-04): an organisation's identity provider
 *   on this node, with its SAML sign-in half and its SCIM provisioning half.
 *
 *   WHY getSsoConnectionByScimTokenHash EXISTS as its own read: the SCIM door authenticates by
 *   bearer token BEFORE it trusts anything in the URL, and the fence is "the connection the token
 *   belongs to must equal the connection the path names". Resolving token → connection first makes
 *   that comparison read the stored record, never the request.
 * @structure createSsoConnection / getSsoConnection / listSsoConnections / updateSsoConnection /
 *   deleteSsoConnection / unlinkSsoConnectionsOfOrganism / getSsoConnectionByScimTokenHash.
 * @usage import type { SsoConnectionRepository } from './repositories/sso-connection.repository.js';
 * @version-history
 *   v1.1.0 — 2026-11-11 — unlinkSsoConnectionsOfOrganism: an organism delete clears its link on the
 *     connections that name it without reading the whole table.
 *   v1.0.0 — 2026-08-23 — Initial (BR-04 phase 1).
 */
import type { SsoConnectionRecord } from '../interface.js';

export interface SsoConnectionRepository {
  /** Insert. Throws on a duplicate id (the id is the URL segment; a silent replace would hand
   *  one organisation another's sign-in door). */
  createSsoConnection(record: SsoConnectionRecord): Promise<SsoConnectionRecord>;
  getSsoConnection(id: string): Promise<SsoConnectionRecord | null>;
  listSsoConnections(): Promise<SsoConnectionRecord[]>;
  /** Partial update; `id`, `createdBy` and `createdAt` never change. Null clears a nullable field. */
  updateSsoConnection(id: string, updates: Partial<SsoConnectionRecord>): Promise<SsoConnectionRecord | null>;
  deleteSsoConnection(id: string): Promise<boolean>;
  /** Clear `organismId` on every connection that names this organism, in one statement, and return
   *  how many it changed. The connections stay: each is the node's sign-in, with no organism. */
  unlinkSsoConnectionsOfOrganism(organismId: string): Promise<number>;
  /** Resolve a presented SCIM bearer (as SHA-256 hex) to its connection — the auth read. */
  getSsoConnectionByScimTokenHash(hash: string): Promise<SsoConnectionRecord | null>;
}
