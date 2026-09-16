/**
 * @file credential.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Sealing and opening a remote MCP server's credential. The one place a token for a
 *   remote server becomes ciphertext and back, so there is exactly one place to audit.
 *
 *   The same envelope as an outbound connection's credential, from the same AES-256-GCM helper and
 *   the same node key, because it is the same problem and solving it twice would produce two
 *   answers. What differs is only the payload shape: an MCP server credential has no `session`
 *   form, and it may name the header its secret belongs in.
 *
 *   NOTHING HERE LOGS THE SECRET. A decrypt failure returns null with no ciphertext, no key state
 *   and no upstream response attached. A secret that reaches a log has left the node as surely as
 *   one that reaches an API response.
 *
 *   THREE OUTCOMES, NOT TWO. `openMcpCredential` distinguishes "this node has no key" from "the
 *   ciphertext will not open", because they need different answers: the first is an operator
 *   problem and a 503 naming the env var, and the second is the owner's and means "connect it
 *   again". Collapsing them tells the owner to reconnect an account that was never the problem.
 * @structure sealMcpCredential · openMcpCredential
 * @usage const opened = openMcpCredential(row.credential, config);
 * @version-history
 *   v1.0.0 — 2026-09-16 — Phase 1 of the MCP proxy.
 */
import { encrypt, decrypt, getEncryptionKey } from '../encryption.js';
import { logger } from '../../utils/logger.js';
import type { AimeatConfig } from '../../config.js';
import type { McpServerCredential } from '../../models/mcp-server-schemas.js';

/**
 * The node's master key, or null when none is configured.
 *
 * Callers refuse the whole operation on null rather than continue. There is no degraded mode:
 * storing a token in the clear because a key was missing is worse than not storing it at all.
 */
export function requireEncryptionKey(config: AimeatConfig): Buffer | null {
  return getEncryptionKey(config);
}

/** Seal a credential for storage. Returns `iv:tag:ct`. */
export function sealMcpCredential(credential: McpServerCredential, key: Buffer): string {
  return encrypt(JSON.stringify(credential), key);
}

/**
 * Open a stored credential.
 *
 * Returns the credential, `'no-key'` when this node has none configured, or null when the
 * ciphertext cannot be read — a rotated key, a truncated column, a row restored from a backup taken
 * under a different key. Null is a legitimate outcome the caller handles by parking the server in
 * `needs_reauth`: the honest sentence to the owner is "connect this again", not a 500.
 */
export function openMcpCredential(
  ciphertext: string, config: AimeatConfig,
): McpServerCredential | null | 'no-key' {
  const key = requireEncryptionKey(config);
  if (!key) return 'no-key';
  try {
    const parsed = JSON.parse(decrypt(ciphertext, key)) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const c = parsed as Partial<McpServerCredential>;
    if (typeof c.accessToken !== 'string') return null;
    if (c.shape !== 'oauth2' && c.shape !== 'static') return null;
    return {
      shape: c.shape,
      accessToken: c.accessToken,
      ...(typeof c.refreshToken === 'string' ? { refreshToken: c.refreshToken } : {}),
      ...(typeof c.headerName === 'string' ? { headerName: c.headerName } : {}),
      // Without this the client registration is dropped on the way back out, and the FIRST refresh
      // is the one that finds out: the exchange needs the client that minted the token.
      ...(c.oauthClient && typeof c.oauthClient.client_id === 'string'
        ? { oauthClient: c.oauthClient }
        : {}),
    };
  } catch {
    // The FACT is logged; the exception is not. A failed decrypt's message can carry fragments of
    // the ciphertext, so passing it to the logger would put key material in the log to satisfy a
    // rule about visibility. The caller adds which server it was when it parks the row.
    logger.warn(
      'mcp-client: a stored credential could not be opened (rotated key, or a backup restored under another key)',
    );
    return null;
  }
}
