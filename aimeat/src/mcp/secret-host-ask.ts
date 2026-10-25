/**
 * @file src/mcp/secret-host-ask.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description aimeat_secret_host_ask on the node's own MCP surface: the owner's "Ask me before my
 *   secret is sent to a new address for the first time", read and switched from a chat. One service
 *   with GET and PUT /v1/ghii/me/secret-host-ask (services/secret-host-ask-setting.ts); the CLI twin
 *   proxies those routes (tool-dispatch/tool-call-defs-secrets.ts).
 *
 *   memory:read reads it, as the GET route does; switching takes memory:write, as the PUT route does,
 *   asked here before the service writes. Switching off without secrets:manage asks the owner.
 * @structure registerSecretHostAskTools(mcp, storage, config, caller)
 * @usage registerSecretHostAskTools(mcp, storage, config, caller) from mcp/register-all.ts
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial (secaudit2026oct22, leads 68 and 386 reworked; Jouni, 2026-10-25).
 */
import { McpServer } from '@modelcontextprotocol/server';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { CallerContext } from '../services/caller-context.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from '../tool-catalog/shape.js';
import { zodShapeFor } from '../tool-catalog/zod-shape.js';
import { toolError } from './tool-error.js';
import { readSecretHostAsk, changeSecretHostAsk } from '../services/secret-host-ask-setting.js';

const text = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] });

export function registerSecretHostAskTools(mcp: McpServer, storage: Storage, config: AimeatConfig, caller: () => CallerContext): void {
  mcp.registerTool('aimeat_secret_host_ask', {
    description: descriptionFor('aimeat_secret_host_ask'), inputSchema: zodShapeFor('aimeat_secret_host_ask'), annotations: annotationsFor('aimeat_secret_host_ask'),
  }, async ({ on }) => {
    const who = caller();
    if (on === undefined) return text({ setting: await readSecretHostAsk(storage, config, who.ownerGhii) });
    if (!who.has('memory:write')) return toolError('SCOPE_DENIED', 'Switching this setting takes memory:write, which this session does not hold.');
    const out = await changeSecretHostAsk({ storage, config }, who, on);
    if (!out.ok) return toolError(out.code, out.message);
    return text({ setting: out.setting, ...(out.approval_request ? { approval_request: out.approval_request } : {}) });
  });
}
