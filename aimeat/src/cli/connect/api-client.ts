/**
 * @file src/cli/connect/api-client.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Connector credential adapter for the shared HTTP client.
 * @version-history
 *   v1.0.0 -- 2026-09-27 -- Keep config and key-store access in the CLI; share HTTP behavior.
 */
import { AimeatClient as HttpClient } from '../../tool-dispatch/api-client.js';
import { loadConfig } from './config.js';
import { forgetCachedToken, resolveToken } from './agent-key.js';
import { refusedCredential, noteCredentialAnswer } from './refused-credentials.js';
export type { ApiResponse, Transport } from '../../tool-dispatch/api-client.js';

export class AimeatClient extends HttpClient {
  constructor(baseUrl: string, token?: string, identity?: { agent: string; owner: string }) {
    super(baseUrl, token, identity, { resolveToken, forgetCachedToken, refusedCredential, noteCredentialAnswer });
  }

  static async fromConfig(): Promise<AimeatClient> {
    const config = loadConfig();
    if (!config) throw new Error('Not configured. Run: npx aimeat connect');
    // The current credential: a key mints one, else the stored bearer. The bearer alone left an
    // agent that holds only a key with nothing to send.
    const token = await resolveToken(config.agent, config.owner, config.node_url);
    if (!token) throw new Error('No stored token. Run: npx aimeat connect');
    return new AimeatClient(config.node_url, token, { agent: config.agent, owner: config.owner });
  }

}
