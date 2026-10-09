/**
 * @file transport-secrets.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The secrets a remote MCP server's TRANSPORT carries, sealed at rest: the environment
 *   values of a local process (`stdio` env) and the extra request headers of a hosted one
 *   (`transport.headers`). The credential column was sealed from the start (credential.ts); these
 *   two sat in plain text beside it, and an API key in an environment variable or a header is the
 *   same secret as a token (secrets audit 2026-10-09, chapter 2).
 *
 *   EACH VALUE IS SEALED TO ITS PLACE. encryptBound with the context
 *   `mcp-transport:<serverId>:<env|header>:<name>`, so a value copied into another server's row, or
 *   under another name, does not open. The names stay readable: an operator can see WHICH variables
 *   a server is given without the node opening any of them.
 *
 *   WHERE THEY OPEN. Only at the line that builds the transport (pool.ts), for the moment of the
 *   connect. No response returns a transport at all (toPublicMcpServer), so nothing else needs them.
 *
 *   THE BOOT STEP. Rows written before 2026-10-09 hold plain values. sealLegacyTransportSecrets
 *   rewrites a value only on positive evidence that it is plain text: it is not in the sealed form.
 *   A value in the sealed form that does not open is left as it is and named in the log, never
 *   overwritten, because that is a rotated key and not a plain value.
 * @structure hasTransportSecrets · sealTransportSecrets · openTransportSecrets · sealServerRowSecrets ·
 *   sealLegacyTransportSecrets
 * @usage await storage.createMcpServer(sealServerRowSecrets(row, config));
 * @version-history
 *   v1.0.0 — 2026-10-09 — Initial (secrets audit 2026-10-09, chapter 2).
 */
import { encryptBound, decryptBound, getEncryptionKey } from '../encryption.js';
import { logger } from '../../utils/logger.js';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import type { McpServerRecord, McpTransport } from '../../models/mcp-server-schemas.js';

/** The sealed form encryptBound writes: v2:iv:tag:ciphertext, hex. */
const SEALED_RE = /^v2:[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]*$/;

type KeyConfig = Pick<AimeatConfig, 'encryptionKey' | 'totpSecretEncryptionKey'>;

const contextFor = (serverId: string, where: 'env' | 'header', name: string): string =>
  `mcp-transport:${serverId}:${where}:${name}`;

/** The map of secret values this transport carries, and which kind they are. */
function secretMap(t: McpTransport): { where: 'env' | 'header'; values: Record<string, string> } | null {
  if (t.kind === 'stdio' && t.env && Object.keys(t.env).length) return { where: 'env', values: t.env };
  if ((t.kind === 'http' || t.kind === 'sse') && t.headers && Object.keys(t.headers).length) {
    return { where: 'header', values: t.headers };
  }
  return null;
}

function withValues(t: McpTransport, values: Record<string, string>): McpTransport {
  if (t.kind === 'stdio') return { ...t, env: values };
  if (t.kind === 'http' || t.kind === 'sse') return { ...t, headers: values };
  return t;
}

/** True when this transport carries an environment or extra headers. */
export function hasTransportSecrets(t: McpTransport): boolean {
  return secretMap(t) !== null;
}

/** Every value sealed to this server and name. A value already sealed is kept as it is. */
export function sealTransportSecrets(t: McpTransport, key: Buffer, serverId: string): McpTransport {
  const m = secretMap(t);
  if (!m) return t;
  const sealed: Record<string, string> = {};
  for (const [name, value] of Object.entries(m.values)) {
    sealed[name] = SEALED_RE.test(value) ? value : encryptBound(String(value), key, contextFor(serverId, m.where, name));
  }
  return withValues(t, sealed);
}

/**
 * Every value opened for the moment of a connect. A plain value (a row the boot step has not
 * reached) passes as it is; a sealed value that does not open is left out and named in the log,
 * so the process or the request goes without it rather than with ciphertext in its place.
 */
export function openTransportSecrets(t: McpTransport, config: KeyConfig, serverId: string): McpTransport {
  const m = secretMap(t);
  if (!m) return t;
  const key = getEncryptionKey(config);
  const open: Record<string, string> = {};
  for (const [name, value] of Object.entries(m.values)) {
    if (!SEALED_RE.test(value)) { open[name] = value; continue; }
    try {
      if (!key) throw new Error('no key');
      open[name] = decryptBound(value, key, contextFor(serverId, m.where, name));
    } catch {
      logger.warn('mcp-client: a sealed transport value could not be opened and was left out', {
        server: serverId, [m.where]: name,
      });
    }
  }
  return withValues(t, open);
}

/**
 * The row as it is stored: its transport's secrets sealed. Throws when there is something to seal
 * and no key; the operator's door refuses that case first with NO_ENCRYPTION_KEY.
 */
export function sealServerRowSecrets(row: McpServerRecord, config: KeyConfig): McpServerRecord {
  if (!hasTransportSecrets(row.transport)) return row;
  const key = getEncryptionKey(config);
  if (!key) throw Object.assign(new Error('No encryption key to seal the server\'s transport values.'), { code: 'NO_ENCRYPTION_KEY' });
  return { ...row, transport: sealTransportSecrets(row.transport, key, row.id) };
}

/**
 * Boot step: seal the plain transport values of rows written before 2026-10-09. Idempotent, and it
 * never throws: a failure leaves the rows as they were, to be sealed on the next boot.
 */
export async function sealLegacyTransportSecrets(storage: Storage, key: Buffer | null): Promise<number> {
  if (!key) return 0;
  let sealed = 0;
  try {
    for (const row of await storage.listMcpServers()) {
      const m = secretMap(row.transport);
      if (!m || Object.values(m.values).every(v => SEALED_RE.test(v))) continue;
      await storage.updateMcpServer(row.id, { transport: sealTransportSecrets(row.transport, key, row.id) });
      sealed++;
    }
    if (sealed) logger.info(`[mcp-client] sealed the transport values of ${sealed} remote MCP server(s)`);
  } catch (err) {
    logger.warn(`[mcp-client] sealing the old transport values failed; they stay as they were until the next boot: ${String((err as Error).message ?? err)}`);
  }
  return sealed;
}
