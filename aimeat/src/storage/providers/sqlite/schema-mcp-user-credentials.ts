/**
 * @file sqlite/schema-mcp-user-credentials.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The SQLite half of personal sign-in on a shared MCP server: mcp_user_credentials, one
 *   sealed credential per person per node-wide or organism server whose auth mode is per-user-oauth.
 *   Mirrors Postgres migration 0123. Called at the end of applySchemaTables4, after mcp_servers
 *   exists; idempotent on every boot.
 *
 *   WHY A TABLE AND NOT A MEMORY RECORD. The row holds a live OAuth token for somebody's issue
 *   tracker or wiki. A memory key is principal-writable and readable by the person's agents and
 *   apps; a credential must be readable by the node's MCP client code path only, so it gets the
 *   same treatment as mcp_servers.credential: ciphertext under the node key, in a table no route
 *   reads directly.
 * @version-history
 *   v1.0.0 — 2026-11-02 — Initial (wish-henkil-kohtainen-kirjautuminen-jaettuun-mcp-palvelimeen).
 */
import type Database from 'better-sqlite3';

export function applyMcpUserCredentialSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS mcp_user_credentials (
      serverId         TEXT NOT NULL,
      -- The person whose account at the far side this is. An agent's call spends its owner's.
      ownerGhii        TEXT NOT NULL,
      -- Ciphertext iv:authTag:ct of a JSON McpServerCredential under the node key.
      credential       TEXT NOT NULL,
      -- NULL is a legitimate value: some tokens never expire.
      expiresAt        TEXT,
      -- active | needs_reauth. One person's dead token parks that person's row, never the server.
      status           TEXT NOT NULL DEFAULT 'active',
      lastError        TEXT,
      -- Single-flight refresh claim, per person, for the reason mcp_servers has one.
      refreshClaimedAt TEXT,
      createdAt        TEXT NOT NULL,
      updatedAt        TEXT NOT NULL,
      PRIMARY KEY (serverId, ownerGhii)
    );
    CREATE INDEX IF NOT EXISTS idx_mcp_user_credentials_owner ON mcp_user_credentials(ownerGhii);
  `);
}
